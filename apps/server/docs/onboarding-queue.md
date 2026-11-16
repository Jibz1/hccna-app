# Onboarding queue

Signup creates the base Postgres profile and a `user-onboarding-v1` job in one
SQL transaction, then creates the Firestore profile if it is missing. The
request succeeds only after both stores are available. A Firestore failure
leaves the committed job available to finish the repair. Existing profiles
are never overwritten by a repeated signup request.

The same handoff serves `ensureUserProfile`, the only signup path. CCB
enrichment runs after signup. Profile reads and sign-ins enqueue repairs for placeholder names; sign-ins also
enqueue profiles carrying `ccbEnrichmentPending`. Repeated lazy triggers for
the same UID and email coalesce within each UTC hour. A later hour permits
another lookup after a directory miss or exhausted job.

## Worker and deployment

`Main` starts one scoped consumer per server instance. Audit/backfill scripts
do not start consumers. Shutdown interrupts processing and closes the SQL
pool. Effect's SQL queue leases recover jobs abandoned by a terminated
instance. Queue delivery is at least once.

The worker checks the current Firebase identity before acting, repairs a
missing Firestore base profile before calling CCB, and reloads profile data
after directory calls. SQL conditional updates and Firestore transactions
preserve real names, existing phone numbers, and CCB identifiers. Deleted
Postgres rows are not reinserted by a worker. Jobs for deleted, disabled, or
changed-email Firebase accounts are skipped. Postgres `enrichment_pending`
is set with the new profile and cleared atomically with its enriched fields.
Firestore's `ccbEnrichmentPending` clears when that mirror update succeeds;
a mirror failure continues retrying even after Postgres is ready.

Each job has a 30-second processing timeout, with separate 5-second Firebase
Auth and 8-second directory timeouts. Jobs retry up to 10 attempts with
Effect's persisted exponential delay (1 second initially, capped at 5
minutes). Failed jobs remain in the queue for inspection; completed jobs
are cleaned up daily after seven days.

The deployment files configure instance-based CPU allocation and at least
one Cloud Run instance so polling continues without HTTP traffic. This
changes idle billing. Consumer concurrency grows with the number of server
instances; account for CCB's rate limits when increasing instance counts.
The worker uses a separate Effect PostgreSQL pool with at most three
connections per instance, using the existing database configuration.

The Effect SQL store creates/migrates `onboarding_queue` and
`onboarding_queue_migrations` when its layer initializes, before serving
traffic. This also happens when a CLI builds the full application runtime;
an audit does not change profile data or consume jobs, but may initialize
these infrastructure tables. The database role needs DDL privileges for
these tables. The normal startup migrations must apply
`20260926120000_onboarding_enrichment` before serving traffic. No additional
secrets are required. Deploy the server and its additive GraphQL field before
shipping the mobile update.

## Updates in an open app

`User.profile.enrichmentPending` accompanies the Postgres profile in the same
Relay response. The app mounts one refresh loop under its Relay provider,
independent of the visible screen. While pending, it refetches the profile
every five seconds when active and online. Each request completes before the
next is scheduled. Completing enrichment refreshes Relay's subscribed views
and stops polling, including successful lookups with no directory match.

Backgrounding, going offline, signing out, switching accounts, and disposing
the provider cancel scheduled and in-flight work. Returning online/active
resumes the remaining budget. Polling is capped at 120 attempts per authenticated
Relay session (about ten minutes plus request time), including failed requests.
An exhausted job therefore cannot poll forever; after the cap, existing
foreground/reconnect revalidation can still refresh the profile.

## Inspection and recovery

Use the configured database connection to inspect queue state:

```sql
SELECT state, count(*) FROM onboarding_queue GROUP BY state;

SELECT id, attempts, last_failure, created_at, updated_at
FROM onboarding_queue
WHERE state = 'failed'
ORDER BY updated_at DESC;
```

After resolving the cause, retry a reviewed failed job by its ID:

```sql
UPDATE onboarding_queue
SET state = 'pending', attempts = 0, visible_at = CURRENT_TIMESTAMP,
    acquired_at = NULL, acquired_by = NULL, updated_at = CURRENT_TIMESTAMP
WHERE queue_name = 'user-onboarding-v1' AND state = 'failed'
  AND id = '<reviewed-job-id>';
```

For existing pending profiles, run `bun run --cwd apps/server provisioning:audit`
and preview `bun run --cwd apps/server provisioning:backfill`. Adding
`--apply` repairs missing base stores and enqueues fresh enrichment jobs.
An enrichment outcome with `queued: true` confirms the durable handoff;
completion is recorded in the queue. Do not reuse an old `--resume` log when
intentionally requeueing a previously accepted job.

Monitor failed jobs and the age of pending jobs. Logs include job ID, UID,
and attempt number. The existing `ccb_profile_name_repair` Statsig event
records completed worker outcomes; telemetry failures do not fail jobs.

The payload is versioned. Preserve decoding compatibility for queued jobs
when changing its schema; Effect retains undecodable jobs as failed records.
