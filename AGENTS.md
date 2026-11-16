# HCCNA Monorepo

Bun 1.4 workspaces + Turborepo. Two apps, an experimental Rust backend, shared packages.

| Path | What it is |
|---|---|
| `apps/server` | GraphQL/REST backend (Hono + Yoga + Pothos + Drizzle, Effect). Deploys to Railway via the `deploy server` GitHub Actions workflow. |
| `apps/mobile` | Expo SDK 58 React Native app (Relay, Effect, uniwind). Store builds are made locally; OTA updates go through EAS Update. |
| `apps/server-rs` | Experimental Rust port of the GraphQL backend (axum + async-graphql), heading to parity with `apps/server`: it answers the queries it has ported and forwards everything else to `apps/server`. No production client uses it yet. A Cargo crate, not a Bun workspace. Deploys to the Railway service `hccna-backend-rs` via the `server-rs` workflow. |
| `packages/castr`, `packages/ccb`, `packages/strapi-v2` | Server-side integration libraries (`@hccnj/*`). |
| `packages/schema` | GraphQL contract: `schema.graphql` (SDL only; each app runs its own codegen). |
| `packages/config` | Shared tsconfig bases and tooling presets. |
| `packages/anti-slop` | Shared vendored anti-slop Oxlint plugin and ten-rule policy. |
| `packages/mobile-lint` | Custom Oxlint rules for `apps/mobile` (`@hccnj/mobile-lint`): effect, timer and import guards. |

## Conventions

- Run checks from the root via turbo: `bunx turbo run build typecheck lint fmt:check test`.
- Install with `bun install` at the root only — one lockfile (`bun.lock`).
- Shared dependency versions (including `effect`) live in the root `package.json` catalog; workspace packages declare `"effect": "catalog:"`.
- Cross-workspace references always go through the package name (`@hccnj/schema/schema.graphql`, `import.meta.resolve(...)`, `require.resolve(...)`) — never deep relative paths like `../../packages/...`. Declare the package in `dependencies` (`"workspace:*"`) and give the owning package an `exports` entry for any file it shares.
- Each app has its own `AGENTS.md` with app-specific conventions — read it before working in that app.
- Secrets are never committed. `docs/secrets.md` documents every untracked-but-required file and where it comes from.

## No real user data in the repo

Never write real people's information anywhere in the checkout: names, emails, phone numbers,
addresses, Firebase UIDs, CCB ids, push tokens, giving records, or exported profiles.

- This covers untracked and ignored files too, not just commits. A data file left in the working
  tree can be committed by mistake, gets copied into worktrees, and is read and quoted by agents.
- Scripts that read production users, such as `apps/server/scripts/user-provisioning-reconcile.ts`,
  write their output outside the checkout: pass `--out` with a path under `$TMPDIR` or an agent
  scratchpad, since the default lands in the current directory. Delete the file when the job is done.
- Tests, fixtures, snapshots, docs, commit messages, and PR descriptions use synthetic values with
  the same shape (`Ada Example`, `ada@example.com`, `555-0100`). The same applies to real CMS
  records and recorded API responses.

## Effect v4 only

Both apps and every package use Effect v4 (`effect` pinned in the root catalog). Always write
v4 code; never write, suggest, or copy Effect v3 APIs or patterns.

- Services: `Context.Service` (with `make` or a static `layer`), never v3's `Effect.Service`,
  `Effect.Tag`, `Context.Tag`, or `Context.GenericTag`.
- Errors: `Schema.TaggedError` with `Effect.catch` / `Effect.catchTag(s)`; v3's
  `Effect.catchAll*` became `Effect.catch*`, and `Either` became `Result`.
- Imports: platform, RPC, cluster, and SQL core modules come from `effect` itself (for example
  `effect/sql`, `effect/persistence`); v3's `@effect/platform`, `@effect/rpc`, `@effect/cluster`,
  and `@effect/schema` do not exist in v4. Separate `@effect/*` packages (`@effect/sql-pg`,
  `@effect/platform-bun`, …) must match the `effect` version exactly.
- Ignore skills, docs, blog posts, and examples written for v3 — including generic "Effect best
  practices" guides — and do not install skills that teach v3 patterns. When unsure whether an API
  exists in v4, check `repos/effect` (start with `LLMS.md`, then `MIGRATION.md` and
  `migration/`) rather than relying on memory.

## Anti-slop

Both apps declare `@hccnj/anti-slop` as a workspace development dependency.
Its source is checked in under `packages/anti-slop` so fresh installs do not
depend on fetching the upstream GitHub repository. Keep the ten enabled rules
in `packages/anti-slop/rules.mjs` and register the plugin through its package name.
The package's exact `@oxlint/plugins` and Oxlint versions must match the apps'
Oxlint version.

`packages/anti-slop/UPSTREAM.md` records the upstream revision and local changes.
When updating, reconcile the source against that baseline, preserve tests and
licenses, update the provenance, and run the root checks. The package's test task
runs the upstream suites with Node's test runner.

## Vendored reference repositories

`repos/` at the monorepo root holds read-only reference checkouts for coding agents. It is
gitignored. Root `bun install` and `bun update` run a postinstall hook that syncs the
Effect checkout to the exact `workspaces.catalog.effect` version in `package.json`.
To restore or refresh it separately, run:

```bash
bun run refs:sync
```

- `repos/effect` — the canonical Effect v4 source (`Effect-TS/effect`, matching release tag).
  When writing Effect code, read `repos/effect/LLMS.md` first and treat the checkout as the source of truth for
  idiomatic usage, tests, module structure, and API design. (`effect-smol`, the old v4 repo both
  apps previously vendored, is archived — v4 lives in the canonical repo now.)
- Sync downloads `effect@<version>` into a temporary directory, verifies its package version,
  then replaces the old reference and removes `.git`. Matching references need no network;
  download failures preserve the previous reference and fail the install with retry instructions.
- CI, EAS builds, and `NODE_ENV=production` skip reference sync. Set
  `SKIP_EFFECT_REPO_SYNC=1` for an offline install; run `bun run refs:sync` when online again.
  `bunfig.toml` enables lifecycle scripts for this project; `--ignore-scripts` still disables
  the hook. Keep Effect pinned to an exact release version.
- Never edit or import from `repos/` — application code imports from normal package dependencies.

## Docs

- `docs/secrets.md` — fresh-clone bootstrap: every untracked-but-required file and its source.
- `docs/cms-change-notices.md` — how Strapi 4 and Strapi 5 notify the backend of content changes.
- `docs/ota-updates.md` — EAS Update setup, publishing, rollback, and what needs a store build.
- Design docs for **completed** work are removed rather than kept as clutter — the monorepo
  design spec and migration plan live in git history (`docs/superpowers/`, removed 2026-08-22).
  Keep only docs describing pending work, live conventions, or operational procedures.
