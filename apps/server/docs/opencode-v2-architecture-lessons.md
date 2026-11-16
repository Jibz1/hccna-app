# Architecture Lessons from opencode v2

**Source:** comparative review of `opencode` (branch `v2`) against this backend, 2026-08-15.
**Status:** adoption in progress on the `v2` integration branch (updated 2026-08-16).

## Adoption status on branch `v2`

| Item                                                        | Status                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Phase 1 guardrails (contract tests + `testEffect` harness)  | landed (PR #293)                                                                                      |
| Streaming stale-write ordering guard (v3 doc spec)          | landed (PR #294); folding `manualEdit.isLive` into the poll transaction deferred                      |
| `loadAppConfigSync` memoization                             | landed (PR #295)                                                                                      |
| Persisted-ops prep: known-operation guard, log-only default | this PR; enforcement needs the mobile manifest rollout                                                |
| REST v1 → `HttpApi` port                                    | in progress                                                                                           |
| Logging consolidation                                       | landed (this PR) — Effect logs now emit through pino; `getLogger()` stays for promise-land call sites |
| Typed `Config` accessors, `Redacted` secrets                | deferred — change failure semantics / `AppConfigContract`                                             |
| `Effect.fn` span sweep + OTLP graceful degradation          | deferred — pair with trace sampling decision                                                          |

## Why this comparison is unusually direct

opencode v2 and this backend are on the **same stack and the same conventions**:

| Dimension       | This backend                                      | opencode v2                         |
| --------------- | ------------------------------------------------- | ----------------------------------- |
| Effect version  | `effect@4.0.0-rc.112`                             | `effect@4.0.0-beta.101` (patched)   |
| Service pattern | `Context.Service` + contract interface (ADR-0001) | identical                           |
| Error pattern   | `Schema.TaggedError`                              | identical (148 uses)                |
| Test runner     | `bun:test`                                        | `bun:test`                          |
| Monorepo        | bun workspaces + catalog                          | bun workspaces + catalog            |
| Guardrails      | custom check scripts + oxlint anti-slop           | ast-grep rules + bundle-graph tests |

They even share the style rule banning `yield* (yield* Foo.Service).bar()`. opencode v2 is
effectively a preview of where our conventions lead when pushed to completion, so most
patterns transfer as direct lifts, not translations.

What we already do as well or better: the `scripts/check-effect-boundaries.ts` debt ledger
(every violation enumerated with a justification, new ones fail the build) is a stronger
migration ratchet than anything in opencode; ADR discipline is comparable. Keep both.

## The meta-lesson

opencode v2 converts **conventions into mechanisms**:

- Dependency direction is not a doc rule — it is a bundle-graph test
  (`packages/cli/test/import-boundaries.test.ts`).
- Type identity is not a review comment — it is a referential-equality assertion
  (`expect(CoreSession.Info).toBe(Session.Info)`).
- Error→HTTP status is not a mapping table — it is a schema annotation
  (`{ httpApiStatus: 409 }`) that tooling resolves and the type system enforces.

Our codebase has excellent conventions that humans still hold by hand. Each adoption below
promotes one convention to a mechanism.

## Ranked adoption list

### 1. One transport boundary for Effect

Today Effect is executed _inside_ 17 resolvers via `ctx.effect.runPromise(...)`, so `E`/`R`
types never reach the edge and error→HTTP mapping is split across three unrelated
mechanisms (`app.onError`, the duck-typed `isHonoHttpError` in
`src/transport/http/runEffect.ts`, Pothos ErrorPlugin). In opencode, `HttpApi` endpoints
declare their error types and a handler whose error channel doesn't match **fails to
typecheck**.

Nearest concrete move: port REST `v1` (`newuser`, `attendance-exports`) from
`@hono/zod-openapi` to `effect/http-api` (already in our Effect version). This also
collapses the Zod-vs-Effect-Schema dual-validation split. Note
`src/routes/v1/newuser.ts` already carries the `{ httpApiStatus }` annotation that
opencode's tooling reads — the correct pattern, half-adopted.

### 2. Contract-identity tests (cheapest win — Phase 1)

One `toBe`/set-equality assertion kills an entire class of drift bugs. Our candidates:

- The three cache layers that must agree per field: `useResponseCache` TTL map,
  `SHARED_RESPONSE_CACHE_QUERY_FIELDS` (`src/graphql/responseCacheSession.ts`), and
  Stellate edge rules (`stellate.ts`). Nothing structurally links them today; the
  `Query.castrStream` stale-ACL incident was this gap.
- `known-operation-names.ts` vs reality (it has duplicate entries today).
- `httpApiStatus` annotation vs `httpStatus` instance field on error classes (five classes
  carry both, nothing checks agreement).

### 3. A real Effect test harness (Phase 1)

Our tests hand-roll Drizzle mock chains and `mock.module` import-order games; `TestClock`
is used exactly once. opencode's ~60-line harness (`packages/core/test/lib/effect.ts`)
gives `testEffect(layer).effect("name", body)` with `TestClock` and pretty `Cause` printing
built in, and test doubles are **layers shipped next to production layers**, not mocks.
This also unblocks the streaming-migration complaint that the in-memory `runTransaction`
fake "never retries or contends" — contention behavior belongs in a test layer.

### 4. Event-ordering guard for the streaming projection

The open defects in `docs/streaming-migration-implementation-v3.md` (no stale-write
ordering guard, unconditional `lastCheckedAtByStreamId` overwrites, two overlapping
schedulers) map exactly to opencode's Bus design:

- per-aggregate `KeyedMutex` serializes writers without a global lock;
- a monotonic per-aggregate `seq` allocated **inside** the committing transaction makes
  stale writes structurally detectable (`seq <= latest` → drop/verify), replacing
  wall-clock ordering hopes (`StreamMappingService.ts` captures `now` before the
  transaction);
- projections write inside the same transaction that allocates `seq`.

We do not need their SQLite Bus — Firestore transactions plus a `seq` field on the
projection document get us the guard. Read `specs/v2/event-stream-architecture.md` in the
opencode repo before finalizing the streaming migration.

**Downstream caution:** `castr-streams/*` and `app-config/live-stream*` are read directly
by mobile Firestore listeners — those document shapes are a public contract. The guard must
be add-only (new fields, no renames/removals). This is also the right moment to introduce
an Effect Schema per projected document and a shape-pinning test, giving the Firestore
contract the same drift protection as the HTTP one.

### 5. Client contract + codegen with a CI drift gate

opencode: generated artifacts carry a manifest; CI runs `generate && git diff --exit-code`.
Our wire contract lives in four places at once (Pothos builders, Zod schemas, a dev-time
`schema.graphql` side effect, a hand-maintained operation-name list). GraphQL equivalent:
GraphQL Code Generator + persisted operations for the mobile client with the same
`--exit-code` gate. The persisted manifest then _becomes_ the operation allowlist, so
`known-operation-names.ts` can be deleted.

**Downstream caution:** enforcement of persisted operations rejects old app versions.
Rollout: ship manifest-capable clients → log-only mode until old-version traffic decays →
enforce. APQ today is a caching optimization, not an allowlist.

### 6. Layer replacements instead of hand-wired variants

opencode's `LayerNode` (`packages/util/src/effect/layer-node.ts`, ~330 self-contained
lines, vendorable) is a checked layer DAG: missing dependencies produce a type error that
names the missing service; `Replacements` (`[sourceNode, replacementLayer]` pairs,
type-checked to not add new error types) swap implementations by name — their entire
workerd profile is one replacement list. Our six hand-numbered tiers in
`src/effect/Runtime.ts` are fine at 30 services; adopt Replacements when test/emulator/prod
profiles start to hurt.

### 7. Smaller direct lifts

- `Effect.fn("Name")` as the default span mechanism (620 uses there); `Effect.fnUntraced`
  for hot helpers. **Pair with head sampling before adopting wholesale** — every span is
  allocation + export bandwidth.
- `withoutParentSpan` (`Context.omit(Tracer.ParentSpan)`) for background fibers, so
  detached traces don't parent on request/boot spans. (Checked: our
  `createManagedRequestEffectRunner` does not currently inherit a parent span, so this is
  a keep-in-mind, not a defect.)
- Graceful OTLP degradation: their observability layer falls back to local logging via
  `Layer.catchCause` instead of failing startup.
- ast-grep with paired rule tests for structural Effect rules our regex scripts can't
  express (`script/ast-grep/` in their repo).
- Kill `loadAppConfigSync()` (module-scope config resolution in `src/instrument.ts` and
  `src/graphql/builder.ts` duplicates the `AppConfig` layer path) and defer heavy SDK
  imports — Cloud Run cold-start wins.
- `Redacted` for secrets in config and credentials.
- Finish logging consolidation: done — `PinoEffectLoggerLive` (in `AppLoggerService.ts`)
  replaces Effect's default console logger with the shared pino sink, wired beneath the
  runtime layers so the OTLP logger still merges on top. Promise-land call sites
  (middlewares, Yoga plugins, dataloaders, module init) keep `getLogger()` — pino is the
  single sink either way. `AppLoggerService` remains only as a sync adapter for SDK
  callbacks (Statsig output logger).

## What NOT to copy

- **`LocationServiceMap` / per-tenant layer graphs** — solves one-service-graph-per-project-
  directory; a single Cloud Run service wants our single `ManagedRuntime`.
- **Their SQLite Bus as infrastructure** — single-process; our multi-replica Cloud Run +
  Firestore topology needs the patterns (§4), not the implementation.
- **Multi-runtime `#imports` conditions** — we ship one runtime.
- **Dropping Effect `Config`** — they read env at edges because they're a CLI; a 12-factor
  Cloud Run service is what `Config` is for. Simplify (use `Config.integer`/`Config.boolean`
  over string-then-parse), don't drop.

## Downstream (wire) impact summary

| Change                                                   | GraphQL schema | REST req/resp                                                        | Mobile coordination                                     |
| -------------------------------------------------------- | -------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| Contract-identity tests, harness, spans, config, logging | none           | none                                                                 | none                                                    |
| Centralizing resolver `runPromise`                       | none           | none                                                                 | none                                                    |
| REST v1 → `HttpApi`                                      | none           | error bodies + `/openapi.json` change; validation strictness differs | low (confirm v1 callers)                                |
| Persisted operations (enforced)                          | none           | none                                                                 | **yes — staged rollout required**                       |
| Streaming `seq` guard                                    | none           | none                                                                 | safe if add-only (Firestore docs are a public contract) |

## Performance summary

Net: performance-neutral to mildly positive; these are correctness/maintainability moves.

**Gains:** persisted operations (skip parse/validate/complexity per request — the only real
throughput win); seq guard (fewer Firestore writes and listener fan-outs = cost + client
battery); killing `loadAppConfigSync` + lazy SDK imports (cold start); centralizing
`runPromise` (removes per-resolver fiber bridges and the duplicated per-request
`FirebaseAdminContext` provision).

**Penalties:** Effect Schema decode is slower than Zod v4 (negligible at v1 traffic —
measure before porting any hot path); blanket `Effect.fn` spans need sampling; Effect
Logger is slower than pino at high volume; the castrStream TTL-0 fix deliberately puts
Strapi in the hot path of our most-polled query — watch its latency after deploy.

**Cloud Run trap the opencode patterns don't cover:** CPU is throttled outside request
handling, so `runPromiseDetached` background work (the castr ping projection) races the
throttle unless the service runs CPU-always-allocated. Keep projection work inside the
scheduler request's lifetime; don't adopt their fork-and-forget patterns as-is.

## Adoption sequencing

1. **Phase 1 (planned, this PR):** contract tests (cache layers, operation names,
   error-status agreement) + Effect test harness. Zero wire impact.
2. Streaming `seq`/mutex ordering guard folded into the v3 migration plan before it ships,
   plus Firestore document schemas + shape tests.
3. REST v1 → `HttpApi` as the typed-transport pilot.
4. Persisted operations + codegen `--exit-code` gate (staged mobile rollout).
5. Opportunistic per the CMS → Giving → Streaming reshaping order: logging consolidation,
   config decomposition, layer replacements.
