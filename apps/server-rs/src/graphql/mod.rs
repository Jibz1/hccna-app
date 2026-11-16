//! The GraphQL schema and request pipeline (`apps/server/src/routes/graphql.ts`).

pub mod auth;
pub mod complexity;
pub mod depth;
pub mod errors;
pub mod guards;
pub mod handler;
pub mod memo;
pub mod nesting;
pub mod nulls;
pub mod operation;
pub mod rate_limit;
pub mod response_cache;

use std::sync::Arc;

use async_graphql::{EmptyMutation, EmptySubscription, MergedObject, Schema, SchemaBuilder};

use crate::fields;
use crate::fields::Clock;
use crate::fields::ccb_forms::CcbFormsLoader;
use crate::fields::core::CoreSettings;
use crate::fields::giving_history::service::GivingService;
use crate::fields::live_stream::projection::StreamProjectionStore;
use crate::fields::user::woa::WoaService;
use crate::fields::vod::VodService;
use crate::statsig::FeatureGates;
use crate::strapi::CmsSource;

pub type AppSchema = Schema<Query, EmptyMutation, EmptySubscription>;

// The root `Query`: each field group is a separate object merged here, and later PRs append
// theirs. (A doc comment would become the type's description in the SDL; TS has none.)
#[derive(MergedObject, Default)]
pub struct Query(
    fields::campuses::CampusesQuery,
    fields::ccb_forms::CcbFormsQuery,
    fields::core::CoreQuery,
    fields::events::EventsQuery,
    fields::giving_history::GivingHistoryQuery,
    fields::live_stream::LiveStreamQuery,
    fields::sermons::SermonsQuery,
    fields::thought_of_god::ThoughtOfGodQuery,
    fields::user::UserQuery,
    fields::vod::VodQuery,
);

/// The schema without any request-independent data, for the SDL and for tests.
pub fn schema_builder() -> SchemaBuilder<Query, EmptyMutation, EmptySubscription> {
    Schema::build(Query::default(), EmptyMutation, EmptySubscription)
}

/// async-graphql's default nesting limit, set explicitly so `depth::check` applies the same one
/// before any of the handler's own document walks.
pub const MAX_RECURSIVE_DEPTH: usize = 32;

/// Introspection stays enabled, as on the TS server. Resource limits: before parsing,
/// `nesting::check` rejects query text with more than `nesting::MAX_BRACKET_NESTING` (128)
/// `(`/`[`/`{` open at once — an over-approximation of the parser's value nesting that never
/// under-counts it, so the parser's recursive value building cannot overflow the stack. Then the
/// parser rejects definitions nested deeper than 64 levels, `depth::check` and then async-graphql
/// reject documents nested deeper than `MAX_RECURSIVE_DEPTH` (fragment spreads included),
/// `http::GRAPHQL_BODY_LIMIT` bounds the request body, and the handler applies the TS cost model
/// (`complexity`, max 2000) to every operation before executing it.
pub fn build_schema(data: SchemaData) -> AppSchema {
    schema_builder()
        .limit_recursive_depth(MAX_RECURSIVE_DEPTH)
        .extension(errors::ValidationErrorCode)
        .data(data.ccb_forms)
        .data(data.cms)
        .data(data.clock)
        .data(data.core)
        .data(data.gates)
        .data(data.giving)
        .data(data.streams)
        .data(data.vod)
        .data(data.woa)
        .finish()
}

/// The services resolvers reach through the schema; later PRs add theirs.
pub struct SchemaData {
    pub ccb_forms: Arc<CcbFormsLoader>,
    /// CMS content for the Strapi-backed fields.
    pub cms: Arc<dyn CmsSource>,
    /// The time the event fields date events against.
    pub clock: Clock,
    /// `core`'s settings and their caches.
    pub core: Arc<CoreSettings>,
    /// Feature gates (Statsig).
    pub gates: Arc<dyn FeatureGates>,
    /// The giving fields' tiers: memory, Redis, Postgres, CCB.
    pub giving: Arc<GivingService>,
    /// `liveStreamStatus`'s Firestore reads and its legacy metadata cache.
    pub streams: Arc<StreamProjectionStore>,
    /// `verseOfTheDayV2`'s verse and its caches.
    pub vod: Arc<VodService>,
    /// `User.woa`'s profile check, Word of Activation lookup and caches.
    pub woa: Arc<WoaService>,
}

/// The schema's SDL, compared against `packages/schema/schema.graphql` by the contract test.
pub fn sdl() -> String {
    schema_builder().finish().sdl()
}
