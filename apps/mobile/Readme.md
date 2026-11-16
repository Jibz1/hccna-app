# HCCNA mobile app

Expo development builds are required; this project does not run in Expo Go.

## Setup

```sh
bun install # from the monorepo root
cd apps/mobile
bunx expo prebuild
```

Do not edit the generated `ios/` or `android/` directories directly.

Expo SDK 58's native template uses the scene-based app lifecycle that Xcode 27 /
iOS 27 requires. After updating Expo or its config plugins, regenerate iOS before
building on a device:

```sh
# from apps/mobile
bunx expo prebuild --platform ios --clean
npx expo run:ios --device
```

The root Bun patch for `react-native-screens@4.30.0` emits the prevented-selection
event when the action-only More tab is tapped while it is already selected, so the
More menu opens from `/more` too. Upstream still treats that tap as a repeated
selection. Changing the patch requires rebuilding the native app. On iOS 27,
UIKit detaches only the prominent tab, so the iPhone tab layout passes
`ios.prominentScreenKey: "more"` through `unstable_nativeProps` to keep More on
its own glass button.

React Native Firebase 27 installs the Firebase Apple SDK only through Swift
Package Manager, so `expo-build-properties` builds iOS pods as dynamic
frameworks (`useFrameworks: "dynamic"`); RNFB's pod install rejects static
linkage. Do not pass `disableSPM` to the `@react-native-firebase/app` plugin.
Google Sign-In still comes from CocoaPods, so its App Check and session-fetcher
dependencies are separate copies from Firebase's SPM ones. Firebase BoM 35 on
Android needs Kotlin 2.4 or newer, which `kotlinVersion` sets.

Keep React, React DOM, React Native, Reanimated, and Worklets aligned with Expo's
bundled versions. Expo 58 uses React 19.3.0, React Native 0.88.0, Reanimated
4.7.1, and Worklets 0.13.0. Only `@sentry/react-native` is listed in
`expo.install.exclude`, because it is intentionally newer than Expo's bundled
version. Rebuild the custom development client after changing native
dependencies.

React Native 0.87+ exports `AssetRegistry` from `react-native`, and `expo-asset`
reads it from there. Uniwind rewrites `react-native` imports, and only 1.13+
forwards exports it does not wrap, so keep Uniwind at 1.13 or newer; older
versions break every bundled asset and font with
`Cannot read property 'getAssetByID' of undefined`.

## Development

```sh
bun run ios
bun run android
bun run web
```

## Quality checks

```sh
bun run check
```

`check` runs TypeScript, linting, formatting verification, and the complete
Vitest suite. Use `bun run test:watch` while developing for Vitest watch mode.
