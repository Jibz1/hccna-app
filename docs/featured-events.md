# Featured event feeds

Strapi owns featured cards. PostgreSQL stores one ordered snapshot for Home and
one for each campus in `featured_event_sources`. Campus snapshots contain only
local cards. The API composes local cards followed by Home cards marked
`allCampusEvent`; a campus with no local cards receives the entire Home selection.
The GraphQL schema and authentication contract are unchanged.

Campus sources are limited to the shared `CAMPUS_SLUGS` list used by the campus
API. Unknown slugs receive the full Home selection without a campus lookup or
source row. Refresh claims reject unknown sources, and workers ignore any
unknown rows already stored. Register a new campus in that list before its
featured feed can initialize.

## Synchronization and freshness

Home and campus webhooks refresh their own source from uncached, published Strapi
content. A successful empty list replaces the previous list. Null Home data (or
its 404 response) and absent published campuses represent removal. Missing fields,
invalid payloads, and request failures preserve the last successful snapshot.

The server worker checks known sources every ten seconds. PostgreSQL claims limit
routine source fetches to once per thirty seconds across replicas. Webhooks bypass
that interval. A monotonically increasing refresh revision prevents older work
from overwriting newer work. The separate content revision also prevents image
processing from restoring a list read before an in-flight refresh completed.

Reads fetch Home and the selected campus in one database query when current.
Uninitialized or stale sources are refreshed on demand, including after a Cloud
Run instance resumes from idle. Concurrent first reads wait briefly for another
replica's initialization. Existing successful snapshots remain available during
Strapi outages. The refresh worker is process-scoped; request-time reconciliation
is the fallback when background CPU is unavailable.

Home and featured GraphQL responses have a fifteen-second TTL and are invalidated
after changed snapshots. The response-cache namespace is bumped for this rollout
so old ten-minute responses cannot survive the deployment. This targets roughly
a minute of propagation under healthy dependencies; it is not an outage SLA.

Image colors are enriched independently, with bounded concurrency and timeouts.
Content publication and deletion never wait for image processing. Until enrichment
finishes, the existing default palette is used.

Mobile defaults FeaturedEventsQuery to revalidate on foreground/reconnection,
subject to a fifteen-second sweep cooldown. Statsig per-query overrides still
apply. Home also supports pull-to-refresh. Offline devices retain downloaded
content until their next successful online fetch.

## Deployment

Apply `20260927120000_featured_event_sources` before running the new server. Normal
container startup already runs the migration runner. It seeds Home and previously
stored campus source names with uninitialized snapshots. The worker and first reads
rebuild supported sources from Strapi; registered campuses initialize when first
requested or updated.

Legacy `featured_events` rows are deliberately retained for rollback, but the new
server never reads them. They cannot be safely converted because shared copies
have no provenance. Rollback to the old server restores the previous behavior and
its known shared-event synchronization defect. Complete the server rollout before
assessing freshness; old replicas still use the previous feed implementation.

Verify a shared-card deletion across two campuses, removal of the last Home card,
and the full Home fallback after a campus loses its final local card. Inspect
`source`, `revision`, `content_revision`, `attempted_at`, and `synced_at` when
investigating stale content. Refresh and enrichment failures log the source.
