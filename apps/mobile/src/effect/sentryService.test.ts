import { Effect } from "effect";
import { expect, test, vi } from "vitest";

import {
  makeSentryService,
  type SentryBreadcrumb,
  type SentryServiceDependencies,
} from "./sentryService";

test("breadcrumb SDK failures cannot become registration exceptions", () => {
  const addBreadcrumb = vi.fn();
  const captureException = vi.fn();
  const service = makeSentryService({
    defaultErrorSampleRate: 1,
    defaultTraceSampleRate: 1,
    getPlatform: () => "ios",
    getOtaVersion: () => "2.1.3",
    getRandom: () => 0,
    isDevelopment: () => false,
    isStatsigReady: () => false,
    getStatsigSampleRate: (_key, fallback) => fallback,
    makeConfig: () => ({}),
    init: vi.fn(),
    addBreadcrumb,
    captureException,
    setTag: vi.fn(),
  });
  const breadcrumb: SentryBreadcrumb = {
    category: "push.registration",
    level: "warning",
  };
  Effect.runSync(service.addBreadcrumb(breadcrumb));
  expect(addBreadcrumb).toHaveBeenCalledExactlyOnceWith(breadcrumb);
  addBreadcrumb.mockImplementationOnce(() => {
    throw new Error("Sentry unavailable");
  });
  expect(() => {
    Effect.runSync(service.addBreadcrumb(breadcrumb));
  }).not.toThrow();
  expect(captureException).not.toHaveBeenCalled();
});

const dependencies = (
  overrides: Partial<SentryServiceDependencies>,
): SentryServiceDependencies => ({
  defaultErrorSampleRate: 1,
  defaultTraceSampleRate: 1,
  getPlatform: () => "ios",
  getOtaVersion: () => "2.1.3",
  getRandom: () => 0,
  isDevelopment: () => false,
  isStatsigReady: () => false,
  getStatsigSampleRate: (_key, fallback) => fallback,
  makeConfig: () => ({}),
  init: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setTag: vi.fn(),
  ...overrides,
});

test("tags events with the JavaScript version the app is running", () => {
  const setTag = vi.fn();
  Effect.runSync(makeSentryService(dependencies({ setTag })).init());
  expect(setTag).toHaveBeenCalledWith("app_platform", "ios");
  expect(setTag).toHaveBeenCalledWith("ota_version", "2.1.3");
});

test("leaves the version tag off when the config has no version", () => {
  const setTag = vi.fn();
  Effect.runSync(
    makeSentryService(
      dependencies({ setTag, getOtaVersion: () => undefined }),
    ).init(),
  );
  expect(setTag).not.toHaveBeenCalledWith("ota_version", expect.anything());
});
