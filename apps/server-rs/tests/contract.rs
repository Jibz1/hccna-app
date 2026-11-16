//! The schema contract: every type and field the Rust server defines must exist in
//! `packages/schema/schema.graphql` (the TS server's SDL) with the same kind, type strings,
//! arguments and default values. Descriptions and directives are not compared.
//!
//! The SDL is found by package name, as the repository requires: walking up from this crate,
//! the first `packages/*/package.json` named `@hccnj/schema` wins, and its `exports` entry for
//! `./schema.graphql` gives the file. `HCCNA_SCHEMA_PATH` overrides the search.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use async_graphql::parser::types::{
    FieldDefinition, InputValueDefinition, ServiceDocument, TypeDefinition, TypeKind,
    TypeSystemDefinition,
};

use hccna_server_rs::gateway::route::PARTIAL_FIELDS;

const SCHEMA_PACKAGE: &str = "@hccnj/schema";

/// The `@hccnj/schema` SDL file under `start` or one of its ancestors.
fn find_schema_from(start: &Path) -> Option<PathBuf> {
    start.ancestors().find_map(|dir| {
        let mut candidates = vec![dir.to_path_buf()];
        if let Ok(entries) = std::fs::read_dir(dir.join("packages")) {
            let mut packages: Vec<PathBuf> = entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.is_dir())
                .collect();
            packages.sort();
            candidates.extend(packages);
        }
        candidates
            .into_iter()
            .find_map(|package| schema_file(&package))
    })
}

/// The SDL file of `package` when its `package.json` names it `@hccnj/schema`.
fn schema_file(package: &Path) -> Option<PathBuf> {
    let manifest = std::fs::read_to_string(package.join("package.json")).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest).ok()?;
    if manifest.get("name").and_then(serde_json::Value::as_str) != Some(SCHEMA_PACKAGE) {
        return None;
    }
    let export = manifest
        .pointer("/exports/.~1schema.graphql")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("./schema.graphql");
    Some(package.join(export.trim_start_matches("./")))
}

fn schema_path() -> PathBuf {
    if let Some(path) = std::env::var_os("HCCNA_SCHEMA_PATH") {
        return PathBuf::from(path);
    }
    find_schema_from(Path::new(env!("CARGO_MANIFEST_DIR"))).unwrap_or_else(|| {
        panic!(
            "no {SCHEMA_PACKAGE} package above {}; set HCCNA_SCHEMA_PATH",
            env!("CARGO_MANIFEST_DIR")
        )
    })
}

/// Differences that break the contract, one line each.
fn contract_violations(rust_sdl: &str, ts_sdl: &str) -> Vec<String> {
    let rust = Schema::parse(rust_sdl, "Rust");
    let ts = Schema::parse(ts_sdl, "TS");
    let mut violations = Vec::new();
    for (name, rust_type) in &rust.types {
        if is_builtin(name) {
            continue;
        }
        let Some(ts_type) = ts.types.get(name) else {
            violations.push(format!("{name}: not in TS"));
            continue;
        };
        match (&rust_type.kind, &ts_type.kind) {
            (TypeKind::Object(r), TypeKind::Object(t)) => {
                compare_fields(
                    name,
                    &r.fields,
                    &t.fields,
                    ts.is_root(name) || is_partial(name),
                    &mut violations,
                );
            }
            (TypeKind::Interface(r), TypeKind::Interface(t)) => {
                compare_fields(
                    name,
                    &r.fields,
                    &t.fields,
                    ts.is_root(name),
                    &mut violations,
                );
            }
            (TypeKind::Union(r), TypeKind::Union(t)) => {
                let members = |members: &[async_graphql::Positioned<async_graphql::Name>]| {
                    members
                        .iter()
                        .map(|member| member.node.to_string())
                        .collect::<BTreeSet<_>>()
                };
                compare_sets(
                    name,
                    "members",
                    members(&r.members),
                    members(&t.members),
                    &mut violations,
                );
            }
            (TypeKind::Enum(r), TypeKind::Enum(t)) => {
                let values = |values: &[async_graphql::Positioned<
                    async_graphql::parser::types::EnumValueDefinition,
                >]| {
                    values
                        .iter()
                        .map(|value| value.node.value.node.to_string())
                        .collect::<BTreeSet<_>>()
                };
                compare_sets(
                    name,
                    "values",
                    values(&r.values),
                    values(&t.values),
                    &mut violations,
                );
            }
            (TypeKind::InputObject(r), TypeKind::InputObject(t)) => {
                compare_inputs(name, &r.fields, &t.fields, &mut violations);
            }
            (TypeKind::Scalar, TypeKind::Scalar) => {}
            (r, t) => violations.push(format!(
                "{name}: {} in Rust but {} in TS",
                kind_name(r),
                kind_name(t)
            )),
        }
    }
    violations
}

struct Schema {
    types: BTreeMap<String, TypeDefinition>,
    roots: BTreeSet<String>,
}

impl Schema {
    fn parse(sdl: &str, side: &str) -> Self {
        let document: ServiceDocument = async_graphql::parser::parse_schema(sdl)
            .unwrap_or_else(|error| panic!("the {side} SDL does not parse: {error}"));
        let mut types = BTreeMap::new();
        let mut roots = BTreeSet::new();
        for definition in document.definitions {
            match definition {
                TypeSystemDefinition::Type(definition) => {
                    types.insert(definition.node.name.node.to_string(), definition.node);
                }
                TypeSystemDefinition::Schema(schema) => {
                    let schema = schema.node;
                    for root in [schema.query, schema.mutation, schema.subscription]
                        .into_iter()
                        .flatten()
                    {
                        roots.insert(root.node.to_string());
                    }
                }
                TypeSystemDefinition::Directive(_) => {}
            }
        }
        if roots.is_empty() {
            roots.extend(["Query", "Mutation", "Subscription"].map(str::to_owned));
        }
        Self { types, roots }
    }

    fn is_root(&self, name: &str) -> bool {
        self.roots.contains(name)
    }
}

/// A type the gateway answers only some fields of (`PARTIAL_FIELDS`); TS answers the rest.
fn is_partial(name: &str) -> bool {
    PARTIAL_FIELDS
        .iter()
        .any(|partial| partial.type_name == name)
}

fn is_builtin(name: &str) -> bool {
    name.starts_with("__") || matches!(name, "String" | "Int" | "Float" | "Boolean" | "ID")
}

fn kind_name(kind: &TypeKind) -> &'static str {
    match kind {
        TypeKind::Scalar => "scalar",
        TypeKind::Object(_) => "object",
        TypeKind::Interface(_) => "interface",
        TypeKind::Union(_) => "union",
        TypeKind::Enum(_) => "enum",
        TypeKind::InputObject(_) => "input",
    }
}

/// Every Rust field must match TS. Root types, and the types of the gateway's partial fields, may
/// define a subset; others must define them all.
fn compare_fields(
    type_name: &str,
    rust: &[async_graphql::Positioned<FieldDefinition>],
    ts: &[async_graphql::Positioned<FieldDefinition>],
    root: bool,
    violations: &mut Vec<String>,
) {
    let ts_fields: BTreeMap<String, &FieldDefinition> = ts
        .iter()
        .map(|field| (field.node.name.node.to_string(), &field.node))
        .collect();
    let mut rust_names = BTreeSet::new();
    for field in rust {
        let field = &field.node;
        let name = field.name.node.to_string();
        let coordinate = format!("{type_name}.{name}");
        rust_names.insert(name.clone());
        let Some(ts_field) = ts_fields.get(&name) else {
            violations.push(format!("{coordinate}: not in TS"));
            continue;
        };
        let (rust_type, ts_type) = (field.ty.node.to_string(), ts_field.ty.node.to_string());
        if rust_type != ts_type {
            violations.push(format!(
                "{coordinate}: type {rust_type} differs from TS {ts_type}"
            ));
        }
        compare_arguments(
            &coordinate,
            &field.arguments,
            &ts_field.arguments,
            violations,
        );
    }
    if !root {
        for name in ts_fields.keys().filter(|name| !rust_names.contains(*name)) {
            violations.push(format!("{type_name}.{name}: missing (TS has it)"));
        }
    }
}

fn compare_arguments(
    coordinate: &str,
    rust: &[async_graphql::Positioned<InputValueDefinition>],
    ts: &[async_graphql::Positioned<InputValueDefinition>],
    violations: &mut Vec<String>,
) {
    let ts_arguments = by_name(ts);
    let rust_arguments = by_name(rust);
    for (name, argument) in &rust_arguments {
        match ts_arguments.get(name) {
            None => violations.push(format!("{coordinate}: argument {name} is not in TS")),
            Some(ts_argument) => {
                if let Some(difference) = input_difference(argument, ts_argument) {
                    violations.push(format!("{coordinate}: argument {name} {difference}"));
                }
            }
        }
    }
    for name in ts_arguments
        .keys()
        .filter(|name| !rust_arguments.contains_key(*name))
    {
        violations.push(format!("{coordinate}: argument {name} is missing"));
    }
}

fn compare_inputs(
    type_name: &str,
    rust: &[async_graphql::Positioned<InputValueDefinition>],
    ts: &[async_graphql::Positioned<InputValueDefinition>],
    violations: &mut Vec<String>,
) {
    let ts_fields = by_name(ts);
    let rust_fields = by_name(rust);
    for (name, field) in &rust_fields {
        match ts_fields.get(name) {
            None => violations.push(format!("{type_name}.{name}: not in TS")),
            Some(ts_field) => {
                if let Some(difference) = input_difference(field, ts_field) {
                    violations.push(format!("{type_name}.{name}: {difference}"));
                }
            }
        }
    }
    for name in ts_fields
        .keys()
        .filter(|name| !rust_fields.contains_key(*name))
    {
        violations.push(format!("{type_name}.{name}: missing (TS has it)"));
    }
}

fn by_name(
    values: &[async_graphql::Positioned<InputValueDefinition>],
) -> BTreeMap<String, &InputValueDefinition> {
    values
        .iter()
        .map(|value| (value.node.name.node.to_string(), &value.node))
        .collect()
}

/// How an argument or input field differs in type or default value, if it does.
fn input_difference(rust: &InputValueDefinition, ts: &InputValueDefinition) -> Option<String> {
    let (rust_type, ts_type) = (rust.ty.node.to_string(), ts.ty.node.to_string());
    if rust_type != ts_type {
        return Some(format!("type {rust_type} differs from TS {ts_type}"));
    }
    let default = |value: &InputValueDefinition| {
        value
            .default_value
            .as_ref()
            .map(|default| default.node.clone())
    };
    let (rust_default, ts_default) = (default(rust), default(ts));
    if rust_default != ts_default {
        let show = |value: Option<async_graphql::Value>| {
            value.map_or_else(|| "none".to_owned(), |value| value.to_string())
        };
        return Some(format!(
            "default {} differs from TS {}",
            show(rust_default),
            show(ts_default)
        ));
    }
    None
}

fn compare_sets(
    name: &str,
    what: &str,
    rust: BTreeSet<String>,
    ts: BTreeSet<String>,
    violations: &mut Vec<String>,
) {
    if rust != ts {
        let join = |set: BTreeSet<String>| set.into_iter().collect::<Vec<_>>().join(", ");
        violations.push(format!(
            "{name}: {what} {} differ from TS {}",
            join(rust),
            join(ts)
        ));
    }
}

#[test]
fn rust_schema_matches_the_ts_contract() {
    let path = schema_path();
    let ts_sdl = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("reading {}: {error}", path.display()));
    let violations = contract_violations(&hccna_server_rs::graphql::sdl(), &ts_sdl);
    assert!(
        violations.is_empty(),
        "the Rust schema breaks the contract in {}:\n{}",
        path.display(),
        violations.join("\n")
    );
}

/// Root fields this crate serves. The contract above only compares what the Rust schema defines,
/// so a ported field that went missing would otherwise pass unnoticed.
const PORTED_ROOT_FIELDS: [&str; 13] = [
    "campuses",
    "campusesV2",
    "ccbFormsV2",
    "core",
    "events",
    "getPreviousFiveYearsGivingV2",
    "liveStreamStatus",
    "myGivingHistory",
    "sermons",
    "thoughtOfGod",
    "upcomingEventsByMonth",
    "user",
    "verseOfTheDayV2",
];

#[test]
fn the_rust_schema_serves_every_ported_root_field() {
    let rust = Schema::parse(&hccna_server_rs::graphql::sdl(), "Rust");
    let Some(TypeKind::Object(query)) = rust.types.get("Query").map(|query| &query.kind) else {
        panic!("the Rust schema has no Query object");
    };
    let fields: BTreeSet<String> = query
        .fields
        .iter()
        .map(|field| field.node.name.node.to_string())
        .collect();
    let missing: Vec<&str> = PORTED_ROOT_FIELDS
        .into_iter()
        .filter(|field| !fields.contains(*field))
        .collect();
    assert!(
        missing.is_empty(),
        "missing from the Rust schema: {missing:?}"
    );
}

/// A partial type's Rust fields are exactly the ones the gateway answers locally, so the routing
/// list and the schema cannot drift apart.
#[test]
fn partial_types_define_exactly_their_local_fields() {
    let rust = Schema::parse(&hccna_server_rs::graphql::sdl(), "Rust");
    for partial in PARTIAL_FIELDS {
        let Some(TypeKind::Object(object)) = rust.types.get(partial.type_name).map(|ty| &ty.kind)
        else {
            panic!("the Rust schema has no {} object", partial.type_name);
        };
        let defined: BTreeSet<String> = object
            .fields
            .iter()
            .map(|field| field.node.name.node.to_string())
            .collect();
        let listed: BTreeSet<String> = partial.fields.iter().map(|f| (*f).to_owned()).collect();
        assert_eq!(defined, listed, "{}", partial.type_name);
    }
}

const TS: &str = r#"
    type Query {
        ccbFormsV2: CCBFormsResult
        sermons(first: Int = 10, after: String): [Sermon!]
        other: String
    }
    type Sermon { id: ID! title: String tags: [String!]! }
    union CCBFormsResult = A | B
    type A { a: Int }
    type B { b: Int }
    enum Reoccurring { DAILY WEEKLY }
    input Filter { slug: String = "home" }
    scalar JSON
"#;

#[test]
fn accepts_a_matching_subset_of_the_root() {
    let rust = r#"
        type Query { sermons(after: String, first: Int = 10): [Sermon!] }
        type Sermon { id: ID! title: String tags: [String!]! }
        enum Reoccurring { WEEKLY DAILY }
        input Filter { slug: String = "home" }
        scalar JSON
        schema { query: Query }
    "#;
    assert_eq!(contract_violations(rust, TS), Vec::<String>::new());
}

#[test]
fn reports_type_argument_and_member_differences() {
    let rust = r#"
        type Query {
            ccbFormsV2: CCBFormsResult!
            sermons(first: Int = 20, before: String): [Sermon!]
            extra: String
        }
        type Sermon { id: ID! title: String }
        union CCBFormsResult = A
        type A { a: Int }
        enum Reoccurring { DAILY }
        input Filter { slug: String }
        type Unknown { x: Int }
        interface JSON { x: Int }
    "#;
    let violations = contract_violations(rust, TS);
    let expected = [
        "Query.ccbFormsV2: type CCBFormsResult! differs from TS CCBFormsResult",
        "Query.sermons: argument first default 20 differs from TS 10",
        "Query.sermons: argument before is not in TS",
        "Query.sermons: argument after is missing",
        "Query.extra: not in TS",
        "Sermon.tags: missing (TS has it)",
        "CCBFormsResult: members A differ from TS A, B",
        "Reoccurring: values DAILY differ from TS DAILY, WEEKLY",
        "Filter.slug: default none differs from TS \"home\"",
        "Unknown: not in TS",
        "JSON: interface in Rust but scalar in TS",
    ];
    for line in expected {
        assert!(
            violations.contains(&line.to_owned()),
            "missing {line:?} in {violations:#?}"
        );
    }
    assert_eq!(violations.len(), expected.len(), "{violations:#?}");
}

#[test]
fn finds_the_schema_package_by_name() {
    let root = std::env::temp_dir().join(format!("hccna-contract-{}", std::process::id()));
    let crate_dir = root.join("apps/server-rs");
    let package = root.join("packages/contract");
    std::fs::create_dir_all(&crate_dir).unwrap();
    std::fs::create_dir_all(package.join("sdl")).unwrap();
    std::fs::create_dir_all(root.join("packages/other")).unwrap();
    std::fs::write(
        root.join("packages/other/package.json"),
        r#"{"name":"@hccnj/other"}"#,
    )
    .unwrap();
    std::fs::write(
        package.join("package.json"),
        r#"{"name":"@hccnj/schema","exports":{"./schema.graphql":"./sdl/schema.graphql"}}"#,
    )
    .unwrap();
    std::fs::write(package.join("sdl/schema.graphql"), "type Query { a: Int }").unwrap();

    assert_eq!(
        find_schema_from(&crate_dir),
        Some(package.join("sdl/schema.graphql"))
    );
    std::fs::remove_dir_all(&root).unwrap();
}
