# HCCNA v2 Mobile App — Design Spec

**Date:** 2026-07-04
**Status:** Approved (pending final review)
**Author:** Brainstormed with Claude; decisions by Godwin

## 1. Summary

HCCNA v2 is a new, standalone Expo React Native app that replaces the v1 app
(`HCCNA-MONO/mobile-app/hccna`). It keeps full feature parity with v1, ships
light/dark theming, adds backend-synced offline-first user preferences, and
introduces a Slack-style chat system powered by Firestore with channels derived
from the church's org structure (campus, department, ministry, small group)
plus direct messages and emoji reactions.

The existing Bun backend (`HCCNA-Project/backend`, deployed at
`https://api.hccnj.org`) remains the single API. It gets two small extensions:
a preferences column on `app_users` and a chat-provisioning service that
projects org membership into Firestore. No realtime/WebSocket layer is added to
the backend — Firestore carries all realtime traffic.

## 2. Decisions log

| Decision             | Choice                                                                                                                      | Alternatives considered                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Chat transport       | Firestore (realtime listeners + offline persistence)                                                                        | Extend backend with GraphQL subscriptions + Redis pub/sub; managed service (Stream/Sendbird) |
| Data layer           | Relay-centered: Relay 21 with MMKV store persistence; SignalDB and TanStack Query dropped                                   | Keep v1 four-layer stack; TanStack-first                                                     |
| Chat launch scope    | Channels + DMs + reactions (threads/typing/presence deferred)                                                               | Channels only; full Slack parity                                                             |
| Project home         | Fresh standalone repo                                                                                                       | Sibling folder in mobile-app repo; revive appV2-tanstack clone                               |
| Preferences storage  | Backend Postgres via extended `updateProfile` mutation with `updatedAt` LWW + local MMKV offline layer                      | Firestore user doc; device-only                                                              |
| Channel provisioning | Backend writes Firestore via Admin SDK + nightly reconcile                                                                  | Cloud Functions sync layer; Firebase custom claims                                           |
| Visual design        | Evolve v1 purple light/dark token system per PRD-REDESIGN goals                                                             | Follow hccna-v2 Figma playground; defer design                                               |
| Tab layout           | Home / Events / Chat / Give / More — Chat replaces Sermons tab; Sermons becomes a stack screen reachable from Home and More | Keep 5 v1 tabs with Chat elsewhere; six tabs                                                 |

## 3. Goals and non-goals

### Goals

- Feature parity with v1 (section 6 checklist).
- Light/dark/system theming applied before first paint.
- User preferences (theme, campus, notification toggles, muted channels,
  followed groups) that survive reinstalls, sync across devices, and work
  offline.
- Slack-style chat: auto-provisioned org channels, DMs, reactions, unread
  badges, image attachments, push notifications, and the moderation controls
  Apple requires for user-generated content.
- Fix v1's documented startup problem: first frame renders from local cache,
  never blocked on network, Firestore doc waits, Statsig, or push registration.

### Non-goals (launch)

- Threads, typing indicators, presence, read receipts UI, message search,
  user-created channels (schema leaves room; see 9.7).
- In-app payments / saved cards (giving remains Pushpay links + history, as v1).
- Web as a first-class target.
- Migrating v1 users' device-local preferences (users re-pick on first run).

## 4. Tech stack

| Layer         | Choice                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Platform      | Expo SDK 56+ (latest stable at kickoff), Expo Router, React 19, TypeScript                                     |
| GraphQL       | Relay 21, store persistence to MMKV (serialize RecordSource; hydrate before first query)                       |
| Chat/realtime | `@react-native-firebase/firestore` with offline persistence enabled                                            |
| Services      | Effect-TS services: Auth, GraphQL network, Preferences, Chat, Startup (ported/adapted from v1's `src/effect/`) |
| UI state      | Jotai                                                                                                          |
| Styling       | UniWind + Tailwind CSS v4; v1 purple token system ported                                                       |
| Storage       | MMKV (encrypted); expo-secure-store for tokens                                                                 |
| Auth          | Firebase Auth: Apple, Google, email (same providers as v1)                                                     |
| Push          | Expo Notifications + FCM                                                                                       |
| REST          | Plain fetch via Effect for the two REST endpoints (`POST /v1/gbp` onboarding, attendance-export download)      |
| Observability | Sentry, Statsig (feature flags), Firebase Analytics                                                            |
| Tooling       | Bun, Oxlint, Oxfmt, Vitest                                                                                     |

Dropped relative to v1: SignalDB, TanStack Query, Legend State.

## 5. Repository and project structure

New standalone repo (working name `hccna-v2`; suggested local path
`~/Documents/Dev/Projects/HCCNA-Project/hccna-v2-app`, beside the backend).

```
hccna-v2/
  src/
    app/            # Expo Router: (tabs)/{index,events,chat,give,more}.tsx + modals
    features/       # home/ events/ sermons/ giving/ chat/ preferences/ profile/ auth/
    ui/             # ported v1 primitives (~36 components) + chat UI components
    icons/          # ported v1 SVG icons (~67)
    effect/         # AuthService, GraphQLNetworkService, PreferencesService,
                    # ChatService, AppStartupService
    relay/          # environment, MMKV persistence, generated artifacts
    utils/          # mmkv, constants, theme helpers
  firebase/         # firestore.rules, firestore.indexes.json
  functions/        # chat push fan-out Cloud Function (single function)
  assets/           # ported from v1
```

Porting strategy: assets, icons, UI primitives, theme tokens, and Relay
fragments are copied from v1 and adapted — the fresh repo does not mean
rebuilding the design system from zero.

## 6. Feature parity checklist

Every item below exists in v1 and must exist in v2 at launch.

| Feature                                                                                                                              | v2 location                                                     | Notes                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------- |
| Home: featured events carousel, word of the day, verse of the day, latest sermons, upcoming events, campus locations, Thought of God | Home tab                                                        | Layout refreshed per PRD (less stacking), same content        |
| Events: week selector, featured + latest lists, event detail, external registration links                                            | Events tab                                                      |                                                               |
| QR check-in + attendance recording (`recordEventAttendance`, bulk)                                                                   | Events → check-in modal                                         | Coordinator-scoped                                            |
| Attendance PDF/CSV export                                                                                                            | Events / More                                                   | Uses existing REST download endpoint                          |
| Sermons list + YouTube playback + VOD detail                                                                                         | Sermons stack screen (entry: Home "Latest Sermons" + More menu) | Tab slot goes to Chat                                         |
| Live stream (Castr)                                                                                                                  | Home / Sermons stack                                            |                                                               |
| Giving: Pushpay links, my-giving summary, 5-year history, yearly tax export, House of Stars, other-campus giving                     | Give tab                                                        | External links as v1                                          |
| Auth: Apple, Google, email; sign-out; delete account                                                                                 | Auth flow + More                                                |                                                               |
| Profile: view/edit name, phone, avatar; campus display                                                                               | More tab                                                        |                                                               |
| CCB forms + dynamic menu links (CoreData-driven)                                                                                     | More tab                                                        |                                                               |
| Campus selector/info                                                                                                                 | Campus modal                                                    | Selection persists to preferences                             |
| Word of Activation (monthly) + verse of the day                                                                                      | Home                                                            |                                                               |
| Push notifications                                                                                                                   | Global                                                          | Registration deferred post-interactive                        |
| Preferences UI (theme, notifications)                                                                                                | More → Preferences                                              | Now backend-synced (section 8)                                |
| Offline behavior                                                                                                                     | Global                                                          | Relay MMKV hydration + Firestore persistence replace SignalDB |
| Analytics/flags/errors: Firebase Analytics, Statsig, Sentry                                                                          | Global                                                          | Init deferred post-first-paint                                |

New in v2: Chat tab (section 9), server-synced preferences (section 8).

## 7. Navigation

Native bottom tabs: **Home / Events / Chat / Give / More**.

Modals and stacks carried from v1: event detail, YouTube player, VOD detail,
check-in, campus, Thought of God, live stream, edit profile, delete-account
confirmation, yearly giving, attendance export, preferences, account stack.
New: Sermons stack; chat channel screen; DM screen; new-DM user picker; chat
settings (mute/report/block) sheets.

Push notifications deep-link via Expo Router (e.g. `hccna://chat/{channelId}`).

## 8. User preferences

### 8.1 Backend

- `app_users` gains `preferences jsonb` and `preferences_updated_at timestamptz`.
- `updateProfile` mutation input gains optional `preferences: JSON` and
  `preferencesUpdatedAt: DateTime`.
- Last-write-wins: the server replaces stored preferences only when the
  incoming `preferencesUpdatedAt` is newer than the stored value; response
  returns the winning document so a stale client converges immediately.
- The profile query returns `preferences` + `preferencesUpdatedAt`.

### 8.2 App

`PreferencesService` (Effect):

- **Read:** always from MMKV; hydrated from the profile query when fresher.
- **Write:** update MMKV synchronously (UI reacts instantly), stamp
  `updatedAt = now`, enqueue a sync job.
- **Sync:** queue flushes on startup, on reconnect, and after each write when
  online, calling `updateProfile`. Retries with backoff; failures never block UI.
- **Schema:** Zod-validated, versioned:

```ts
{
  version: 1,
  theme: "light" | "dark" | "system",
  campusId: string | null,
  notifications: { announcements: boolean, events: boolean, chat: boolean, woa: boolean },
  mutedChannelIds: string[],
  followedGroupIds: string[],
}
```

Unknown fields are preserved round-trip so older clients don't wipe newer
clients' settings.

## 9. Chat system

### 9.1 Firestore data model

```
channels/{channelId}
  type: "campus" | "department" | "ministry" | "group" | "dm" | "custom"
  name: string                  # e.g. "Newark Campus", "Ushering"
  photoURL?: string
  orgRef?: { kind: string, backendId: string }   # link to Postgres/CCB entity
  memberCount: number
  lastMessage?: { text, senderId, senderName, sentAt }   # denormalized preview
  createdAt, updatedAt

channels/{channelId}/members/{uid}
  uid: string                   # duplicated for collection-group queries
  role: "member" | "moderator"
  joinedAt, muted: boolean, lastReadAt: timestamp

channels/{channelId}/messages/{messageId}
  senderId, senderName, senderPhotoURL      # denormalized; no join on render
  text: string
  imageURL?: string             # Firebase Storage upload
  reactions: { [emoji: string]: uid[] }
  createdAt, editedAt?, deletedAt?          # soft delete → "message removed"

users/{uid}                     # existing doc, extended
  blockedUids: string[]
  pushTokens/{tokenId}: { token, platform, updatedAt }

reports/{reportId}
  messageId, channelId, reportedUid, reporterUid, reason, createdAt, status
```

DM channel IDs are deterministic: `dm_{minUid}_{maxUid}` — creating a DM is an
idempotent upsert, no duplicate-conversation checks needed.

### 9.2 Channel provisioning (backend-owned)

New Effect service in the Bun backend, `ChatProvisioningService`, modeled on
the AttendanceExportService exemplar pattern:

- **Triggers:** `updateProfile` campus change; department/ministry membership
  changes; CCB group sync runs.
- **Action:** upsert `channels/{id}` and `channels/{id}/members/{uid}` docs via
  Firebase Admin SDK (bypasses security rules).
- **Reconcile:** nightly job diffs Postgres/CCB truth against Firestore
  membership and repairs drift. Firestore membership is a rebuildable
  projection, never the source of truth.
- **Preference mirror:** when `updateProfile` changes the chat-notification
  toggle, the service also writes `chatNotificationsEnabled` onto
  `users/{uid}` — the push Cloud Function reads Firestore only and cannot see
  Postgres preferences.

### 9.3 Client behavior

- **Channel list:** collection-group query `members` where `uid == me` to
  discover memberships, then subscribe to those channel docs; sorted
  client-side by `lastMessage.sentAt` (collection-group queries cannot order by
  parent-document fields).
- **Messages:** paginated listener (last 50, `limitToLast` + older-page fetch).
- **Send:** Firestore write with offline queueing; pending messages render in a
  "sending" state; sender info denormalized onto the message at write time.
- **Reactions:** transactional `arrayUnion`/`arrayRemove` on the emoji map.
- **Unread:** channel badge when `lastMessage.sentAt > members.lastReadAt`;
  per-channel counts via Firestore `count()` aggregation; `lastReadAt` written
  on channel open/scroll-to-bottom.
- **Images:** upload to Firebase Storage under `chat/{channelId}/`, then send
  message with `imageURL`.

### 9.4 Security rules (shape)

- Read channel/messages/members: requires `channels/{id}/members/{myUid}` to exist.
- Create message: member only; `senderId == auth.uid`; text length capped.
- Edit/delete message: sender (soft delete), or channel moderator.
- Reactions: members may update only the `reactions` field of a message.
- Create channel: clients may create only `type == "dm"` docs whose ID matches
  the deterministic pattern containing their own uid, and only if neither party
  blocks the other. All other channel creation is Admin-SDK-only.
- `lastReadAt`/`muted`: a member may update only their own member doc.
- Reports: create-only for authenticated users.

Rules are tested against the Firestore emulator (section 13).

### 9.5 Push notifications

One Cloud Function (`onDocumentCreated` on `messages`) fans out FCM to channel
members, excluding the sender, members with `muted == true`, and users with
`chatNotificationsEnabled == false` on their Firestore user doc (mirrored from
Postgres preferences by the provisioning service, see 9.2). Payload deep-links
to the channel.
Token registry lives in `users/{uid}/pushTokens`.

### 9.6 Moderation & App Store compliance (launch-blocking)

Apple guideline 1.2 requires for UGC: report content (→ `reports` collection),
block users (client-side filtering + DM rules), delete own messages, moderator
deletion, and terms-of-use acceptance on first chat use. All five ship at launch.

### 9.7 Deferred (schema-compatible)

Threads (`replyTo` field reserved), typing indicators, presence, read receipts
UI, search, user-created `custom` channels. None require schema migration.

## 10. Theming

- Port v1 `purple-light` / `purple-dark` CSS variables into Tailwind v4
  `@theme` blocks; components use semantic tokens only (`bg-surface`,
  `text-primary`, ...).
- Mode `light | dark | system` from preferences; MMKV-cached and applied at the
  root layout before first paint; system mode follows `Appearance` changes live.
- Navigation (tabs, headers) and chat UI consume the same tokens.

## 11. Auth and startup

Auth flow ported from v1's Effect AuthService: provider sign-in → Firebase →
`POST /v1/gbp` onboarding → profile query. Startup order fixes v1's documented
blocking problem:

1. First frame renders immediately from MMKV (theme, hydrated Relay store).
2. Auth state restores in background; signed-out users see the auth flow.
3. Statsig, Sentry, Analytics, push-token registration all initialize
   post-interactive.
4. No Firestore user-doc wait on the render path.

## 12. Backend change list (complete)

1. `preferences jsonb` + `preferences_updated_at` on `app_users`; extend
   `updateProfile` mutation and profile query (LWW semantics per 8.1).
2. `ChatProvisioningService` + nightly reconcile + chat-notification
   preference mirror to Firestore (9.2).
3. Nothing else: no GraphQL subscriptions, no new REST routes, no schema
   changes to existing types.

## 13. Error handling and testing

- Effect tagged errors across services; Relay error boundaries per route;
  preference sync retries silently with backoff; chat send failures surface a
  retry affordance (Firestore offline queue handles transport).
- **Vitest (app):** PreferencesService LWW/merge logic, chat helpers (DM id,
  unread computation), theme mapping.
- **Firestore rules tests** (`@firebase/rules-unit-testing` + emulator):
  membership gating, DM creation constraints, reaction-only updates, blocked
  users — the highest-value test surface since rules are the chat
  authorization layer.
- **Vitest (backend):** ChatProvisioningService upsert/reconcile, preferences
  LWW.
- **Relay component tests** with `relay-test-utils` for key screens.
- Manual smoke matrix (iOS/Android, light/dark, offline) before store submission.

## 14. Rollout sketch

1. **Phase 0 — Foundation:** repo scaffold, CI/EAS, tokens/theming, auth, Relay
   environment with persistence.
2. **Phase 1 — Parity:** port tabs/screens/modals from v1 (section 6 checklist).
3. **Phase 2 — Preferences:** backend column + mutation extension, PreferencesService.
4. **Phase 3 — Chat:** backend provisioning, rules, Cloud Function, chat UI.
5. **Phase 4 — Hardening:** rules/emulator tests, perf pass, beta (TestFlight /
   internal track), store review prep (UGC compliance), launch.

Detailed task breakdown lives in the implementation plan (separate document).

## 15. Risks

| Risk                                                | Mitigation                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Firestore chat costs grow with reads                | Denormalized `lastMessage` avoids N-message reads for the channel list; pagination caps listeners; `count()` aggregation instead of full scans |
| Membership drift between Postgres/CCB and Firestore | Nightly reconcile; Firestore is a rebuildable projection                                                                                       |
| Apple UGC rejection                                 | Moderation set (9.6) is launch-blocking scope, not a fast-follow                                                                               |
| Relay persistence is new territory for the team     | v1 already contains the (unused) persistence code as a starting point; fallback is cold-start fetch, not data loss                             |
| Two writers to Firestore (clients + backend Admin)  | Rules constrain clients to messages/reactions/member-self fields and DM creation only; everything else is Admin-only                           |

## 16. Review addendum (2026-07-05)

The direction remains approved, but the implementation plan must treat the
following as required amendments before the design is considered fully scoped.

### 16.1 Backend and membership source

- Section 12 is not complete until `ChatProvisioningService` defines the exact
  source of truth for campus, department, ministry, and small-group membership,
  including initial backfill, nightly reconcile behavior, member removal,
  moderator assignment, retry policy, and operational alerts.
- The current backend has Postgres `app_users`, `user_departments`, and
  `user_ministries` tables, but profile reads do not yet expose a reliable
  membership graph for chat. Chat provisioning must read from the backend/CCB
  truth directly, not from the current mobile profile shape.
- Keep the existing Firestore user document path `app-users/{uid}` unless a
  migration explicitly renames it. Do not introduce a parallel `users/{uid}`
  tree for chat metadata without a migration and compatibility plan.

### 16.2 Preferences conflict handling

- Replace client-clock LWW (`updatedAt = now`) with a server-issued monotonic
  revision or server timestamp token. Client writes should include the base
  revision they edited from, and the server should return the winning
  preferences document plus its new revision.
- Unknown preference fields must be preserved explicitly. The schema layer
  should either allow passthrough fields or merge validated known fields back
  into the raw stored JSON before saving, so older clients cannot erase newer
  clients' settings.
- If different preference groups can be edited independently, prefer per-field
  or per-section merge semantics over replacing the whole JSON document.

### 16.3 Firestore and Storage security

- Blocking must apply to existing DMs, not only DM creation. When either party
  blocks the other, rules and push fan-out must deny DM reads, message writes,
  and notifications for that thread.
- Add Firebase Storage rules for chat images under `chat/{channelId}/`. Uploads
  and reads must require authenticated channel membership, enforce image content
  types and size limits, and define who can delete uploaded media.
- Field-level Firestore rules must be tested for message updates, reactions,
  `lastReadAt`, `muted`, reports, block lists, and moderator deletes. Rules
  should use allowlists for changed fields so clients cannot mutate Admin-owned
  fields such as `memberCount`, `lastMessage`, roles, or channel metadata.

### 16.4 Chat data model refinements

- Do not store reactions as unbounded UID arrays on the message document.
  Prefer reaction subdocuments or per-emoji aggregate docs with counts, plus a
  per-user reaction marker when the UI needs to know whether the current user
  reacted. This avoids hot document writes and Firestore document-size risk.
- Decide whether `lastMessage` is written by the sender client under strict
  rules or by a trusted backend/Cloud Function. The rules and offline behavior
  differ materially.
- Validate unread-count strategy before launch. `count()` aggregations may be
  acceptable for channel detail, but channel-list badges should avoid expensive
  per-channel work on every app open.

### 16.5 App Store UGC compliance

- The launch-blocking moderation set must include all Guideline 1.2 items:
  objectionable-content filtering, report flow, user blocking, published
  contact information, timely report response, and clear terms/community
  standards acceptance before first chat use.
- Add an admin/moderator operating path for report review, message removal, and
  abusive-user action. A `reports` collection alone is not enough for review.

### 16.6 Phase gates

- Phase 0 must prove Relay persistence is real by wiring the MMKV-backed record
  source into the live Relay environment and verifying first render from local
  data on cold start.
- Phase 3 must include Firestore emulator tests, Storage rules tests, push
  fan-out tests, and a dry-run path for membership backfill/reconcile before
  chat is enabled for production users.
- Before implementation starts, add language tags to fenced code blocks in this
  document to keep markdown lint clean.
