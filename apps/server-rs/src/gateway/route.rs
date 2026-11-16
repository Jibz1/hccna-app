//! Where an operation is answered: here, or by the TS server
//! (`docs/superpowers/specs/2026-10-14-server-rs-parity-design.md`, "Routing" and "Kill switch").

use async_graphql::parser::types::{ExecutableDocument, OperationType};

use crate::gateway::Route;
use crate::graphql::operation;
use crate::statsig::{FeatureGates, GateUser};

/// The `Query` fields this server answers itself. A PR that ports a field adds it here when it
/// lands; everything else goes to the TS server.
pub const LOCAL_FIELDS: [&str; 10] = [
    "campuses",
    "campusesV2",
    "ccbFormsV2",
    "core",
    "events",
    "liveStreamStatus",
    "sermons",
    "thoughtOfGod",
    "upcomingEventsByMonth",
    "verseOfTheDayV2",
];

/// The `Query` fields this server answers itself only while CCB is configured (`AppState::ccb`),
/// since they read it; otherwise they go to the TS server like any other field.
pub const CCB_FIELDS: [&str; 2] = ["getPreviousFiveYearsGivingV2", "myGivingHistory"];

/// A `Query` field this server answers itself only for some fields of its type.
#[derive(Clone, Copy, Debug)]
pub struct PartialField {
    pub root_field: &'static str,
    /// The field's type, which this server defines with `fields` alone (the contract test holds
    /// it to that).
    pub type_name: &'static str,
    /// The fields of `type_name` answered here; `__typename` is always allowed.
    pub fields: &'static [&'static str],
}

/// `user { woa }` is answered here; selecting any other `User` field anywhere under `user` sends
/// the whole operation to TS.
pub const PARTIAL_FIELDS: [PartialField; 1] = [PartialField {
    root_field: "user",
    type_name: "User",
    fields: &["woa"],
}];

/// The kill switch: while this Statsig gate is off, unknown or unavailable, every request is
/// forwarded.
pub const SERVE_LOCALLY_GATE: &str = "server_rs_serve_locally";

/// The fixed user the kill switch is checked for, so the gate has no per-user targeting.
/// Statsig dedupes identical exposures for 60 s, so this logs about one exposure a minute.
pub const GATE_USER: GateUser<'static> = GateUser {
    uid: Some("hccna-backend-rs"),
    email: None,
};

/// Whether this server may answer anything itself.
pub fn serve_locally(gates: &dyn FeatureGates) -> bool {
    gates.check(SERVE_LOCALLY_GATE, &GATE_USER)
}

/// The route for a parsed document that passed the depth check. Anonymous and unselectable
/// operations stay local, where the pipeline answers them with its existing errors. A query is
/// local when each root field (`__typename` aside) is in [`LOCAL_FIELDS`], in [`CCB_FIELDS`] while
/// `ccb_configured`, or in [`PARTIAL_FIELDS`] with only its listed fields selected; everything
/// else, introspection included, is forwarded whole.
pub fn route_operation(
    document: &ExecutableDocument,
    operation_name: Option<&str>,
    ccb_configured: bool,
) -> Route {
    if operation::check_operation_names(document).is_err() {
        return Route::Local;
    }
    let Some(selected) = operation::select_operation(document, operation_name) else {
        return Route::Local;
    };
    let definition = &selected.definition.node;
    if definition.ty != OperationType::Query {
        return Route::Forward;
    }
    let fields = operation::root_fields(document, &definition.selection_set.node, true);
    let selection = &definition.selection_set.node;
    let partial_local = |partial: &PartialField| {
        let selected = operation::field_selection_sets(document, selection, partial.root_field);
        operation::fields_of_all(document, &selected, true)
            .iter()
            .all(|field| partial.fields.contains(&field.as_str()))
    };
    let local = |field: &str| {
        LOCAL_FIELDS.contains(&field)
            || (ccb_configured && CCB_FIELDS.contains(&field))
            || PARTIAL_FIELDS
                .iter()
                .find(|partial| partial.root_field == field)
                .is_some_and(partial_local)
    };
    if fields.iter().all(|field| local(field)) {
        Route::Local
    } else {
        Route::Forward
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::statsig::DisabledGates;
    use crate::statsig::testing::FixedGates;

    fn route(query: &str, operation_name: Option<&str>) -> Route {
        route_with_ccb(query, operation_name, true)
    }

    fn route_with_ccb(query: &str, operation_name: Option<&str>, ccb_configured: bool) -> Route {
        let document = operation::parse_document(query).expect("the test query parses");
        route_operation(&document, operation_name, ccb_configured)
    }

    #[test]
    fn serves_queries_of_local_fields_locally() {
        for field in LOCAL_FIELDS {
            assert_eq!(
                route(&format!("query Q {{ {field} {{ __typename }} }}"), None),
                Route::Local,
                "{field}"
            );
        }
        assert_eq!(
            route(
                "query Home { core { title } sermons(first: 3) { edges { cursor } } }",
                None
            ),
            Route::Local
        );
    }

    #[test]
    fn serves_the_ccb_fields_locally_only_while_ccb_is_configured() {
        for field in CCB_FIELDS {
            let query = format!("query Q {{ {field} {{ __typename }} }}");
            assert_eq!(route_with_ccb(&query, None, true), Route::Local, "{field}");
            assert_eq!(
                route_with_ccb(&query, None, false),
                Route::Forward,
                "{field}"
            );
        }
        let mixed = "query Q { core { title } myGivingHistory { __typename } }";
        assert_eq!(route_with_ccb(mixed, None, true), Route::Local);
        assert_eq!(route_with_ccb(mixed, None, false), Route::Forward);
        assert_eq!(
            route_with_ccb("query Q { core { title } }", None, false),
            Route::Local
        );
    }

    #[test]
    fn serves_user_locally_only_for_woa() {
        for query in [
            "query UserWoaQuery { user { woa { book month } } }",
            "query Q { user { __typename woa { text } } core { title } }",
            "query Q { me: user { woa { text } } user { other: woa { text } } }",
            "query Q { user { ...W } } fragment W on User { woa { text } }",
            "query Q { user { ... on User { woa { text } } } }",
            "query Q { user { __typename } }",
        ] {
            assert_eq!(route(query, None), Route::Local, "{query}");
        }
        for query in [
            "query UserProfileQuery { user { profile { email } } }",
            "query SavedVersesQuery { user { savedVerses { verseId } } }",
            "query Q { user { woa { text } profile { email } } }",
            // Any `user` selection counts, however it is reached.
            "query Q { user { woa { text } } other: user { profile { email } } }",
            "query Q { user { woa { text } ...P } } fragment P on User { profile { email } }",
            "query Q { ...U } fragment U on Query { user { profile { email } } }",
            "query Q { user { ... on User { woa: profile { email } } } }",
        ] {
            assert_eq!(route(query, None), Route::Forward, "{query}");
        }
    }

    #[test]
    fn routes_many_user_selections_of_one_large_fragment_in_linear_time() {
        // This runs before authentication: a fragment shared by every `user` selection must be
        // expanded once, not once per selection.
        let fragment: String = (0..10_000).map(|_| "woa ").collect();
        let selections: String = (0..10_000).map(|_| "user { ...F } ").collect();
        let query = format!("query Q {{ {selections} }} fragment F on User {{ {fragment} }}");
        let document = operation::parse_document(&query).expect("the test query parses");
        let start = std::time::Instant::now();
        assert_eq!(route_operation(&document, None, true), Route::Local);
        assert!(
            start.elapsed() < std::time::Duration::from_secs(1),
            "took {:?}",
            start.elapsed()
        );
    }

    #[test]
    fn allows_typename_beside_local_fields_and_alone() {
        assert_eq!(
            route("query Q { __typename core { title } }", None),
            Route::Local
        );
        assert_eq!(route("query Q { __typename }", None), Route::Local);
    }

    #[test]
    fn follows_aliases_and_fragments_to_the_real_field() {
        // An alias does not hide the field it selects.
        assert_eq!(
            route("query Q { core: profile { id } }", None),
            Route::Forward
        );
        assert_eq!(
            route(
                "query Q { ...F } fragment F on Query { core { title } profile { id } }",
                None
            ),
            Route::Forward
        );
        assert_eq!(
            route("query Q { ... on Query { profile { id } } }", None),
            Route::Forward
        );
        assert_eq!(
            route(
                "query Q { ...F } fragment F on Query { thoughtOfGod { title } }",
                None
            ),
            Route::Local
        );
    }

    #[test]
    fn forwards_introspection() {
        assert_eq!(
            route("query Q { __schema { types { name } } }", None),
            Route::Forward
        );
        assert_eq!(
            route(
                r#"query Q { __type(name: "Core") { name } core { title } }"#,
                None
            ),
            Route::Forward
        );
        // Anonymous introspection passes the operation-name rule, so it is routed too.
        assert_eq!(
            route("{ __schema { queryType { name } } }", None),
            Route::Forward
        );
    }

    #[test]
    fn forwards_queries_with_any_other_root_field() {
        assert_eq!(
            route("query Q { core { title } profile { id } }", None),
            Route::Forward
        );
        assert_eq!(route("query Q { nope }", None), Route::Forward);
        // A skipped field still counts: the operation is never split.
        assert_eq!(
            route(
                "query Q { core { title } profile @skip(if: true) { id } }",
                None
            ),
            Route::Forward
        );
    }

    #[test]
    fn forwards_shorts_until_it_is_ported() {
        // The app's query (`apps/mobile/src/components/shorts/ShortsFeed.tsx`).
        assert_eq!(
            route(
                "query ShortsFeedQuery { shorts { id videoId title channelTitle thumbnail curated } }",
                None
            ),
            Route::Forward
        );
        // Beside a local field the whole operation still goes to TS.
        assert_eq!(
            route(
                "query Q { sermons(first: 3) { edges { cursor } } shorts { id } }",
                None
            ),
            Route::Forward
        );
    }

    #[test]
    fn forwards_every_mutation_and_subscription() {
        assert_eq!(route("mutation M { core }", None), Route::Forward);
        assert_eq!(route("mutation M { __typename }", None), Route::Forward);
        assert_eq!(route("subscription S { core }", None), Route::Forward);
    }

    #[test]
    fn routes_the_selected_operation() {
        let document = "query A { core { title } } mutation B { setVerseOfTheDay }";
        assert_eq!(route(document, Some("A")), Route::Local);
        assert_eq!(route(document, Some("B")), Route::Forward);
    }

    #[test]
    fn keeps_unnamed_and_unselectable_operations_local() {
        // The pipeline answers these with its existing errors.
        assert_eq!(route("{ profile { id } }", None), Route::Local);
        assert_eq!(
            route("mutation { setVerseOfTheDay }", Some("SetVerseOfTheDay")),
            Route::Local
        );
        let two = "query A { profile { id } } query B { profile { id } }";
        assert_eq!(route(two, None), Route::Local);
        assert_eq!(route(two, Some("C")), Route::Local);
    }

    #[test]
    fn checks_the_kill_switch_for_the_fixed_user() {
        let on = FixedGates::passing(&[SERVE_LOCALLY_GATE]);
        assert!(serve_locally(&on));
        assert_eq!(
            on.checks.lock().unwrap().as_slice(),
            [(
                SERVE_LOCALLY_GATE.to_owned(),
                Some("hccna-backend-rs".to_owned()),
                None
            )]
        );
        assert!(!serve_locally(&FixedGates::passing(&["another_gate"])));
        // No Statsig key, or Statsig unavailable: every gate is off.
        assert!(!serve_locally(&DisabledGates));
    }
}
