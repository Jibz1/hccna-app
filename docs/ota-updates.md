# OTA updates (EAS Update)

Store builds are made locally (Xcode and Gradle). EAS Update delivers over-the-air updates,
which replace the JavaScript bundle and assets of an installed build.

This repository contains no publishing tooling: publishing updates, syncing the EAS
environment, and recording store releases are done from the internal repository. This page
explains how updates fit the app so that changes here can be judged correctly.

## How it fits together

- `apps/mobile/app.config.ts` points `expo-updates` at the project's EAS URL and sends the
  `production` channel header. EAS Build replaces it with each `eas.json` profile's channel, so
  preview and development builds never receive production updates.
- The runtime version uses the `fingerprint` policy: a hash of everything that reaches the
  native build. An update installs only on builds with the same hash, so an update can never
  run on native code it does not match. `apps/mobile/fingerprint.config.js` leaves out the
  Expo `extra` section and `package.json` scripts, which differ between machines or never
  reach the native build.
- Store builds share `scripts/releaseEnv.ts`. It loads only `apps/mobile/.env.production` over
  `apps/mobile/.env`, reports loaded filenames on stderr, and ignores `.env.local`,
  `.env.production.local`, and inherited update values. Both release files are gitignored.
- Expo's own `.env` selection includes developer-local files, so the app config refuses to
  make a store bundle (`expo export:embed --dev false`, which Xcode and Gradle run for Release
  builds) unless the release loader set up the environment. EAS Build workers are exempt.
- Every store build since 1.1.3 encrypts local storage with the `MMKV_ENCRYPTION_KEY` from
  `.env`. Never change that key: a build or update with a different key cannot read the
  stores users already have.
- `apps/mobile/ota-release.json` is the reviewed record of the store release: the storage-key
  hash (`mmkvKeySha256`), the hashes of the client-embedded update values
  (`updateValuesSha256`), and each platform's verified store runtime (`runtimeVersions`).

## Versioning

Versions read `MAJOR.STORE.OTA`. Store releases are `X.Y.0`; OTA updates on top of a store
release are `X.Y.1`, `X.Y.2`, and so on, restarting at `.1` after each store release.

- `apps/mobile/native-version.js` holds the store version and the Android `versionCode`. It is
  generated: change it only with `bun run version:bump store` (`2.0.1` → `2.1.0`) or
  `bun run version:bump major` (`2.4.0` → `3.0.0`). Both raise the `versionCode` by one.
- Version numbers are not part of the runtime. A store release that only changes the version
  keeps the previous runtime.
- `expo prebuild` copies the numbers into `android/app/build.gradle` and
  `ios/HCCNA/Info.plist`. `android:bundle` and Xcode Release builds stop when those copies
  differ from `native-version.js`; rerun `generate--android-native-build` or
  `prebuild:release`.
- OTA numbers are never committed; the publisher derives them from past update messages. iOS,
  Android, the stores, force update, What's New, and the server's `x-hccna-app-version` header
  keep the store version.
- Pull requests that change native code get a **mobile fingerprint** warning: they need a
  store release, not an OTA update.

## Building a store release

Build store releases only through the release commands, from `apps/mobile`:

- iOS: `bun run prebuild:release`, then archive in Xcode. The command writes a block to the
  generated `ios/.xcode.env.local` that runs the release loader at build time.
  `bun run ios:release -- --device` builds and installs a Release directly.
- Android: `bun run generate--android-native-build`, then `bun run android:bundle` for the
  Play Store bundle. `bun run android:release -- --device` builds and installs a Release
  directly.

Release builds started any other way fail with "Store bundles must use the release
environment".

## Changes that need a store build

These change the fingerprint, so existing installs ignore any update built from them:

- adding, removing, or upgrading native dependencies (including Expo SDK upgrades)
- editing config plugins or `app.config.ts` fields other than `extra`, including icons,
  splash, and permissions
- `eas.json` and `apps/mobile/.gitignore`
- the root Bun patches and `apps/mobile/patches`

A version bump on its own does not change the runtime.
