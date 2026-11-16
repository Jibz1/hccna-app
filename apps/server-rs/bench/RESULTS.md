# Benchmark results (phase 1)

Numbers and run metadata only. Do not paste response bodies, slugs, cursors, ids, tokens, log
excerpts or diff values here; the runbook keeps those under `$TMPDIR` and says to delete them.
How each number is produced: [`RUNBOOK.md`](RUNBOOK.md). Leave a cell as `-` when it was not
measured and say why under Notes.

Do not record who ran the benchmark; the commit SHAs and dates identify the run.

Targets: `rs` is `hccna-backend-rs` (Rust), `ts` is `hccna-backend-ts-bench` (the TS server from
`main`). Latencies are k6's `http_req_duration` in milliseconds, client side, from the `hccna-bench`
service. Report the average of the two passes (A and B) when they agree within 10%; otherwise report both
and say what changed.

## Run metadata

| Item | Value |
|---|---|
| Dates (UTC) | |
| TS server commit (`main`) | |
| Rust server commit (`main`) | |
| Harness commit (`apps/server-rs/bench`) | |
| k6 image | `grafana/k6:1.5.0` |
| Railway project / environment / region | Apps Backend / production / us-east4 |
| Replicas (rs, ts) | 1, 1 |
| vCPU and memory limits (rs, ts, bench) | |
| Private networking used for targets | yes / no (public domains) |
| Operations | 11 (phase 1) |
| `SEED` | 1 |
| Anonymous Firebase accounts created (and removed on) | |
| Benchmark window (for account cleanup) | |

## Run log

One row per run. `valid` is the `valid` field of the `run` line (no dropped iterations, `graphqlOkRate` of 1, no
counter reset, and for `cold` a fresh target). Redo invalid runs and log them as `invalid`.

| Run | Pass | Scenario | Target | Load started (UTC) | Load ended (UTC) | Config | Iterations | Dropped | Valid |
|---|---|---|---|---|---|---|---|---|---|
| 1 | A | warm | rs | | | | | | |
| 2 | A | warm | ts | | | | | | |
| 3 | A | resolver | rs | | | | | | |
| 4 | A | resolver | ts | | | | | | |
| 5 | A | cold | rs | | | | | | |
| 6 | A | cold | ts | | | | | | |
| 7 | B | warm | ts | | | | | | |
| 8 | B | warm | rs | | | | | | |
| 9 | B | resolver | ts | | | | | | |
| 10 | B | resolver | rs | | | | | | |
| 11 | B | cold | ts | | | | | | |
| 12 | B | cold | rs | | | | | | |

Every run was preceded by a bench Redis flush and a restart of the target: yes / no.
Operations skipped on a target (`setup.skipped`), if any:

## Correctness diff

| Date | Mode | Cases | Equal | Differing cases and JSON paths (no values) | Expected? |
|---|---|---|---|---|---|
| | default | 11 | | | |
| | thorough | | | | |

## warm: response-cache hits

Latency by step (all operations mixed).

| Step (rps) | Target | Requests | p50 | p95 | p99 | max | HTTP failed | GraphQL ok |
|---|---|---|---|---|---|---|---|---|
| 10 | rs | | | | | | | |
| 10 | ts | | | | | | | |
| 25 | rs | | | | | | | |
| 25 | ts | | | | | | | |
| 50 | rs | | | | | | | |
| 50 | ts | | | | | | | |
| 100 | rs | | | | | | | |
| 100 | ts | | | | | | | |

Per operation, whole run. Average response characters (decoded body length, not wire bytes) show
payload differences.

| Operation | rs p50 | rs p95 | rs p99 | ts p50 | ts p95 | ts p99 | rs chars | ts chars |
|---|---|---|---|---|---|---|---|---|
| CCBFormsQuery | | | | | | | | |
| CampusesQuery | | | | | | | | |
| CoreDataQuery | | | | | | | | |
| EventDetailQuery | | | | | | | | |
| LatestEventsQuery | | | | | | | | |
| LatestSermonsQuery | | | | | | | | |
| SermonsContainerQuery | | | | | | | | |
| SermonsItemsRefetchQuery | | | | | | | | |
| ThoughtOfGodImplQuery | | | | | | | | |
| ThoughtOfGodQuery | | | | | | | | |
| VerseOfTheDayQuery | | | | | | | | |

Cache behaviour over the whole warm run. Redis columns are the deltas of `redis-stats.ts` on the
shared bench Redis (the same source for both servers); the Strapi column is each server's own
`/metrics` (`strapi-v5` service). Expected: `incr` about the request count; `setex` a small constant (the priming pass is inside the window), not proportional to requests.

| Target | GraphQL requests | Mean ms (server) | Redis incr | Redis setex | Redis get | Strapi requests | Rust RSS (MB) |
|---|---|---|---|---|---|---|---|
| rs | | | | | | | |
| ts | | | | | | | n/a (TS has no `process_*`) |

## resolver: response cache defeated, 20 rps

| Operation | Target | Requests | p50 | p95 | p99 | max | GraphQL ok |
|---|---|---|---|---|---|---|---|
| SermonsItemsRefetchQuery | rs | | | | | | |
| SermonsItemsRefetchQuery | ts | | | | | | |
| CampusesQuery | rs | | | | | | |
| CampusesQuery | ts | | | | | | |
| LatestEventsQuery | rs | | | | | | |
| LatestEventsQuery | ts | | | | | | |
| EventDetailQuery | rs | | | | | | |
| EventDetailQuery | ts | | | | | | |
| All | rs | | | | | | |
| All | ts | | | | | | |

Did the misses happen? Redis deltas from `redis-stats.ts` on the shared bench Redis; Strapi from
each server's `/metrics`. Expected: `incr` about the request count; new response entries about 80%
of the requests on both servers (sermon and campuses requests always miss); Strapi about 45% of the
requests (sermon pages only; campuses misses are served by the Strapi record cache). Rust `rs:*`
counts every key the Rust server wrote, so it is expected near 125% (response entries plus about
45% record-cache entries); it is not a response-entry count. `setex`, `get` and `ttl` are not
comparable across servers: TS adds an entity-index entry and a `GET` per entity per miss and a
`TTL` read per request, which the Rust server does not do.

| Target | GraphQL requests | Redis incr | New response entries (TS `graphql:response-cache:result:v2:*`, Rust `rs:graphql:response-cache:result:v2:*`) | Record-cache entries (`cms-v5:*` / `rs:cms-v5:*`) | Rust `rs:*` total | Strapi requests | Strapi share of requests |
|---|---|---|---|---|---|---|---|
| rs | | | | | | | |
| ts | | | | | n/a | | |

For reference (not compared across servers): Redis `setex`, `get` and `ttl` deltas per target.

| Target | Redis setex | Redis get | Redis ttl |
|---|---|---|---|
| rs | | | |
| ts | | | |

The Firebase lookups, Postgres reads and Firestore reads behind the misses cannot be counted on TS:
its `/metrics` has `service_request` only for `strapi-v5`, `ccb` and `castr`. Rust-only counters,
for reference (not compared): Firebase lookups `-`, Postgres `-`, Firestore `-`.

## cold: caches empty, 1 rps

Pass 1 is the cold measurement. The two operations discovery touches first (`CampusesQuery` and
`LatestEventsQuery`; the cold run discovers no sermon cursors) have their first-touch time in the
`setup` line's `discovery` list; put those here as "first touch (setup)". Confirm `fresh` was true.

| Operation | rs first touch (ms) | ts first touch (ms) | rs later passes p50 (ms) | ts later passes p50 (ms) |
|---|---|---|---|---|
| CCBFormsQuery | | | | |
| CampusesQuery | | | | |
| CoreDataQuery | | | | |
| EventDetailQuery | | | | |
| LatestEventsQuery | | | | |
| LatestSermonsQuery | | | | |
| SermonsContainerQuery | | | | |
| SermonsItemsRefetchQuery | | | | |
| ThoughtOfGodImplQuery | | | | |
| ThoughtOfGodQuery | | | | |
| VerseOfTheDayQuery | | | | |

## Resources (Railway service metrics, same source for both)

Window = the run's `[loadStartedAt, loadEndedAt]` (for the 100 rps row, that step's own
`startedAt` / `endedAt`); idle window = 30 minutes after a fresh restart.

| Window | Target | CPU avg (vCPU) | CPU peak (vCPU) | Memory avg (MB) | Memory peak (MB) |
|---|---|---|---|---|---|
| idle (30 min) | rs | | | | |
| idle (30 min) | ts | | | | |
| warm, 100 rps step | rs | | | | |
| warm, 100 rps step | ts | | | | |
| resolver | rs | | | | |
| resolver | ts | | | | |
| cold | rs | | | | |
| cold | ts | | | | |

Rust `process_*` cross-check (RSS at the end of the warm run, MB): `-`.

## Build, image and start

| Metric | rs | ts |
|---|---|---|
| Image size (MB, `docker image inspect`) | | |
| Railway build time, cold cache (s) | | |
| Railway build time, warm cache (s) | | |
| Deploy start to healthy (s) | | |
| Process start to listening log line (s) | | |

## Notes

- Deviations from the runbook (for example public domains instead of private networking, a skipped
  pass, a changed rate), with the reason:
- Runs redone and why:
- Anything that could bias the comparison (shared upstream load from production, time of day):
