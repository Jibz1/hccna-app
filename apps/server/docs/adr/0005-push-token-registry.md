# Push token registry and channel topics

## Status

Accepted — 2026-07-22

## Context

Push delivery was topic-only: every device was subscribed to the single
"announcement" FCM topic by the `sendBroadcast` mutation, which also wrote a
flat `anonymousPushTokens` collection nothing read. Per-user notifications were
impossible, client-requested channels were ignored, dead tokens were never
pruned, and the stored Expo token had no delivery path. Distributed app
versions call `sendBroadcast` with a fixed input shape, so that mutation cannot
change.

## Decision

- A `pushTokens` collection (doc ID = FCM token; fields: token, topics,
  userId?, platform?, createdAt, updatedAt) is the device registry, owned by
  `PushTokenService`.
- Registration normalizes client channels into FCM topics and always includes
  the shared "announcement" topic; removed channels are unsubscribed.
- Broadcast-style sends stay on FCM topics (free, no registry reads at send
  time). Per-user sends use `sendEachForMulticast` over the user's registry
  tokens and prune tokens FCM reports as unregistered or invalid.
- New clients register via `registerPushToken` (userId derived from auth
  context). `sendBroadcast` is frozen—same input/result shape and success
  message—and delegates to the same service; `expoToken` is accepted but no
  longer stored (Expo push has no server-side delivery path here; FCM is the
  single channel, at zero message cost).
- `sendAnnouncement` publishes to its optional `channel` topic when valid,
  defaulting to "announcement".
- `scripts/backfill-push-tokens.ts` copies legacy docs into the registry
  (dry-run by default). The legacy collection is retained until the backfill is
  verified in production.

## Consequences

- Per-user and targeted pushes become possible (used next by event reminders
  and the planned FCM "nudge" if mobile Firestore listeners are revisited).
- Old app binaries keep working unchanged; their registrations now also honor
  the channels they were already sending.
- FCM and APNs remain free; marginal cost is a few Firestore operations per
  registration and per-user send.
