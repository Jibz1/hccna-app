import { loadAppConfigSync } from "@/effect/AppConfig";
import { initializeGlobalOpenTelemetry } from "@/platform/observability";
import {
	withoutSecretRequestHeaders,
	withRedactedGraphQLVariables,
} from "@/platform/observability/redaction";
import * as Sentry from "@sentry/bun";

initializeGlobalOpenTelemetry();

const appConfig = loadAppConfigSync();
const SAMPLE_RATE = appConfig.observability.sentrySampleRate;
const TRACES_SAMPLE_RATE = appConfig.observability.sentryTracesSampleRate;
const DEFAULT_SENTRY_DSN =
	"https://e4b420c99240b2d01277da0240a2fe1d@o4509593910378496.ingest.us.sentry.io/4510513578180608";

Sentry.init({
	enabled: appConfig.isProduction || appConfig.observability.sentryEnabled,

	dsn: appConfig.observability.sentryDsn ?? DEFAULT_SENTRY_DSN,

	debug: false,

	ignoreErrors: ["AbortError", "TimeoutError"],
	environment: appConfig.nodeEnv,
	initialScope: (scope) => {
		scope.setTag("service.name", appConfig.observability.otelServiceName);
		return scope;
	},
	sampleRate: SAMPLE_RATE,
	// Sentry 11 streams spans by default and then never calls `beforeSendTransaction`, which is
	// what drops scanner 404s and strips secret request headers below.
	traceLifecycle: "static",
	beforeSend: (event) => withRedactedGraphQLVariables(withoutSecretRequestHeaders(event)),
	beforeSendTransaction(transaction) {
		if (transaction.contexts?.response?.status_code === 404) {
			// oxlint-disable-next-line no-null
			return null;
		}

		return withoutSecretRequestHeaders(transaction);
	},
	tracesSampler: (samplingContext) => {
		// Honor parent service's sampling decision to maintain trace chains
		if (samplingContext.parentSampled !== undefined) {
			return samplingContext.parentSampled ? 1 : 0;
		}
		// Apply local sampling logic if no parent context
		return TRACES_SAMPLE_RATE;
	},
});
