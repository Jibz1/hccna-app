# expo-font 58.0.11

APP-4H terminates in the asynchronous FontLoaderModule closure while releasing
Swift array storage. The upstream registry is read synchronously on the JS
thread and replaced on the Expo async queue without synchronization.

`expo-font@58.0.11.patch` protects discovery, reads, and updates with one lock,
covering `loadAsync`, `loadFontFamilyAsync`, and `getLoadedFonts`. Native font
discovery remains lazy. The public module API and the names it reports are
unchanged. This addresses the observed race
candidate; confirming the production crash is resolved requires a native build.

Upstream: expo/expo, npm package `expo-font@58.0.11` (published without a gitHead).
Its registry is still unsynchronized.
The upstream package's MIT license is retained by the Bun patch.

The root `overrides` pins every dependency path to the patched version, including
Expo's transitive dependency. Keep that override, the mobile dependency, and the
patch version aligned when upgrading.

From the repository root on macOS with Xcode:

```sh
bunx turbo run test:native:fonts --filter=@hccnj/mobile
```

The test compiles the installed patched registry with Thread Sanitizer and runs
20,000 concurrent reads/registrations. Linux skips this native test. Rebuild the
iOS application to ship the fix; a JavaScript update cannot change native code.
Remove or reconcile the patch when upstream synchronizes its font registry.
