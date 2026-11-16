import { mock } from "bun:test";

import type { startSpan } from "@sentry/bun";

/**
 * The one Sentry mock for every server test. `scripts/test-preload.ts` installs it over the real
 * `@sentry/bun` before any test file loads, so no test starts a Sentry client and every file sees
 * the same functions. Suites that assert on Sentry import `sentry` and clear what they check in
 * `beforeEach`.
 *
 * Never call `mock.module("@sentry/bun", ...)` in a test file: Bun applies module mocks to the
 * whole process, so that file's functions would replace the ones another file asserts on.
 */
export const sentry = {
	captureException: mock(),
	captureMessage: mock(),
	init: mock(),
	startSpan: mock((_options: Parameters<typeof startSpan>[0], run: () => unknown) => run()),
};
