# OTA updates (EAS Update)

Store builds are made locally (Xcode and Gradle). EAS is used only for
over-the-air updates, which replace the JavaScript bundle and assets of an
installed build. The Free plan includes unlimited publishes, 1,000 monthly
active users (an install that downloads at least one update in a calendar
month), 100 GiB of bandwidth, and 20 GiB of storage. See [Expo pricing](https://expo.dev/pricing)
for current limits.

## How it fits together

- `apps/mobile/app.config.ts` points `expo-updates` at the project's EAS URL
  and sends the `production` channel header. Local builds send it themselves;
  EAS Build replaces it with each `eas.json` profile's channel, so preview and
  development builds never receive production updates.
- The runtime version uses the `fingerprint` policy: a hash of everything that
  reaches the native build. An update installs only on builds with the same
  hash, so an update can never run on native code it does not match.
  `apps/mobile/fingerprint.config.js` leaves out the Expo `extra` section and
  `package.json` scripts, which differ between machines or never reach the
  native build.
- Store builds, env sync, and baseline generation share `scripts/releaseEnv.ts`.
  It loads only `apps/mobile/.env.production` over `apps/mobile/.env`, reports
  loaded filenames on stderr, and ignores `.env.local`, `.env.production.local`,
  and inherited update values (including during variable expansion). Expo's
  subsequent dotenv loading is disabled. Put verified production overrides in
  `.env.production`; both release files are gitignored.
- Expo's own `.env` selection includes developer-local files, so the app config
  refuses to make a store bundle (`expo export:embed --dev false`, which Xcode and
  Gradle run for Release builds) unless the release loader set up the environment.
  EAS Build workers are exempt.
- Every store build since 1.1.3 encrypts local storage with the
  `MMKV_ENCRYPTION_KEY` from `.env`. Never change that key. A build or update
  with a different key cannot read the stores users already have.
- `apps/mobile/ota-release.json` is the reviewed record of the store release:
  - `mmkvKeySha256` pins the key hash, verified from archived iOS releases 1.1.3
    through 2.0.1. Release builds, sync, hash generation, and publishing all
    enforce it, and the app config enforces it whenever EAS marks the key required.
    Key rotation requires a separate storage migration.
  - `updateValuesSha256` records the SHA-256 of `MMKV_ENCRYPTION_KEY`,
    `APPLE_TEAM_ID`, and every `EXPO_PUBLIC_*` value the store build used. They
    are client-embedded or public values, so the hashes are not secret.
    Publishing compares EAS against this record, and `--sync-env` refuses local
    values that differ from it. `APPLE_TEAM_ID` only sets `ios.appleTeamId`, but
    the app config is part of the runtime fingerprint: if EAS lacks it, both
    platforms resolve a different runtime than the store builds.
  - `runtimeVersions` records each platform's verified store runtime. The
    publisher resolves the selected platforms offline using
    `expo-updates runtimeversion:resolve` inside the EAS production environment,
    then compares them before publishing.

  Unset or different entries block publishing. They start as `null`: no
  OTA-enabled store build has been verified yet.
- The EAS `production` environment also holds `MMKV_ENCRYPTION_KEY_REQUIRED=true`.
  `eas update` evaluates the app config with the EAS values, so this makes the
  published config itself reject a missing key or one that differs from the pin,
  even if EAS changes after the publisher's check.

## Versioning

Versions read `MAJOR.STORE.OTA`. Store releases are `X.Y.0`; OTA updates on top
of a store release are `X.Y.1`, `X.Y.2`, and so on, restarting at `.1` after
each store release.

- `apps/mobile/native-version.js` holds the store version and the Android
  `versionCode`. It is generated: change it only with
  `bun run version:bump store` (`2.0.1` → `2.1.0`) or
  `bun run version:bump major` (`2.4.0` → `3.0.0`). Both raise the
  `versionCode` by one. iOS keeps build number 1.
- The **prepare mobile store release** workflow (Actions, run from `main`) runs
  the mobile checks, then runs `version:bump` with the number you choose
  (`store` or `major`) and opens a `release/mobile-<version>` PR. It needs
  **Settings → Actions → General → "Allow GitHub Actions to create and approve
  pull requests"**. GitHub does not run checks on that PR; the workflow's own
  test job is the check.
- A store release goes: bump the version (the workflow, or
  `bun run version:bump store` in a PR), merge that PR, build iOS
  (`bun run prebuild:release`, then archive in Xcode) and Android
  (`bun run generate--android-native-build`, then `bun run android:bundle`) from
  the merged commit, then record the runtimes in `ota-release.json`. After the
  PR merges and before those runtimes are recorded, a version-only `main` still
  publishes OTAs numbered for the next store version (for example 2.2.1) to
  current 2.1.0 binaries, so record the new runtimes when the builds are
  submitted.
- Version numbers are not part of the runtime. A store release that only changes
  the version keeps the previous runtime.
- `expo prebuild` copies the numbers into `android/app/build.gradle` and
  `ios/HCCNA/Info.plist`. `android:bundle` and Xcode Release builds stop when
  those copies differ from `native-version.js`; rerun
  `generate--android-native-build` or `prebuild:release`.
- OTA numbers are never committed. `update:publish` reads the `X.Y.N · ` prefix
  of past update messages on EAS, ignores rollbacks and messages without a
  prefix, and publishes the next number as `X.Y.N · <message>`. The update's
  config carries that version: More → App, Statsig, and the Sentry `ota_version`
  tag show it. iOS, Android, the stores, force update, What's New, and the
  server's `x-hccna-app-version` header keep the store version. Because Statsig
  `appVersion` now carries OTA numbers (2.1.3), rules that target one store
  version should use a range (for example `>= 2.1.0` and `< 2.2.0`), not an
  exact match.
- Do not publish locally while a deploy workflow runs: both could pick the same
  number.
- Pull requests that change native code get a **mobile fingerprint** warning:
  they need a store release, not an OTA update.

## One-time setup

Run these from `apps/mobile`.

1. Install EAS CLI 24.12.0 or later (`npm install -g eas-cli@24.12.0`, the
   version CI uses; `eas.json` rejects older versions) and confirm `eas whoami`
   shows the `hccna` account.
2. Confirm `eas channel:view production` points to the `production` branch.
   Create it with `eas channel:create production` if it does not exist.
3. Restore the verified release values into `.env` and, if needed,
   `.env.production`. Review overrides that previously lived in `.env.local`
   before moving them into the release file set.
4. Build, test, and record the OTA-enabled store release as described below.
   Installs of 2.0.1 and earlier have updates disabled and never receive one.
5. Copy the recorded values to EAS: `bun run update:publish -- --sync-env`. It
   first checks the local key against the pin and the local values against
   `updateValuesSha256`, then reads EAS. An existing different EAS key stops
   **all** writes; an existing matching key is left untouched. A missing key is
   created without `--force`, so an unreadable secret or a concurrently created
   project key cannot be overwritten. Public values are updated with `--force`
   and get **sensitive** visibility. Do not use the "secret" visibility, because
   `eas update` cannot read secret variables. The command copies only update
   values, never the keystore passwords or `SENTRY_AUTH_TOKEN`, and finally sets
   `MMKV_ENCRYPTION_KEY_REQUIRED=true` with plaintext visibility. EAS values that
   are not in the record are not deleted; the publisher reports them, and you
   remove them with `eas env:delete`.

## Building a store release

Always build store releases through the release commands, from `apps/mobile`:

- iOS: run `bun run prebuild:release`, then archive in Xcode as usual. The
  command writes a block to the generated `ios/.xcode.env.local`, which every
  React Native and Expo build phase sources. In Release configurations it runs
  the release loader at build time, so the archive uses the release files and
  fails if the key no longer matches the pin. Run `prebuild:release` again after
  any other `expo prebuild`. `bun run ios:release -- --device` builds and installs
  a Release directly.
- Android: run `bun run generate--android-native-build`, which prebuilds Android
  from the same release files as `prebuild:release` and adds release signing,
  then `bun run android:bundle` for the Play Store bundle. It runs
  `./gradlew bundleRelease` with the release environment.
  `bun run android:release -- --device` builds and installs a Release directly.

Release builds started any other way, such as from Android Studio, plain
`expo run:ios --configuration Release`, or Xcode after a plain `expo prebuild`,
fail with "Store bundles must use the release environment".

## Recording a store release

Preserve the exact release commit, Firebase files, env files, and built artifacts.
Then record the release in `apps/mobile/ota-release.json`, commit it, and merge
the change after review. A platform may remain `null` until its build is ready.

1. Generate the environment record from the same release files:
   `bun run update:publish -- --print-local-env-hashes`. Put the printed object in
   `updateValuesSha256`. Both platforms' store builds must use these values.
2. Read each runtime from the built artifact. With the fingerprint policy,
   `EXUpdatesRuntimeVersion` and `expo_runtime_version` only hold the placeholder
   `file:fingerprint`; the runtime is in a `fingerprint` file:

   ```bash
   cat "<archive>.xcarchive/Products/Applications/HCCNA.app/EXUpdates.bundle/fingerprint"
   ```

   ```bash
   unzip -p android/app/build/outputs/bundle/release/app-release.aab base/assets/fingerprint
   ```

   For an APK, read `assets/fingerprint` instead. Put each value in the
   corresponding `runtimeVersions` entry. The two platforms can have different
   runtimes.

The offline resolver shows what a checkout would target:

```bash
npx --no-install expo-updates runtimeversion:resolve --platform ios
npx --no-install expo-updates runtimeversion:resolve --platform android
```

Its `runtimeVersion` must equal the artifact's `fingerprint` before you record a
release. Do not copy the runtime of a failing OTA checkout into the record to make
it pass. A runtime mismatch requires a store build, or reverting the native drift.
Keep `mmkvKeySha256` unchanged when recording a new release.

## Test before the first OTA-capable release

1. Build a Release from the release commit and install it on a device, for
   example `bun run ios:release -- --device` or `bun run android:release -- --device`.
   These commands load the explicit release files before Expo reads the config
   and set `EAS_BUILD_PROFILE=production`, so a missing or changed key fails before
   building. Open the installed Release once. Record its environment and runtime
   in `ota-release.json` on the test branch, and run `--sync-env`, before
   attempting the OTA test.

   `--device` takes a device or emulator (AVD) name. Simulators, emulators, and
   phones built from the same commit share a runtime. On Android, a local Release
   is signed with the debug key: it updates a sideloaded debug-signed build in
   place, keeping its data, but cannot replace a Play Store install without
   uninstalling it first, which clears the device's local data.
2. Make a visible JavaScript-only change, commit it on a scratch branch, and run
   `bun run update:publish -- --message "OTA test" --platform ios` (or `android`).
3. Force-quit and reopen the app. Once the update downloads, the app offers
   **Restart now**; take it and confirm the change. Force-quit and reopen once
   more to confirm the update persists. Check that stored data survived: you are
   still signed in, and saved verses and the theme are intact.
4. Roll each platform back to its embedded bundle, using the runtime versions
   printed by the test publish, so store installs launch their own bundle:
   `eas update:roll-back-to-embedded --channel production --platform ios --runtime-version <ios runtime>`,
   then the same for `android`.

## Publishing an update

1. Keep the change to JavaScript and assets. Commit it so the deployed change
   has an identifiable revision.
2. Run `bun run update:publish -- --message "Fix event times"` from
   `apps/mobile`. Add `--platform ios` or `--platform android` to target one
   platform. The script checks EAS against `ota-release.json` (values, pinned key,
   key requirement, and selected store runtimes), then runs
   `eas update --channel production --environment production`, and uploads
   the source maps to Sentry. Publishing does not read local `.env` files.

If the source-map upload fails, the update is already live and the command still
succeeds with a warning. Do not publish again; upload `dist` with
`npx sentry-expo-upload-sourcemaps dist` while it still exists.

Installed apps check on every launch without waiting. When a new update finishes
downloading, `OtaUpdatePrompt` offers to restart into it, in the same layout as
the soft store-update prompt. Choosing **Later** (or ignoring it) applies the
update on the next cold start. A required store update takes precedence, and
rollbacks apply silently on the next launch. `eas update:insights` shows launches,
crashes, and unique users per update.

To check setup without publishing, run `bun run update:publish -- --check`. Add
`--platform ios` or `--platform android` to check one platform. `--check` works
anywhere between options; flag-looking message values remain literal. Supported
EAS options are `--message`/`-m`, `--platform`/`-p`, `--non-interactive`, and
`--clear-cache`. Options that change the channel, environment, or bundle input
are rejected so they cannot bypass the checked export.

## Deploying from GitHub Actions

The **deploy mobile update** workflow runs manually from
**Actions → deploy mobile update → Run workflow**. Select `main`, enter the
release message (not needed for check only), and choose `all`, `ios`, or
`android`. Choose **check only** to see the next OTA version and verify EAS
without publishing; the version appears in the run summary. The workflow runs
checks for mobile and its workspace dependencies (reusing the Turbo remote
cache), validates EAS against the committed `ota-release.json` in one preflight,
publishes the update, and uploads source maps. Production publishes run one at a
time. With check only, it stops after the EAS check and publishes nothing.

Create a GitHub environment named `mobile-production` with these secrets:

| Secret | Source |
|---|---|
| `EXPO_TOKEN` | An Expo access token with access to `@hccna/hccna`; create it in [Expo access-token settings](https://expo.dev/settings/access-tokens) |
| `MOBILE_GOOGLE_SERVICES_JSON_BASE64` | Base64 of the exact `apps/mobile/google-services.json` used for the store build |
| `MOBILE_GOOGLE_SERVICE_INFO_PLIST_BASE64` | Base64 of the exact `apps/mobile/GoogleService-Info.plist` used for the store build |
| `SENTRY_AUTH_TOKEN` | The source-map upload token from the local release environment |

From `apps/mobile` on the machine that makes store builds, save the Firebase files.
Base64 keeps them byte-exact: `gh secret set` trims trailing newlines, and these
files are fingerprint inputs.

```bash
base64 < google-services.json | gh secret set MOBILE_GOOGLE_SERVICES_JSON_BASE64 --repo HCCNJ/HCCNA-V2 --env mobile-production
```

```bash
base64 < GoogleService-Info.plist | gh secret set MOBILE_GOOGLE_SERVICE_INFO_PLIST_BASE64 --repo HCCNJ/HCCNA-V2 --env mobile-production
```

Restoring the exact store-build Firebase files keeps CI's runtime compatible.
No signing keys or native build are needed in this workflow.

Keep updates to fixes and small changes. Changes to what the app does still go
through store review.

## Rolling back

Run `eas update:rollback` and choose either an earlier update to republish or
the embedded bundle of each runtime version.

## Changes that need a store build

These change the fingerprint, so existing installs ignore any update built from
them:

- adding, removing, or upgrading native dependencies (including Expo SDK
  upgrades)
- editing config plugins or `app.config.ts` fields other than `extra`, including
  icons, splash, and permissions
- `eas.json` and `apps/mobile/.gitignore`
- the root Bun patches and `apps/mobile/patches`

The publish guard rejects this drift automatically against `ota-release.json`.
Record new runtimes only after verifying the corresponding store builds. A
version bump on its own does not change the runtime.
