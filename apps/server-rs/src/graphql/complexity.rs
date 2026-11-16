//! The TS server's query cost model (`apps/server/src/graphql/queryComplexity.ts`): every field
//! costs 1 (or its configured cost), list fields add 10 per list level and multiply their
//! children by 10 per level, unaliased `__typename` is free, and an operation over 2000 (or a raised
//! per-field maximum) is rejected with `QUERY_TOO_COMPLEX` before execution.

use std::collections::{HashMap, HashSet};

use async_graphql::parser::types::{
    BaseType, ExecutableDocument, OperationType, Selection, SelectionSet, ServiceDocument, Type,
    TypeDefinition, TypeKind, TypeSystemDefinition,
};
use serde_json::json;

use crate::graphql::errors::error_body;
use crate::graphql::operation;

/// The settings `routes/graphql.ts` passes to `useQueryComplexity`.
#[derive(Clone, Copy, Debug)]
pub struct ComplexityConfig {
    pub maximum: u64,
    /// `maximumComplexityByFieldName`: selecting one of these fields (at any depth) raises the
    /// limit to its value.
    pub field_maximums: &'static [(&'static str, u64)],
    pub default_field: u64,
    pub default_list: u64,
    /// `fieldComplexityByCoordinate`.
    pub field_costs: &'static [(&'static str, u64)],
}

impl ComplexityConfig {
    pub const TS: Self = Self {
        maximum: 2000,
        field_maximums: &[
            ("getPreviousFiveYearsGivingV2", 12_000),
            ("myGivingHistory", 12_000),
            ("givingHistory", 12_000),
            ("upcomingEventsByMonth", 12_000),
        ],
        default_field: 1,
        default_list: 10,
        field_costs: &[
            ("Query.campuses", 5),
            ("Query.campusesV2", 5),
            ("Query.events", 5),
            ("Query.upcomingEventsByMonth", 5),
            ("Query.sermons", 5),
            ("Query.castrStream", 5),
            ("Query.getPreviousFiveYearsGivingV2", 10),
            ("Query.myGivingHistory", 10),
            ("Query.exportAttendance", 25),
            ("Mutation.exportEventAttendancePdf", 25),
            ("Mutation.exportEventAttendeesPdf", 25),
        ],
    };
}

/// graphql-js's introspection types, which the schema's SDL leaves out.
const INTROSPECTION_SDL: &str = r#"
type __Schema { description: String types: [__Type!]! queryType: __Type! mutationType: __Type subscriptionType: __Type directives: [__Directive!]! }
type __Type { kind: __TypeKind! name: String description: String specifiedByURL: String fields(includeDeprecated: Boolean = false): [__Field!] interfaces: [__Type!] possibleTypes: [__Type!] enumValues(includeDeprecated: Boolean = false): [__EnumValue!] inputFields(includeDeprecated: Boolean = false): [__InputValue!] ofType: __Type isOneOf: Boolean }
type __Field { name: String! description: String args(includeDeprecated: Boolean = false): [__InputValue!]! type: __Type! isDeprecated: Boolean! deprecationReason: String }
type __InputValue { name: String! description: String type: __Type! defaultValue: String isDeprecated: Boolean! deprecationReason: String }
type __EnumValue { name: String! description: String isDeprecated: Boolean! deprecationReason: String }
type __Directive { name: String! description: String isRepeatable: Boolean! locations: [__DirectiveLocation!]! args(includeDeprecated: Boolean = false): [__InputValue!]! }
"#;

/// What the cost model needs from the schema: each composite type's fields, with their named
/// type and list depth.
#[derive(Debug)]
pub struct SchemaIndex {
    types: HashMap<String, CompositeType>,
    query: Option<String>,
    mutation: Option<String>,
    subscription: Option<String>,
    /// graphql-js's meta fields: `__typename: String!`, `__schema: __Schema!`, `__type: __Type`.
    typename: FieldType,
    schema_meta: FieldType,
    type_meta: FieldType,
}

impl Default for SchemaIndex {
    fn default() -> Self {
        Self {
            types: HashMap::new(),
            query: None,
            mutation: None,
            subscription: None,
            typename: FieldType::meta("String!"),
            schema_meta: FieldType::meta("__Schema!"),
            type_meta: FieldType::meta("__Type"),
        }
    }
}

#[derive(Debug, Default)]
struct CompositeType {
    fields: HashMap<String, FieldType>,
}

#[derive(Debug)]
pub(crate) struct FieldType {
    /// The innermost named type.
    pub(crate) named: String,
    pub(crate) list_depth: u32,
    /// The full type, with nullability at every level.
    pub(crate) ty: Type,
}

impl FieldType {
    fn of(ty: &Type) -> Self {
        let mut list_depth = 0;
        let mut base = &ty.base;
        while let BaseType::List(inner) = base {
            list_depth += 1;
            base = &inner.base;
        }
        let named = match base {
            BaseType::Named(name) => name.to_string(),
            BaseType::List(_) => unreachable!("the loop above unwraps every list"),
        };
        Self {
            named,
            list_depth,
            ty: ty.clone(),
        }
    }

    fn meta(sdl_type: &str) -> Self {
        Self::of(&Type::new(sdl_type).expect("meta field types are valid SDL types"))
    }
}

impl SchemaIndex {
    /// Indexes `sdl` (the schema's own SDL) plus the introspection types.
    pub fn from_sdl(sdl: &str) -> Result<Self, async_graphql::parser::Error> {
        let document: ServiceDocument =
            async_graphql::parser::parse_schema(format!("{sdl}\n{INTROSPECTION_SDL}"))?;
        let mut index = Self::default();
        for definition in document.definitions {
            match definition {
                TypeSystemDefinition::Schema(schema) => {
                    let name = |root: Option<async_graphql::Positioned<async_graphql::Name>>| {
                        root.map(|root| root.node.to_string())
                    };
                    index.query = name(schema.node.query);
                    index.mutation = name(schema.node.mutation);
                    index.subscription = name(schema.node.subscription);
                }
                TypeSystemDefinition::Type(definition) => {
                    let TypeDefinition { name, kind, .. } = definition.node;
                    let fields = match kind {
                        TypeKind::Object(object) => object.fields,
                        TypeKind::Interface(interface) => interface.fields,
                        TypeKind::Union(_) => Vec::new(),
                        _ => continue,
                    };
                    let fields = fields
                        .into_iter()
                        .map(|field| {
                            let field = field.node;
                            (field.name.node.to_string(), FieldType::of(&field.ty.node))
                        })
                        .collect();
                    index
                        .types
                        .insert(name.node.to_string(), CompositeType { fields });
                }
                TypeSystemDefinition::Directive(_) => {}
            }
        }
        // Without a schema definition the conventional root names apply.
        let default_root = |types: &HashMap<String, CompositeType>, name: &str| {
            types.contains_key(name).then(|| name.to_owned())
        };
        if index.query.is_none() {
            index.query = default_root(&index.types, "Query");
        }
        if index.mutation.is_none() {
            index.mutation = default_root(&index.types, "Mutation");
        }
        if index.subscription.is_none() {
            index.subscription = default_root(&index.types, "Subscription");
        }
        Ok(index)
    }

    /// `getFieldDefinition`, with the meta fields graphql-js resolves.
    pub(crate) fn field(&self, parent: &str, name: &str) -> Option<&FieldType> {
        match name {
            "__typename" => return Some(&self.typename),
            "__schema" if self.query.as_deref() == Some(parent) => return Some(&self.schema_meta),
            "__type" if self.query.as_deref() == Some(parent) => return Some(&self.type_meta),
            _ if name.starts_with("__") => return None,
            _ => {}
        }
        self.types.get(parent)?.fields.get(name)
    }

    /// The root type for an operation type.
    pub(crate) fn root(&self, kind: OperationType) -> Option<&str> {
        match kind {
            OperationType::Query => self.query.as_deref(),
            OperationType::Mutation => self.mutation.as_deref(),
            OperationType::Subscription => self.subscription.as_deref(),
        }
    }

    fn is_composite(&self, name: &str) -> bool {
        self.types.contains_key(name)
    }
}

/// The complexity of the selected operation and the limit that applies to it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Verdict {
    pub complexity: u64,
    pub maximum: u64,
}

impl Verdict {
    pub fn too_complex(&self) -> bool {
        self.complexity > self.maximum
    }

    /// The error the TS plugin returns, without `data` and with HTTP 200.
    pub fn error_body(&self) -> serde_json::Value {
        error_body(
            &format!(
                "Query is too complex: {}. Maximum allowed complexity: {}",
                self.complexity, self.maximum
            ),
            Some(json!({
                "code": "QUERY_TOO_COMPLEX",
                "complexity": self.complexity,
                "maximumComplexity": self.maximum,
            })),
        )
    }
}

/// `getVerdict`: schema-introspection operations cost nothing; others get
/// `calculateDocumentComplexity` against the operation's maximum.
pub fn verdict(
    schema: &SchemaIndex,
    config: &ComplexityConfig,
    document: &ExecutableDocument,
    operation_name: Option<&str>,
) -> Verdict {
    let selected = operation::select_operation(document, operation_name);
    // TS `isIntrospectionOperation`: only an operation whose every top-level selection (ignoring
    // an unaliased `__typename`) is `__schema`/`__type` goes unscored, so one introspection field
    // beside ordinary fields cannot waive the limit for the rest.
    let introspection = selected.is_some_and(|operation| {
        let mut selections = operation
            .definition
            .node
            .selection_set
            .node
            .items
            .iter()
            .filter(|selection| {
                !matches!(&selection.node, Selection::Field(field)
                    if field.node.name.node.as_str() == "__typename" && field.node.alias.is_none())
            })
            .peekable();
        selections.peek().is_some()
            && selections.all(|selection| {
                matches!(&selection.node, Selection::Field(field)
                    if matches!(field.node.name.node.as_str(), "__schema" | "__type"))
            })
    });
    if introspection {
        return Verdict {
            complexity: 0,
            maximum: config.maximum,
        };
    }
    let maximum = selected.map_or(config.maximum, |operation| {
        let mut names = HashSet::new();
        collect_field_names(
            document,
            &operation.definition.node.selection_set.node,
            &mut names,
            &mut HashSet::new(),
        );
        config
            .field_maximums
            .iter()
            .filter(|(field, _)| names.contains(*field))
            .fold(config.maximum, |maximum, (_, field_maximum)| {
                maximum.max(*field_maximum)
            })
    });
    Verdict {
        complexity: calculate(schema, config, document, operation_name),
        maximum,
    }
}

/// `collectSelectedFieldNames`: every field name at any depth, through fragments. The result is a
/// union, so following each fragment once (TS re-walks a fragment for every spread) gives the
/// same set in linear time.
fn collect_field_names<'a>(
    document: &'a ExecutableDocument,
    selection_set: &'a SelectionSet,
    names: &mut HashSet<&'a str>,
    visited: &mut HashSet<&'a str>,
) {
    for selection in &selection_set.items {
        match &selection.node {
            Selection::Field(field) => {
                names.insert(field.node.name.node.as_str());
                collect_field_names(document, &field.node.selection_set.node, names, visited);
            }
            Selection::InlineFragment(fragment) => {
                collect_field_names(document, &fragment.node.selection_set.node, names, visited);
            }
            Selection::FragmentSpread(spread) => {
                let name = spread.node.fragment_name.node.as_str();
                if let Some(fragment) = document.fragments.get(name)
                    && visited.insert(name)
                {
                    collect_field_names(
                        document,
                        &fragment.node.selection_set.node,
                        names,
                        visited,
                    );
                }
            }
        }
    }
}

/// `calculateDocumentComplexity`.
///
/// TS removes a fragment from its visited set after walking it, so a fragment spread at k
/// nested levels is walked 2^k times; a small valid document can stall the event loop (the TS
/// server has the same weakness). Here each fragment's cost is computed once and reused, which
/// gives TS's result in linear time. That reuse is exact when no fragment spreads itself; a
/// document with a fragment cycle costs 0 here, because validation rejects it next, as TS
/// validation does before the cost model ever runs there.
pub fn calculate(
    schema: &SchemaIndex,
    config: &ComplexityConfig,
    document: &ExecutableDocument,
    operation_name: Option<&str>,
) -> u64 {
    let Some(operation) = operation::select_operation(document, operation_name) else {
        return 0;
    };
    let Some(root) = schema.root(operation.definition.node.ty) else {
        return 0;
    };
    if has_fragment_cycle(document) {
        return 0;
    }
    let mut walk = Walk {
        schema,
        config,
        document,
        fragment_costs: HashMap::new(),
    };
    walk.selection_set(root, &operation.definition.node.selection_set.node)
}

struct Walk<'a> {
    schema: &'a SchemaIndex,
    config: &'a ComplexityConfig,
    document: &'a ExecutableDocument,
    /// Each fragment's cost on its own type condition, by name.
    fragment_costs: HashMap<&'a str, u64>,
}

/// Whether any fragment reaches itself through spreads (depth-first, each fragment once).
fn has_fragment_cycle(document: &ExecutableDocument) -> bool {
    #[derive(Clone, Copy, PartialEq)]
    enum State {
        Active,
        Done,
    }

    fn spreads<'a>(selection_set: &'a SelectionSet, out: &mut Vec<&'a str>) {
        for selection in &selection_set.items {
            match &selection.node {
                Selection::Field(field) => spreads(&field.node.selection_set.node, out),
                Selection::InlineFragment(fragment) => {
                    spreads(&fragment.node.selection_set.node, out);
                }
                Selection::FragmentSpread(spread) => {
                    out.push(spread.node.fragment_name.node.as_str());
                }
            }
        }
    }

    fn visit<'a>(
        document: &'a ExecutableDocument,
        name: &'a str,
        states: &mut HashMap<&'a str, State>,
    ) -> bool {
        match states.get(name) {
            Some(State::Active) => return true,
            Some(State::Done) => return false,
            None => {}
        }
        let Some(fragment) = document.fragments.get(name) else {
            return false;
        };
        states.insert(name, State::Active);
        let mut next = Vec::new();
        spreads(&fragment.node.selection_set.node, &mut next);
        if next.into_iter().any(|next| visit(document, next, states)) {
            return true;
        }
        states.insert(name, State::Done);
        false
    }

    let mut states = HashMap::new();
    document
        .fragments
        .keys()
        .any(|name| visit(document, name.as_str(), &mut states))
}

impl<'a> Walk<'a> {
    /// `calculateSelectionSetComplexity`. Sums saturate instead of growing past `u64::MAX`.
    fn selection_set(&mut self, parent: &str, selection_set: &'a SelectionSet) -> u64 {
        let mut total: u64 = 0;
        for selection in &selection_set.items {
            let cost = match &selection.node {
                Selection::Field(field) => {
                    let field = &field.node;
                    let name = field.name.node.as_str();
                    // The Stellate edge adds `__typename` everywhere; unaliased copies are free.
                    if name == "__typename" && field.alias.is_none() {
                        continue;
                    }
                    let Some(definition) = self.schema.field(parent, name) else {
                        continue;
                    };
                    let coordinate = format!("{parent}.{name}");
                    let field_cost = self
                        .config
                        .field_costs
                        .iter()
                        .find(|(known, _)| *known == coordinate)
                        .map_or(self.config.default_field, |(_, cost)| *cost);
                    let depth = definition.list_depth;
                    let multiplier = if depth > 0 {
                        self.config.default_list.saturating_pow(depth)
                    } else {
                        1
                    };
                    let surcharge = u64::from(depth).saturating_mul(self.config.default_list);
                    let children = if !field.selection_set.node.items.is_empty()
                        && self.schema.is_composite(&definition.named)
                    {
                        self.selection_set(&definition.named, &field.selection_set.node)
                    } else {
                        0
                    };
                    field_cost
                        .saturating_add(surcharge)
                        .saturating_add(children.saturating_mul(multiplier))
                }
                Selection::InlineFragment(fragment) => {
                    let parent = fragment
                        .node
                        .type_condition
                        .as_ref()
                        .map_or(parent, |condition| condition.node.on.node.as_str());
                    if self.schema.is_composite(parent) {
                        let parent = parent.to_owned();
                        self.selection_set(&parent, &fragment.node.selection_set.node)
                    } else {
                        0
                    }
                }
                Selection::FragmentSpread(spread) => {
                    let name = spread.node.fragment_name.node.as_str();
                    if let Some(cost) = self.fragment_costs.get(name) {
                        *cost
                    } else {
                        let Some(fragment) = self.document.fragments.get(name) else {
                            continue;
                        };
                        let on = fragment.node.type_condition.node.on.node.as_str();
                        if !self.schema.is_composite(on) {
                            continue;
                        }
                        let cost = self.selection_set(on, &fragment.node.selection_set.node);
                        self.fragment_costs.insert(name, cost);
                        cost
                    }
                }
            };
            total = total.saturating_add(cost);
        }
        total
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SCHEMA: &str = "
        type Campus {
            id: ID!
            name: String!
        }

        type Query {
            campuses: [Campus!]!
        }
    ";

    const PLAIN: ComplexityConfig = ComplexityConfig {
        maximum: 1000,
        field_maximums: &[],
        default_field: 1,
        default_list: 10,
        field_costs: &[],
    };

    fn complexity(query: &str) -> u64 {
        let schema = SchemaIndex::from_sdl(TEST_SCHEMA).unwrap();
        let document = operation::parse_document(query).unwrap();
        calculate(&schema, &PLAIN, &document, None)
    }

    // Ported from apps/server/src/graphql/__tests__/queryComplexity.test.ts.

    #[test]
    fn expands_fragment_spreads_using_the_fragment_type() {
        assert_eq!(
            complexity(
                "query Campuses { campuses { ...CampusFields } }
                 fragment CampusFields on Campus { id name }"
            ),
            31
        );
    }

    #[test]
    fn does_not_charge_the_typename_the_stellate_edge_adds() {
        assert_eq!(
            complexity("query Campuses { campuses { __typename id name } }"),
            complexity("query Campuses { campuses { id name } }")
        );
    }

    #[test]
    fn charges_an_aliased_typename_like_any_other_field() {
        assert_eq!(
            complexity("query Campuses { campuses { id name kind: __typename } }"),
            41
        );
    }

    #[test]
    fn rejects_the_selected_operation_over_the_maximum() {
        let schema = SchemaIndex::from_sdl(TEST_SCHEMA).unwrap();
        let document =
            operation::parse_document("query Campuses { campuses { id name } }").unwrap();
        let config = ComplexityConfig {
            maximum: 20,
            ..PLAIN
        };
        let verdict = verdict(&schema, &config, &document, Some("Campuses"));
        assert!(verdict.too_complex());
        assert_eq!(
            verdict.error_body(),
            json!({ "errors": [{
                "message": "Query is too complex: 31. Maximum allowed complexity: 20",
                "extensions": { "code": "QUERY_TOO_COMPLEX", "complexity": 31, "maximumComplexity": 20 },
            }] })
        );
    }

    // Further cases from the same algorithm.

    const APP_SCHEMA: &str = "
        type Sermon { id: ID title: String tags: [[String]] }
        type Event { id: ID }
        union Item = Sermon | Event
        type Query {
            sermons: [Sermon!]
            upcomingEventsByMonth: [[Event!]!]
            items: [Item]
            core: Sermon
        }
    ";

    fn app_verdict(query: &str) -> Verdict {
        let schema = SchemaIndex::from_sdl(APP_SCHEMA).unwrap();
        let document = operation::parse_document(query).unwrap();
        verdict(&schema, &ComplexityConfig::TS, &document, None)
    }

    #[test]
    fn applies_configured_costs_and_nested_lists() {
        // sermons: 5 + 10 + (id 1 + tags (1 + 20)) * 10
        assert_eq!(
            app_verdict("query S { sermons { id tags } }"),
            Verdict {
                complexity: 5 + 10 + 22 * 10,
                maximum: 2000
            }
        );
    }

    #[test]
    fn raises_the_maximum_for_listed_fields() {
        // upcomingEventsByMonth: 5 + 20 + (id 1) * 100
        assert_eq!(
            app_verdict("query U { core { id } upcomingEventsByMonth { id } }"),
            Verdict {
                complexity: 2 + 125,
                maximum: 12_000
            }
        );
    }

    #[test]
    fn follows_inline_fragments_on_union_members() {
        // items: 1 + 10 + (Sermon.title 1 + Event.id 1 + unaliased __typename 0) * 10
        assert_eq!(
            app_verdict(
                "query I { items { __typename ... on Sermon { title } ... on Event { id } } }"
            )
            .complexity,
            31
        );
    }

    #[test]
    fn treats_schema_introspection_as_free() {
        assert_eq!(
            app_verdict("query Intro { __schema { types { name fields { name } } } }"),
            Verdict {
                complexity: 0,
                maximum: 2000
            }
        );
        // Introspection reached through an inline fragment is charged like any field.
        assert!(
            app_verdict("query Intro { ... on Query { __schema { types { name } } } }").complexity
                > 0
        );
        // An unaliased `__typename` beside introspection keeps it free.
        assert_eq!(
            app_verdict("query Intro { __typename __schema { types { name } } }").complexity,
            0
        );
    }

    #[test]
    fn charges_ordinary_fields_selected_beside_introspection() {
        // One `__schema` field must not waive the limit for the rest of the operation.
        let mixed = "query X { __schema { types { name } } core { id } }";
        let schema = SchemaIndex::from_sdl(APP_SCHEMA).unwrap();
        let document = operation::parse_document(mixed).unwrap();
        let charged = calculate(&schema, &ComplexityConfig::TS, &document, None);
        assert!(charged >= app_verdict("query X { core { id } }").complexity);
        assert_eq!(app_verdict(mixed).complexity, charged);
        assert!(
            app_verdict("query X { __type(name: \"Query\") { name } core { id } }").complexity > 0
        );
        // An aliased `__typename` is an ordinary field, as in graphql-js.
        assert!(
            app_verdict("query X { t: __typename __schema { types { name } } }").complexity > 0
        );
    }

    #[test]
    fn ignores_unknown_fields_and_operations() {
        assert_eq!(
            app_verdict("query X { nope { id } core { id } }").complexity,
            2
        );
        let schema = SchemaIndex::from_sdl(APP_SCHEMA).unwrap();
        let document = operation::parse_document("query A { core { id } }").unwrap();
        assert_eq!(
            calculate(&schema, &ComplexityConfig::TS, &document, Some("B")),
            0
        );
    }

    /// `k` fragments on `Sermon`, each spreading the next twice, under `core` and `sermons`.
    fn chain(k: usize) -> String {
        let mut document = "query C { core { ...F0 } sermons { ...F0 } } ".to_owned();
        for i in 0..k - 1 {
            document += &format!(
                "fragment F{i} on Sermon {{ title ...F{} ...F{} }} ",
                i + 1,
                i + 1
            );
        }
        document += &format!("fragment F{} on Sermon {{ id tags }}", k - 1);
        document
    }

    #[test]
    fn matches_ts_on_repeated_fragment_spreads() {
        // Costs from running `calculateDocumentComplexity` (queryComplexity.ts) on the same
        // documents and schema with `Query.sermons: 5`.
        for (k, ts_cost) in [(1, 258), (2, 511), (3, 1017), (5, 4053), (8, 32389)] {
            assert_eq!(app_verdict(&chain(k)).complexity, ts_cost, "k = {k}");
        }
    }

    #[test]
    fn walks_each_fragment_once() {
        // TS walks 2^40 fragment copies here; the memoized walk is linear with the same result.
        let start = std::time::Instant::now();
        let verdict = app_verdict(&chain(40));
        let leaf_to_root = 23 * (1_u64 << 39) - 1;
        assert_eq!(verdict.complexity, 16 + 11 * leaf_to_root);
        assert!(
            start.elapsed() < std::time::Duration::from_secs(1),
            "took {:?}",
            start.elapsed()
        );
    }

    #[test]
    fn leaves_fragment_cycles_to_validation() {
        // TS validates (and rejects cycles) before it computes complexity; here the cost model
        // runs first, so a cyclic document costs nothing and validation then rejects it.
        let schema = SchemaIndex::from_sdl(APP_SCHEMA).unwrap();
        let document = operation::parse_document(
            "query C { core { ...A } } fragment A on Sermon { id ...B } fragment B on Sermon { title ...A }",
        )
        .unwrap();
        assert_eq!(
            calculate(&schema, &ComplexityConfig::TS, &document, None),
            0
        );
    }
}
