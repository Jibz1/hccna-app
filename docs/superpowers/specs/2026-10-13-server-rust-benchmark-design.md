# Rust backend benchmark — design (phase 1)

Date: 2026-10-13. Status: phase 1 built and on `main`; the benchmark decides whether to go further.

## Goal

Run a Rust implementation of the GraphQL backend beside the TypeScript server (`apps/server`) and
measure both under the same load before deciding whether a migration is worth it. Nothing user-facing
changes: no device ever talks to the Rust server.

Decisions made while brainstorming:

| Question | Decision |
|---|---|
| Purpose | Side-by-side performance comparison that informs a migration decision. |
| Traffic | Replay + load tests only. A harness replays the mobile app's own operations; no user traffic, no shadowing, no canary. |
| Scope | Every query root field the mobile app sends (15 fields, 23 operations), split into three phases. This spec is phase 1. |
| Environment | The existing Railway project (*Apps Backend*, `production`, us-east4) with real upstreams. |
| Stack | axum + async-graphql with typed resolvers; schema parity enforced by a contract test. |
| Build | A Dockerfile built by Railway through `railway up`, the same path as `hccna-backend`. |

## Phases

| Phase | Root fields | Upstreams | Status |
|---|---|---|---|
| 1. Foundation + content | `core`, `sermons`, `thoughtOfGod`, `campusesV2`, `events`, `upcomingEventsByMonth`, `ccbFormsV2`, `verseOfTheDayV2` (11 operations) | Postgres (`core_settings` only), Strapi 5, public CCB forms, Firestore, Statsig, Redis | This spec |
| 2. Signed-in reads | `user` (profile, savedVerses, woa), `featuredEvents`, `castrStream` | Adds writes (onboarding enqueue, Firestore transaction, featured refresh) | Own spec |
| 3. CCB-backed reads | `myGivingHistory`, `kidsEventAttendance`, `eventWithAttendance`, `exportAttendance` | Live CCB with real people's data, background syncs | Own spec |

Phases 2 and 3 cannot be load-tested against production upstreams (they write, and CCB is rate
limited and holds real giving and attendance data). Their specs must revisit the environment.

## 1. Topology

### Repository

- `apps/server-rs/` is a single Cargo binary crate, `hccna-server-rs`. It has no `package.json`, so it
  is not a Bun workspace: `bun.lock`, turbo, root CI and the TS Dockerfile are untouched.
- `apps/server-rs/AGENTS.md` holds the Rust conventions. `.gitignore` ignores `target/`.
- Branch workflow: phase 1 was built as a stack of PRs into `experiment/server-rust` and then landed on
  `main`. New work is a branch with a PR into `main`.
- CI: `.github/workflows/server-rs.yml` runs `cargo fmt --check`, `cargo clippy -D warnings`,
  `cargo test` and a Docker build for PRs and pushes that touch the crate. It does not
  deploy.

### Docker image

`apps/server-rs/Dockerfile` builds from the repository root (what `railway up` uploads) and copies
only the crate's manifest and sources, so a local `target/` never enters the build:

1. `lukemathwalker/cargo-chef:<version>-rust-1.93-trixie` plans and cooks dependencies into their own
   layer. Railway only allows BuildKit cache mounts whose id hard-codes the service id, so cargo-chef's
   ordinary layer cache is used instead.
2. Release build: thin LTO, one codegen unit, mimalloc as the global allocator.
3. Runtime `gcr.io/distroless/cc-debian13:nonroot`: glibc matches the trixie builder, CA certificates
   included, no shell, non-root.

### Railway services

All in project *Apps Backend*, environment `production`, region us-east4. The live `hccna-backend` and
`api.hccnj.org` are not touched.

| Service | What | Why |
|---|---|---|
| `hccna-backend-rs` | The Rust server; Railway domain only. Dockerfile path `apps/server-rs/Dockerfile`, health check `/readyz`. | The subject. |
| `hccna-backend-ts-bench` | The TS server from `main` (same `apps/server/Dockerfile`), `BACKGROUND_WORKERS_ENABLED=false`, `RUN_MIGRATIONS=false`. | Load-testing the single live replica would slow real users, and real traffic on it would skew results. |
| `hccna-bench-redis` | Redis used by both bench servers. Rust keys carry the prefix `rs:`. | The TS and Rust caches use different encodings; sharing production Redis would let the live server read a Rust-written entry and fail strict decoding. It also keeps benchmark load off production Redis and gives both servers equally cold caches. |
| `hccna-bench` | k6 load generator; runs one scenario and exits (restart policy never). | Runs inside the private network so results measure the servers, not the internet. |

Shared with production, read-only in phase 1: `hccna-postgres` (only `core_settings`), Strapi 5,
Firebase Auth and Firestore, the public CCB forms endpoint. Both bench servers cap their Postgres pool
at 10 so the live server's pool of 50 keeps headroom.

Fairness: identical vCPU and memory limits, one replica each, same region. `GRAPHQL_RATE_LIMIT_RPS` is
raised on both because all load comes from one address; the limiter still runs, so its Redis `INCR`
per request stays in the measured work.

Owner-only steps (secrets): copy `CMS_V5_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`,
`STATSIG_SERVER_SECRET_KEY` and the Postgres reference to the new services (and give both bench
servers the same `STATSIG_ENVIRONMENT`, so their gate checks and exposures land in the same,
non-production Statsig tier); provide a Firebase web API
key for the harness's anonymous sign-in. The runbook lists every variable per service.

## 2. Request pipeline

The Rust server reproduces the per-request work the TS server does for these operations, in the same
order, so the comparison measures the runtime rather than a different amount of work.

| TS behaviour (`apps/server`) | Rust phase 1 |
|---|---|
| `compress`, `requestId` (`X-Request-Id`), JSON request log, 20 s timeout, `cors()` | Same, via tower-http layers. |
| Per-IP rate limit: `graphql:rate-limit:<key>` Redis `INCR`/`EXPIRE` 1 s window, in-memory fallback, 429 body with `TOO_MANY_REQUESTS` | Same, under the `rs:` prefix. |
| Rate-limit key: the whole raw `X-Forwarded-For` value, else the peer IP | Deliberate difference: Railway's `X-Real-IP` (the client's remote IP, set by Railway's edge per its "Request Headers" docs), else the peer IP; `X-Forwarded-For` is ignored. Clients control `X-Forwarded-For`, so keying on it would give them a fresh bucket per request, and Railway does not document rewriting it. Same work per request (one header read). |
| App Check middleware (`off` in production) | Not ported. |
| APQ (unused by clients), `@defer`/`@stream` (unused), Stellate logger, Sentry | Not ported. |
| yoga's request parsers: `POST` JSON, `GET` query strings, `application/graphql`, form-encoded and multipart bodies | Only `POST` with `application/json` or `application/graphql+json` (yoga's messages and status codes for malformed bodies); other content types get yoga's 415, and `GET /graphql` gets 405. The app and the harness send `POST` JSON only. |
| No document nesting limit in graphql-js | Rust bounds, each covering one thing: the bracket pre-scan (next row) caps `(`/`[`/`{` nesting in the query text at 128, which covers values, arguments and selections; the parser caps selection-set nesting within one definition at 64; the depth check (row after) caps selection depth through fragment spreads at 32; serde_json caps the `variables` JSON at 128 levels (400 `BAD_REQUEST`). Mobile operations stay far below all of them: the deepest selection depth is 5 and the deepest bracket nesting 6 (`UserGivingQuery`, `LatestEventsQuery`). |
| Deeply nested values (lists and objects in field arguments, directive arguments and variable defaults) parse recursively; a too-deep recursion is a caught `RangeError` that fails only that request | Deliberate difference: before parsing, a linear scan of the query text rejects any document with more than 128 brackets (`(`, `[`, `{`, counted together) open at once, with a parse error (`Syntax Error: brackets are nested deeper than 128 levels.`, its location, `GRAPHQL_PARSE_FAILED`, HTTP 200). It skips strings, block strings (`\"""` included) and comments, and a closing bracket with nothing open cannot lower the count below zero. The scan is a one-sided over-approximation of the parser's own nesting, not an exact match of the grammar: it may count brackets the parser would not (so it can reject a document the parser would accept), but it never under-counts — for every document the parser accepts, the scan counts at least as deep as the parsed value nests. In particular an unterminated `"""` is read as `""` (an empty string) exactly as the grammar's ordered choice backtracks, so brackets after it still count (an earlier version skipped to end of document there, which hid a 4 KB stack-overflow bypass). The reason for the bound: pest 2.9.3 checks the remaining stack and fails the parse cleanly when it runs low, so the parse itself does not abort; the overflow came from async-graphql's recursive conversion of the accepted document (one recursion per list or object level, no limit), which overflowed a 2 MiB worker stack at about 1,400 levels, a 4 KB body, and aborted the process with every in-flight request. |
| No nesting limit through fragment spreads: a document nested arbitrarily deep through a chain of fragments is walked recursively, and a too-deep recursion is a caught `RangeError` that fails only that request | Deliberate difference: right after parsing, before any other walk of the document, Rust rejects every operation or fragment definition (used or not) nested deeper than 32 levels, counting selection sets, inline fragments and fragment spreads as async-graphql's limit does, with async-graphql's own error (`The recursion depth of the query cannot be greater than `32``, its location, `GRAPHQL_VALIDATION_FAILED`, HTTP 200). A fragment cycle fails it too. The reason: the handler's walks and async-graphql's checks recurse once per spread, and a Rust stack overflow aborts the process and every in-flight request (a 15k-fragment chain did). The check uses an explicit stack and visits each fragment once. |
| Redis commands without a timeout (Bun's client queues them while it reconnects) | Deliberate difference: each command, connection included, is bounded by 500 ms (`store/kv.rs`), then treated as a miss or skipped write, so an outage adds latency instead of holding requests. |
| CMS record cache: every request that misses memory reads Redis and, on a miss there, loads from Strapi, even while another request is loading the same key (`recordCache.ts` is a plain LRU with no in-flight tracking) | Deliberate difference: concurrent misses for one key share a load (`strapi/record_cache.rs`). The first reads Redis and Strapi; the others wait, then read what it put in memory. A waiter whose predecessor cached nothing (a failed load, or a generation that moved) reads Redis and Strapi itself, as before. Different keys still load in parallel. The reason: the app sends `CampusesQuery` twice at once when it opens, and on 2026-10-17 each cold pair made two identical Strapi calls inside a burst of six, which Strapi (one replica) answered in 150–210 ms each instead of 16–72 ms. Rust does less Strapi work than TS on those bursts, so compare cold-path latency with that in mind. |
| Strapi calls use Bun's global `fetch` with its defaults: no agent or keep-alive options (`utils/serviceRequest.ts`). firebase-admin uses its own HTTP client | One reqwest client for Strapi, CCB and Google (`upstream.rs`). It keeps an idle connection pooled for 1 h, sends HTTP/2 pings every 60 s on idle connections too (a connection whose ping goes unanswered for 20 s is closed), and sets TCP keep-alive at 60 s. Per-request work is the same; only connection reuse differs. The reason: Rust's traffic arrives in bursts minutes to hours apart, while TS calls Strapi every few minutes for other users. On 2026-10-17, with a 90 s idle timeout, Rust's Strapi calls averaged 1.6–3.5× TS's for the same queries. They also measured about 100 ms more at the client than Strapi's edge logged, which fits a new DNS, TCP and TLS setup at the start of each burst. Strapi (through Railway's edge) and Google both speak HTTP/2. |
| `useRequireOperationName` | Same rule and message. |
| `useKnownOperationGuard` (log-only) and `formatOperationName` (`-untagged`, `anonymous`) | Name formatting for logs and metrics only. |
| `graphql_envelop_*` metrics labelled with `formatOperationName` of the client's operation name | Deliberate difference: labels come from a fixed set (known names as is, `anonymous`, otherwise `untagged`), because the server has a public domain and raw client names would let anyone create unbounded Prometheus series. Log lines keep the TS `<name>-untagged` formatting. They also carry a Rust-only `route` label (`local` or `forward`, from the gateway): a forwarded request's duration is TS's time plus the network hop, so the Grafana comparison reads `route="local"` only. It adds at most one series set per operation. |
| Every metric is recorded twice: prom-client and the Effect/OpenTelemetry reader that pushes to OTLP (`bench/k6/metrics.js` reads the prom-client side) | Deliberate difference: Rust records Prometheus only (`src/metrics.rs`; no OTLP push in phase 1, see Observability). The TS server does this in production, so measuring it is legitimate, but it means Rust does less work per request: a Rust advantage of one recording per metric, not a language effect. Read CPU comparisons with that in mind. |
| Shared-cache classification (root fields ⊆ public allowlist) | Same allowlist. |
| Response cache: in-process LRU (TTL ≤ 30 s) → Redis `{data, expiresAt}`; TTL is the minimum over the document's field coordinates (5 min when none has one); shared or scoped to the raw `Authorization` value (no header → one shared empty session, with private root fields skipped); key = hex SHA-256 of `query|operationName|stableStringify(variables)|session`; looked up **before** authentication and again when execution starts; only error-free results stored; `ETag`/`Last-Modified` on error-free query results | Same. The entity index used for invalidation is not ported: no mutation or CMS webhook reaches the Rust server, so entries expire by TTL. yoga's `If-None-Match` → 304 branch is not ported because the TS server never takes it (it runs in `onRequest`, before the policy marks the request cacheable). TTL coordinates are read at the root level only, which covers every configured coordinate except `User.profile` (no `User` type here). The in-process tier is its own 1000-entry moka cache; TS shares one 1000-entry LRU between the response cache and other services. |
| Query complexity (custom cost model, max 2000, `QUERY_TOO_COMPLEX`), checked when execution starts, after the context (authentication) is built; the verdict is memoized per document and operation name (`WeakMap`), and the response-cache TTL walk per document (`memoize4`) | Same algorithm, per-field costs and maxima, at the same point. The verdict and the TTL are memoized per (query string, operation name) in a 1000-entry cache (keyed by the query's SHA-256), only for names that select an operation, as TS memoizes. Ordering difference: yoga validates the document before authenticating; async-graphql validates inside execution, so here validation runs after authentication and the complexity check. An invalid document carrying a valid bearer token therefore costs a key check and an Identity Toolkit lookup that TS skips, and gets a 503 instead of validation errors while Google is failing. |
| Parsing and validation: the cache policy plugin parses each request (uncached); yoga's `parserAndValidationCache` (1000 entries) returns the same document for the second parse and caches validation per document | Parsing: once per request in the normal path (`set_parsed_query`), so at most TS's work; the query is cloned and re-parsed only on responses that carry path errors, which valid runs never produce. Validation: deliberate difference that adds Rust work — async-graphql validates every executed request. It has no supported way to reuse a validation result: `ValidationMode::Fast` drops most rules rather than caching them, and its rules read variable values (`ArgumentsOfCorrectType`), so caching by document would skip checks that graphql-js does at execution. Measured CPU on the `resolver` scenario includes this. Errors are capped like graphql-js's (100, then `Too many validation errors, error limit reached. Validation aborted.`), but async-graphql only stops at the end of its pass. Rule gap: async-graphql's `OverlappingFieldsCanBeMerged` lacks graphql-js's `SameResponseShape` check, so a few documents TS rejects (same response key with differently shaped selections) pass Rust validation. |
| Complexity walk over fragment spreads: a fragment is walked again for every spread, so a fragment spread twice at each of k nested levels costs 2^k walks (a small valid document stalls the event loop; the production TS server has this weakness and needs the same fix as a follow-up) | Deliberate difference in the cost model only: each fragment's cost (and its field names, for the per-field maxima) is computed once and reused, which gives TS's result in linear time. (A fragment cycle never reaches it: the depth check rejects it first, as TS validation rejects cycles before its cost model runs.) The rest of the Rust request is not linear in fragment fan-out: async-graphql's recursion check and field collection follow every spread, bounded only by the 32-level limit (26 fragments of `{ __typename ...next ...next }` took 12 s on a release build, as TS's cost model stalls on it today). A joint follow-up needs a linear bound on the expanded selection count before execution, on both servers. |
| Any root `__schema` or `__type` selection exempts the whole operation from the cost model (`isSchemaIntrospectionOperation` uses `.some`) | Same, kept for parity. It is a known TS quirk (adding `__type` to an operation skips its cost check); fix both servers together to exempt only operations whose root selections are all introspection. |
| Auth `firebase`: `verifyIdToken(token, checkRevoked = true)`; anonymous tokens become `firebaseAnonymous` | Same checks in firebase-admin's order: `kid`, RS256, `aud`, `iss`, `sub` (non-empty, ≤ 128) before any key fetch; RS256 signature against Google's securetoken JWKs (cached per `Cache-Control: max-age`, refetched without one); `nbf`/`exp` when present (firebase-admin checks neither `iat` nor the presence of `auth_time`); then Identity Toolkit `accounts:lookup` for `disabled` and `validSince` (`auth_time < validSince` is revoked). Invalid credentials → unauthenticated. A key fetch failure is also unauthenticated, because firebase-admin reports it as `auth/argument-error`. The lookup failing (5xx, transport, unknown error code), missing Google credentials, or the 5 s deadline → 503 `SERVICE_UNAVAILABLE` (`Authentication temporarily unavailable. Please retry.`). Key source: Rust reads Google's securetoken JWK set (`GOOGLE_JWKS_URL`); firebase-admin reads the same keys as an X.509 certificate map (`robot/v1/metadata/x509/securetoken@…`), with the same `max-age` caching. Not ported: firebase-admin's HTTP retries (503 and connection resets) on the key fetch and the account lookup, and the per-request SHA-256 auth-method cache (only one method exists here). Rust-only observability: `service_request*{service="firebase", action="verify_id_token"|"lookup_account"}`. |
| Auth `googleInternal`, `googleIam`, shared client `token` | Not ported; such requests are unauthenticated. No phase 1 field needs them. |
| Scope `authorized` → Pothos `ForbiddenError` `Not authorized to resolve Query.<field>` | Same message, `path` and `locations`, field `null`, not masked. Like TS, the error has no `extensions`: Pothos keeps `FORBIDDEN` on a JS property that never reaches the response. `ccbFormsV2` stays unscoped. |
| Error masking: unexpected resolver errors → `Unexpected error.` (`INTERNAL_SERVER_ERROR`) with a null field; `GraphQLError`s pass | Same; errors made with `expected_error`, the guard's error, and errors carrying a `code` pass. async-graphql leaves a failed field out of its parent (and never propagates past it), so the handler rebuilds graphql-js's result from each error's path, the operation's selections and the schema's field types: a failed nullable field becomes `null`, a failed non-null field nulls its nearest nullable ancestor, or `data` becomes `null`. async-graphql may report one error per failed list item where graphql-js stops at the first. Parse and validation errors carry yoga's `GRAPHQL_PARSE_FAILED` / `GRAPHQL_VALIDATION_FAILED` codes, but their message texts are async-graphql's. |
| Firestore activity write for signed-in (`jwt`) users | Not ported; the harness uses anonymous tokens. |
| Legacy EditorJS inline HTML (`richContent.ts`) is parsed by htmlparser2 into a tree as deep as the markup | Same parsing rules, but element nesting is capped at 256 (`MAX_HTML_DEPTH`): deeper start tags and their end tags are ignored, their text kept in the deepest element, so hostile CMS HTML cannot overflow the stack and abort the process. Real content never nests that deep, so output is unchanged. |
| Strapi 5 response bodies, cached record JSON and Strapi 4 rich-content JSON strings are read with `JSON.parse`, which has no nesting limit | Deliberate difference: serde_json's default 128-level recursion limit applies to all of them. A Strapi response nested deeper fails the operation as a Decode error (detail `Response body is not JSON`) where TS returns the data. A record that decodes from Strapi but whose cached JSON nests deeper than 128 (legacy EditorJS lists nested about 30 or more levels deep, since each list level adds about 4 JSON levels of rich content) no longer decodes from the in-process or Redis tier, so every read is a cache miss with its own Strapi request and `SETEX`, where TS caches it. A Strapi 4 JSON string nested deeper becomes a paragraph of its raw text. The limit is kept because it is what keeps the recursive JSON walkers stack-safe; real content never nests that deep. Number spelling in `content`: serde_json writes `1e21` where V8 writes `1e+21`, and keeps integers above 2^53 exact where V8 rounds them; `diff.ts` parses both bodies before comparing (`Object.is` on numbers), so it cannot report a false difference. |
| `sermons` cursors: `Buffer.from(cursor, "base64")`, then Effect Schema's `fromJsonString` (`JSON.parse`) into `{ slug, date }` | Same lenient base64 (both alphabets, other characters skipped, decoding stops at `=`; checked against Bun) and UTF-8 with replacement characters, but the JSON is read by serde_json: a cursor whose JSON holds a lone UTF-16 surrogate escape (`\ud800`) or nests deeper than 128 levels is an invalid cursor (the masked `Error fetching sermons`) where TS accepts it and sends the string to Strapi. Real cursors are the server's own `{"slug","date"}`. |
| `events` dates: Luxon 3.7 (`DateTime.fromISO`, `set`, `plus`, `startOf`/`endOf`, `diff` in weeks) over `Intl` time zones, in the process zone (UTC on Railway) | Same arithmetic, ported in `fields/events/luxon.rs` (offset guess and one correction, DST gaps and overlaps, `set({ day })` rolling over, `plus({ months })` clamping) on `chrono-tz`'s America/New_York; about 25,000 generated events matched the TS code (135 of them are pinned in `fields/events/parity.json`). Luxon's ISO week dates (`2026-W40-1`), ordinal dates (`2026-277`), time-only strings and bracketed IANA zones (`…Z[America/New_York]`) are not parsed: such a start date is invalid. Offsets are whole seconds (Luxon holds `Intl`'s whole-second offsets as fractional minutes), and New York offsets end at chrono's ±262,143 years where `Date` reaches ±275,760. Strapi 5 sends ISO `DateTime`s, `Date`s and `Time`s, which all parse. |
| A one-time event without sessions whose start date Luxon cannot parse falls back to date-fns (`getNextOccurrence` in `utils/events.ts`): `Invalid time zone specified: America/New_York` for a date date-fns cannot read either, otherwise an `eventDate` of the form `yyyy-MM-dd HH:mm:ssXXX` for the ISO variants only date-fns reads (a space instead of `T`) | The fallback is not ported: every such event fails with `Invalid time zone specified: America/New_York` (the masked `Error fetching events` for `events`, `UpcomingEventsByMonthFetchError` with that message for `upcomingEventsByMonth`). Unreachable with Strapi 5 data. |
| Statsig: `@statsig/statsig-node-core` 0.23.1 initialized before serving (3 s SDK timeout; a failure leaves Statsig off until restart), rule sets synced in the background, `checkGate` evaluated in process with exposures batched; a `StatsigUser` built for every GraphQL request in the context | Same SDK core: `statsig-rust` 0.23.1 (the crate `statsig-node-core` wraps), the same options (`STATSIG_ENVIRONMENT` or `NODE_ENV`, log level, an output logger into the app log) and the same user (`userID` or the shared `anonymousID`, `custom.environment`, the environment tier, the email as a private attribute). Differences: the user is built only when a gate is checked (only `core.more.links` checks one), the SDK's service name is `hccna-backend-rs`, and shutdown waits at most 3 s to flush exposures. The crate adds about 4 MB to the release binary. It turns on reqwest's `brotli` and native-root features; the shared upstream client opts out of both, so Strapi, CCB and Google requests are unchanged. |
| In-process caches for `core` and `verseOfTheDayV2`: entries in the shared 1000-entry `LRUService` (`ttl` per entry, no `updateAgeOnGet`) | One single-entry slot per field with the same TTL and expiry rules, so another key can never evict it (TS's 1000-entry LRU, shared with the response cache, could). |
| Their Redis entries are `JSON.parse`d without validation (`entry?.data`); VOD entries must also carry a book, a positive `cachedAt` and today's date | Same checks, but the entry must also decode into the field's shape (every `CoreData` field; `ScriptureData`'s strings): any other entry is a miss. Only this server writes its `rs:` keys, so the difference is unreachable. |
| `core_settings` read by node-postgres with an unnamed statement per query; sessions start with `statement_timeout` (`DB_STATEMENT_TIMEOUT_MS`, default 10 s) | Same SQL text and session `statement_timeout`; sqlx prepares the statement once per connection and reuses it (one round trip per query on both). |
| Firestore through firebase-admin: gRPC `BatchGetDocuments` over a persistent HTTP/2 channel, with gax retries (backoff) on `UNAVAILABLE`-class errors and no deadline shorter than the request's | Firestore REST `GET …/documents/<collection>/<id>` for each document read (`dailyVerse/verseOfTheDay`, `app-config/live-stream`, `castr-streams/{id}`) over reqwest's pooled HTTP/2 connection with the service account's cached OAuth token, one attempt, 20 s timeout (`APP_TIMEOUT_MS`). A 404 is a missing document. With one attempt, a transient error TS would retry ends the read: `liveStreamStatus` answers `LiveStreamStatusFetchError` for the aggregate, and a stream's legacy `title` and `description` are null for that request. A failed `dailyVerse/verseOfTheDay` read is also logged as a warning (TS logs nothing). Firestore is project `FIREBASE_PROJECT_ID` (default `app-hccnj`, the TS default app). |
| `vod/firebase.ts`: `stBook.slice(0, 20)` counts UTF-16 code units | Same count; a surrogate pair cut in half becomes U+FFFD where JavaScript keeps a lone surrogate. Verse references are ASCII. |
| `sortMoreLinks` uses `localeCompare` (ICU collation) | A comparison that orders like ICU's root collation for these titles (letters case-insensitively, space and punctuation before digits and letters, lowercase first on ties). Exact for `MORE_LINKS`, the only links `core` ever returns. |
| No service metrics for Postgres or Firestore reads | Same: neither read is recorded in `service_request*`. |
| `StreamProjectionStore`'s legacy metadata cache: Effect `Cache` with capacity 100 (the least recently used entry is evicted first), 5 min for a successful read; a failed aggregate decode logs Effect's `SchemaError` text as `cause`; a failed Firestore read logs firebase-admin's gRPC error as `cause` | Same TTL, capacity and sharing in a moka cache, whose admission policy (TinyLFU) may keep older entries instead of a new one once 100 stream ids are cached; production has fewer than ten streams. Expiry is checked on tokio's clock. No cross-server invalidation is needed: TS's metadata saves also publish the aggregate's `metadataByStreamId`, which takes precedence over the legacy document. The decode `cause` is Rust's own text in Effect's shape (`Expected boolean` then `at ["streams"][1]["isLive"]`), without the received value Effect also names. A failed Firestore read (the aggregate or `castr-streams/{id}`) logs the REST client's error text as `cause` in `Failed to load live stream status` and `Failed to load live stream metadata` (for example `Firestore answered HTTP 503`). |

Each root field keeps the TS cache layers in front of its upstream:

| Field | Source (TS) | Cache layers |
|---|---|---|
| `core` | `graphql/schema/cms/core.ts`, `effect/services/CMSService.ts`, `cms/{cache,repositories,transforms,constants}.ts` | LRU `cms:coreSettings` 10 min → Redis `cms:coreSettings:v1` (`{data, cachedAt}`) 600 s → drizzle's `select <every column> from "core_settings" limit $1`, mapped by `transformDbCoreSettings`. A failed query or a missing row is masked (`core: null`). Statsig gate `graphql_core_sort_more_links`, checked each time `more.links` resolves (false when Statsig is not configured). |
| `sermons` | `graphql/schema/cms/sermon.ts`, `packages/strapi-v2/src/queries/sermons.ts` | CMS record cache (below). |
| `thoughtOfGod` | `graphql/schema/cms/thoughtOfGod.ts`, `packages/strapi-v2/src/queries/thoughtOfGod.ts` | CMS record cache. |
| `campusesV2` | `graphql/schema/cms/campuses.ts` | CMS record cache. |
| `campuses` | `graphql/schema/cms/campuses.ts` (`loadCampuses`, the `campuses` field) | CMS record cache, the same read as `campusesV2`. A CMS failure rejects the field: `campuses: null` with `Unexpected error.` (`INTERNAL_SERVER_ERROR`). |
| `events`, `upcomingEventsByMonth` | `graphql/schema/cms/events.ts` | CMS record cache. |
| `ccbFormsV2` | `graphql/loaders/ccbFormsDataLoader.ts` | LRU 15 min (may serve stale) → Redis 15 min (5 min stale) → public CCB `GET /api/forms`. Errors become an empty success. Redis is read with `GET` where TS's `createRedisCache` sends `MGET` with one key (one round trip either way). |
| `verseOfTheDayV2` | `graphql/schema/scriptures/vod.ts`, `effect/services/VodService.ts`, `vod/{cache,constants,firebase,transforms,types}.ts` | LRU `vod:daily` 30 s → Redis `vod:verseOfTheDay:v2` (`{data, cachedAt, date}`) 600 s, each served only when dated today in `VOD_TIMEZONE` → Firestore `dailyVerse/verseOfTheDay` (REST). Postgres is not read: the TS service keeps its dated copy write-only for now. Failures are the `VodFetchError` / `VodNotFoundError` members with the TS messages. |
| `liveStreamStatus` | `graphql/schema/castr/liveStreamStatus.ts`, `effect/services/StreamProjectionStore.ts`, `graphql/loaders/streamMetadataDataLoader.ts` | No cache for the aggregate: Firestore `app-config/live-stream` (REST) on every request; a failed read or decode is `LiveStreamStatusFetchError`. Streams without published `metadataByStreamId` metadata read `castr-streams/{id}` only when `title` or `description` is selected: once per stream per request (failures included, four reads at once), behind an in-process cache of 100 streams that keeps a successful read 5 min and no failure. Response-cache TTL 0, keyed per caller. |

The CMS record cache (`effect/services/cms/content/recordCache.ts`) is ported as is, except for
concurrent misses (a deliberate difference in the pipeline table) and invalidation: `clear` (run as `invalidate.<area>` on CMS change notices: the generation `INCR`, the
per-instance clear counts, the memory purge and the Redis `KEYS` + `DEL` sweep) is not ported,
because no change notice reaches the Rust server, so entries expire by TTL. The shared generation
check is kept, so per-request Redis work matches. The read path is: in-process LRU
(500 entries, 10 min) → Redis `MGET [record key, generation key]` with a 500 ms timeout → Strapi, and a
70 min `SETEX` only if the generation did not change during the load. The Strapi transport
(`packages/strapi-v2/src/transport.ts`: 4 s timeout, three attempts with exponential backoff from
500 ms on transport errors, 5xx, 408 and 429), record mapping, strict rich-content decoding
(`richContent.ts`, needed for `content: JSON`) and the Tiptap → EditorJS conversion (`richText.ts`,
needed for `body`) are ported with them.

Known nondeterminism the correctness diff ignores: the `verseOfTheDayV2` fallback `verseId`
(`firebase-vod-<today>-<uuid8>`) when the Firestore document has none.

## 3. Benchmark harness (`apps/server-rs/bench/`)

- **Operation corpus.** `extract-operations.ts` (a dependency-free Bun script) reads the Relay
  artifacts in `apps/mobile/src/**/__generated__/*.graphql.ts` and writes the phase 1 operation texts
  to `operations.json`. Operation text is code, not data, so it is committed. Requests are sent the way
  the app sends them: `POST {query, variables}` with no `operationName`, `Accept-Encoding: gzip`, and
  `Authorization: Bearer <anonymous Firebase ID token>`.
- **No recorded data.** Variables (campus slugs, event slugs, sermon cursors) are discovered at run
  time from the servers' own responses. Response bodies, diffs and raw k6 output are written outside
  the checkout (`$TMPDIR`), never committed.
- **Token.** Anonymous Identity Toolkit `signUp` with `FIREBASE_WEB_API_KEY`, refreshed before expiry.
- **Scenarios** (k6 `constant-arrival-rate`, an open model that avoids coordinated omission). The two
  targets run one after the other, never at the same time, and each scenario is repeated in reverse
  order.

  | Scenario | What it isolates | Load |
  |---|---|---|
  | `warm` | Fixed variables → response-cache hits: HTTP, parse, cache lookup, serialization | Steps up to 100 rps |
  | `resolver` | Varied variables defeat the response cache; auth, execution, record caches and JSON transforms run | ≤ 20 rps (each request costs one Identity Toolkit lookup) |
  | `cold` | Bench Redis flushed and both servers restarted; upstream-bound latency | ≤ 2 rps |
  | `idle` | No load for 30 minutes | Railway CPU and memory only |

  Rates are capped because Postgres, Strapi and Firebase are shared with production.
- **Measurements.** Client latency (p50/p95/p99, errors) from k6; each server's `/metrics` scraped
  before and after a run (request-duration histograms, process RSS and CPU); Railway's per-service CPU
  and memory; image size, cold start (deploy to first `/readyz` 200) and build time.
- **Correctness.** `diff.ts` (Bun, run locally at low rate) replays every operation once against both
  public Railway domains with the same token, deep-diffs the JSON and writes a report to `$TMPDIR`.
  Run it after flushing the bench Redis and restarting both servers so cache ages match.
- **Runbook.** `bench/RUNBOOK.md`: creating the Railway services and variables, deploying the TS bench
  copy (`railway up --service hccna-backend-ts-bench` from a `main` checkout), run order, collecting
  Railway metrics, and the results template. Results (numbers only) are recorded in
  `bench/RESULTS.md`.

## 4. Observability

- **Logs:** one JSON object per line on stdout, pino-shaped: `level` as a lowercase name, no
  timestamp (Railway stamps lines), request lines with `requestId`, `userAgent`, `method`, `path`,
  `status`, `time` (duration in ms), `client{…}`, `operationName`, `operationType`, `fields`. Passing
  health probes log at debug. Authorization and secret headers are never logged.
- **Metrics:** Prometheus text on `METRICS_SERVER_PORT` (default 9184), separate from the app port,
  with the TS names, labels and bucket boundaries (`.005 … 20`):
  `http_server_request_duration_seconds{method,path_group,status_class}`,
  `http_server_errors_total{method,path_group}`,
  `graphql_envelop_request_total{operationName,operationType,route}`,
  `graphql_envelop_request_duration{operationName,operationType,route}` (`route` is Rust-only; see
  the pipeline table),
  `service_request_duration{service,action}`, `service_error_total{service,action}`,
  `readiness_dependency_failures_total{dependency,reason}`, plus `process_*` metrics.
- **No OTLP push in phase 1.** The harness reads `/metrics` directly, which keeps new series out of
  Grafana Cloud's free-tier cap (the 2026-10-11 metrics outage).

## 5. Testing

- Unit tests next to each module, with synthetic fixtures (`Ada Example`, `example.com` URLs), for every
  ported transform: `capitalizeText`, sermon cursors and the `before` sort quirk, connection paging,
  `thoughtOfGod` list reversal and null coalescing, campus rules, VOD normalization, rich-content
  decoding and the EditorJS conversion. Cases are ported from the TS tests (`packages/strapi-v2/tests`,
  `apps/server/src/**/__tests__`) with their data replaced.
- HTTP-level tests drive the axum router in-process (`tower::ServiceExt::oneshot`) with upstreams
  stubbed by `wiremock` (Strapi, Google JWKs, Identity Toolkit, Firestore, CCB). Redis and Postgres
  sit behind small traits with in-memory test implementations; tests that need the real services read
  `TEST_REDIS_URL` / `TEST_DATABASE_URL`, which CI provides as service containers.
- **Contract test:** every type, field, argument and nullability in the Rust schema's SDL must match
  `packages/schema/schema.graphql`. The test finds the schema by walking up from the crate until it
  reaches the package whose `package.json` is named `@hccnj/schema`, honouring the "reference
  workspaces by package name" rule; `HCCNA_SCHEMA_PATH` overrides it.
- The harness's `diff.ts` is the end-to-end conformance check against the live TS server.

## Out of scope for phase 1

Mutations, subscriptions, the scheduler-only fields, `/v1/*` REST routes, GraphiQL, App Check, Sentry,
OTLP export, Stellate purges, the response-cache entity index, and phases 2 and 3.

## Delivery

A stack of PRs into `experiment/server-rust`:

1. Foundation: crate, config, health and readiness, metrics server, logging, Dockerfile, CI, this spec.
2. GraphQL pipeline + Firebase auth + `ccbFormsV2` + contract test.
3. Strapi 5 client: transport, record cache, records, rich content, EditorJS conversion.
4. Strapi-backed fields: `sermons`, `thoughtOfGod`, `campusesV2`, `events`, `upcomingEventsByMonth`.
5. `core` (Postgres + Statsig) and `verseOfTheDayV2` (Firestore).
6. Benchmark harness, k6 image and runbook.
