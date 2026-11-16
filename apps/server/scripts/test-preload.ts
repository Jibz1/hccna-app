/**
 * `bun test` preload (wired in `bunfig.toml`, so every `bun test` run in this app loads it):
 * import the real modules that suites mock before any test file runs.
 *
 * Bun applies module mocks process-wide and does not guarantee test-file order. If a mock
 * registers before the real module was ever imported, the mock IS the module, with only the
 * exports that one file listed, for every later file. Once the real module is loaded, later mocks
 * only patch the exports they list.
 *
 * - Several suites call `mock.module("@/effect/Runtime", () => ({ managedRuntime }))`; without
 *   the real module loaded first, every later consumer of `AppLayer` (the v1 routes) fails to link.
 * - Sentry is mocked once, here, with the shared mock from `sentry-mocks.ts`. Test files import
 *   that mock instead of mocking `@sentry/bun` themselves.
 */
// Date-formatting assertions assume UTC.
process.env.TZ = "UTC";

import "@/effect/Runtime";
import "@sentry/bun";
import { sentry } from "@/graphql/__tests__/utils/sentry-mocks";
import { mock } from "bun:test";

void mock.module("@sentry/bun", () => sentry);
