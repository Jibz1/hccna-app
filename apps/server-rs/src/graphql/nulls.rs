//! graphql-js null propagation for failed fields.
//!
//! async-graphql leaves a failed field out of its parent object (and reports `data: null` when no
//! root field is left); it never propagates a failure past the object that holds the field.
//! graphql-js sets the failed position to `null` if its type is nullable, and otherwise nulls the
//! nearest nullable ancestor, or the whole `data` when there is none. This rebuilds that from each
//! error's path, the operation's selections (to map response keys, aliases included, to fields)
//! and the schema's field types.

use async_graphql::parser::types::{BaseType, ExecutableDocument, Selection, SelectionSet, Type};
use async_graphql::{Name, PathSegment, Response, Value};

use crate::graphql::complexity::SchemaIndex;
use crate::graphql::operation;

/// Writes graphql-js's `null`s into `response.data` for every error that has a path.
pub fn propagate(
    schema: &SchemaIndex,
    document: &ExecutableDocument,
    operation_name: Option<&str>,
    response: &mut Response,
) {
    if response.errors.iter().all(|error| error.path.is_empty()) {
        return;
    }
    // async-graphql reports `null` when every root field failed; graphql-js starts from an
    // object and nulls fields in it.
    if response.data == Value::Null {
        response.data = Value::Object(Default::default());
    }
    let operation = operation::select_operation(document, operation_name).and_then(|operation| {
        let root = schema.root(operation.definition.node.ty)?;
        Some((root, &operation.definition.node.selection_set.node))
    });
    let mut targets: Vec<&[PathSegment]> = Vec::new();
    for error in &response.errors {
        if error.path.is_empty() {
            continue;
        }
        let target = operation.and_then(|(root, selection_set)| {
            null_target(schema, document, root, selection_set, &error.path)
        });
        match target {
            Some(Target::Data) => {
                response.data = Value::Null;
                return;
            }
            Some(Target::Prefix(len)) => targets.push(&error.path[..len]),
            // A path the selections do not explain: null the failed position itself.
            None => targets.push(&error.path),
        }
    }
    // A target under another target's `null` is covered by it, whatever the error order.
    targets.sort_by_key(|target| target.len());
    let mut applied: Vec<&[PathSegment]> = Vec::new();
    for target in targets {
        if applied.iter().any(|done| target.starts_with(done)) {
            continue;
        }
        set_null(&mut response.data, target);
        applied.push(target);
    }
}

enum Target {
    /// No nullable position on the path: `data` itself becomes `null`.
    Data,
    /// The nullable position at `path[..len]`.
    Prefix(usize),
}

/// The deepest nullable position at or above the failed one.
fn null_target(
    schema: &SchemaIndex,
    document: &ExecutableDocument,
    root: &str,
    selection_set: &SelectionSet,
    path: &[PathSegment],
) -> Option<Target> {
    let types = path_types(schema, document, root, selection_set, path)?;
    let nullable = (1..=types.len()).rev().find(|len| types[len - 1].nullable);
    Some(nullable.map_or(Target::Data, Target::Prefix))
}

/// The schema type at each position of `path`: field types for field segments (response keys
/// resolved through aliases, inline fragments and fragment spreads), item types for indexes.
fn path_types<'a>(
    schema: &'a SchemaIndex,
    document: &'a ExecutableDocument,
    root: &'a str,
    selection_set: &'a SelectionSet,
    path: &[PathSegment],
) -> Option<Vec<&'a Type>> {
    let mut sets: Vec<(&'a str, &'a SelectionSet)> = vec![(root, selection_set)];
    let mut types: Vec<&'a Type> = Vec::with_capacity(path.len());
    for segment in path {
        let ty = match segment {
            PathSegment::Field(key) => {
                let mut fields = Vec::new();
                for (parent, set) in &sets {
                    find_fields(document, parent, set, key, &mut fields, &mut Vec::new());
                }
                let (parent, field) = *fields.first()?;
                let field_type = schema.field(parent, field.name.node.as_str())?;
                let named = field_type.named.as_str();
                sets = fields
                    .iter()
                    .map(|(_, field)| (named, &field.selection_set.node))
                    .collect();
                &field_type.ty
            }
            PathSegment::Index(_) => match &types.last()?.base {
                BaseType::List(item) => item.as_ref(),
                BaseType::Named(_) => return None,
            },
        };
        types.push(ty);
    }
    Some(types)
}

/// Fields selected under `parent` whose response key is `key`, with the type each is selected on.
fn find_fields<'a>(
    document: &'a ExecutableDocument,
    parent: &'a str,
    selection_set: &'a SelectionSet,
    key: &str,
    out: &mut Vec<(&'a str, &'a async_graphql::parser::types::Field)>,
    visited: &mut Vec<&'a str>,
) {
    for selection in &selection_set.items {
        match &selection.node {
            Selection::Field(field) if field.node.response_key().node.as_str() == key => {
                out.push((parent, &field.node));
            }
            Selection::Field(_) => {}
            Selection::InlineFragment(fragment) => {
                let parent = fragment
                    .node
                    .type_condition
                    .as_ref()
                    .map_or(parent, |condition| condition.node.on.node.as_str());
                find_fields(
                    document,
                    parent,
                    &fragment.node.selection_set.node,
                    key,
                    out,
                    visited,
                );
            }
            Selection::FragmentSpread(spread) => {
                let name = spread.node.fragment_name.node.as_str();
                if visited.contains(&name) {
                    continue;
                }
                visited.push(name);
                if let Some(fragment) = document.fragments.get(name) {
                    let on = fragment.node.type_condition.node.on.node.as_str();
                    find_fields(
                        document,
                        on,
                        &fragment.node.selection_set.node,
                        key,
                        out,
                        visited,
                    );
                }
            }
        }
    }
}

/// Sets the value at `path` to `null`. On the way, a `null` object is one async-graphql collapsed
/// because all its selected fields failed (an error path runs through it, so it resolved): it
/// becomes an object again. If async-graphql dropped a field on the way (it drops the failed
/// field itself), `null` goes there instead.
fn set_null(data: &mut Value, path: &[PathSegment]) {
    let Some((last, parents)) = path.split_last() else {
        return;
    };
    let mut current = data;
    for segment in parents {
        if *current == Value::Null {
            *current = Value::Object(Default::default());
        }
        current = match (current, segment) {
            (Value::Object(map), PathSegment::Field(key)) => {
                let key = Name::new(key);
                if !map.contains_key(&key) {
                    map.insert(key, Value::Null);
                    return;
                }
                match map.get_mut(&key) {
                    Some(next) => next,
                    None => return,
                }
            }
            (Value::List(items), PathSegment::Index(index)) => match items.get_mut(*index) {
                Some(next) => next,
                None => return,
            },
            _ => return,
        };
    }
    if *current == Value::Null && matches!(last, PathSegment::Field(_)) {
        *current = Value::Object(Default::default());
    }
    match (current, last) {
        (Value::Object(map), PathSegment::Field(key)) => {
            map.insert(Name::new(key), Value::Null);
        }
        (Value::List(items), PathSegment::Index(index)) => {
            if let Some(item) = items.get_mut(*index) {
                *item = Value::Null;
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema};
    use serde_json::{Value as Json, json};

    use super::*;
    use crate::graphql::errors;
    use crate::graphql::handler::render;

    struct NullQuery;

    #[Object(name = "Query")]
    impl NullQuery {
        async fn page(&self) -> Option<Page> {
            Some(Page)
        }

        async fn required(&self) -> Page {
            Page
        }

        async fn pages(&self) -> Option<Vec<Page>> {
            Some(vec![Page, Page])
        }

        async fn ok(&self) -> &str {
            "ok"
        }
    }

    struct Page;

    #[Object]
    impl Page {
        /// `String!` that fails.
        async fn title(&self) -> async_graphql::Result<String> {
            Err("title unavailable".into())
        }

        /// `String` that fails.
        async fn subtitle(&self) -> async_graphql::Result<Option<String>> {
            Err("subtitle unavailable".into())
        }

        async fn name(&self) -> &str {
            "Ada Example"
        }
    }

    fn error_at(path: Vec<PathSegment>) -> async_graphql::ServerError {
        let mut error = async_graphql::ServerError::new("boom", None);
        error.path = path;
        error
    }

    fn data(response: &Response) -> Json {
        response.data.clone().into_json().unwrap()
    }

    #[test]
    fn falls_back_to_the_failed_position_when_the_path_is_unknown() {
        // async-graphql leaves a failed field out; graphql-js sets it to null.
        let mut response =
            async_graphql::Response::new(Value::from_json(json!({ "ok": 1 })).unwrap());
        response.errors = vec![error_at(vec![PathSegment::Field("core".to_owned())])];
        propagate(
            &SchemaIndex::default(),
            &operation::parse_document("query Q { core }").unwrap(),
            None,
            &mut response,
        );
        assert_eq!(data(&response), json!({ "ok": 1, "core": null }));
    }

    #[test]
    fn builds_data_when_every_root_field_failed() {
        let mut response = async_graphql::Response::new(Value::Null);
        response.errors = vec![
            error_at(vec![PathSegment::Field("core".to_owned())]),
            error_at(vec![PathSegment::Field("sermons".to_owned())]),
        ];
        propagate(
            &SchemaIndex::default(),
            &operation::parse_document("query Q { core }").unwrap(),
            None,
            &mut response,
        );
        assert_eq!(data(&response), json!({ "core": null, "sermons": null }));
    }

    #[test]
    fn nulls_the_first_missing_segment_of_nested_paths() {
        let mut response = async_graphql::Response::new(
            Value::from_json(
                json!({ "ccbFormsV2": { "__typename": "CCBFormsSuccess" }, "list": [{ "a": 1 }] }),
            )
            .unwrap(),
        );
        response.errors = vec![
            error_at(vec![
                PathSegment::Field("ccbFormsV2".to_owned()),
                PathSegment::Field("forms".to_owned()),
                PathSegment::Index(0),
                PathSegment::Field("title".to_owned()),
            ]),
            error_at(vec![
                PathSegment::Field("list".to_owned()),
                PathSegment::Index(0),
                PathSegment::Field("b".to_owned()),
            ]),
        ];
        propagate(
            &SchemaIndex::default(),
            &operation::parse_document("query Q { core }").unwrap(),
            None,
            &mut response,
        );
        assert_eq!(
            data(&response),
            json!({ "ccbFormsV2": { "__typename": "CCBFormsSuccess", "forms": null }, "list": [{ "a": 1, "b": null }] })
        );
    }

    async fn run(query: &str) -> Json {
        let schema = Schema::new(NullQuery, EmptyMutation, EmptySubscription);
        let index = SchemaIndex::from_sdl(&schema.sdl()).unwrap();
        let document = operation::parse_document(query).unwrap();
        let mut response = schema.execute(query).await;
        propagate(&index, &document, None, &mut response);
        errors::finish(&mut response);
        serde_json::from_slice(&render(&response)).unwrap()
    }

    #[tokio::test]
    async fn nulls_a_nullable_failed_field() {
        let body = run("query Q { page { subtitle name } }").await;
        assert_eq!(
            body["data"],
            json!({ "page": { "name": "Ada Example", "subtitle": null } })
        );
    }

    #[tokio::test]
    async fn nulls_the_nearest_nullable_ancestor_of_a_non_null_field() {
        let body = run("query Q { page { title name } ok }").await;
        assert_eq!(body["data"], json!({ "page": null, "ok": "ok" }));
        assert_eq!(body["errors"][0]["path"], json!(["page", "title"]));
    }

    #[tokio::test]
    async fn nulls_data_when_no_ancestor_is_nullable() {
        let body = run("query Q { required { title } ok }").await;
        assert_eq!(body["data"], Json::Null);
        assert!(body.as_object().unwrap().contains_key("data"));
    }

    #[tokio::test]
    async fn follows_aliases_and_fragments() {
        let body = run("query Q { p: page { ...F } } fragment F on Page { t: title name }").await;
        assert_eq!(body["data"], json!({ "p": null }));
        let body = run("query Q { ... on Query { p: page { s: subtitle } } }").await;
        assert_eq!(body["data"], json!({ "p": { "s": null } }));
    }

    #[tokio::test]
    async fn applies_errors_in_any_order() {
        // `title` nulls `page`, which covers the nullable `subtitle` beside it.
        for query in [
            "query Q { page { title subtitle } }",
            "query Q { page { subtitle title } }",
        ] {
            assert_eq!(run(query).await["data"], json!({ "page": null }), "{query}");
        }
    }

    #[tokio::test]
    async fn nulls_a_nullable_list_holding_non_null_items() {
        // `pages: [Page!]`: a failed `title: String!` nulls its non-null item, so the list.
        let body = run("query Q { pages { title } ok }").await;
        assert_eq!(body["data"], json!({ "pages": null, "ok": "ok" }));
    }
}
