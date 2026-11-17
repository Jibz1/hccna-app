# Secrets & untracked files bootstrap

A fresh clone of this repo builds nothing that needs credentials until you restore the
files below. None of them are ever committed — the root `.gitignore` enforces that.

## apps/mobile

| File | Purpose | Where it comes from |
|---|---|---|
| `GoogleService-Info.plist` | Firebase config (iOS) | Firebase console → HCCNA iOS app → download config |
| `google-services.json` | Firebase config (Android) | Firebase console → HCCNA Android app → download config |
| `prod.keystore` | Android release signing | EAS credentials service (`eas credentials`, platform Android) — or team password manager |
| `my-upload-key.keystore` | Android upload key | Same as above |
| `credentials/` | EAS local credentials (see `credentials.json` refs) | EAS credentials service |
| `.env`, `.env.production` | Release defaults and production overrides (API URLs, public keys), including the existing `MMKV_ENCRYPTION_KEY` (never change it) | Team password manager / the verified store-release environment |
| `.env.local`, `.env.production.local` | Developer-only overrides; excluded from release builds, OTA sync, and release hash generation | Developer's machine |
| `ios/`, `android/` | Native projects | Generated: `bunx expo prebuild` (not secret, just untracked) |

Set `APPLE_TEAM_ID` in `apps/mobile/.env` to the Apple Developer team ID used for
iOS signing (Apple Developer account → Membership details). Expo reads it as
`ios.appleTeamId`; when unset, the config leaves the team unspecified. Release
builds use `.env.production` over `.env` through the existing release loader.
The team ID is part of the runtime fingerprint, so it is also a recorded release
value.

The shared release loader reports the selected files and ignores developer-local
files and inherited update values. Store builds must go through the release
commands (`prebuild:release`, `ios:release`, `android:release`, `android:bundle`);
the app config refuses store bundles made with Expo's own `.env*.local` selection.
See [OTA updates](ota-updates.md).

`apps/mobile/ota-release.json` is a committed, non-secret record of the store
release: the existing storage-key hash, the hashes of the client-embedded update
values, and each platform's verified store runtime. Publishing refuses an unset
entry or a mismatch; this file is not generated from the OTA checkout.

**Preferred keystore source of truth: the EAS credentials service.** Run
`eas credentials` from `apps/mobile` to upload/inspect. Local keystore copies are then
only needed for non-EAS local release builds.

## apps/server

| File | Purpose | Where it comes from |
|---|---|---|
| `.env` | Local dev env (`DATABASE_URL`, `REDIS_URL`, `CASTR_*`, `CCB_*`, `SENDGRID_API_KEY`, `CMS_V5_ENDPOINT` and `CMS_V5_TOKEN` (see below), Firebase admin, …) | Team password manager / a teammate; production values live in the backend service's variables on the host. There's also a `.env.example`. Without it, `bun run dev` fails at startup with an Effect `ConfigError` naming the first missing variable. |

Local infra (Postgres/Redis) comes from `apps/server/docker-compose.yml`.

### Grafana dashboard and collector

The Grafana Alloy collector service references the backend's
`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` variables for ingestion, and
the Rust service's private domain for scraping. It needs no local credential file. See the
[collector setup](../apps/server/observability/alloy/README.md) for configuration and verification.

### CMS settings (Strapi 5)

The server reads only Strapi 5 and fails at startup without `CMS_V5_ENDPOINT` and `CMS_V5_TOKEN`,
locally too.

| Variable | Purpose | Where it comes from |
|---|---|---|
| `CMS_V5_ENDPOINT` | The CMS's GraphQL URL | Service variables on the host; local `.env` |
| `CMS_V5_TOKEN` (secret) | Read-only custom API token: `find`/`findOne` on the 13 content types the server reads (app-config, home, campus, leader-ship, event, sermon, sermon-page, tog, stream, check-in-permission, kids-checkin, department, ministry), plus upload `find` if media come back empty | Strapi 5 admin → Settings → API Tokens; store in Railway variables and the local `.env` |
| `CMS_WEBHOOK_SECRET` (secret) | The secret the Strapi 5 CMS sends in the `x-cms-webhook-secret` header on `cmsWebhookUpdate` notices with `cmsVersion: V5` ([CMS change notices](cms-change-notices.md)) | Generate (`openssl rand -hex 32`); store it in Railway's backend variables and in the Strapi 5 CMS's environment |

### Shorts feed (YouTube)

The `shorts` query lists YouTube Shorts through the YouTube Data API v3. Neither variable is
required to start the server: without the key the query returns an empty list and the server
logs one warning at startup.

| Variable | Purpose | Where it comes from |
|---|---|---|
| `YOUTUBE_API_KEY` (secret) | YouTube Data API v3 key the server uses to list Shorts and check that each can play inside the app. Create a key for this alone and restrict it to "YouTube Data API v3"; a key restricted to other APIs is rejected with `API_KEY_SERVICE_BLOCKED` | Google Cloud console → APIs and services → Credentials (the API itself must be enabled on that project); store it in the Railway service variables and the local `.env` |
| `SHORTS_DEFAULT_CHANNEL` | Optional, not a secret. The channel that is always in the feed, as a handle (`@name`), a youtube.com channel URL, or a channel id (`UC…`). Unset, or set to something that is not a channel, means the church's own channel, `@hgccnj` | Railway service variables, only when the default should change |

## CI (GitHub repo settings)

| Secret/Var | Used by |
|---|---|
| `TURBO_TOKEN` (secret), `TURBO_TEAM` (variable) | turbo remote cache in `checks.yml` |

