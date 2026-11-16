# Transport Request — design

Status: v3, revised 2026-09-02 after an implementation-readiness review. Storage moved
from Postgres to Firestore in v2; the v1 review and the v2-to-v3 findings are logged at
the end.
Domain terms are defined in `CONTEXT.md` (Transport Coordinator, Guest Rider, Church
Event, Event Occurrence, Transport Request, Request Cutoff, Pickup Run, Pickup Stop,
Scheduled Pickup Time).

## What we're building

Signed-in Users request a ride to a Campus for one Event Occurrence (a dated instance of a
Church Event from the CMS events listing) whose CMS `Transport` component explicitly
enables transport. The event names its destination Campus; the backend resolves and
validates the event, next occurrence, campus, and cutoff instead of accepting those facts
from the client. Transport Coordinators create requests on behalf of Guest Riders who
phone in. Requests close at a hardcoded Request Cutoff before the occurrence starts;
coordinators can still add late riders until the run departs.
Transport Coordinators — Users on a Strapi-managed per-campus email list, exactly like
Castr stream coordinators — approve requests, then tap "Plan route": the backend computes
an optimized multi-stop route and works each rider's Scheduled Pickup Time backward from
"arrive at campus N minutes before start". On pickup day the driving coordinator's phone
reports location in the background (so they can navigate with Google Maps); riders watch
an Uber-style live map (driver dot, distance, minutes away) fed by per-rider Firestore
documents, with push notifications as nudges at each milestone.

v1 scope: House of Stars campus (Union, NJ — slug `house-of-stars`) and inbound runs only.

## Decisions

| #   | Decision               | Choice                                                                                                                                                                          |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Who receives requests  | Strapi per-campus `CoordinatorEmails`-style list (Castr/CheckIn pattern) — the Transport Coordinator                                                                            |
| 2   | Coordinator vs driver  | One list; the coordinator who plans/drives a run is that run's driver. No standing "driver" role                                                                                |
| 3   | Campus                 | "Union" = existing `house-of-stars` Campus. Each eligible Church Event points to its destination with `Transport.CampusSlug`; no new campus type is introduced                  |
| 4   | What anchors a request | An explicitly transport-enabled Church Event's **next** occurrence (what the recurrence engine supports). The server resolves the occurrence, Campus, and cutoff                |
| 5   | Cutoff                 | Hardcoded offset from occurrence start (AppConfig). Riders cannot self-request after it; coordinators can add late riders until the run departs                                 |
| 6   | Pickup location        | Typed address + Places Autocomplete and Place Details in phase 1; geocoded at request time; Maps-derived address/coordinates purged no later than 30 days after the occurrence  |
| 7   | Approval               | Coordinator approves each request in v1; config flag (Statsig) flips to auto-accept later. Requests still pending at cutoff expire with a push                                  |
| 8   | Route planning         | Coordinator-triggered "Plan route" after cutoff; Routes API waypoint optimization; times computed backward from campus arrival; coordinator confirms before riders are notified |
| 9   | Replan policy          | Free re-optimization before confirm. After confirm: stop order is preserved and no promised time ever moves earlier; late additions are inserted without moving anyone earlier  |
| 10  | Multi-vehicle          | **Open before implementation:** the current occurrence lock supports only one run per direction, despite the v2 claim that it supports many; see Remaining design decisions     |
| 11  | Direction              | Inbound only in v1; `direction` and stop assignments preserve the storage shape for return runs, subject to resolving request-vs-stop state ownership                           |
| 12  | Seats                  | A request carries a seat count (rider + companions without accounts); one request = one stop                                                                                    |
| 13  | Guest riders           | Coordinators create requests on behalf of people without accounts (name, phone, address, seats). They are routed and scheduled; they get no push or live map                    |
| 14  | Live experience        | Full Uber-style live map: driver dot + stops/distance/minutes; driver location tracked in the background while the run is active; staleness shown honestly                      |
| 15  | Cancellation           | Rider cancels anytime up to pickup; post-plan cancels notify the driver, who replans (order-preserving); geofence may infer arrival, but pickup/no-show requires driver input   |
| 16  | Storage                | Firestore only (product decision). A narrow repository isolates backend persistence, while direct mobile projections remain an intentional Firestore API contract               |
| 17  | Safety nets            | An awaited, idempotent 10-minute scheduler tick expires stale requests, reminds coordinators of unplanned runs, flags moved events, broadcasts delays, and purges PII           |
| 18  | Event eligibility      | A Strapi Event-level `Transport` component with `Enabled` and `CampusSlug`; coordinator emails remain on the Campus                                                             |

## Architecture

Everything reuses an existing pattern; the only genuinely new integration is Google Maps.

```
Rider app                          Backend (Cloud Run)                       Admin/Config
─────────                          ───────────────────                       ────────────
requestTransport ──GraphQL──▶   TransportRequestService ◀──ACL── StrapiTransportAclProvider
cancel / myRequests                 │        │                              (Campus.Transport.
onSnapshot ◀── transport-request-views/{id}  │   PushTokenService.sendToUser  CoordinatorEmails;
(own minimal rider projection)      │        │                              Event.Transport.Enabled/CampusSlug)
                                    │        ▼
Coordinator app                     │   RoutePlanningService ──▶ Google Routes API (waypoint opt)
approve / decline / onBehalf ───▶   │        │                   Google Places (at request)
planPickupRun / confirm ────────▶   │        │
startPickupRun / complete ──────▶   │        ▼
reportDriverLocation ─every ~10s─▶ TransportRunProjectionStore ──▶ Firestore
(background location task)          │                    transport-requests/{id}
                                    │                    transport-request-views/{id} (rider projection)
                                    │                    transport-occurrences/{key}   (inbox index + plan lock)
Cloud Scheduler ─every 10 min──▶ transportTick (googleInternal)   transport-runs/{runId}
  expire · remind · reconcile · delay · purge                       ├─ stops/{requestId}  (assignment)
                                                                    └─ riders/{uid} ──onSnapshot──▶ Rider live map
```

### Storage: Firestore, single store

**Why Firestore.** Product decision after weighing Postgres (v1) and Firebase Realtime
Database. Firestore wins over RTDB because the mobile app already depends on
`@react-native-firebase/firestore` with the `onSnapshot` pattern, the backend already has
the admin ops, and RTDB's edge (cheap very-high-frequency writes) is irrelevant at ten
riders and a ping every ten seconds — a second database SDK on both sides for nothing.
The repo's migration guidance (Firestore generic primitives are transitional infra) is
honored structurally: `TransportRequestService` depends on a narrow `TransportRepository`
contract, and the Firestore implementation is built from narrowed `FirebaseAdminService`
ops exactly like `PushTokenService` does. This isolates backend writes and queries; it
does **not** make a store change a one-file edit because the mobile read projections,
security rules, indexes, and data migration are also Firestore contracts.

**Collections and document identity.**

- `transport-requests/{requestId}` — `requestId` is deterministic for Users:
  `${uid}__${eventDocumentId}__${occurrenceStartEpoch}`. Guest riders get
  `guest__${coordinatorUid}__${clientRequestId}` where `clientRequestId` is a
  coordinator-client UUID retained across retries. Fields: campusSlug, eventDocumentId,
  eventSlug, eventTitle
  (denormalized), occurrenceStart, cutoffAt, rider `{ kind: "user" | "guest", uid?,
  email?, displayName, phone? }`, pickup `{ address, placeId, lat, lng }`, seatCount,
  status, statusHistory `[{ status, at, byUid }]`, createdByUid, purgeAt, timestamps.
  Status: `requested | accepted | declined | expired | scheduled | picked_up | no_show |
  cancelled | completed`, plus a `needsAttention` flag. This status set is provisional
  until the request-vs-stop state decision below is resolved.
  The deterministic ID is the uniqueness rule (one request per rider per occurrence)
  **and** the idempotency key: `requestTransport` is a transactional upsert — a lost
  response and retry converge on the same doc, and a `cancelled | declined | expired`
  doc is **reopened** to `requested` by a new request (history kept in statusHistory).
  A doc in `scheduled` or later is not reopened; the mutation returns it as-is.
- `transport-request-views/{requestId}` — a minimal rider-facing projection: riderUid,
  requestId, event `{ title, occurrenceStart }`, Campus summary, seatCount, requestStatus,
  scheduledPickupTime?, runId?, updatedAt. It deliberately excludes coordinator notes,
  phone/email, status history, audit actors, other riders, and operational flags. It is
  deleted when the canonical request reaches its PII purge date. Firestore reads return
  whole documents, so rules alone cannot hide fields on the canonical request. Canonical
  request changes and this projection are committed together in one Firestore transaction
  or batch.
- `transport-occurrences/{occurrenceKey}` — `${campusSlug}__${eventDocumentId}__${epoch}`.
  The coordinator inbox index and the planning lock: eventTitle, occurrenceStart,
  cutoffAt, counts `{ requested, accepted, scheduled }`, runs `{ inbound: runId | null,
  return: runId | null }`, drift `{ detectedAt, newOccurrenceStart } | null`,
  lastReconciledAt. Creating a run happens in a Firestore transaction that fails if
  `runs[direction]` is already set — two coordinators tapping Plan at once cannot create
  duplicate runs.
- `transport-runs/{runId}` — campusSlug, occurrenceKey, direction, coordinatorUid,
  coordinatorEmail, status (`planning | scheduled | active | completed | abandoned`),
  start `{ address, lat, lng }`, plannedDepartureAt, targetArrivalAt, route `{ polyline,
  legs[] }`, earliestPickupAt, longestRideMinutes, startedAt, completedAt, lastLocation
  `{ lat, lng, heading, capturedAt, receivedAt, sequence }`.
- `transport-runs/{runId}/stops/{requestId}` — the **Pickup Stop** assignment entity:
  order, scheduledPickupTime, etaAt, status (`pending | arrived | picked_up | no_show |
  cancelled`), rider summary, pickup coords. Because
  assignment is a subcollection rather than fields on the request, one request can be a
  stop on an inbound run and later on a return run.
- `transport-runs/{runId}/riders/{uid}` — the per-rider **live projection** written on
  every ping: driver `{ lat, lng, heading, capturedAt, receivedAt }`, stopsAway,
  distanceMeters, etaMinutes, myStopStatus, runStatus, updatedAt. Deleted when the run
  completes. Riders never see other riders' addresses; the manifest exists only in the
  coordinator's GraphQL view.

**What the client reads directly (security rules).** Two minimal single-document
subscriptions, both the existing `onSnapshot` shape, both keyed so rules are pure uid
equality:

- `transport-request-views/{requestId}` readable iff `resource.data.riderUid ==
  request.auth.uid` — the rider watches their own approval/schedule status live, so
  in-app state is the source of truth and push is only a nudge.
- `transport-runs/{runId}/riders/{uid}` readable iff `uid == request.auth.uid`.
- Canonical requests, occurrences, runs, and stops are backend-only. **No client
  writes.** Anonymous Firebase sessions
  (the GraphQL fallback) match nothing.

`firestore.rules` and `firestore.indexes.json` are added to this repo and deployed with
the Firebase CLI; the existing anonymous read of `app-config/live-stream` must stay
intact. Emulator tests prove both positive access and fail-closed access to every other
transport path, and CI/deployment applies rules and indexes with the backend release.
Composite indexes: `transport-requests (campusSlug, occurrenceStart, status)` for the
inbox and `(rider.uid, occurrenceStart desc)` for "my requests".

### Authorization: two tiers, Strapi off the hot path

Copy the streaming split (`StrapiTransportAclProvider` loads with `fetchFresh`;
`TransportAuthorizationService` decides with typed denial reasons) — but only for
**coordinator-level commands**: approve, decline, create-on-behalf, accept-late, plan,
confirm, start. **Run-scoped commands** (`reportDriverLocation`, mark stop, replan,
complete) are authorized by `transport-runs.coordinatorUid == caller uid` from the run
document alone. A Strapi outage can stop new approvals; it cannot stop a run in progress,
and a 10-second ping never touches Strapi.

Coordinator identity is matched by the email in the Firebase token. **Apple "Hide My
Email" relay addresses will never match a Strapi list**; the coordinator screen shows the
caller's sign-in email and a "not on the coordinator list" hint so the mismatch is visible
instead of silent. A uid-keyed override is a later option.

Riders use `authScope.signedIn` (rejects anonymous sessions). Strapi change: a `Transport`
component on the Campus type holding `CoordinatorEmails`, plus an Event-level `Transport`
component with `Enabled` and `CampusSlug`. The server rejects requests when transport is
disabled, the Campus does not exist, or the occurrence is no longer the event's next
occurrence.

### Trust boundaries and idempotency

Client inputs identify intent, not authoritative event or route facts:

- `requestTransport` accepts `eventDocumentId`, `placeId`, the Places session token, and
  `seatCount`; the server fetches the Church Event, requires
  `Transport.Enabled`, resolves `Transport.CampusSlug`, calculates the next occurrence
  and cutoff, and resolves the Place Details. It ignores client-supplied titles, times,
  campuses, cutoffs, formatted addresses, and coordinates.
- `createTransportRequestOnBehalf` additionally accepts Guest Rider contact details; its
  `clientRequestId` is the idempotency key so retrying after a lost response cannot add
  the same Guest Rider twice.
- `reportDriverLocation` accepts a monotonically increasing sequence and client
  `capturedAt`; the server writes `receivedAt`, rejects invalid coordinates and stale or
  out-of-order points, and requires the caller to own an active run.
- Address suggestion and driver-location operations have dedicated per-user limits in
  addition to the global GraphQL limit. Autocomplete uses a minimum query length,
  debounce, New Jersey restriction/bias, response field masks, and one UUID session token
  carried through the subsequent Place Details call.

### Event Occurrence identity

`RecurrenceCalculator` only answers "next occurrence after a reference date" — there is no
occurrence ID and no range expansion. So:

- v1 offers "Request transport" only for the **next** occurrence of an explicitly
  transport-enabled Church Event (the engine's contract); future-occurrence booking
  needs range expansion first.
- A request stores `eventDocumentId` + `eventSlug` + `occurrenceStart` + `cutoffAt`. The
  timestamp is the identity, and it can drift: a CMS edit to the event time shifts every
  future occurrence.
- The scheduler tick and the coordinator inbox **reconcile**: recompute the next
  occurrence from Strapi and compare with each open occurrence key. On drift the
  occurrence doc gets `drift`, its requests get `needsAttention`, coordinators get one
  push ("Sunday Service moved to 9:30 — 6 requests need attention"), and the coordinator
  resolves the change or declines the requests. The exact rescheduling write depends on
  the stable-occurrence-identity decision below; v3 does not pretend that a
  timestamp-keyed document can move in place.

### GraphQL surface (mobile API)

New module `src/graphql/schema/transport/` registered in `schema.ts`; every operation
added to `KNOWN_OPERATION_NAMES_LIST`; typed success/error unions like
`upcomingEventsByMonth`.

Rider: `requestTransport(input)` (idempotent upsert; input is event ID, Place ID, Places
session token, and seats), `cancelTransportRequest(id)`, `myTransportRequests`,
`transportAddressSuggestions(query, sessionToken)` (Places
Autocomplete passthrough; the Maps key stays server-side).

Coordinator, ACL tier: `transportOccurrences(campusSlug)` (inbox from the occurrence
index), `transportRequests(occurrenceKey)`, `approveTransportRequest(id)`,
`declineTransportRequest(id, reason?)`, `createTransportRequestOnBehalf(input)` (Guest
Rider; allowed after cutoff until the run starts), `acceptLateRequest(id)`,
`planPickupRun(input)` → proposed ordered stops, pickup times, earliest pickup, longest
ride, `confirmPickupRun(runId)`, `startPickupRun(runId)`.

Coordinator, run-owner tier:
`reportDriverLocation(runId, lat, lng, heading?, capturedAt, sequence)`,
`markStopPickedUp(runId, requestId)` / `markStopNoShow(...)`, `replanPickupRun(runId)`,
`completePickupRun(runId)`.

Scheduler: `transportTick` (`authScope.googleInternal`), awaited inside the request. It
returns success only after the bounded batch and durable checkpoints complete; failures
return non-2xx so Cloud Scheduler can retry safely.

### Route planning

On `planPickupRun`: one Routes API `computeRoutes` call — origin = coordinator-chosen
start (default: campus), destination = campus, intermediates = accepted stops (Users and
Guest Riders alike) with `optimizeWaypointOrder: true`, `TRAFFIC_AWARE`, and a field mask
that includes `optimizedIntermediateWaypointIndex`. (`TRAFFIC_AWARE_OPTIMAL` is not
compatible with waypoint optimization.) Target arrival = occurrenceStart −
`arrivalBufferMinutes`. Walk the optimized legs backward from target arrival, subtracting
`stopServiceMinutes` at every pickup, to get each Scheduled Pickup Time (rounded to 5
min, communicated as "be ready from HH:MM"). Recompute once from the derived departure
time so the traffic estimate and backward schedule agree.

**Ride-length ceiling.** The proposal reports `earliestPickupAt` and `longestRideMinutes`;
if the longest ride exceeds `maxRideMinutes` (AppConfig, e.g. 60) the planner warns and
the coordinator can exclude riders from this run or proceed knowingly. Whether excluded
riders can be planned into a second v1 run depends on the multi-vehicle decision below.
Nobody is handed a 7:10 AM pickup for a 9 AM service without a human seeing it first.

**Replan policy** (decision #9). Before confirm: free re-optimization. After confirm:
order is preserved, and no promised time moves earlier; a cancellation just removes a
stop (times after it may stay or move later); a late addition is inserted at the position
that moves no existing promise earlier. Every replan that changes a time pushes the
affected riders. Routes API caps intermediates at 25 — far above one vehicle; a bigger
Sunday needs either a second run or an explicit overflow policy. The run also needs a
seat-capacity invariant: the sum of assigned request `seatCount` values must not exceed
the vehicle's declared `seatCapacity`.

### Live tracking (pickup day)

**Background tracking, not foreground-only.** Drivers navigate with Google Maps or Waze,
which backgrounds our app; a foreground-only design freezes the rider map the moment the
driver starts driving. Therefore:

- Driver taps "Start run" → run `active` → `expo-location` background updates via an
  `expo-task-manager` task, ~10 s cadence, posted through `reportDriverLocation`. iOS
  needs `UIBackgroundModes: location` and **Always** authorization for background
  updates. Android needs foreground and background location permission plus a foreground
  service of type `location` with a persistent notification. Tracking starts only on
  "Start run" and stops on complete/abandon. The experience must show when permission is
  missing, tracking is stale, or the OS/user has terminated the task; background delivery
  is not an uninterrupted-service guarantee.
- "Navigate to next stop" opens the stop in Google Maps / Waze / Apple Maps via URL
  scheme; our task keeps reporting while the driver is in the other app.
- `TransportRunProjectionStore` (mirrors `StreamProjectionStore`) writes the per-rider
  docs on every ping. ETA: one Routes API call from the driver's position through the
  remaining stops in order every ~60 s (≈ 60 calls per run, inside the free tier);
  between calls, extrapolate along that route. No polyline-progress guessing when the
  driver deviates.
- **Staleness is shown, never hidden.** Each projection carries `driver.receivedAt`; the rider
  widget greys the dot with "last update 48 s ago" past 45 s and "driver signal lost"
  past 3 min; the tick pushes the coordinator when an active run is silent for 5 min.
- **Arrival can be inferred; pickup cannot.** Driver within 75 m of the next stop for ≥
  45 s → stop `arrived`, rider pushed "your driver is here". The driver must then choose
  one large, low-distraction action: "Picked up" or "No-show". Leaving the geofence can
  prompt the driver but never records that a person entered the vehicle; until confirmed,
  downstream riders see a conservative stop count and ETA.
- Rider app: `onSnapshot` on their own rider doc through a **keyed** subscription
  registry (`Map<docPath, {snapshot, unsub, listeners}>` — the `useEventLive` singleton
  generalized), throttled emissions, driving a `react-native-maps` view: driver marker
  animating, their pickup pin, distance/minutes header.
- Volume: a 1-hour run with 10 riders and one ping every 10 seconds is about 3.6K
  projection writes and about 3.6K listener update reads, plus reconnect reads and route
  refreshes — small at v1 volume, but measured in production rather than assumed free.

### Push notifications

All per-user via `PushTokenService.sendToUser` (ADR 0005); coordinator emails resolve to
uids through the users collection. **Push is a nudge; in-app state is the truth** — every
push moment is also visible on the rider's request projection or live projection, so
riders who
denied notifications still see their time. Each push carries `data.route` so the tap
handler can deep-link (new mobile work, see below).

| Trigger                                       | Recipients                          |
| --------------------------------------------- | ----------------------------------- |
| Request submitted                             | Campus Transport Coordinators       |
| Approved / declined / expired at cutoff       | Rider                               |
| Run confirmed (times set) / times moved later | Riders on the run                   |
| Cutoff passed, riders accepted, no run yet    | Coordinators (hourly until planned) |
| Event occurrence moved (drift)                | Coordinators                        |
| Run started / running late                    | Riders on the run                   |
| Driver arrived at your stop                   | That rider                          |
| Rider cancelled after planning                | Driving coordinator                 |
| Active run silent for 5 min                   | Driving coordinator                 |

Guest Riders receive nothing (no device); the coordinator relays by phone. SMS is out of
scope for v1.

### Scheduler tick

Cloud Scheduler → `transportTick` every 10 minutes with `googleInternal` scope. The
handler awaits a bounded batch before responding; it does not detach work after the HTTP
response. Every transition and notification milestone is transactionally checkpointed,
so retries are safe and the hourly reminder is sent once per hour bucket. Failures return
non-2xx and are reported to Sentry. Each tick:

1. Expire `requested` docs past `cutoffAt` → `expired`, push the rider.
2. Remind coordinators of occurrences past cutoff with accepted riders and no run
   (repeat hourly until planned).
3. Reconcile occurrence identity against Strapi; flag drift.
4. Push "running late" to riders when a `scheduled` run has not started by
   `plannedDepartureAt + 5 min`; remind the coordinator.
5. Push the coordinator when an `active` run has had no ping for 5 minutes.
6. Purge PII: scrub exact names, phones, emails, pickup addresses/coordinates, start and
   stop coordinates, and Maps-derived routes/legs/polylines from canonical requests,
   stops, and runs past `purgeAt` (no later than occurrence + 30 days); delete rider
   request/live projections after their shorter operational retention. Retain only
   non-identifying counts and status/audit facts needed by policy.

### Config (AppConfig, no direct process.env)

`transport.requestCutoffHours` (12), `transport.arrivalBufferMinutes` (15),
`transport.stopServiceMinutes` (3), `transport.maxRideMinutes` (60),
`transport.locationPingSeconds` (10),
`transport.etaRefreshSeconds` (60), `transport.staleAfterSeconds` (45),
`transport.geofenceMeters` (75), `transport.purgeAfterDays` (30),
`integrations.googleMapsApiKey` (Cloud Run secret). Auto-accept, intake, and emergency
live-tracking gates: Statsig.

## Maps API: options and cost

Volumes assumed for v1 (one campus): ~20 requests/week, ~2 runs/week, 1-hour runs with a
60 s ETA refresh ⇒ per month: ~80 autocomplete/Place Details sessions, ~15 route
computations, ~500 ETA refreshes.

**Recommended: Google Maps Platform.** Verified against the published pricing table on
2026-09-02: monthly free usage caps are 10K calls for Essentials SKUs, 5K for Pro, and 1K
for Enterprise. Waypoint optimization is billed as Compute Routes Pro. The forecasted v1
volume is inside those caps, so incremental Maps spend is expected to be $0 if the shared
project has not already consumed them. A budget alert is visibility, not a hard cap: ship
per-user rate limits, project quotas where supported, monitoring by SKU, and an emergency
disable for new address/route computations. Re-check pricing before production because
SKU names, session billing, and rates can change.

**Maps data and presentation constraints.** Autocomplete and Place Details use one
session token and attribution as required. Google route, Places, or coordinate content is
rendered on a Google-provided basemap (force the Google provider rather than silently
falling back to Apple Maps), and required Google Maps attribution remains visible. Stored
Maps-derived address, coordinate, route, ETA, and polyline content is deleted or refreshed
within the applicable policy window; this design uses a maximum of 30 days. Public Terms
of Use and Privacy Policy disclose Google Maps Platform use before release.

Why Google over alternatives: the project already lives on GCP (`app-hccnj`); best NJ
geocoding; Places Autocomplete UX riders know; Routes waypoint optimization is exactly
"plot the best route". **Mapbox** (fine second choice, second vendor for zero savings),
**self-hosted OSRM/OpenRouteService** (free, but an ops burden for ~15 route calls a
month), **HERE** (weakest stack fit) were considered.

Non-Maps running costs: FCM is free; Firestore's incremental operations should remain
inside the project's published free quota at this scale, but that quota is shared with
the rest of the product and reconnects add reads; no Cloud SQL involvement. **The
feature's real cost is engineering time, dominated by the background-tracking and
live-map mobile work.**

## Mobile app reality check (verified against hccna-mono/apps/mobile, 2026-09-01)

- **Notification receive side is display-only today.** All three arrival paths
  (foreground listener, tap listener, cold-start `getLastNotificationResponseAsync`) in
  `src/hooks/utils/usePushNotifications.ts` converge on a toast showing title/body; no
  handler reads the `data` payload, navigates, or refetches. Data-only messages hit a
  placeholder `setBackgroundMessageHandler` in `src/entry.tsx`. The "tap → open
  transport screen" bridge is phase-1 mobile work.
- **Delivery itself works out of the box** — permissions, FCM token, Android `default`
  channel, registration via the replay-safe outbox are all live.
- **The client never writes Firestore**; all writes go through GraphQL. Driver location
  goes up via `reportDriverLocation`, keeping that invariant.
- **Realtime = `onSnapshot` on single docs only.** Both new subscriptions (own request
  projection, own live rider projection) are single-document reads by known ID — the
  existing shape — but the `useEventLive.ts` module singleton must become a keyed
  registry.
- **Firestore auth caveat**: GraphQL silently falls back to `signInAnonymously`; rules
  key on the real uid and transport UI requires full sign-in.
- **No security-rules or index file exists in either repo** — both are added to the
  backend repo in phase 1 and deployed via the Firebase CLI.
- **Maps and location are entirely absent**: no react-native-maps, no expo-location, no
  expo-task-manager, no Maps key config, no location permission strings, no background
  modes for location. A phase-1 native feasibility spike must validate iOS Always and
  Android background/foreground-service permission flows, termination behavior, Google
  provider rendering, and store disclosures on real devices. Phase 3 is a native release
  (config plugin like
  `plugins/withAndroidFcmDefaultChannel.js`, permission strings, `UIBackgroundModes`
  location, Android foreground-service-location declaration, testing against
  `useFrameworks: "static"`). Phases 1–2 are JS-only and ship OTA; the native release
  train starts during phase 2.
- **Offline outbox is push-token-specific**; transport mutations stay online-only in v1
  (ADR 0006's boundary). `requestTransport` being an idempotent upsert makes a later
  outbox admission straightforward.
- **Refetch conventions**: no pull-to-refresh or focus-refetch; user-scoped data polls
  every 60 s. Transport screens rely on the own-doc subscription instead; add any
  offline-visible query to the Relay retention allowlist.
- **Use an intake gate, not one kill switch.** Turning transport intake off blocks new
  requests and new plans, but riders can still read/cancel and an active run can still
  report, mark stops, and complete. A separate emergency live-tracking switch may stop
  new location collection without stranding request history.

## Build phases

1. **Request & approve** — Campus and Event-level Strapi Transport components; ACL
   provider + authorization service; `TransportRepository` (Firestore) with
   deterministic IDs and reopen
   semantics and Guest Rider idempotency; occurrence index; Places Autocomplete + Place
   Details, rate limits, and Maps key/quota guardrails; request / cancel / approve /
   decline / on-behalf / accept-late; minimal rider request projection; notification tap
   → route bridge; rules + indexes + emulator tests + deployment; awaited scheduler tick
   with expiry, deduplicated no-plan reminders, reconciliation, and purge; native
   location/maps feasibility spike. _Shippable: the ministry stops running a
   text-message list, and guests are in the same list as app users._
2. **Plan & schedule** — plan/confirm with Routes optimization, ride ceiling, replan
   policy, delay broadcast;
   re-check Maps SKU pricing. Start the native release train (background location, maps).
   _Shippable: riders get promised times they can trust not to move earlier._
3. **Live run** — background tracking task, navigation handoff, projections + rules,
   ETA refresh, geofence arrival, explicit pickup/no-show, staleness display, live map,
   arrival pushes.
   _Shippable: the Uber-style experience, one that survives the driver opening Waze._
4. **Later** — auto-accept flag on, return runs, multi-run UI, future-occurrence booking
   (needs recurrence range expansion), SMS for guests, uid-keyed coordinator ACL.

## Adversarial review log (v1 → v2)

| #   | Finding                                                  | Resolution in v2                                                           |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Foreground-only tracking dies when the driver opens Maps | Background location task + navigation handoff; staleness shown             |
| 2   | App-only riders exclude phone-in members                 | Guest Riders via `createTransportRequestOnBehalf` in phase 1               |
| 3   | Nothing fires if nobody plans the run                    | Scheduler tick: no-plan reminders, expiry, delay, reconciliation, purge    |
| 4   | Strapi ACL on every location ping                        | Two-tier auth; run-scoped commands authorize by run ownership              |
| 5   | "Times only get earlier" is the unsafe direction         | Replan policy: order preserved, never earlier after confirm                |
| 6   | Run fields on the request block return runs              | `stops/{requestId}` assignment subcollection                               |
| 7   | Unique index blocks re-request after cancel              | Deterministic doc ID with reopen semantics; idempotent upsert              |
| 8   | Two coordinators planning at once → duplicate runs       | Occurrence doc as transactional plan lock                                  |
| 9   | Occurrence identity is a computed timestamp with no ID   | Next-occurrence-only in v1; drift reconciliation + migrate-in-one-tap      |
| 10  | Pending-at-cutoff undefined; no late override            | Expire with push; `acceptLateRequest` + on-behalf allowed until departure  |
| 11  | No ride-length ceiling; silent early pickups             | `maxRideMinutes`, earliest-pickup shown before confirm; "running late"     |
| 12  | Widget depends on driver taps while driving              | v2 inferred pickups; v3 keeps inferred arrival but requires pickup/no-show |
| 13  | Push treated as the delivery channel                     | Own-doc `onSnapshot`; push is a nudge with a deep link                     |
| 14  | Apple relay emails never match Strapi                    | Visible mismatch hint on the coordinator screen; uid override later        |
| 15  | Home coordinates retained forever                        | `purgeAt` + tick scrubbing 30 days after the occurrence                    |
| 16  | Rules not in source control                              | `firestore.rules` + `firestore.indexes.json` in repo, phase 1              |
| 17  | "$0 Maps" unverified                                     | Verification task in phase 2 + GCP budget alert                            |

## Implementation-readiness review (v2 → v3)

| #   | Finding                                                            | Resolution in v3                                                                     |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 1   | Transport eligibility was implicit and could expose every event    | Event-level `Transport.Enabled` + `CampusSlug`; server resolves the destination      |
| 2   | Canonical request direct reads exposed unnecessary rider/audit PII | Minimal rider request projection; canonical transport documents are backend-only     |
| 3   | Phase 1 stored geocoded data but Maps began in phase 2             | Places Autocomplete + Place Details and quota guardrails moved to phase 1            |
| 4   | Guest retries could create duplicate requests                      | Coordinator UUID `clientRequestId` is a durable idempotency key                      |
| 5   | Detached scheduler work can stop after Cloud Run responds          | Await a bounded tick; checkpoint work; return failures for scheduler retry           |
| 6   | Reminder and notification retries could duplicate pushes           | Durable transition/milestone keys make notification dispatch idempotent              |
| 7   | Background-location permission assumptions were incorrect          | iOS Always + Android background permission/foreground service; phase-1 spike         |
| 8   | Geofence departure could falsely claim a rider was picked up       | Infer arrival only; pickup/no-show remains an explicit driver action                 |
| 9   | Client timestamps could rewind the visible driver position         | Server receive time + client capture time + monotonic sequence; reject stale data    |
| 10  | Route timing ignored dwell time and an API incompatibility         | Per-stop service time; `TRAFFIC_AWARE`; required optimized-index field mask          |
| 11  | Maps retention/attribution and basemap constraints were absent     | Google provider/attribution, policy disclosure, and complete Maps-data purge         |
| 12  | Firestore read estimate was ten times too high                     | ~3.6K projection writes and ~3.6K listener update reads per example run              |
| 13  | “Swap the store in one file” understated the public read contract  | Repository isolates backend access; projections, rules, migration, and mobile remain |
| 14  | One feature gate could strand active runs                          | Intake gate preserves reads, cancellations, and active-run completion                |
| 15  | Source-controlled rules lacked verification and deployment         | Emulator access tests and rules/index deployment are part of phase 1                 |

## Remaining design decisions

These affect the data model or safety behavior and should be resolved before their phase
is implemented:

1. **One run or multiple vehicles in v1.** The v2 occurrence document stores one run ID
   per direction and transactionally rejects a second, while decision #10 says many runs
   are supported. The smallest v1 is exactly one inbound Pickup Run per Event Occurrence,
   with a declared `seatCapacity` and an explicit overflow process. True multi-vehicle
   support instead needs an occurrence `runIds[]`/run collection, per-request assignment
   locking, and capacity enforcement across concurrent planners.
2. **Stable identity when an event time moves.** A request ID containing
   `occurrenceStartEpoch` cannot be “migrated in one tap” without copying the document and
   breaking an existing subscription/idempotency key. Recommended: materialize a stable
   internal `occurrenceId` the first time transport opens, keep `scheduledStart` mutable,
   and derive User request IDs from `uid + occurrenceId`.
3. **Separate intake state from run execution state.** Request-level `scheduled`,
   `picked_up`, `no_show`, and `completed` become ambiguous once inbound and return stops
   coexist. Recommended: the Transport Request owns only intake state (`requested |
   accepted | declined | expired | cancelled`); each Pickup Stop owns execution state,
   and rider projections compose the two.
4. **Driver handoff.** Run-owner authorization deliberately works during a Strapi outage,
   but it also prevents recovery if the assigned driver's phone/account becomes
   unavailable. Recommended: a coordinator-tier audited `reassignPickupRun` command,
   allowed before or during a run, with explicit notification to old and new owners.
5. **Eligibility changes after requests exist.** Recommended: disabling transport blocks
   new requests but never silently deletes accepted work. Reconciliation marks the
   occurrence `needsAttention`, notifies coordinators once, and requires an explicit
   decline or reassignment decision.

The Firestore storage choice plus direct mobile projections is hard to reverse and
surprising beside the wider Postgres migration. Once the remaining identity/run-model
choices are settled, capture it in an ADR with the rejected Postgres and Realtime Database
alternatives and the mobile contract consequences.

## Deferred items

- Guest Rider contact is phone-only in v1; SMS notifications are a later phase.
