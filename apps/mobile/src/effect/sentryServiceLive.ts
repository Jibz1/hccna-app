import * as Sentry from "@sentry/react-native";
import { Layer } from "effect";
import Constants from "expo-constants";

import { makeSentryService, SentryService } from "@/effect/sentryService";
import { DYNAMIC_CONFIGS } from "@/featureGates/names";
import { getPlatform } from "@/utils/flags";

import {
  getLiveStatsigDynamicConfig,
  isLiveStatsigReady,
} from "./statsigServiceLive";

const SENTRY_DSN =
  "https://b945344f52964aab15acd160dd3687f8@o4509593910378496.ingest.us.sentry.io/4509593922568193";

const DEFAULT_ERROR_SAMPLE_RATE = 0.5;
const DEFAULT_TRACE_SAMPLE_RATE = 0.5;

export const routingInstrumentation = Sentry.reactNavigationIntegration();

export const SentryServiceLive = Layer.succeed(
  SentryService,
  makeSentryService({
    defaultErrorSampleRate: DEFAULT_ERROR_SAMPLE_RATE,
    defaultTraceSampleRate: DEFAULT_TRACE_SAMPLE_RATE,
    getPlatform,
    getOtaVersion: () => Constants.expoConfig?.version,
    getRandom: Math.random,
    isDevelopment: () => __DEV__,
    isStatsigReady: isLiveStatsigReady,
    getStatsigSampleRate: (key, defaultValue) =>
      getLiveStatsigDynamicConfig(DYNAMIC_CONFIGS.sentrySampleRate, {
        disableExposureLog: true,
      }).get(key, defaultValue),
    makeConfig: ({ getRandom, getSampleRate, isDevelopment }) =>
      ({
        dsn: SENTRY_DSN,
        enabled: !isDevelopment,
        environment: isDevelopment ? "development" : "production",
        sendDefaultPii: true,
        tracesSampler: ({ inheritOrSampleWith }) => {
          return inheritOrSampleWith(
            getSampleRate("transactions", DEFAULT_TRACE_SAMPLE_RATE),
          );
        },
        integrations: [
          Sentry.reactNativeTracingIntegration(),
          routingInstrumentation,
          // Sentry.mobileReplayIntegration()
        ],
        beforeSend(event) {
          if (
            getRandom() > getSampleRate("errors", DEFAULT_ERROR_SAMPLE_RATE)
          ) {
            return null;
          }

          return event;
        },
        attachViewHierarchy: true,
        enableAppHangTracking: true,
        enableAutoPerformanceTracing: true,
        enableUserInteractionTracing: true,
        enableNativeFramesTracking: true,
        enableStallTracking: true,
        enableAppStartTracking: true,
      }) satisfies Sentry.ReactNativeOptions,
    init: (config) => {
      Sentry.init(config);
    },
    addBreadcrumb: Sentry.addBreadcrumb,
    captureException: Sentry.captureException,
    setTag: (key, value) => {
      Sentry.getGlobalScope().setTag(key, value);
    },
  }),
);
