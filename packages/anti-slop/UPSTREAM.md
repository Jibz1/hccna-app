# Anti-slop provenance

- Source: https://github.com/dmmulroy/anti-slop
- Baseline: `13909c9e07590f5a85d93c62712259fe14a883f7` (2026-10-14).
- Previous baseline: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`.
  Every previously vendored source file matched this revision exactly except for
  the Bun CLI test launcher described below, which is preserved.
- This update keeps consecutive single-line bindings grouped in
  `require-readable-spacing`, including exported bindings. Leading comments still
  start a new group. The updated rule, regression tests, and ESLint Stylistic
  adapter and provenance are copied without local changes.
- Canonical upstream `src/` is copied into `src/`, including tests and the nested
  ESLint Stylistic license and provenance. The upstream root license is `LICENSE`.

## Local integration

The plugin moved from `apps/server/tools/oxlint/anti-slop` into this workspace.
Source is checked in so fresh installs do not need to fetch the upstream GitHub
repository or transpile a TypeScript-only dependency inside `node_modules`.
Both apps register `@hccnj/anti-slop` and import `@hccnj/anti-slop/rules` for the
same ten generic rules previously enabled on the server. Oxlint and
`@oxlint/plugins` remain paired at `1.88.0`. The shared Oxlint and
`oxlint-tsgolint` versions are pinned in the root catalog.

Production rule sources have no local deviations. The CLI spacing test invokes
`bun x --no-install oxlint` instead of `pnpm exec oxlint` to use this workspace's
installed version. `package.json` and `rules.mjs` are locally owned integration.

New generic rules are included but are not enabled by the shared policy:
`no-array-filter-map`, `no-reduce-accumulator-copy`, `no-module-mocking`,
`no-reflect-apply`, `no-reflect-get`, `no-unknown-returns`,
`require-readable-spacing`, and `require-safety-comment-for-type-assertion`.
The optional Effect plugin is exported at `@hccnj/anti-slop/effect` but is not
registered by either app. Enabling these rules is a separate policy change;
the upstream recommendation is error severity, with native
`oxc/no-accumulating-spread` alongside `no-reduce-accumulator-copy`.

## Maintenance

Run `bunx turbo run test --filter=@hccnj/anti-slop` from the monorepo root.
This runs all 24 upstream rule and CLI suites using the installed Oxlint version.
Run the full root Turbo checks after changing the plugin or shared policy.

For future updates, compare the baseline above, local sources, and the incoming
upstream revision. Preserve local policy, tests, licenses, and intentional changes.
Update this record with the revision actually reconciled, not just upstream HEAD.
