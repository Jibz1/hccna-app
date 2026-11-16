# Account deletion and provisioning recovery

Run the audit and backfill commands below from `apps/server`.

Firebase ID tokens are checked for revocation on every request. Revoked, expired,
disabled, deleted, and invalid credentials are rejected. Verification outages
and timeouts return GraphQL `SERVICE_UNAVAILABLE` with HTTP 503 so clients can
retry without treating an outage as a signed-out session. The request waits at
most five seconds; the Firebase Admin SDK does not expose cancellation for its
underlying lookup. No positive authentication cache or local-only fallback is used.

Deletion consumes the confirmation code, removes Postgres data and profile cache
keys, recursively removes Firestore data, then revokes tokens and deletes the Auth
user. Database failures leave tokens usable for a retry with a new code. A failure
after Postgres cleanup can leave partial data; failures after revocation require
reauthentication. Stage and UID are logged for reconciliation.

Profile invalidation clears the current process and Redis. Other replicas revisit
Redis within 30 seconds because their memory TTL is capped, including Redis-loaded
entries. This is bounded staleness, not immediate broadcast invalidation. Redis
failures and writes already in flight can still delay convergence. A successful
revalidation that finds no profile evicts the previous positive cache entry.

## Signup path

Clients establish a profile in both stores with authenticated
`ensureUserProfile` before completing sign-in. The legacy `POST /v1/gbp` and
`qpd` creation paths were removed in 2026-11 after production showed no
callers.

## Recovering an incomplete profile

HTTP 500 alone does **not** guarantee a Firebase Auth `onCreate` retry. The
external trigger's deployed retry policy is not configured by this repository,
and this change adds no durable repair queue. New mobile sign-ins call
`ensureUserProfile`; legacy-only users can still need operational reconciliation.
The CCB enrichment flag is not a substitute for a missing-profile repair job.

Use `bun run provisioning:audit` to identify Firestore-only, Postgres-only and
missing profiles. Then run `bun run provisioning:backfill` to review the dry-run
plan. After reviewing identity conflicts and planned repairs, operators can apply
the plan with `bun run provisioning:backfill --apply`. Missing-both accounts
require the command's explicit `--create-missing` option. Follow-up work in the
trigger deployment must confirm retry policy or supply a durable queue before
automatic recovery can be guaranteed for legacy-only clients.
