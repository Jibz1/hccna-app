//! Operation analysis that runs before execution: the named-operation rule
//! (`apps/server/src/graphql/useRequireOperationName.ts`), operation selection and root fields for
//! logs and metrics (`useGraphQLLogger.ts`), and `formatOperationName`
//! (`known-operation-names.ts`).

use std::collections::HashSet;

use async_graphql::Positioned;
use async_graphql::parser::types::{
    DocumentOperations, ExecutableDocument, OperationDefinition, OperationType, Selection,
    SelectionSet,
};

use crate::graphql::nesting;
use crate::http::request_log::GraphqlOperationInfo;

/// The error the TS server returns for an anonymous operation.
pub const ANONYMOUS_OPERATION_MESSAGE: &str =
    "All operations must have a name. Please add a name to your query/mutation.";

/// `KNOWN_OPERATION_NAMES_LIST` in `known-operation-names.ts`, verbatim.
pub const KNOWN_OPERATION_NAMES: [&str; 67] = [
    "CampusesSignalQuery",
    "CastrChannelEditorQuery",
    "CCBFormsQuery",
    "CCBFormsV2Query",
    "CoreDataQuery",
    "EventCheckInQuery",
    "EventDetailQuery",
    "EventListImplQuery",
    "ensureUserProfileMutation",
    "FeaturedEventsQuery",
    "HomeQuery",
    "ProfileQuery",
    "LatestEventsQuery",
    "LatestSermonsQuery",
    "SermonsContainerQuery",
    "ShortsFeedQuery",
    "ThoughtOfGodQuery",
    "ThoughtOfGodImplQuery",
    "UpdateEventAttendanceInput",
    "useCodeSigninMutation",
    "useCodeVerificationMutation",
    "useDeleteAccountConfirmationMutation",
    "useRequestDeleteAccountMutation",
    "useSendBroadcastMutation",
    "UpdateCastrStreamInput",
    "VerseOfTheDayQuery",
    "verseOfTheDayV2",
    "useGetMyGivingQuery",
    "useGetMyGivingHistoryQuery",
    "EventAttendancesQuery",
    "PingCastrStreamQuery",
    "useExportYearGivingQuery",
    "GivingSignalQuery",
    "UserDataProfileQuery",
    "ProfileMutation",
    "PushTokensRegisterPushTokenMutation",
    "PushTokensUnregisterPushTokenMutation",
    "SetPreferredCampusMutation",
    "SavedVersesQuery",
    "SaveVerseMutation",
    "RemoveSavedVerseMutation",
    "ImportSavedVersesMutation",
    "ReconcileCampusSubscriptionsMutation",
    "PushTokensSendBroadcastMutation",
    "SermonsItemsRefetchQuery",
    "StreamEditorQuery",
    "useAttendanceMutation",
    "UserDataGivingQuery",
    "UserDataUpdateProfileMutation",
    "UserDataWoaQuery",
    "useUpdateCastrStreamMutation",
    "upComingEvents",
    "CampusesQuery",
    "ExportEventAttendanceModalQuery",
    "ExportEventAttendanceQuery",
    "MinistryToolsAccessQuery",
    "UserGivingQuery",
    "UserProfileQuery",
    "UserUpdateProfileMutation",
    "UserWoaQuery",
    "useExportEventAttendanceMutation",
    // Website (HCCNJ/site)
    "WebsiteCcbForms",
    "WebsiteLiveStreamStatus",
    "WebsiteVerseOfTheDay",
    // Cloud Scheduler jobs
    "SetVerseOfTheDay",
    "VodPushNotification",
    // Strapi 5 change notices
    "Strapi5ChangeNoticeMutation",
];

/// An operation picked out of a document, with its name when it has one.
#[derive(Clone, Copy, Debug)]
pub struct SelectedOperation<'a> {
    pub name: Option<&'a str>,
    pub definition: &'a Positioned<OperationDefinition>,
}

/// Why a query is not a parseable document.
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    /// Brackets nested past `nesting::MAX_BRACKET_NESTING`, found before parsing.
    #[error(
        "Syntax Error: brackets are nested deeper than {} levels.",
        nesting::MAX_BRACKET_NESTING
    )]
    TooDeep(nesting::TooDeep),
    #[error(transparent)]
    Syntax(#[from] async_graphql::parser::Error),
}

impl ParseError {
    /// Where the error is, for the response's `locations`.
    pub fn pos(&self) -> Option<async_graphql::Pos> {
        match self {
            Self::TooDeep(at) => Some(async_graphql::Pos {
                line: at.line,
                column: at.column,
            }),
            Self::Syntax(error) => error.positions().next(),
        }
    }
}

/// Parses a GraphQL document, after the bracket-nesting pre-scan that keeps the parser's
/// recursive value building from overflowing the stack (see `nesting`).
pub fn parse_document(query: &str) -> Result<ExecutableDocument, ParseError> {
    nesting::check(query).map_err(ParseError::TooDeep)?;
    Ok(async_graphql::parser::parse_query(query)?)
}

/// The named-operation rule: every operation in the document needs a name unless all of its root
/// selections are `__schema` or `__type` fields. Returns the TS error message otherwise.
///
/// The parser only accepts an anonymous operation when it is the document's only operation, so
/// a single anonymous operation is the one case to check.
pub fn check_operation_names(document: &ExecutableDocument) -> Result<(), &'static str> {
    match &document.operations {
        DocumentOperations::Single(operation) if !is_introspection(&operation.node) => {
            Err(ANONYMOUS_OPERATION_MESSAGE)
        }
        _ => Ok(()),
    }
}

/// `isIntrospectionOperation`: a non-empty root selection set of only `__schema` and `__type`
/// fields (fragments do not count).
fn is_introspection(operation: &OperationDefinition) -> bool {
    let selections = &operation.selection_set.node.items;
    !selections.is_empty()
        && selections.iter().all(|selection| match &selection.node {
            Selection::Field(field) => {
                matches!(field.node.name.node.as_str(), "__schema" | "__type")
            }
            _ => false,
        })
}

/// graphql-js `getOperationAST`: the operation called `operation_name`, or the only operation
/// when no name is given.
pub fn select_operation<'a>(
    document: &'a ExecutableDocument,
    operation_name: Option<&str>,
) -> Option<SelectedOperation<'a>> {
    match (&document.operations, operation_name) {
        (DocumentOperations::Single(definition), None) => Some(SelectedOperation {
            name: None,
            definition,
        }),
        (DocumentOperations::Single(_), Some(_)) => None,
        (DocumentOperations::Multiple(operations), Some(name)) => operations
            .get_key_value(name)
            .map(|(name, definition)| SelectedOperation {
                name: Some(name.as_str()),
                definition,
            }),
        (DocumentOperations::Multiple(operations), None) if operations.len() == 1 => operations
            .iter()
            .next()
            .map(|(name, definition)| SelectedOperation {
                name: Some(name.as_str()),
                definition,
            }),
        (DocumentOperations::Multiple(_), None) => None,
    }
}

/// The first operation in document order.
fn first_operation(document: &ExecutableDocument) -> Option<SelectedOperation<'_>> {
    document
        .operations
        .iter()
        .map(|(name, definition)| SelectedOperation {
            name: name.map(|name| name.as_str()),
            definition,
        })
        .min_by_key(|operation| {
            (
                operation.definition.pos.line,
                operation.definition.pos.column,
            )
        })
}

/// Root field names of `selection_set`, through inline fragments and fragment spreads, deduplicated
/// in document order. `__typename` is included unless `skip_typename`.
pub fn root_fields(
    document: &ExecutableDocument,
    selection_set: &SelectionSet,
    skip_typename: bool,
) -> Vec<String> {
    fields_of_all(document, &[selection_set], skip_typename)
}

/// [`root_fields`] of several selection sets together: their field names deduplicated in order,
/// with each fragment expanded once across all of them, so many selections spreading one large
/// fragment stay linear.
pub fn fields_of_all(
    document: &ExecutableDocument,
    selection_sets: &[&SelectionSet],
    skip_typename: bool,
) -> Vec<String> {
    let mut collected = RootFields {
        ordered: Vec::new(),
        seen: HashSet::new(),
        visited: HashSet::new(),
    };
    for selection_set in selection_sets {
        collect_root_fields(document, selection_set, skip_typename, &mut collected);
    }
    collected.ordered
}

/// Root field names in first-seen order. `seen` makes each check O(1), as the TS `Set` does;
/// `visited` holds the fragments already followed.
struct RootFields<'a> {
    ordered: Vec<String>,
    seen: HashSet<&'a str>,
    visited: HashSet<&'a str>,
}

fn collect_root_fields<'a>(
    document: &'a ExecutableDocument,
    selection_set: &'a SelectionSet,
    skip_typename: bool,
    collected: &mut RootFields<'a>,
) {
    for selection in &selection_set.items {
        match &selection.node {
            Selection::Field(field) => {
                let name = field.node.name.node.as_str();
                if (skip_typename && name == "__typename") || !collected.seen.insert(name) {
                    continue;
                }
                collected.ordered.push(name.to_owned());
            }
            Selection::InlineFragment(fragment) => collect_root_fields(
                document,
                &fragment.node.selection_set.node,
                skip_typename,
                collected,
            ),
            Selection::FragmentSpread(spread) => {
                let name = spread.node.fragment_name.node.as_str();
                // The TS logger follows spreads without this guard; it is here so a cyclic
                // document (rejected later by validation) cannot recurse forever.
                if !collected.visited.insert(name) {
                    continue;
                }
                if let Some(fragment) = document.fragments.get(name) {
                    collect_root_fields(
                        document,
                        &fragment.node.selection_set.node,
                        skip_typename,
                        collected,
                    );
                }
            }
        }
    }
}

/// The selection sets of every field called `name` in `selection_set` (aliases included), through
/// inline fragments and fragment spreads, each fragment followed once.
pub fn field_selection_sets<'a>(
    document: &'a ExecutableDocument,
    selection_set: &'a SelectionSet,
    name: &str,
) -> Vec<&'a SelectionSet> {
    let mut found = Vec::new();
    let mut visited = HashSet::new();
    collect_field_selection_sets(document, selection_set, name, &mut visited, &mut found);
    found
}

fn collect_field_selection_sets<'a>(
    document: &'a ExecutableDocument,
    selection_set: &'a SelectionSet,
    name: &str,
    visited: &mut HashSet<&'a str>,
    found: &mut Vec<&'a SelectionSet>,
) {
    for selection in &selection_set.items {
        match &selection.node {
            Selection::Field(field) => {
                if field.node.name.node.as_str() == name {
                    found.push(&field.node.selection_set.node);
                }
            }
            Selection::InlineFragment(fragment) => collect_field_selection_sets(
                document,
                &fragment.node.selection_set.node,
                name,
                visited,
                found,
            ),
            Selection::FragmentSpread(spread) => {
                let fragment_name = spread.node.fragment_name.node.as_str();
                if !visited.insert(fragment_name) {
                    continue;
                }
                if let Some(fragment) = document.fragments.get(fragment_name) {
                    collect_field_selection_sets(
                        document,
                        &fragment.node.selection_set.node,
                        name,
                        visited,
                        found,
                    );
                }
            }
        }
    }
}

pub fn operation_type_name(kind: OperationType) -> &'static str {
    match kind {
        OperationType::Query => "query",
        OperationType::Mutation => "mutation",
        OperationType::Subscription => "subscription",
    }
}

/// `formatOperationName`: known names unchanged, others suffixed `-untagged`, none `anonymous`.
pub fn format_operation_name(name: Option<&str>) -> String {
    match name {
        None | Some("") => "anonymous".to_owned(),
        Some(name) if KNOWN_OPERATION_NAMES.contains(&name) => name.to_owned(),
        Some(name) => format!("{name}-untagged"),
    }
}

/// The operation name for metric labels: a known name as is, no name `anonymous`, anything else
/// `untagged`. Unlike `format_operation_name`, the result comes from a fixed set.
pub fn metric_operation_name(name: Option<&str>) -> &'static str {
    match name {
        None | Some("") => "anonymous",
        Some(name) => KNOWN_OPERATION_NAMES
            .iter()
            .find(|known| **known == name)
            .copied()
            .unwrap_or("untagged"),
    }
}

/// What `useGraphQLLogger` records: the selected operation (falling back to the first one), its
/// name or else the request's `operationName`, its type and its root fields.
pub fn operation_info(
    document: &ExecutableDocument,
    operation_name: Option<&str>,
) -> Option<GraphqlOperationInfo> {
    let operation =
        select_operation(document, operation_name).or_else(|| first_operation(document))?;
    let definition = &operation.definition.node;
    Some(GraphqlOperationInfo {
        operation_name: format_operation_name(operation.name.or(operation_name)),
        metric_operation_name: metric_operation_name(operation.name.or(operation_name)),
        operation_type: operation_type_name(definition.ty).to_owned(),
        fields: root_fields(document, &definition.selection_set.node, false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(query: &str) -> ExecutableDocument {
        parse_document(query).unwrap()
    }

    #[test]
    fn reads_name_type_and_root_fields() {
        let document = parse("query CoreDataQuery { core { title } }");
        let info = operation_info(&document, None).unwrap();
        assert_eq!(
            info,
            GraphqlOperationInfo {
                operation_name: "CoreDataQuery".to_owned(),
                metric_operation_name: "CoreDataQuery",
                operation_type: "query".to_owned(),
                fields: vec!["core".to_owned()],
            }
        );
    }

    #[test]
    fn collects_root_fields_through_fragments_once() {
        let document = parse(
            "query Home { __typename ...Root ... on Query { sermons { id } core { a } } }
             fragment Root on Query { core { b } thoughtOfGod { c } }",
        );
        let operation = select_operation(&document, None).unwrap();
        let selection_set = &operation.definition.node.selection_set.node;
        assert_eq!(
            root_fields(&document, selection_set, false),
            ["__typename", "core", "thoughtOfGod", "sermons"]
        );
        assert_eq!(
            root_fields(&document, selection_set, true),
            ["core", "thoughtOfGod", "sermons"]
        );
    }

    #[test]
    fn collects_many_distinct_root_fields_in_linear_time() {
        // A 2 MiB body can name about 450k distinct root fields; deduplication must not be
        // quadratic, because this runs before authentication.
        let fields: String = (0..100_000).map(|n| format!("f{n} f{n} ")).collect();
        let document = parse(&format!("query Many {{ {fields} }}"));
        let operation = select_operation(&document, None).unwrap();
        let start = std::time::Instant::now();
        let collected = root_fields(
            &document,
            &operation.definition.node.selection_set.node,
            true,
        );
        assert_eq!(collected.len(), 100_000);
        assert_eq!(collected[99_999], "f99999");
        assert!(
            start.elapsed() < std::time::Duration::from_secs(1),
            "took {:?}",
            start.elapsed()
        );
    }

    #[test]
    fn survives_fragment_cycles() {
        let document = parse(
            "query Loop { ...A }
             fragment A on Query { core ...B }
             fragment B on Query { sermons ...A }",
        );
        let operation = select_operation(&document, None).unwrap();
        assert_eq!(
            root_fields(
                &document,
                &operation.definition.node.selection_set.node,
                false
            ),
            ["core", "sermons"]
        );
    }

    #[test]
    fn rejects_anonymous_operations() {
        let document = parse("{ core { title } }");
        assert_eq!(
            check_operation_names(&document),
            Err(ANONYMOUS_OPERATION_MESSAGE)
        );
        // `__typename` is not introspection for this rule, matching the TS check.
        assert_eq!(
            check_operation_names(&parse("{ __typename }")),
            Err(ANONYMOUS_OPERATION_MESSAGE)
        );
        assert_eq!(
            check_operation_names(&parse("{ __schema { types { name } } core { title } }")),
            Err(ANONYMOUS_OPERATION_MESSAGE)
        );
    }

    #[test]
    fn allows_named_and_introspection_operations() {
        assert_eq!(
            check_operation_names(&parse("query CoreDataQuery { core { title } }")),
            Ok(())
        );
        assert_eq!(
            check_operation_names(&parse(
                "{ __schema { types { name } } __type(name: \"Core\") { name } }"
            )),
            Ok(())
        );
        assert_eq!(
            check_operation_names(&parse("query A { core } query B { sermons }")),
            Ok(())
        );
    }

    #[test]
    fn selects_operations_like_get_operation_ast() {
        let document = parse("query A { core } query B { sermons }");
        assert_eq!(
            select_operation(&document, Some("B")).unwrap().name,
            Some("B")
        );
        assert!(select_operation(&document, None).is_none());
        assert!(select_operation(&document, Some("C")).is_none());

        let single = parse("query A { core }");
        assert_eq!(select_operation(&single, None).unwrap().name, Some("A"));
    }

    #[test]
    fn logs_the_first_operation_when_none_is_selected() {
        let document = parse("query B { sermons } query A { core }");
        let info = operation_info(&document, None).unwrap();
        assert_eq!(info.operation_name, "B-untagged");
        assert_eq!(info.fields, ["sermons"]);
    }

    #[test]
    fn falls_back_to_the_requested_name_for_anonymous_operations() {
        let document = parse("mutation { setVerseOfTheDay }");
        let info = operation_info(&document, Some("SetVerseOfTheDay")).unwrap();
        assert_eq!(info.operation_name, "SetVerseOfTheDay");
        assert_eq!(info.operation_type, "mutation");
    }

    #[test]
    fn formats_operation_names() {
        assert_eq!(format_operation_name(None), "anonymous");
        assert_eq!(format_operation_name(Some("")), "anonymous");
        assert_eq!(
            format_operation_name(Some("CoreDataQuery")),
            "CoreDataQuery"
        );
        assert_eq!(
            format_operation_name(Some("WebsiteCcbForms")),
            "WebsiteCcbForms"
        );
        assert_eq!(format_operation_name(Some("Bench")), "Bench-untagged");
    }

    #[test]
    fn knows_the_shorts_feed_operation() {
        // The app's query for the Shorts feed, forwarded to TS.
        assert_eq!(
            format_operation_name(Some("ShortsFeedQuery")),
            "ShortsFeedQuery"
        );
        assert_eq!(
            metric_operation_name(Some("ShortsFeedQuery")),
            "ShortsFeedQuery"
        );
    }

    #[test]
    fn bounds_metric_operation_names() {
        assert_eq!(metric_operation_name(None), "anonymous");
        assert_eq!(metric_operation_name(Some("")), "anonymous");
        assert_eq!(
            metric_operation_name(Some("CoreDataQuery")),
            "CoreDataQuery"
        );
        assert_eq!(metric_operation_name(Some("Bench")), "untagged");
        let info = operation_info(&parse("query Bench { core }"), None).unwrap();
        assert_eq!(info.operation_name, "Bench-untagged");
        assert_eq!(info.metric_operation_name, "untagged");
    }

    #[test]
    fn known_names_are_unique() {
        let names: HashSet<&str> = KNOWN_OPERATION_NAMES.iter().copied().collect();
        assert_eq!(names.len(), KNOWN_OPERATION_NAMES.len());
    }
}
