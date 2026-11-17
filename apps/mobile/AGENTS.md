Use `bunx expo install` to add dependencies.

When searching Apple docs, replace https://developer.apple.com with https://sosumi.ai to read as markdown. e.g. https://sosumi.ai/documentation/Xcode/configuring-app-groups instead of https://developer.apple.com/documentation/xcode/configuring-app-groups

## Pressable Style Functions

Do NOT use the function form of `style` on `Pressable` (e.g. `style={({ pressed }) => ({ ... })}`). This is not supported when using Uniwind. Instead, use `className` with the `active:` modifier for pressed states (e.g. `className="bg-transparent active:bg-muted"`).

## CSS Variables

Do NOT use CSS variables (e.g. `var(--app-muted)`) directly in inline `style` props. Instead, use Tailwind classes. The design tokens in `global.css` are mapped to Tailwind colors via the `@theme` block, so use classes like `bg-muted`, `bg-accent`, `border-border`, `text-foreground`, etc. For pressed/active states, use `active:bg-muted` on Pressable components via `className`.

## Theme and screen layout

`src/theme/tokens.ts` owns the native palette and generates the matching
Tailwind colors in `src/theme/tokens.css`. After editing tokens, run
`bun run --cwd apps/mobile theme:generate` from the root. The test suite checks
that generated CSS stays in sync. Use `useAppTheme` from `@/theme/useAppTheme`
for native color props and the existing Tailwind classes for styles. Persisted
`purple-light`/`purple-dark` names remain compatible at the preferences boundary.

Tab screens use `useTabScreenLayout` with `AnimatedHeader` for header measurement,
safe areas, and tab clearance. Pass the header's scroll props to either the
screen's ScrollView or virtualized list; do not repeat inset arithmetic in screens.

As features change, keep their screens and query documents together under
`src/components/<feature>`, with route files composing or exporting those screens.
Shared theme and layout code belongs outside feature folders. Move unrelated
features only when working on them.

## Effects, timers and guarded imports

`useEffect`, `useLayoutEffect`, `useInsertionEffect` and raw timers (`setTimeout`,
`setInterval`, `setImmediate`, `requestAnimationFrame`, `requestIdleCallback`) are
banned by the `mobile/*` lint rules. Before reaching for one, in this order:

1. Compute the value during render.
2. Do the work in the event handler that causes it.
3. Read an external store with `useSyncExternalStore`.
4. Load data with Relay, not an effect.
5. Reset state with `key`.
6. Only then use a hook from `@/hooks/effects`: `useMountEffect`, `useEventListener`,
   `useExternalSync`, `useTimeout`, `useInterval`.

Outside React use `sleep` or `withTimeout` from `@/utils/timers`; in Effect code use
`Effect.sleep`, `Effect.timeout` or `Schedule`. To defer non-urgent work use
`scheduleIdleTask` from `@/utils/scheduleIdleTask`. A delay never stands in for a
readiness signal: wait for the event or promise.

Also lint-enforced: mutations go through `@/relay/mutations`; Statsig gates and
configs are read with `useGate` or `useConfig` from `@/featureGates/react` with a
name from `@/featureGates/names`; components read auth state with `useIsLoggedIn`
(`@/hooks/auth/useIsLoggedIn`) and a new auth listener belongs in a service under
`src/effect`; and there are no new `jotai` or `@legendapp/state` imports.
`@effect/atom-react` is allowed.

`lint-baseline.json` lists the existing violations per file. It only shrinks: after
removing one, run `bun run --cwd apps/mobile lint:ratchet:update`. Never add an
entry, raise a count, or add an `oxlint-disable` comment for these rules. When a
baselined file is renamed, rename its key in the JSON by hand.

Disable comments for the `mobile/` rules fail the lint: the ratchet rejects any
`oxlint-disable*` or `eslint-disable*` comment under `src` that names a `mobile/` rule
or names no rule at all. The ratchet also lints `scripts/lint-ratchet.canary.tsx`,
which holds one violation of each rule, and fails if any rule reports nothing there;
never fix or delete those violations.

`compiler-baseline.json` lists the files the React Compiler skips (a bailout, an
internal error, or a `"use no memo"` opt-out). Its test fails if a file is added or a
listed file starts compiling; when you fix a file, remove its entry.

## Verification

### Linting

After making changes, run `bunx turbo run lint --filter=@hccnj/mobile` from the
monorepo root and fix all errors.

`oxlint.config.mjs` registers `@shadcn/lint` alongside the existing Oxlint rules.
It recognizes design-system imports under `@/ui` and automatically discovers the
Tailwind v4 theme in `global.css`. No `shadcn/*` rules are enabled yet. Configure
them in the config's `rules` object when choosing design-system policies; see the
[available rules](https://github.com/shadcn-ui/lint/blob/main/README.md#rules) and
[configuration examples](https://github.com/shadcn-ui/lint/blob/main/docs/design-systems.md).

Both apps load the checked-in `@hccnj/anti-slop` workspace dependency and the
shared ten-rule policy from `@hccnj/anti-slop/rules`. Follow the provenance and
update instructions in `packages/anti-slop/UPSTREAM.md` and the root `AGENTS.md`
when adopting upstream changes.

### App verification

This app requires a custom Expo development build and will not work in Expo Go. To verify the app:

- Use `npx serve-sim` to verify iOS and Apple platforms.
- Use `npx agent-browser` to verify on web.

## Metadata

Manage Apple App Store metadata and screenshots with `npx eas-cli@latest metadata:pull` and `npx eas-cli@latest metadata:push`.

## In-app release notes

The Statsig gate `show_whats_new` controls automatic presentation and defaults
off. The `whats_new` dynamic config supplies an explicit release version and
its highlights. Automatic prompts require online connectivity; offline or
unknown connectivity suppresses them, even with cached Statsig values. A native
version bump alone must never trigger the prompt.

Bundled notes in `src/components/whats-new/releaseNotes.ts` are a fallback for
manual visits only. Keep their versions pinned to the releases they describe.
Fresh installs start with their installed version acknowledged. The device
preference survives sign-out, and users can reopen notes from the App section
of resources even when the automatic prompt is disabled.

## OTA updates

Store builds are made locally; EAS Update delivers JavaScript-only changes to
builds with the same fingerprint runtime version. This repository has no OTA
publishing tooling. Never substitute or change `MMKV_ENCRYPTION_KEY`: shipped
builds cannot read storage encrypted with another key.
`ota-release.json` is the reviewed store-release record: the storage-key SHA-256,
the hashes of the update values (`MMKV_ENCRYPTION_KEY`, `APPLE_TEAM_ID`, and
`EXPO_PUBLIC_*`), and the runtime version for each platform. Record them from
verified OTA-enabled store
builds (runtimes come from the artifact's `fingerprint` file). Never replace a
baseline just to make an OTA pass.
The shared `scripts/releaseEnv.ts` loads `.env.production` over `.env`, excludes
`.env*.local` and inherited update values, and reports loaded filenames. Make store
builds only with `prebuild:release` (then archive in Xcode), `ios:release`,
`android:release`, or `android:bundle`. `prebuild:release` writes the release
loader into the generated `ios/.xcode.env.local`; `app.config.ts` rejects store
bundles made without it.
When a new update finishes downloading, `OtaUpdatePrompt` (rendered by
`ForceUpdateProvider` whenever the store prompt is hidden) offers to restart
into it with the `ForceUpdateOverlay` layout; rollbacks never prompt.

Versions are `MAJOR.STORE.OTA`. `native-version.js` is generated by `bun run version:bump
store|major` and holds the store version and Android `versionCode`; never edit it by hand. OTA
updates carry their number in `HCCNA_OTA_VERSION`; `app.config.ts` rejects that variable for
native builds. Version numbers and `native-version.js` are excluded from
the fingerprint.

## Do NOT modify the auto-generated folders (ios/android)

The `ios/` and `android/` folders are auto-generated when running `npx expo run:ios --device`, `npx expo run:android --device`, or `npx expo prebuild --clean`.

## Vendored Repositories

Reference checkouts live at the **monorepo root** under `repos/` (see the root `AGENTS.md` for
the restore command).

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `repos/` unless explicitly asked.
- Do not import from `repos/`; application code must continue importing from normal package dependencies.
- When writing Effect code, read `repos/effect/LLMS.md` (from the monorepo root) first, then inspect
  `repos/effect/` for examples of idiomatic usage, tests, module structure, and API design.
