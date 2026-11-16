import { AppConfig, AppConfigLive } from "@/effect/AppConfig";
import { whenBackgroundWorkersEnabled } from "@/effect/BackgroundWorkers";
import { testAppConfig } from "@/effect/services/__tests__/fixtures";
import { describe, expect, it } from "bun:test";
import { ConfigProvider, Effect, Layer, Logger } from "effect";

const loadConfig = (env: Record<string, string>) => {
	const configProvider = ConfigProvider.layer(ConfigProvider.fromEnv({ env }));
	const configLayer = AppConfigLive.pipe(Layer.provide(configProvider));
	const program = Effect.gen(function* () {
		return yield* AppConfig;
	});
	return Effect.runSync(program.pipe(Effect.provide(configLayer)));
};

const startWorkers = (started: string[]) =>
	Effect.forkScoped(Effect.sync(() => started.push("onboarding"))).pipe(
		Effect.andThen(Effect.sleep("20 millis")),
	);

const runWithWorkersEnabled = async (enabled: boolean) => {
	const started: string[] = [];
	const messages: unknown[] = [];
	const layer = Layer.mergeAll(
		Layer.succeed(AppConfig, { ...testAppConfig, backgroundWorkers: { enabled } }),
		Logger.layer([Logger.make((options) => messages.push(options.message))]),
	);
	await Effect.runPromise(
		whenBackgroundWorkersEnabled(startWorkers(started)).pipe(Effect.scoped, Effect.provide(layer)),
	);
	return { started, messages };
};

describe("BACKGROUND_WORKERS_ENABLED", () => {
	it("defaults to enabled", () => {
		expect(loadConfig({}).backgroundWorkers.enabled).toBe(true);
	});

	it.each([
		["false", false],
		[" FALSE ", false],
		["true", true],
	])("parses %p", (value, expected) => {
		expect(loadConfig({ BACKGROUND_WORKERS_ENABLED: value }).backgroundWorkers.enabled).toBe(
			expected,
		);
	});

	it("rejects values other than true or false", () => {
		expect(() => loadConfig({ BACKGROUND_WORKERS_ENABLED: "no" })).toThrow(
			"BACKGROUND_WORKERS_ENABLED must be either true or false",
		);
	});
});

describe("whenBackgroundWorkersEnabled", () => {
	it("starts the workers when enabled", async () => {
		const { started, messages } = await runWithWorkersEnabled(true);

		expect(started).toEqual(["onboarding"]);
		expect(messages).toEqual([]);
	});

	it("starts no worker and logs once when disabled", async () => {
		const { started, messages } = await runWithWorkersEnabled(false);

		expect(started).toEqual([]);
		expect(messages).toEqual([["Background workers disabled"]]);
	});
});
