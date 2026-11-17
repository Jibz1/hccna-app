# Campus notification operations

Deploy the campus preference database migration before the server release, and
deploy the backend before releasing the new mobile app. The new mobile operations
require the additive campus fields; old GraphQL operations remain valid. Older
clients continue using explicit channels.

This repository's CI does not compare the schema with the deployed API. Additive
backend/mobile work can merge before deployment; a green PR check does not mean
production is ready for the new app.

## Subscription reconciliation

Provision a Cloud Scheduler HTTP job every minute against the server's `/graphql`
endpoint. Use POST, `Content-Type: application/json`, and this body:

```json
{"query":"mutation ReconcileCampusSubscriptionsMutation { reconcileCampusSubscriptions { processed failed } }"}
```

Use an OIDC token from the existing allowlisted internal scheduler service account
with the server's configured audience. This operation requires `googleInternal`;
client tokens cannot invoke it. Use the same authentication configuration as the
existing internal GraphQL scheduler jobs. Configure a request deadline sufficient
for a batch of 25 users and an alert on repeated scheduler failures.

The mutation processes up to 25 due users, two at a time. Failures retain the
pending version with exponential backoff (up to one hour). Monitor
`campus_subscription_sync` row age and the `Campus subscription synchronization
will retry` structured log. No token values are logged. Invalid FCM tokens are
removed from the registry. Successful reconciliation conditionally removes the
processed preference version; newer updates remain pending.

Changing campus saves the Postgres profile even when Firestore or FCM is
unavailable. Reconciliation first mirrors `preferredCampusSlug` and
`campusPreferenceVersion` to Firestore's `app-users/{firebaseUid}` document, then
updates device subscriptions. This also mirrors selections for users without
registered devices or notification permission. The Firestore transaction merges
only those two fields and rejects older versions. Postgres remains authoritative.
The response's `syncPending` covers both the Firestore mirror and device
subscriptions; a failed mirror retains the durable row for retry. Deploying code
does not provision the scheduler or apply the migration automatically.

After deploying the server with the Firestore mirror, queue existing selections
once in Postgres so they are copied without requiring users to select again:

```sql
INSERT INTO campus_subscription_sync (user_id, version)
SELECT id, campus_preference_version
FROM app_users
WHERE preferred_campus_slug IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;
```

Run the reconciliation mutation above, or let the scheduler drain the queue.
Existing pending versions and their retry schedules are preserved.

## Stream delivery cutover

Keep the Statsig gate `campus_stream_notifications_enabled` off until the mobile
release registers with `followPreferredCampus` and physical-device tap tests pass.
Enable it for stream coordinators to begin campus delivery. With the gate off,
Union stream notifications go out as two sends: `announcement` devices without
notification settings (the `notify-prefs-v1` marker), and devices with settings
that kept Livestreams on or follow Union. Other campuses do not send stream
alerts. Disabling the gate returns to that behavior; it does not restore
broadcasts to devices whose settings turned Livestreams off. It is a rollout gate,
not a switch that stops all stream notifications.

Versions **1.1.5 and below** retain Union stream alerts. Campus delivery requires
both `followPreferredCampus: true` and a native app version newer than 1.1.5 in
`x-hccna-app-version` (or the legacy `x-app-version` header). Missing or malformed
versions remain on legacy delivery. The legacy `sendBroadcast` operation never
enrolls a device in campus delivery. The new native release is 1.1.6.

Eligible registrations join the server-managed `campus-stream-v2` FCM audience
after the destination campus topics are applied. A legacy registration removes
that membership. Reconciliation preserves each device's enrollment: changing an
account's campus does not enroll its older devices. Existing old devices need no
new registration, including devices that have not reopened during rollout.

With the gate on, every campus stream goes out as two sends, because one combined
condition would exceed FCM's five-topic limit:

- **Devices with settings:** campus members that kept `livestreams` on, plus
  devices with that campus's `follow-<campus>` topic.
- **Devices without settings:** campus members in the migrated audience. For
  Union, also `announcement` subscribers outside that audience.

The second send excludes the `notify-prefs-v1` marker, and registration never
leaves a category or follow topic on a device without the marker (it joins
first and leaves last). Each device therefore matches at most one send at every
step of a registration, including after a failed call. Registration also
unsubscribes every known preference topic the new settings do not include,
even ones the saved document never recorded, so a registration whose Firestore
write failed is repaired by the next one.

All devices keep `announcement` for general announcements, which always reach
every device. VOD goes to `verse-of-the-day` plus `announcement` devices without
the marker, so a device that turned Verse of the Day off stops getting it. WOA
pushes skip a user's devices that turned Word of Activation off. These category
filters apply whether or not the stream gate is on.

Each stream notifies at most once per live event. An event starts with the first
save that leaves a destination switched on, ends with a save that leaves none on,
and continues if the stream is restarted within 30 minutes. Whether anything is
left on is decided inside the save's transaction: the switches Castr accepted from
the save are applied to the ones the status poll last stored, so destinations the
coordinator can't manage, stops Castr rejected, and a destination another save
turned on (once that save's poll has stored it) all count, but Castr's lagging
broadcasting status does not. Only a save whose accepted stop leaves nothing on
counts as a manual end for the status poll, even if Castr rejected a start in the
same save. A stream that is never turned off starts a new event on its first live
save 12 hours after the current one started. The event's notification goes out on
its first live save whose title or description, normalized (Unicode NFC,
whitespace collapsed, trimmed),
differs from the last notification's. Details saved while the stream is offline
count when it goes live. An event that reuses the last notified title and
description waits for the first edit, and later edits during the event never
notify again. The notification's title is the stream title (`Live now` for a stream
saved without one) and its body is fixed.

A Firestore transaction on `castr-streams/<id>` commits the metadata with the event
(`liveEventStartedAt`, `liveEventEndedAt`) and the claim (`notificationRevision`,
`notificationClaimedAt`, `notificationFingerprint`), so concurrent saves claim
once; a save that commits after a later-dated one is treated as happening after
it. A claim from before event tracking counts as the start of the current event,
and its baseline is the title and description stored at the first save after
this change. Polling, saves that leave nothing live, and unmapped special streams
do not notify. While the rollout gate is off, live saves still track the event
but claim nothing, so the event's notification goes out on its first live save
after the gate is turned on, if its details differ from the last notification's.
"Live" means a destination is turned on, not that Castr is receiving video. Only
campus slugs are eligible; `joseph-siju` and `house-of-stars-junior-church` never
send stream notifications, regardless of the rollout gate.

Each claim gets one FCM send attempt. A crash after the claim or an ambiguous FCM
failure can lose an alert; it is deliberately not replayed to avoid duplicate
notifications. Monitor `Campus stream notification send failed` with its event ID.

Stream payloads contain `type=campus-stream`, `campusSlug`, `streamId` and
`eventId`. VOD payloads contain `type=vod`; the mobile destination displays the
current daily verse, not a historical snapshot. WOA payloads contain `type=woa`
and open `/vod-detail-modal?slug=word-of-activation` for the signed-in account.
Livestream taps open `/campus-modal` with the notification's `campusSlug`, even
when it differs from the account's preferred campus.

VOD, livestream, and per-user sends also include routing data in
`apns.payload.body` for installed iOS builds: Expo exposes that nested object as
`notification.request.content.data`.
Direct FCM custom fields are instead available in the iOS `trigger.payload`
(and Android `trigger.remoteMessage.data`). The mobile router accepts these native
payloads as well as Expo's normalized data. Preserve the nested APNs routing payload
until the installed builds that only read `content.data` are retired.

## Notification settings rollout

The mobile Statsig gate `notification_settings_enabled` controls per-device
notification settings: the Settings → Notifications screen, the campus bells,
and whether registration sends the `notify-prefs-v1` marker, categories and
follows. While it is off (or missing), the app registers `channels: []`
exactly as before and the device receives everything, so the server change is
inert. Turning it off later is a kill switch: devices re-register without the
marker the next time they compute their subscriptions, and their saved choices
stay on the device and apply again once the gate is on. The server needs no
gate of its own; it only behaves differently for devices that send the marker.

## Monthly WOA notifications

The existing internal `wordOfActivationMonthly` mutation rotates subscriptions
and sends email and push notifications when `monthlySub` is `true` (including
the legacy string `"true"`). The subscriber's email resolves to a Firebase Auth
UID; pushes use only that UID's registered devices. Email-only subscribers,
disabled accounts, and accounts without registered devices receive no push.
The personal verse is never sent to a shared topic.

A Firestore transaction claims each subscription's monthly assignment before
delivery. Concurrent runs and reruns skip an already-claimed month. Email and
push are attempted independently. The mutation only starts the run; failed
subscribers are retried once, and any still failing raise a Sentry issue tagged
`job:woa-delivery`. `docs/monthly-notification-recovery.md` covers resending.
`notified` counts subscribers with at least one device accepted by FCM, not
confirmed device delivery. Partial push failures count toward `failed` even when
another device accepted the message, except for unregistered tokens, which are
pruned.

The WOA cache ignores previous-month entries using the same America/New_York
month as rotation, so opening a notification can fetch the newly assigned verse.
WOA tap routing requires a mobile release containing `type=woa` support. The
backend payload changes alone support VOD and livestream taps on the existing
build with those destinations. This change does not provision or alter the
monthly scheduler; it extends the existing rotation operation.

## Adding subscription topics

Mobile subscription choices are composed in `usePushSubscriptions`. It returns
one complete desired set for startup, foreground refresh and token rotation.
Read additional saved topic choices there and include them in `channels`; a
one-off call to register a topic would be replaced by the next full registration.
`announcement` remains an automatic server subscription.

`utils/pushSubscriptions.ts` owns the persisted subscription schema, normalization,
comparison key, GraphQL input mapping and confirmation mapping. The campus policy
is optional within that model and uses the backend's canonical preference version.
Adding an explicit public channel uses the existing model. Adding another policy
that derives topics from backend preferences requires its server contract and
resolver plus an entry in this adapter and the composition hook. Permission prompts,
token acquisition, authentication scoping, retry scheduling and the confirmation
cache do not need topic-specific branches. Bump the persisted registration version
if a schema change makes saved registrations incompatible.

Registration replaces the complete set. The server's existing token registration
service applies additions/removals, and campus reconciliation preserves explicit
channels. Private membership topics must be authorized and derived on the server;
the public `channels` input is not an authorization boundary. A new backend
preference policy also needs a durable reconciliation trigger for other devices,
as campus selection has today.

## Mobile registration ownership

`PushRegistrationService` owns one pending registration: the latest FCM token and
complete subscription set for an authentication scope. `pushTokenRegistrationStore`
holds the last server-confirmed receipt. `register` replaces pending intent when
it changes; `sync` resumes it on startup, foreground/connectivity recovery, or its
retry deadline. One serialized worker performs requests, and its retry task belongs
to the application service scope. Logout aborts active requests, clears pending
registration, and cancels retry work before other user storage is cleared. Runtime
disposal cancels work but preserves the registration for the next launch. After
logout cleanup, new registration and sync calls for the departing identity are
ignored until the service observes a different authentication scope. Internal
discards do not retire the current identity or count as explicit logout clears.

The existing `push_token_outbox_enabled` gate still controls durable acceptance.
When enabled, a synchronous encrypted MMKV write precedes the request. With the
gate off, new registrations remain online-only; already-persisted work continues
to retry. Retryable failures retain attempt counts and deadlines across restarts;
server Retry-After takes precedence over the existing jittered backoff and is
measured from the failure response. Permanent failures wait for a fresh `register`
call. The 15-second request timeout remains in the Relay mutation adapter.
Executor-reported cancellation retries while the identity remains current. Storage
read/write failures retain pending intent and schedule backoff recovery; if storage
is unavailable, that recovery deadline stays in memory until it can be read again.
Logout and runtime disposal cancel both network retries and storage recovery.

`pushRegistrationStorage` isolates the legacy version 3 envelope. The MMKV ID,
key, wire format, rollout gate name, and metric names remain compatible with
installed apps and rollback builds. Storage errors retain the deployed
`OfflineMutationOutboxStorageError` tag and `Failed to <operation> the offline
mutation outbox` message, although the TypeScript class is now named
`PushRegistrationStorageError`. Invalid records emit `discarded_invalid` once;
`cleared` counts explicit logout/delete cleanup only. `ignored` means no work was
accepted or retained (for example, a retired identity), so it intentionally does
not emit the hook's queued-registration event. `queued` describes retained work.
Do not route other mutations through this
service; its durability guarantee relies on the push-registration replay contract.

## Mobile release validation

The app saves campus changes online and caches the confirmed profile inside the
existing authenticated Relay persistence scope. Unowned device-global campus
values are not uploaded: users with only the old local setting select their
campus once in the new release. Guests use Union.

The pending push registration uses the deployed version 3 storage format. Older
incompatible records are discarded; legacy confirmations cannot suppress the first
follow-campus registration. The server-confirmed subscription settings and topics
are saved only after success.
The confirmation cache includes the native app version so an upgrade forces a
fresh registration even when the token and campus preference have not changed.
Guest identity scopes include the anonymous UID separately from the anonymous Relay
cache scope, including when an anonymous UID is upgraded to a real account.

Before enabling stream delivery, verify on physical iOS and Android devices:

1. Opt in as a guest, then confirm only Union stream alerts arrive.
2. Sign in on two devices, choose New Breed, and confirm both move to New Breed.
3. Change campuses with FCM temporarily unavailable, then run reconciliation and
   confirm the old campus stops delivering.
4. Sign out, restart, and switch accounts; confirm the device returns to Union
   or the new account's saved choice and does not retain prior ownership.
5. Tap a stream alert while the app is open, backgrounded, and terminated; it
   should open the alert's campus even if the selected campus has since changed.
6. Tap a VOD alert in the same states; it should open the daily verse detail.
7. Confirm receiving an alert in the foreground does not navigate automatically.
8. Going live with a new title or description must create one alert; later
   saves, title or description fixes and a quick restart must not create more.
9. Keep a 1.1.5 device on the same account as a 1.1.6 device. With the gate enabled,
   choose New Breed: the older device still gets Union; the newer device gets only
   New Breed. Test an older device that has not reopened since backend deployment.
10. Upgrade 1.1.5 to 1.1.6 with the same token: startup must re-register and follow
    the saved campus. Re-registering through the legacy API must restore Union.
11. A migrated Union device must get one alert per live event. With the
    gate disabled, Union alerts must reach older versions and newer devices that
    kept Livestreams on or follow Union, and other campuses must send nothing.
    Announcements must still reach every version; VOD must reach older versions
    and newer devices that kept Verse of the Day on.
12. Tap a WOA push while the app is open, backgrounded, and terminated. It must
    open Word of Activation detail for the signed-in account, rather than VOD.
    Verify the new month's verse loads when last month's verse was cached.
13. On a settings device, turn Livestreams, Verse of the Day and Word of
    Activation off one at a time, with the gate on and off. Each must stop only
    its own alerts; announcements must still arrive. Turn each back on and
    confirm it resumes.
14. From a New Breed device, follow Union: a Union live event must
    arrive once, with the gate on or off. Unfollow and confirm Union alerts stop.
    Switch a Union-preferred device that already gets Union alerts to settings,
    and confirm the next Union event arrives exactly once.

These native delivery checks require a custom Expo build with Firebase/APNs/FCM
credentials. Unit tests cover queue, routing, persistence, and trigger behavior;
they do not prove delivery through APNs or FCM on physical devices.
