//! The Strapi 5 GraphQL operations the server sends, from `packages/strapi-v2/src/queries/*.ts`.
//! Each `.graphql` file is the TS template literal byte for byte (no trailing newline), so both
//! servers send the same request body. Each submodule holds an operation's variables, the `data`
//! shape it decodes (strictly, as Effect Schema does: a listed key must be present, and an unknown
//! enum value fails the whole response) and its mapping to records. The shared pieces below mirror
//! `queries/shared.ts`.

pub mod campuses;
pub mod events;
pub mod sermons;
pub mod thought_of_god;

use serde::{Deserialize, Deserializer};

use super::js;

/// `SERMONS_OPERATION` / `SERMONS_DOCUMENT` in `queries/sermons.ts`.
pub const SERMONS_OPERATION: &str = "StrapiV2Sermons";
pub const SERMONS_DOCUMENT: &str = include_str!("sermons.graphql");

/// `TOG_OPERATION` / `TOG_DOCUMENT` in `queries/thoughtOfGod.ts`.
pub const TOG_OPERATION: &str = "StrapiV2ThoughtOfGod";
pub const TOG_DOCUMENT: &str = include_str!("thought_of_god.graphql");

/// `CAMPUSES_OPERATION` / `CAMPUSES_DOCUMENT` in `queries/campuses.ts`.
pub const CAMPUSES_OPERATION: &str = "StrapiV2Campuses";
pub const CAMPUSES_DOCUMENT: &str = include_str!("campuses.graphql");

/// `EVENTS_OPERATION` / `EVENTS_DOCUMENT` in `queries/events.ts`.
pub const EVENTS_OPERATION: &str = "StrapiV2Events";
pub const EVENTS_DOCUMENT: &str = include_str!("events.graphql");

/// `Schema.NullOr(X)` on a required key: `null` is `None`, and a missing key is a decode error
/// (serde would otherwise default a missing `Option` to `None`).
pub(crate) fn nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

/// `Media`'s non-null shape: `{ url }`.
#[derive(Debug, Deserialize)]
pub(crate) struct Media {
    pub url: String,
}

/// `Meta`'s non-null shape: Strapi 5's `meta.meta` component (`Header`, `Heading`, `Intro`).
#[derive(Debug, Deserialize)]
pub(crate) struct Meta {
    #[serde(deserialize_with = "nullable")]
    pub title: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub description: Option<String>,
    #[serde(rename = "featureImage", deserialize_with = "nullable")]
    pub feature_image: Option<Media>,
}

/// `mediaUrl`.
pub(crate) fn media_url(media: Option<&Media>) -> Option<String> {
    media.map(|media| media.url.clone())
}

/// `trimmedOrNull`: trimmed, or `None` when nothing is left.
pub(crate) fn trimmed_or_null(value: Option<&str>) -> Option<String> {
    value
        .map(js::trim)
        .filter(|trimmed| !trimmed.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};

    /// `packages/strapi-v2`, found by walking up from the crate to the workspace package named
    /// `@hccnj/strapi-v2` (never a hard-coded relative path). `HCCNA_STRAPI_V2_PATH` overrides it.
    fn strapi_v2_package() -> PathBuf {
        if let Ok(path) = std::env::var("HCCNA_STRAPI_V2_PATH") {
            return PathBuf::from(path);
        }
        let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        for ancestor in crate_dir.ancestors() {
            let Ok(entries) = std::fs::read_dir(ancestor.join("packages")) else {
                continue;
            };
            for entry in entries.flatten() {
                let manifest = entry.path().join("package.json");
                let Ok(text) = std::fs::read_to_string(&manifest) else {
                    continue;
                };
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };
                if json["name"] == "@hccnj/strapi-v2" {
                    return entry.path();
                }
            }
        }
        panic!("@hccnj/strapi-v2 not found above {}", crate_dir.display());
    }

    /// The template literal assigned to `export const <name> = \`...\`` in a TS query module.
    fn ts_document(file: &str, name: &str) -> String {
        let path = strapi_v2_package().join("src/queries").join(file);
        let source = std::fs::read_to_string(&path).unwrap();
        let start = format!("export const {name} = `");
        let from = source.find(&start).unwrap() + start.len();
        let length = source[from..].find('`').unwrap();
        source[from..from + length].to_owned()
    }

    fn ts_operation(file: &str, name: &str) -> String {
        let path = strapi_v2_package().join("src/queries").join(file);
        let source = std::fs::read_to_string(&path).unwrap();
        let start = format!("export const {name} = \"");
        let from = source.find(&start).unwrap() + start.len();
        let length = source[from..].find('"').unwrap();
        source[from..from + length].to_owned()
    }

    #[test]
    fn documents_match_the_ts_queries_byte_for_byte() {
        let cases = [
            ("sermons.ts", "SERMONS", SERMONS_OPERATION, SERMONS_DOCUMENT),
            ("thoughtOfGod.ts", "TOG", TOG_OPERATION, TOG_DOCUMENT),
            (
                "campuses.ts",
                "CAMPUSES",
                CAMPUSES_OPERATION,
                CAMPUSES_DOCUMENT,
            ),
            ("events.ts", "EVENTS", EVENTS_OPERATION, EVENTS_DOCUMENT),
        ];
        for (file, prefix, operation, document) in cases {
            assert_eq!(
                ts_operation(file, &format!("{prefix}_OPERATION")),
                operation,
                "{file}"
            );
            assert_eq!(
                ts_document(file, &format!("{prefix}_DOCUMENT")),
                document,
                "{file}"
            );
            assert!(document.starts_with(&format!("query {operation}")));
        }
    }

    /// The object types of the recorded Strapi 5 schema (`tests/fixtures/strapi5.graphql` in the
    /// TS package, printed one field per line): type → field → (takes `pagination`, base type).
    type Schema = HashMap<String, HashMap<String, (bool, String)>>;

    fn recorded_schema() -> Schema {
        let path = strapi_v2_package().join("tests/fixtures/strapi5.graphql");
        let sdl = std::fs::read_to_string(path).unwrap();
        let mut types = Schema::new();
        let mut current: Option<String> = None;
        for line in sdl.lines() {
            if let Some(rest) = line.strip_prefix("type ") {
                let name = rest.split([' ', '{']).next().unwrap_or_default();
                types.insert(name.to_owned(), HashMap::new());
                current = Some(name.to_owned());
                continue;
            }
            if line == "}" {
                current = None;
                continue;
            }
            let field = line.trim();
            let Some(fields) = current.as_ref().and_then(|name| types.get_mut(name)) else {
                continue;
            };
            let parsed = match (field.find('('), field.find(':')) {
                (Some(open), colon) if colon.is_none_or(|colon| open < colon) => {
                    field.rfind("): ").map(|close| {
                        (
                            &field[..open],
                            field[open..close].contains("pagination:"),
                            &field[close + 3..],
                        )
                    })
                }
                _ => field
                    .split_once(": ")
                    .map(|(name, kind)| (name, false, kind)),
            };
            if let Some((name, paginated, kind)) = parsed {
                let base = kind.trim_matches(['[', ']', '!']);
                fields.insert(name.to_owned(), (paginated, base.to_owned()));
            }
        }
        types
    }

    /// Walks the selection set at `document[*at..]` (just past its `{`) on object type `parent`,
    /// listing the selected fields the schema lacks and the lists that omit `pageSize`.
    fn check_selection(
        schema: &Schema,
        parent: &str,
        document: &[u8],
        at: &mut usize,
        problems: &mut Vec<String>,
    ) {
        let skip_blanks = |at: &mut usize| {
            while document[*at].is_ascii_whitespace() || document[*at] == b',' {
                *at += 1;
            }
        };
        loop {
            skip_blanks(at);
            if document[*at] == b'}' {
                *at += 1;
                return;
            }
            let start = *at;
            while document[*at].is_ascii_alphanumeric() || document[*at] == b'_' {
                *at += 1;
            }
            let name = String::from_utf8_lossy(&document[start..*at]).into_owned();
            skip_blanks(at);
            let mut arguments = String::new();
            if document[*at] == b'(' {
                let open = *at;
                let mut level = 0;
                loop {
                    match document[*at] {
                        b'(' => level += 1,
                        b')' => level -= 1,
                        _ => {}
                    }
                    *at += 1;
                    if level == 0 {
                        break;
                    }
                }
                arguments = String::from_utf8_lossy(&document[open..*at]).into_owned();
                arguments.retain(|c| !c.is_whitespace());
                skip_blanks(at);
            }
            let field = schema.get(parent).and_then(|fields| fields.get(&name));
            match field {
                None => problems.push(format!("{parent}.{name} is not in the schema")),
                Some((true, _))
                    if !arguments.contains("pagination:{pageSize:100}")
                        && !arguments.contains("pagination:{pageSize:$pageSize}") =>
                {
                    problems.push(format!("{parent}.{name} lacks pagination pageSize 100"));
                }
                Some(_) => {}
            }
            if document[*at] == b'{' {
                *at += 1;
                let child = field.map_or("", |(_, kind)| kind.as_str());
                check_selection(schema, child, document, at, problems);
            }
        }
    }

    /// `unpaginatedLists` plus the schema half of `validate`: Strapi 5 silently applies its
    /// default limit (25) to every list that omits `pagination`.
    fn document_problems(schema: &Schema, document: &str) -> Vec<String> {
        let mut problems = Vec::new();
        // The variable definitions hold no braces, so the first one opens the selection set.
        let mut at = document.find('{').unwrap() + 1;
        check_selection(schema, "Query", document.as_bytes(), &mut at, &mut problems);
        problems
    }

    #[test]
    fn documents_select_only_schema_fields_and_paginate_every_list() {
        let schema = recorded_schema();
        for document in [
            SERMONS_DOCUMENT,
            TOG_DOCUMENT,
            CAMPUSES_DOCUMENT,
            EVENTS_DOCUMENT,
        ] {
            assert_eq!(document_problems(&schema, document), Vec::<String>::new());
        }
    }

    #[test]
    fn spots_unpaginated_lists_and_unknown_fields() {
        let schema = recorded_schema();
        let problems = document_problems(
            &schema,
            "query X { campuses { slug GivingPlatforms { Platform } nope } }",
        );
        assert_eq!(
            problems,
            [
                "Query.campuses lacks pagination pageSize 100",
                "Campus.GivingPlatforms lacks pagination pageSize 100",
                "Campus.nope is not in the schema",
            ]
        );
    }

    #[test]
    fn requires_nullable_keys_to_be_present() {
        assert!(
            serde_json::from_str::<Meta>(
                r#"{"title":null,"description":null,"featureImage":null}"#
            )
            .is_ok()
        );
        let missing = serde_json::from_str::<Meta>(r#"{"title":null,"description":null}"#);
        assert!(
            missing
                .unwrap_err()
                .to_string()
                .contains("missing field `featureImage`")
        );
        assert!(
            serde_json::from_str::<Meta>(r#"{"title":1,"description":null,"featureImage":null}"#)
                .is_err()
        );
    }

    #[test]
    fn trims_to_none() {
        assert_eq!(trimmed_or_null(None), None);
        assert_eq!(trimmed_or_null(Some(" \u{a0} ")), None);
        assert_eq!(
            trimmed_or_null(Some(" Senior Pastor ")),
            Some("Senior Pastor".to_owned())
        );
    }
}
