# HCCNA

> [!IMPORTANT]
> **This is a published copy of HCCNJ's internal production repository.**
> Development, code review, releases, and deployments all happen in the internal repository.
> This copy is refreshed from it as a single snapshot commit, without the internal history.
>
> - **Nothing here deploys.** CI only builds and tests; it has no Railway deploys, migrations,
>   over-the-air (OTA) publishing, store releases, or other access to production services.
> - **It may lag behind production.** The live app and backend can run newer code than this
>   copy.
> - **Running it needs your own services.** The server needs its own database, Redis, CMS, and
>   third-party credentials (see [`docs/secrets.md`](docs/secrets.md)); none are included.
> - The mobile app keeps the production backend URL and public client keys that ship in the
>   store build, so a build made from this copy talks to production like the store app does.

Monorepo for the HCCNA platform: the backend (`apps/server`, Railway) and the mobile app (`apps/mobile`, Expo/EAS), plus shared packages under `packages/`.

## Quickstart

```bash
bun install
bunx turbo run typecheck lint test
```

- `bun run --cwd apps/server dev` — run the backend locally (needs `apps/server/.env`, see `docs/secrets.md`)
- `bun run dev:mobile` — start the Expo dev client and standalone Device Hub together, keeping Expo's port prompts and keyboard shortcuts interactive. Open the Hub URL printed in the terminal (usually `http://127.0.0.1:3400`). Pass Expo options directly, for example `bun run dev:mobile --port 8082`. Press Ctrl+C to stop both processes.
- `bun run --cwd apps/mobile dev` — start only the Expo dev client; `bun run --cwd apps/mobile dev:hub` — start only the standalone Device Hub.
- Expo Device Hub starts automatically with the mobile dev server. Open the `Expo Device Hub` link in the terminal (usually `http://localhost:8081/_expo/plugins/expo-device-hub`) to view and control simulators and emulators. Restart an already-running dev server after installing dependencies. iOS simulators require macOS with Xcode; Android emulators require the Android SDK. The app still requires a custom development build.
- For native iOS builds, run `npx expo run:ios --device` from `apps/mobile`. To build in Xcode, open `apps/mobile/ios/HCCNA.xcworkspace`; the workspace includes the CocoaPods dependencies required by the app. Opening `HCCNA.xcodeproj` alone causes missing React, Expo, and Firebase module errors.

Structure and conventions: see [AGENTS.md](AGENTS.md). Design specs and implementation plans are kept in the internal repository.

## Pull request labels

PRs are labeled automatically from changed paths using [.github/labeler.yml](.github/labeler.yml): `server`, `mobile`, `shared`, `schema`, `castr`, `ccb`, `strapi`, `configuration`, `ci`, `dependencies`, and `documentation`. A PR can receive multiple labels. Configured labels are removed when their paths no longer match; other labels are preserved.

To add a category, create its label in GitHub and add its path rules to the configuration. The workflow reads rules from the base branch, so new rules take effect after merge.

## Architecture

[docs/architecture.md](docs/architecture.md) shows how the app, the backends, and the services
around them fit together, with a system diagram and a typical request.

## License

Copyright © HolyGhost Christian Center North America (HCCNA). All rights reserved.

The source is published for reference only. No license is granted to copy, modify, or
distribute it. The church's names, logos, and photographs are not covered by any license.
`packages/anti-slop` is third-party code under its own license (`packages/anti-slop/LICENSE`).
