import { AppConfig } from "@/effect/AppConfig";
import { AppLoggerService, type LogFields } from "@/effect/services/AppLoggerService";
import * as Sentry from "@sentry/bun";
import {
	DynamicConfig,
	Experiment,
	FeatureGate,
	Statsig,
	Layer as StatsigLayer,
	type ClientInitResponseOptions,
	type DynamicConfigEvaluationOptions,
	type ExperimentEvaluationOptions,
	type FeatureGateEvaluationOptions,
	type LayerEvaluationOptions,
	type OutputLoggerProvider,
	type StatsigOptions,
	type StatsigUser,
} from "@statsig/statsig-node-core";
import { Context, Effect, Layer, Schema } from "effect";

class StatsigInitializationError extends Schema.TaggedError<StatsigInitializationError>()(
	"StatsigInitializationError",
	{
		detail: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `Statsig: ${this.detail}`;
	}
}

interface StatsigLogger {
	debug: (message: string, fields?: LogFields) => void;
	info: (message: string, fields?: LogFields) => void;
	warn: (message: string, fields?: LogFields) => void;
	error: (message: string, fields?: LogFields) => void;
}

type StatsigEventMetadata = Record<string, string | number | boolean | null | undefined>;
type StatsigEventArguments = readonly [
	value?: string | number | null,
	metadata?: StatsigEventMetadata | null,
];

class StatsigOutputLogger implements OutputLoggerProvider {
	private readonly logger: StatsigLogger;

	constructor(logger: StatsigLogger) {
		this.logger = logger;
	}

	private readonly log = (
		level: "debug" | "info" | "warn" | "error",
		tag: string,
		message: string,
	) => {
		this.logger[level](message, { tag });
	};

	readonly initialize = () => {
		this.logger.info("Statsig logger initialized");
	};

	readonly debug = (tag: string, message: string) => {
		this.log("debug", tag, message);
	};

	readonly info = (tag: string, message: string) => {
		this.log("info", tag, message);
	};

	readonly warn = (tag: string, message: string) => {
		this.log("warn", tag, message);
	};

	readonly error = (tag: string, message: string) => {
		this.log("error", tag, message);
	};

	readonly shutdown = () => {
		this.logger.info("Statsig logger shutdown");
	};
}

function createDisabledFeatureGate(gateName: string) {
	return new FeatureGate(gateName, null);
}

function createDisabledDynamicConfig(configName: string) {
	return new DynamicConfig(configName, "{}");
}

function createDisabledExperiment(experimentName: string) {
	return new Experiment(experimentName, "{}");
}

function createDisabledLayer(layerName: string) {
	return new StatsigLayer(() => {}, layerName, "{}");
}

async function initializeStatsigClient(
	sdkKey: string,
	options: StatsigOptions,
): Promise<Statsig | null> {
	const statsig = new Statsig(sdkKey, options);
	const result = await statsig.initialize();

	if (!result.isSuccess) {
		throw new Error(result.error ?? "Statsig initialization failed");
	}

	return statsig;
}

export interface StatsigServiceContract {
	readonly enabled: boolean;
	checkGate: (
		user: StatsigUser,
		gateName: string,
		options?: FeatureGateEvaluationOptions,
	) => boolean;
	getFeatureGate: (
		user: StatsigUser,
		gateName: string,
		options?: FeatureGateEvaluationOptions,
	) => FeatureGate;
	getDynamicConfig: (
		user: StatsigUser,
		configName: string,
		options?: DynamicConfigEvaluationOptions,
	) => DynamicConfig;
	getExperiment: (
		user: StatsigUser,
		experimentName: string,
		options?: ExperimentEvaluationOptions,
	) => Experiment;
	getLayer: (
		user: StatsigUser,
		layerName: string,
		options?: LayerEvaluationOptions,
	) => StatsigLayer;
	getClientInitializeResponse: (user: StatsigUser, options?: ClientInitResponseOptions) => string;
	/** Fire-and-forget analytics event; the SDK queues and flushes in the background. */
	logEvent: (user: StatsigUser, eventName: string, ...args: StatsigEventArguments) => void;
	shutdown: () => Promise<void>;
}

export class StatsigService extends Context.Service<StatsigService, StatsigServiceContract>()(
	"StatsigService",
	{
		make: Effect.gen(function* () {
			const appConfig = yield* AppConfig;
			const logger = yield* AppLoggerService;
			const environment = appConfig.statsig.environment ?? appConfig.nodeEnv;

			if (!appConfig.statsig.enabled || !appConfig.statsig.serverSecretKey) {
				yield* Effect.logInfo("Statsig disabled").pipe(
					Effect.annotateLogs({ environment, enabled: false }),
				);

				const disabledService: StatsigServiceContract = {
					enabled: false,
					checkGate: (
						_user: StatsigUser,
						_gateName: string,
						_options?: FeatureGateEvaluationOptions,
					) => false,
					getFeatureGate: (
						_user: StatsigUser,
						gateName: string,
						_options?: FeatureGateEvaluationOptions,
					) => createDisabledFeatureGate(gateName),
					getDynamicConfig: (
						_user: StatsigUser,
						configName: string,
						_options?: DynamicConfigEvaluationOptions,
					) => createDisabledDynamicConfig(configName),
					getExperiment: (
						_user: StatsigUser,
						experimentName: string,
						_options?: ExperimentEvaluationOptions,
					) => createDisabledExperiment(experimentName),
					getLayer: (_user: StatsigUser, layerName: string, _options?: LayerEvaluationOptions) =>
						createDisabledLayer(layerName),
					getClientInitializeResponse: (_user: StatsigUser, _options?: ClientInitResponseOptions) =>
						"{}",
					logEvent: () => {},
					shutdown: async () => {},
				};

				return disabledService;
			}

			const statsigLogger = new StatsigOutputLogger(logger);
			const sdkOptions: StatsigOptions = {
				environment,
				outputLoggerProvider: statsigLogger,
				outputLogLevel: appConfig.isProduction ? "warn" : "info",
				serviceName: "hccna-backend",
			};

			const client = yield* Effect.tryPromise({
				try: () => initializeStatsigClient(appConfig.statsig.serverSecretKey as string, sdkOptions),
				catch: (cause) =>
					new StatsigInitializationError({
						detail: "initialization failed",
						cause,
					}),
			}).pipe(
				Effect.tap(() =>
					Effect.logInfo("Statsig initialized").pipe(
						Effect.annotateLogs({ environment, enabled: true }),
					),
				),
				Effect.catch((error) =>
					Effect.gen(function* () {
						Sentry.captureException(error);
						yield* Effect.logWarning("Statsig initialization failed").pipe(
							Effect.annotateLogs({
								environment,
								enabled: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						);
						return null;
					}),
				),
			);

			const service: StatsigServiceContract = {
				enabled: client !== null,
				checkGate: (
					user: StatsigUser,
					gateName: string,
					evaluationOptions?: FeatureGateEvaluationOptions,
				) => client?.checkGate(user, gateName, evaluationOptions) ?? false,
				getFeatureGate: (
					user: StatsigUser,
					gateName: string,
					evaluationOptions?: FeatureGateEvaluationOptions,
				) =>
					client?.getFeatureGate(user, gateName, evaluationOptions) ??
					createDisabledFeatureGate(gateName),
				getDynamicConfig: (
					user: StatsigUser,
					configName: string,
					evaluationOptions?: DynamicConfigEvaluationOptions,
				) =>
					client?.getDynamicConfig(user, configName, evaluationOptions) ??
					createDisabledDynamicConfig(configName),
				getExperiment: (
					user: StatsigUser,
					experimentName: string,
					evaluationOptions?: ExperimentEvaluationOptions,
				) =>
					client?.getExperiment(user, experimentName, evaluationOptions) ??
					createDisabledExperiment(experimentName),
				getLayer: (
					user: StatsigUser,
					layerName: string,
					evaluationOptions?: LayerEvaluationOptions,
				) => client?.getLayer(user, layerName, evaluationOptions) ?? createDisabledLayer(layerName),
				getClientInitializeResponse: (
					user: StatsigUser,
					responseOptions?: ClientInitResponseOptions,
				) => client?.getClientInitializeResponse(user, responseOptions) ?? "{}",
				logEvent: (user: StatsigUser, eventName: string, ...args: StatsigEventArguments) => {
					const [value, metadata] = args;
					client?.logEvent(user, eventName, value, metadata);
				},
				shutdown: async () => {
					if (!client) {
						return;
					}

					try {
						await client.shutdown();
					} catch (error) {
						Sentry.captureException(error);
					}
				},
			};

			return service;
		}),
	},
) {}

export const StatsigServiceLive = Layer.effect(StatsigService, StatsigService.make);
