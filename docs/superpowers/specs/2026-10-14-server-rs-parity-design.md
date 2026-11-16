# Rust backend feature parity: design

Date: 2026-10-14. Status: approved in conversation; this document is for review.
Follows `2026-10-13-server-rust-benchmark-design.md` (phase 1: eight read-only query fields).

## Goal

Bring `apps/server-rs` to feature parity with `apps/server`: every query, mutation and HTTP route
that clients still use. TS stays the production server throughout. At the end of the parity work, a
small sample of real users is sent to the Rust backend for a few weeks. The decision on
anything beyond that comes after the sample.

## Constraints

- **TS keeps production.** `api.hccnj.org` keeps pointing at the TS service (`hccna-backend`), and
  nothing here changes that.
- **The sample comes last.** The app-side Statsig sample starts at the end of the parity work.
  Until then, the Rust service is reached only through its Railway URL
  (`https://hccna-backend-rs-production.up.railway.app`), by us and the benchmark harness. No
  `hccnj.org` subdomain is created yet.
- **One PR per slice, straight to `main`, never stacked.** PRs touching the crate carry the
  `server-rs` label. Each PR builds on `main` as it is when the PR starts; a PR that needs another
  waits until that one has merged.
- **Shared data stores.** The Rust service uses the production `hccna-postgres`, `hccna-redis`
  (keys under `rs:`) and the production Firebase projects. It creates no separate database or Redis.

## How Rust serves partial traffic: the gateway

Until parity is complete, the Rust service answers what it can and forwards everything else to the
TS service. A user in the sample gets the complete app at every stage of the work, and each PR
only widens what Rust answers itself.

- **Routing is per operation.** A request is served by Rust only if it is a `query` whose root
  fields are all in the local allowlist. Everything else is forwarded unchanged: every mutation,
  any query that selects a root field outside the allowlist, and introspection (`__schema`,
  `__type`), because Rust's schema covers only part of the API. An operation is never split
  between the servers.
- **The allowlist** is a constant in the crate that lists the fields each PR has ported; a PR adds
  its fields when it lands.
- **Fields that turn out to be dead** (confirmed from production logs) are never ported. The
  gateway forwards them to TS for as long as TS has them.

### Writes, caches, workers and bugs during the sample

- **Writes.** A mutation ported to Rust runs in Rust only for requests that reach Rust, which
  during the sample means sampled users.
- **Per-user caches** (profile, giving, saved verses) stay consistent because the sample is sticky
  per user. A sampled user's reads and writes all go to Rust, and every other user's go to TS.
- **Shared caches are different.** CMS content, the verse of the day and featured events are cached
  separately by each server and must be invalidated in both. The PRs that port those writes own the
  cross-invalidation.
- **Background workers and scheduler targets stay on TS.** This covers the onboarding queue
  consumer and the Cloud Scheduler, Strapi and account-deletion callers. Rust ports the code behind
  configuration, so a later cutover could move them, but nothing in production calls the Rust
  versions during the sample.
- **Bugs and security issues get fixed in TS first.** Rust then ports the fixed behaviour, so the
  two servers keep behaving the same and the sample stays a fair comparison. This replaces phase
  1's rule of copying TS bugs as they are.

## Programme

Each slice is one PR to `main`. Sizes: S < 500 lines, M < 1.5k, L < 3k, XL above.

| # | Slice | Contents | Size | Needs |
|---|---|---|---|---|
| 1 | Gateway | Routing, forwarding to TS, kill switch, Sentry | M | – |
| 2 | Quick wins | `campuses`, `liveStreamStatus` | S | – |
| 3 | Google clients | Firestore writes/transactions/queries (both projects), FCM sends and topics, cross-server cache invalidation, Stellate purge, Mutation root and guards | L | 1 |
| 4 | CCB client | CCB v1 XML client with the TS cache policy (reads) | M | – |
| 5 | CMS writes | `cmsWebhookUpdate`, `featuredEvents`, `home` | L | 1, 3 |
| 6 | Verse of the day | `setVerseOfTheDay`, `vodPushNotification` | M | 1, 3 |
| 7 | Profiles | `ensureUserProfile`, `profile`, `user.profile`, onboarding queue producer, `/v1/gbp` | XL | 1, 3, 4 |
| 8 | Profile edits | `updateUserProfile`, saved verses | M | 7 |
| 9 | Push and campus | Push tokens, `sendBroadcast`, `setPreferredCampus`, `reconcileCampusSubscriptions` | L | 3, 7 |
| 10 | Giving | `myGivingHistory`, `getPreviousFiveYearsGivingV2`, giving subfields | M | 4, 7 |
| 11 | Account lifecycle | Sign-in codes (custom tokens), account deletion, SendGrid | L | 3, 7 |
| 12 | Word of Activation | `user.woa`, both WOA mutations | L | 3, 9 |
| 13 | Livestream | `castrStream`, `updateCastrStream`, `pingCastrStream`, Castr client | XL | 1, 3 |
| 14 | Attendance | Coordinator queries, `createEventAttendance`, PDF/CSV export and download route | XL | 1, 3, 4 |
| 15 | Sample | `hccnj.org` subdomain or app allowlist change, Statsig targeting | S | all |

Each slice after 1, 2 and 4 gets its own short design when it starts. Before slices 13 and 14, the
`sendAnnouncement` and `createEventAttendance` authorization holes are fixed in TS (see
"Security follow-ups").

Candidates for "dead, not ported", to confirm from logs before the slice that would port them:
`qpd`, `createEmailLink`, `sendAnnouncement`, `eventAttendees`, `eventAttendanceByCcb`,
`exportEventAttendeesPdf`.

A field TS gains after this table was written is forwarded until a slice ports it. `shorts` (the
YouTube Shorts feed, TS source `apps/server/src/graphql/schema/cms/shorts.ts`) is the first: no
slice ports it yet, and the gateway's tests hold it to the forward route until one does.

## PR 1: gateway

### Routing

After parsing, the depth check and operation selection (the existing pipeline in
`graphql/handler.rs`), the handler decides where the operation goes:

| Operation | Route |
|---|---|
| `query`; every root field in `LOCAL_FIELDS`; `__typename` allowed | local |
| `query` selecting `__schema` or `__type` | forward |
| `query` with any other root field | forward |
| `mutation` or `subscription` | forward |
| Parse failure, depth failure, unnamed or invalid operation | Rust's existing error response, unchanged |

When the kill switch (below) is off, every request is forwarded **before** parsing, including
documents Rust would reject.

`LOCAL_FIELDS` starts as the eight phase 1 fields. Rust's rate limiter keeps running first, for
every request, as it does today.

### Kill switch

Local serving needs the Statsig gate `server_rs_serve_locally` to be on. It is checked per request
with a fixed system user, so there is no per-user targeting. When the gate is off, unknown, or
Statsig is unavailable, Rust forwards everything. Turning the gate off therefore makes the Rust
service a pure pass-through within Statsig's update interval, with no redeploy. The gate is created
before PR 1 is deployed and turned on once the forward path is verified. The benchmark harness
needs it on, which `apps/server-rs/bench/RUNBOOK.md` will say.

### Forwarding

- **Target.** `TS_ORIGIN_URL`. On Railway it names TS's private domain,
  `http://${{hccna-backend.RAILWAY_PRIVATE_DOMAIN}}:${{hccna-backend.PORT}}`, so forwarded
  requests skip Railway's edge. Unset, as in local runs, it defaults to
  `https://hccna-backend-production.up.railway.app`: TS's public Railway domain, bypassing
  Cloudflare. The URL is fixed by configuration; nothing in a request can change where it goes.
  - Checked on 2026-10-17 from inside the TS container: the production environment resolves
    `*.railway.internal` to IPv6 and IPv4. TS binds `0.0.0.0`, so the IPv6 attempt is refused at
    once and the connection is made over IPv4.
  - `/readyz` on a reused connection took 2.6–3.2 ms over the private domain and 5–8 ms through
    the edge. A new connection took 9 ms and 33 ms (the edge adds a TLS handshake).
  - The private hop is plain HTTP, carried inside Railway's private network.
- **Request.**
  - Method `POST`, path `/graphql`, and the original body bytes.
  - All end-to-end headers are kept: `authorization`, `content-type`, `accept`, `accept-encoding`,
    `user-agent`, `x-firebase-appcheck`, `x-hccna-*`, `traceparent`, `x-request-id`.
  - Hop-by-hop headers (`connection`, `keep-alive`, `proxy-*`, `te`, `trailer`,
    `transfer-encoding`, `upgrade`), `host` and `content-length` are dropped.
  - `X-Forwarded-For` is set to the client's address, as Rust's rate limiter derives it
    (`X-Real-IP`, then the peer).
  - `x-hccna-forwarded-by: hccna-backend-rs` is added, so TS logs can tell forwarded traffic apart.
- **Response.** The TS status, headers (minus hop-by-hop) and body are passed back as they are,
  including `content-encoding: gzip`. The one exception is the `RateLimit*` headers: Rust's own
  limiter sits in front, so its headers replace TS's. The compression layer must not encode a response twice.
- **Limits.** The same 2 MiB body limit as local requests. One deadline of `APP_TIMEOUT_MS`
  (20 s) covers the whole forwarded exchange, the same budget TS gives itself. The deadline is
  stamped before the router's own 20 s `TimeoutLayer` and fires 100 ms earlier, so the client gets
  the gateway's 504 body rather than the layer's empty 504. The HTTP client does not follow
  redirects. It keeps an idle connection to the origin for 15 s, under Bun's 20 s `idleTimeout`,
  so it never sends a request on a connection TS is closing; such a request would fail with no
  retry.
- **Failures.**
  - If TS is unreachable or the deadline expires, the response is `502` (or `504`) with the GraphQL
    error body `{"errors":[{"message":"Upstream unavailable."}]}`.
  - The failure is logged with its cause and reported to Sentry.
  - Retries are not automatic: a mutation is never retried.

**Rate limits behind the gateway.** TS keys its limiter on the raw `X-Forwarded-For` value. The
check after PR 1's deploy found that Railway's edge overwrites that header with the address it
received the connection from. Requests forwarded through TS's public domain therefore share a few
keys: Rust's outbound addresses. The private domain has no edge in between, so TS sees the value
Rust sends. On 2026-10-17 a probe from inside the TS container confirmed both, using synthetic
addresses from 203.0.113.0/24:

- **Private domain:** each distinct address started at `remaining=19`, and a repeated one dropped
  to 18.
- **Public domain:** three distinct addresses counted down one limit: 19, 18, 17.

Forwarding over the private domain therefore gives every client its own TS limit, with no TS
change. Only services in this Railway environment can reach TS without the edge. Public traffic
still gets its header from the edge, so no outside caller can choose its key. A shared secret that
marks Rust's address as trusted is extra protection, not a precondition for the sample. If
`TS_ORIGIN_URL` points at the public domain again, forwarded traffic shares keys again.

TS logs neither request headers nor the client address
(`apps/server/src/transport/http/pinoLoggerMiddleware.ts`), so forwarded requests cannot be picked
out in its logs by `x-hccna-forwarded-by`. Two methods replace that:

- **Finding a request.** Look it up in TS's logs by a unique `x-request-id`, which TS adopts.
- **Checking `X-Forwarded-For`.** From a shell in the TS container (`railway ssh`), send requests
  with distinct `X-Forwarded-For` values to the origin `TS_ORIGIN_URL` names, and read TS's
  `RateLimit` header. Through Rust that header is Rust's own, so TS's limit would show only as a 429.

### Observability

- **Request log.** Each request log line gains `route` (`local` or `forward`) and, for forwarded
  requests, the upstream status and duration.
- **Metrics.** The Prometheus registry gains a counter and a duration histogram labelled by `route`
  and status class only, keeping the label set bounded. The `graphql_envelop_*` operation metrics
  also carry `route`, so the Grafana Rust-vs-TS comparison counts only operations Rust answered
  itself: a forwarded request's time is TS's plus the network hop.
- **Sentry**, through the `sentry` crate.
  - Configured by `SENTRY_DSN` and `SENTRY_ENABLED`, the same variable names TS uses. Rust has no
    built-in default DSN. TS on Railway has no `SENTRY_DSN` and uses the default in
    `apps/server/src/instrument.ts`, so `hccna-backend-rs` gets that same DSN (the same Sentry
    project) as a variable.
  - Events carry environment `production`, server name `hccna-backend-rs`, and the git SHA as the
    release. Deploys made with `railway up` get no `RAILWAY_GIT_COMMIT_SHA`, so the deploy
    workflow sets `SENTRY_RELEASE`.
  - Reported: panics, 5xx responses produced by Rust, and upstream failures.
  - `authorization` headers, cookies and request bodies are never attached, so push tokens never
    reach Sentry.
- **No OTLP push.** Railway's per-service HTTP metrics and the request logs are enough to compare
  the two services. This also avoids adding Grafana series: the free tier's series cap was hit on
  2026-10-11.

### Out of scope

These come with the first slice that needs them:

- The Mutation root and mutation guards (slice 3).
- The shared app token and Google OIDC auth (slices 5, 6 and 7).
- App Check enforcement. TS runs with `APP_CHECK_ENFORCEMENT` off, and forwarded requests keep the
  header.
- `GET /graphql` and persisted queries, which the app does not use.

### Tests

- **Unit tests:**
  - every row of the routing table;
  - gate on, off and unavailable;
  - header filtering, including hop-by-hop and `host`;
  - the `X-Forwarded-For` derivation.
- **Integration tests** against a mock TS origin in-process (axum on a random port):
  - status, header and body pass-through, including a gzip body passed through without
    re-encoding;
  - upstream down returns 502, and the deadline returns 504;
  - a mutation is forwarded, never executed locally.
- **After deploy, against the Railway URL:**
  - the 11 benchmark operations are served locally;
  - a mutation and a query selecting `profile` come back from TS, recognisable in TS's log by
    `x-hccna-forwarded-by`;
  - the `X-Forwarded-For` check above.

### Configuration added to `hccna-backend-rs`

| Variable | Value |
|---|---|
| `TS_ORIGIN_URL` | `http://${{hccna-backend.RAILWAY_PRIVATE_DOMAIN}}:${{hccna-backend.PORT}}`, TS's private domain (see "Forwarding") |
| `SENTRY_DSN` | The DSN from `apps/server/src/instrument.ts` (TS's default, same Sentry project) |
| `SENTRY_ENABLED` | `true` |

## PR 2: `campuses` and `liveStreamStatus`

**`campuses`** (scope `authorized`) is the legacy V1 field. It shares the campus loader that
`campusesV2` already uses in `fields/campuses.rs`, and differs in three ways:

- it returns `Campuses { pageBody, campus }` with the default campus order and no preferred-campus
  sorting;
- it leaves lead names uncleaned;
- it leaves `campusName` and `cityState` un-normalized;
- a CMS failure becomes a GraphQL error, where `campusesV2` returns a typed result. Like any other
  internal error it is masked, so clients see `Unexpected error.`. The log keeps
  `CMS fetch: Unable to load campuses`.

Port of `apps/server/src/graphql/schema/cms/campuses.ts`, the `loadCampuses` effect and the
`campuses` field.

**`liveStreamStatus(slug)`** (scope `authorized`) reads one Firestore document,
`app-config/live-stream`, through the existing `google/firestore.rs` client.

- **Decoding.** Each stream is decoded the way `StreamProjectionStore.getLiveStreams` does it,
  attaching published metadata from `metadataByStreamId` when it is present.
- **Filtering.** A non-blank `slug` keeps only the streams whose slug matches, case-insensitively.
- **Legacy fallback.** Streams without aggregate metadata take `title` and `description` from
  `castr-streams/{id}`. That document is read at most once per stream per request, and cached the
  way the TS `streamMetadata` loader caches it.
- **Errors.** A read or decode failure of the aggregate returns `LiveStreamStatusFetchError`
  ("Unable to load live stream status"), and the cause is logged.
- **Caching.** The response-cache TTL stays 0, as in TS.

Both fields join `LOCAL_FIELDS` if PR 1 has merged by then. Otherwise the gateway PR adds them, and
whichever of the two lands second updates the list. The contract test compares only the SDL, so it just gains the new
types. The synthetic Firestore and Strapi fixtures go in the field tests. Neither field is used by the app; `liveStreamStatus` is
used by the website, which keeps calling TS.

## PR 4: CCB client

A Rust port of the CCB v1 client the TS server uses (`packages/ccb` plus the server's caching
around it), covering read requests only. Writes (`create_event_attendance`, add-to-group) come with
the slices that call them. No GraphQL field uses the client yet. Its first consumers are slices 7,
10 and 14, so this PR is tested in isolation.

### Transport

- `GET {CCB_API_END_POINT}?srv=<service>&...` with HTTP Basic auth from `CCB_USERNAME` and
  `CCB_PASSWORD`.
- A 15 s timeout per attempt, and the retry schedule of `packages/ccb/src/client.ts`: up to 2
  retries (3 attempts), exponential from 500 ms, on transport errors, 5xx, 408 and 429.

### Decoding

XML is decoded with `quick-xml` and serde into typed records mirroring `packages/ccb/src/schemas/*`
for:

| Service | Used for |
|---|---|
| `individual_search` (by email) | Profiles, onboarding |
| `individual_groups` | Profiles, attendance |
| `group_participants` | Attendance |
| `attendance_profile` | Attendance |
| `transactions_by_family` | Giving |

A CCB `<error>` element in a 200 response becomes a typed error, and it is not cached.

`group_profiles` is not ported. Nothing in TS calls it, and its TS schema always decodes it to `{}`.

### Caching

- Per request type, with the TTL and stale-while-revalidate windows of
  `packages/ccb/src/cache-config.ts`: user search 20/30 min, groups 1/2 h, group members
  15/30 min, user groups 25/50 min, giving 40/80 h, attendance profile 5/10 s.
- Two tiers: an in-process moka cache, then Redis under `rs:ccb:`.
- A stale hit returns at once and refreshes in the background, with one refresh in flight per key.
- A Redis outage degrades to the in-process cache, as the Strapi record cache does.

### Where TS differs

The behaviour above is the intended one, and TS's CCB client falls short of it:

- **Errors are cached.** TS's GET path never checks for `<error>`; it decodes it as an empty answer
  and caches it.
- **Stale-while-revalidate is not implemented.** TS never reads the SWR window, its in-process
  entries never expire, Redis keeps entries for the TTL only, and every stale hit starts a refresh
  with no deduplication.
- **Valid data is rejected.** Its schemas reject single-item lists (one phone, group, participant
  or attendee), empty participant and attendee lists, and digits-only text in string fields.

No GraphQL field uses the client yet, so the difference reaches no one. Rust ships the intended
behaviour, and the TS fixes land before the first slice that consumes the client (7, 10 or 14),
which keeps the "TS first" rule wherever traffic is involved.

### Configuration

`CCB_USERNAME`, `CCB_PASSWORD` and `CCB_API_END_POINT` are optional in `Config`, because the client
is built only when all three are set. They are referenced from `hccna-backend` when slice 7 needs
them.

### Tests

- Synthetic XML fixtures for every service, in the shapes of the TS schemas, with no real CCB
  records.
- Error-element decoding.
- Retry behaviour against a mock server.
- The cache's TTL and SWR transitions, with a fixed clock.
- In-flight refresh deduplication.

## PR 10: giving (`myGivingHistory`, `getPreviousFiveYearsGivingV2`)

A port of `donationsV2.ts`, `givings.ts`, `GivingService.ts`, `giving/parseGiving.ts` and
`giving/weeklyRefresh.ts` after the TS fixes of #233 (gifts filtered by date year, a year's rows
replaced rather than merged, `ccb_id` on the summary, Redis prefix `donations-v3`) and #235 (every
tier kept until Monday 10:00 UTC, the CCB read past CCBService's own cache). It is Rust's first
Postgres write path.

Slice 7 is not needed: both fields read the member from `app_users` directly, not through the
profile loader. The giving subfields of `Profile` and `User` stay with slice 7.

- **Scope.** Both fields need `signedIn`: a non-anonymous Firebase sign-in with a uid and an email.
  It is a new guard beside `authorized`, with Pothos' refusal message.
- **Tiers per year**, the five years concurrently, the first failure failing the answer:
  1. an in-process LRU;
  2. Redis under `rs:donations-v3:…`;
  3. the Postgres summary and rows;
  4. CCB.

  The CCB path rewrites the year in one transaction: delete the dropped rows, upsert in batches of
  250, upsert the summary, and log the sync. That transaction and the Redis write run in the
  background, with 2 minutes each.
- **Routing.** The two fields join the gateway's `CCB_FIELDS`. Those are answered here only while
  the CCB client is configured. Until `CCB_API_END_POINT`, `CCB_USERNAME` and `CCB_PASSWORD` are set
  on `hccna-backend-rs` (referenced from `hccna-backend`), giving keeps going to TS, so the deploy
  order does not matter.
- **Timestamps.** The `timestamp` columns have no time zone. drizzle writes UTC wall-clock time
  (`toISOString()`, whose `Z` Postgres drops), so Rust writes `to_timestamp(ms / 1000) at time zone
  'UTC'` and reads `extract(epoch …)`. Row ids are generated here, as drizzle's `$defaultFn` does.

### Where Rust differs

- **The LRU holds only giving.** It keeps 1,000 entries; TS shares its 1,000-entry `LRUService`
  across features.
- **Redis values are Rust's own.** They are the year's result without the `source` and `cachedAt`
  fields that no client reads.
- **The current year is the UTC year.** TS reads the process time zone, which is UTC on Railway.
- **CCB dates.** CCB dates are read as `yyyy-MM-dd`, with an optional time and offset. date-fns'
  `parseISO` also accepts week, ordinal and basic ISO forms, which CCB never writes; those fail
  here, as an invalid date fails in TS.
- **Without CCB configured,** a year that misses every cache is a `MyGivingHistoryFetchError`. The
  routing above keeps clients away from that state.

## PR 12: Word of Activation (`user.woa`)

A port of `User.woa` (`graphql/schema/user/index.ts`, `woa.ts`), its `userProfile` and `woa`
request loaders (`graphql/loaders/firebaseDataLoader.ts`, `woaDataLoader.ts`), and
`WordOfActivationService.getByEmail` with `getOrAssignWordOfActivationEffect`. It ports TS as of #241,
which moved the app's auto-subscription to the secondary project, where the lookup and the
monthly rotation already were. It lands after #241.

The two WOA mutations (`wordOfActivationMonthly`, `wordOfActivationSendPending`) stay on TS: they
are Cloud Scheduler targets, and workers stay on TS.

- **Routing.** `user` is a partial field: `user { woa }` is answered here, and an operation that
  selects any other `User` field anywhere under `user` is forwarded whole. Rust's `User` type
  defines `woa` alone. The contract test accepts that for the types the gateway lists, and checks
  that the list and the schema agree.
- **Scope.** `user` needs `signedIn` and is non-null, so a refused caller gets `data: null`.
  `User.woa`'s own `signedIn` check cannot fail once `user` has resolved, so it is not repeated.
- **Profile check.** `app-users/{uid}` must decode as TS's `UserProfileDocSchema` and carry a
  first and last name, an image and a provider; otherwise `woa` is `null`. A failed read is retried
  once, as TS falls back from its batch read to a single read.
- **Caches.** An in-process LRU of 200 entries, then Redis `rs:woa-dataloader:2:woa-<key>` with
  TS's `{value, expiresAt}` envelope for two hours. Either is used only while its `month` is the
  current Eastern month.
- **Writes.** A new member is subscribed in the secondary project with a random verse and
  `monthlySub: true`. If a subscription appears between the lookup and the add, it is kept,
  re-subscribed and given a verse. These are Rust's first Firestore writes:
  - `runQuery` with one filter;
  - `add`;
  - an update-masked `PATCH` that requires the document to exist.

  A second Firestore client covers the secondary project (`FIREBASE_SECONDARY_PROJECT_ID`, default
  `app-hccnj-17d4f`, which TS hard-codes).

### Where Rust differs

- **LRU expiry.** An LRU entry left unread for an hour is dropped. TS's `allowStale` serves it once
  more first.
- **Random verse ids** come from v4 UUID bytes. firebase-admin's `autoId()` uses its own random
  source; both are 20 characters from `[A-Za-z0-9]`.
- **No primary-project fallback.** On a secondary miss, TS's `getOrAssign` (#241's review fix)
  still checks the primary project. If it finds a match there, it keeps and updates that doc
  instead of adding one. That bridges the time before `woa:copy-subscriptions` runs, and TS drops it
  afterwards. This port lands after the copy, when no copied member reaches that branch, so it
  leaves the fallback out.

## Security follow-ups (TS, before the slices that touch them)

- **`sendAnnouncement`** has scope `authorized`, which includes anonymous Firebase sign-ins. Any app
  install can therefore publish an FCM message to any valid topic, including the one every device
  subscribes to. Restrict it to `googleInternal`, or drop it.
- **`createEventAttendance`** checks that the caller coordinates *some* event, not the event being
  written. It should check the target event.
