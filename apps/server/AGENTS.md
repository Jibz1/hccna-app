# Agent Guidelines

## Backward compatibility with the deployed app

- Server changes must remain backward compatible with the currently deployed mobile app unless the user explicitly asks for a breaking change. A refactor, bug fix, or new app build is not authorization to break existing clients.
- Compatibility includes response shapes and nullability, field meanings, authentication requirements, existing queries and mutations, caching, fallbacks, error behavior, and database migrations during mixed-version rollouts. An unchanged GraphQL schema alone does not prove compatibility.
- Before changing server behavior, verify existing client request paths against representative published CMS data, including null, omitted, empty, and legacy values. Add regression coverage for any compatibility bug being fixed.
- Prefer additive changes and preserve behavior required by deployed clients. If a breaking change is necessary, explain the affected clients and rollout requirements and obtain explicit user authorization before proceeding.

## Strapi 5 CMS contract

When HCCNJ/site changes its rich-text editor extensions, enums or content types, run `bun run --cwd packages/strapi-v2 refresh-schema` from the repo root (it needs `CMS_V5_ENDPOINT` and a read-only Strapi 5 token in `CMS_V5_TOKEN`), update `packages/strapi-v2` if anything fails, and release the server before the CMS change goes live: an unknown node, mark or enum value fails the whole list as a Decode error by design. The CMS calls `cmsWebhookUpdate` with `cmsVersion: V5` after a publish, unpublish or delete.

## Build & Test

- **Run all tests**: `bun run test:summary` (uses Vitest)
- **Run single test**: `bun run test <path/to/file>`
- **Sentry in tests**: `bunfig.toml` loads `scripts/test-preload.ts` for every `bun test` run, and it installs one shared Sentry mock. To assert on Sentry calls, import `sentry` from `src/graphql/__tests__/utils/sentry-mocks.ts` and clear it in `beforeEach`. Never `mock.module("@sentry/bun", ...)` in a test file: Bun module mocks are process-wide, so one file's mock replaces the functions another file asserts on.
- **Lint code**: `bun run lint:ox` (Oxlint and policy checks)
- **Type check**: `bun run build` (TypeScript 7 native compiler via `@typescript/native`)
- **Format**: `bun run prettier:fix`

## TypeScript Toolchain

- Builds use TypeScript 7 (Go-native): the root `build` script invokes `node_modules/@typescript/native/bin/tsc`; workspace packages depend on `typescript@^7` directly so their `tsc -b` is also v7.
- The root `typescript` devDependency stays on 6.x because knip needs the programmatic API, which TypeScript 7 does not ship until 7.1. Do not alias the root `typescript` to `@typescript/typescript6` — bun's isolated linker resolves that shim's internal `@typescript/old` alias onto itself, silently breaking `require("typescript")`.
- `@effect/tsgo` provides the Effect language service for TypeScript 7. The `postinstall` script re-patches the `@typescript/native` Go binary after every install (skipped in production images). Effect diagnostics print as warnings in builds but do not fail them (see `plugins` in `tsconfig.base.json`); `@effect/language-service` remains installed as the fallback for editors still using the TypeScript 6 tsserver.

## GraphQL 17

- graphql-yoga 6 declares graphql 17 and brings graphql-17-aware `@graphql-tools/utils`/`executor`, so the root no longer overrides them. A graphql-tools release that reads v16's `defaultValue` instead of v17's `default: { value }` fails any omitted argument with a default on a non-null type (introspection's `includeDeprecated`, which breaks GraphiQL's schema preview); check that case before pinning graphql-tools by hand.
- If bun overrides change resolution but behavior doesn't, check the store symlinks (`node_modules/.bun/<pkg>/node_modules/...`) — bun can leave stale links on unchanged store entries; `rm -rf node_modules && bun install` forces a full relink.

## Code Style & Conventions

- **Imports**: Use absolute paths with `@/` alias (maps to `./src/`). Sort: built-ins -> external -> internal (@/...) -> relative.

## Vendored Repositories

Reference checkouts live at the **monorepo root** under `repos/` (see the root `AGENTS.md` for
the restore command).

- Use vendored repositories as read-only reference material when working with related libraries
- Prefer examples and patterns from the vendored source code over generated guesses or web search results
- Do not edit files under `repos/` unless explicitly asked
- Do not import from `repos/` - application code should continue importing from normal package dependencies
- When writing Effect code, read `repos/effect/LLMS.md` (from the monorepo root) first and inspect
  `repos/effect/` for examples of idiomatic usage, tests, module structure, and API design. Treat
  it as the source of truth for Effect patterns.

like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.
