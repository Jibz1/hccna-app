# Unified App Caching Strategy (Latency-Biased Balanced)

## Summary

Standardize caching on one shared `Effect`-native cache toolkit, then migrate service-specific one-off implementations to that toolkit incrementally. Services should choose their topology explicitly: LRU-only for process-local hot data, Redis-only for shared distributed data, or two-tier LRU + Redis when they need both low latency and cross-instance coherence.

Current implementation status:

- Shared cache module exists at `src/effect/cache/`.
- `ProfileService` is the first migrated hot read path.
- The shared cache factory currently supports LRU-only, Redis-only, and LRU + Redis topologies, versioned keys, explicit Redis codecs, stale-while-revalidate metadata, single-flight loader de-duping, fail-open cache reads/writes, explicit invalidation, and per-domain policy registration.
- Metrics hooks, prefix invalidation, negative caching, and stale-if-error are still future work.

Current duplication exists across:

- `src/effect/services/CMSService.ts`
- `src/effect/services/attendanceExport/cache.ts`
- `src/effect/services/CCBService.ts`
- `src/utils/withSwr.ts`
- `src/effect/HttpUtils.ts`

This strategy keeps latency first by default, while preserving balanced freshness via explicit policy per domain.

## Public APIs / Interfaces / Types to Add

1. Add shared cache module at `src/effect/cache/`. Done.
2. Add `CachePolicy` type. Done:
   - `name: string`
   - `keyPrefix: string`
   - `version: string`
   - `ttlMs: number`
   - `swrMs: number`
   - `jitterPct?: number`
3. Add shared `Cache` contract. Partially done:
   - `getOrLoad(params): Effect<CacheGetResult<V>, E>`
   - `invalidate(key): Effect<void, never>`
   - `invalidateByPrefix(prefix): Effect<void, never>` remains future work
4. Add `CacheGetResult<V>`:
   - `value: V`
   - `source: 'lru' | 'redis' | 'loader'`
   - `freshness: 'fresh' | 'stale'`
   - `cacheKey: string`
5. Add `CacheLoaderOptions`. Partially done:
   - `backgroundRevalidate?: boolean`
   - `shouldCache?: (value: V) => boolean`
6. Add explicit cache backend topology. Done:
   - `{ kind: 'lru', lru }`
   - `{ kind: 'redis', redis }`
   - `{ kind: 'two-tier', lru, redis }`
7. Add explicit cache codecs for Redis serialization. Done for `ProfileService`.
8. Add cache key helpers:
   - canonical serialization for key parts
   - versioned key builder (`prefix:version:normalized-key`)
9. Add metrics hooks interface. Future work:
   - `onHit`, `onMiss`, `onStaleServe`, `onRefresh`, `onError`

## Recommended Architecture

1. Canonical runtime path: `Effect` cache toolkit uses `src/effect/LRUService.ts` and `src/effect/RedisService.ts`.
2. Compatibility adapters:
   - Promise wrapper for non-Effect callers currently using `src/utils/redisCache.ts`.
   - Keep existing helper temporarily, deprecate once migrations are complete.
3. Central policy registry:
   - `src/effect/cache/policies.ts`
   - One named policy per domain (`ccb`, `attendance`, `profile`, `cms`, `donations`, `woa`, `vod`, `castr`).
4. Single-flight protection:
   - dedupe concurrent loads per key to avoid thundering herd.
5. SWR semantics:
   - serve stale within `swrMs`, trigger background refresh.
6. Fail-open defaults for cache infrastructure failures:
   - cache read/write errors do not fail business request.
7. Domain hooks for strict correctness:
   - allow domain-level “rehydrate/verify” callback after cache hit (needed for attendance and donations consistency checks).

## Migration Plan (Doc + Approach First)

1. Create architecture spec document:
   - `docs/caching-strategy.md`
   - Include policy matrix, key conventions, failure semantics, and migration checklist.
2. Build shared cache toolkit. Done.
3. Migrate low-risk duplicate implementations first:
   - `src/effect/services/ProfileService.ts` done
   - `src/effect/services/CMSService.ts`
4. Migrate attendance snapshot cache next:
   - `src/effect/services/attendanceExport/snapshots.ts`
5. Migrate high-complexity domains last:
   - `src/effect/services/CCBService.ts`
   - `src/graphql/schema/user/donationsV2.ts`
6. Replace/deprecate overlapping utilities after parity:
   - `src/utils/withSwr.ts`
   - `src/effect/HttpUtils.ts` (SWR helper portions)

## Testing and Validation Scenarios

1. Contract tests for shared cache toolkit:
   - implemented: LRU-only, Redis-only, two-tier fresh hit, Redis-to-LRU hydration, codec decoding, miss + load, single-flight, failed loader retry, stale hit + background refresh, opt-out caching.
   - remaining: negative cache, prefix invalidation.
2. Fault-injection tests:
   - Redis unavailable, LRU error, loader error, stale-if-error behavior.
3. Concurrency tests:
   - 20+ concurrent requests for same key produce one loader call.
4. Migration parity tests per service:
   - responses and error semantics unchanged before/after migration.
5. Observability assertions:
   - hit/miss/stale counters emitted with consistent tags.
6. Performance guardrails:
   - p95 latency non-regression for profile/CMS/attendance/CCB hot paths.

## Assumptions and Defaults

1. Priority is latency-first with balanced freshness controls by policy.
2. Rollout is incremental, not a one-shot rewrite.
3. First deliverable is a spec doc and migration approach; no broad behavioral change in that doc-only phase.
4. Existing GraphQL schema and resolver contracts remain unchanged during cache platform migration.
5. Cache keys are versioned; version bumps are the standard invalidation mechanism for schema/payload changes.

## Policy Matrix (Initial Proposal)

| Domain       | `keyPrefix`        | `version` |          `ttlMs` |          `swrMs` | Notes                                   |
| ------------ | ------------------ | --------- | ---------------: | ---------------: | --------------------------------------- |
| `profile`    | `cache:profile`    | `v1`      |        3_600_000 |        1_800_000 | Hot read path, tolerate short staleness |
| `cms`        | `cache:cms`        | `v1`      |          600_000 |          300_000 | App shell data, moderate churn          |
| `attendance` | `cache:attendance` | `v1`      |          300_000 |          600_000 | Keep latency low, refresh quickly       |
| `ccb`        | `cache:ccb`        | `v1`      | per-request-type | per-request-type | Preserve existing type-based policy     |
| `donations`  | `cache:donations`  | `v1`      |       21_600_000 |        7_200_000 | Longer-lived historical data            |
| `woa`        | `cache:woa`        | `v1`      |        3_600_000 |       18_000_000 | Existing SWR-heavy behavior             |
| `vod`        | `cache:vod`        | `v1`      |        3_600_000 |        3_600_000 | Current one-hour behavior               |
| `castr`      | `cache:castr`      | `v1`      |          300_000 |          300_000 | Low-latency stream checks               |

## Key Conventions

1. Always use versioned keys: `<prefix>:<version>:<normalized-key>`.
2. `normalized-key` is canonical JSON or deterministic string.
3. Include tenant/user scope where relevant (e.g., `userId`, `year`, `eventId`).
4. Never include secrets or bearer tokens in cache keys.
5. Bump `version` for payload-shape changes or semantic contract changes.

## Failure Semantics

1. Cache read failures are non-fatal and treated as misses.
2. Cache write failures are non-fatal and logged/metriced.
3. Loader failures should propagate unless stale-if-error policy applies.
4. For SWR stale hits, serve stale immediately and refresh in background.
5. Support strict domain override where stale serve is unsafe.

## Migration Checklist

1. Add shared toolkit + key helpers + policy registry. Done.
2. Add contract tests covering misses and single-flight. Done.
3. Migrate `ProfileService` cache logic to toolkit. Done.
4. Migrate `CMSService` cache logic to toolkit.
5. Migrate attendance snapshot cache helper to toolkit.
6. Compare pre/post behavior with parity tests and logs.
7. Migrate CCB and Donations last with explicit acceptance criteria.
8. Mark old helpers deprecated and remove after full parity.
