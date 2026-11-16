# Replay-safe push-token registration

## Status

Accepted — 2026-07-31

## Context

The mobile Relay offline architecture admits a mutation to its durable outbox
only when the backend contract proves that at-least-once delivery is safe. A
request can reach the backend while its response is lost, so the client must be
able to repeat the command without creating a second logical write or duplicate
side effect.

`registerPushToken` already writes the registry document under the FCM token,
treats the requested channels as a complete desired set, and reconciles FCM
topic membership against the confirmed stored set. Its GraphQL schema did not
previously promise those semantics, so the mobile client correctly kept the
mutation online-only.

## Decision

- `registerPushToken` is a replay-safe, idempotent absolute upsert keyed by the
  FCM token.
- Repeating the same input for the same authenticated User converges to one
  registry document and the same FCM topic set. Metadata such as `updatedAt`
  may advance without changing the command's effective state.
- `channels` is the complete desired channel set. The shared `announcement`
  topic is always included, and previously registered channels omitted from a
  later command are removed.
- FCM topic changes are applied before the registry document is written. If a
  response is lost after success, replay reads the confirmed document and does
  not reapply unchanged topic operations. If persistence fails after an FCM
  operation, replaying that set-membership operation remains safe.
- The authenticated User identity comes from the verified GraphQL context and
  is never accepted from command input.

## Consequences

- The mobile app may admit only `registerPushToken` to a closed, auth-scoped
  durable outbox after its own replay, logout-purge, and cross-scope tests pass.
- This decision does not make arbitrary GraphQL mutations replay-safe.
  Attendance, payments, append-style commands, and commands without an explicit
  idempotency contract remain online-only.
- Any future change to token identity, topic reconciliation, or write ordering
  must preserve the GraphQL replay guarantee or introduce a versioned command.

## Campus subscriptions — 2026-09-18

The additive `followPreferredCampus` input opts into server-derived campus
membership. Replays in this mode converge to the **latest** Postgres preference,
not a campus captured in the original command. The response reports the applied
campus and preference version. Legacy requests retain their explicit channel
semantics. All devices retain `announcement` for general messages and VOD.

Verified Firebase anonymous identities may register; their tokens have no account
owner and follow Union. Signed-in identities own their tokens and follow their
saved preference. An advisory lock serializes writes per token across instances.
In follow mode an attempt that finds a dirty registry document (see below)
removes all other known campus topics and reapplies the desired topics,
repairing FCM changes whose registry write failed.

Preference writes atomically enqueue a versioned reconciliation record. An
immediate attempt updates every opted-in device; the internal scheduler retries
pending records with backoff. Completion removes only the version processed, so
it cannot delete a newer preference change. Invalid FCM tokens are pruned.

## Write-ahead registration marker — 2026-10-15

Reconciling every known topic on every attempt cost about 18 FCM calls per
registration, almost all of them no-ops. Before its first FCM call an attempt
now merges `dirty: true` into the registry document, together with
`pendingTopics`: the topics it may subscribe, added to any an earlier failed
attempt left there. Its final write sets `dirty: false` and empties
`pendingTopics`. An attempt with nothing to change makes no FCM calls and
writes no marker.

- A **clean** document (`dirty: false`) lists exactly the topics FCM holds, so
  the next attempt subscribes only the desired topics it lacks and unsubscribes
  only the stored topics no longer desired. A replay of an applied command makes
  no FCM calls.
- A **dirty** document, or one written before the marker existed, may hide FCM
  changes whose final write failed. The attempt reapplies every desired topic
  and removes every topic the device could hold unless desired: each known
  preference topic, the stream audience, in follow mode every known campus
  topic, the stored topics, and `pendingTopics`.
- A **missing** document means no subscriptions, because every attempt writes
  its marker before calling FCM. The exception predates the marker: a token
  whose first registration failed part-way before this change, with no
  successful registration since, keeps any topic that attempt subscribed and
  later registrations no longer want.

The preferences marker still joins before its category and follow topics and
leaves after them, and the stream audience still changes only after its
destination topics. Any other writer of these documents or of their tokens' FCM
topics, including a future port of this mutation, must keep the marker
protocol, or clean documents stop matching FCM.
