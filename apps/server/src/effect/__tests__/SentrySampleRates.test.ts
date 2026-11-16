import { AppConfig, AppConfigLive } from "@/effect/AppConfig";
import { describe, expect, it } from "bun:test";
import { ConfigProvider, Effect, Layer } from "effect";

const loadConfig = (env: Record<string, string>) => {
	const configProvider = ConfigProvider.layer(ConfigProvider.fromEnv({ env }));
	const configLayer = AppConfigLive.pipe(Layer.provide(configProvider));
	const program = Effect.gen(function* () {
		return yield* AppConfig;
	});
	return Effect.runSync(program.pipe(Effect.provide(configLayer)));
};

describe("Sentry sample rates", () => {
	it("defaults errors to 0.8 and traces to 0.1", () => {
		const { observability } = loadConfig({});

		expect(observability.sentrySampleRate).toBe(0.8);
		expect(observability.sentryTracesSampleRate).toBe(0.1);
	});

	it("reads the two rates from separate variables", () => {
		const { observability } = loadConfig({
			SENTRY_SAMPLE_RATE: "0.5",
			SENTRY_TRACES_SAMPLE_RATE: "0.02",
		});

		expect(observability.sentrySampleRate).toBe(0.5);
		expect(observability.sentryTracesSampleRate).toBe(0.02);
	});

	it("keeps the error rate independent of the traces rate", () => {
		const { observability } = loadConfig({ SENTRY_SAMPLE_RATE: "0.3" });

		expect(observability.sentrySampleRate).toBe(0.3);
		expect(observability.sentryTracesSampleRate).toBe(0.1);
	});

	it("falls back to the default when the traces rate is not a number", () => {
		expect(
			loadConfig({ SENTRY_TRACES_SAMPLE_RATE: "lots" }).observability.sentryTracesSampleRate,
		).toBe(0.1);
	});
});
