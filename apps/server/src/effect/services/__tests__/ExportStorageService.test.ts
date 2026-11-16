import { AppConfig } from "@/effect/AppConfig";
import { testAppConfig } from "@/effect/services/__tests__/fixtures";
import {
	ExportStorageService,
	makeExportStorageServiceLayer,
} from "@/effect/services/ExportStorageService";
import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import { describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";

function makeBucketStub() {
	const makePrivate = mock(() => Promise.resolve());
	const save = mock(() => Promise.resolve());
	const file = mock(() => ({
		makePrivate,
		save,
	}));

	return {
		bucket: { file },
		file,
		makePrivate,
		save,
	};
}

const runProvided = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
	Effect.runPromise(effect as never);

describe("ExportStorageService", () => {
	it("uploads a private export file through the bucket wrapper", async () => {
		const bucketStub = makeBucketStub();
		const layer = makeExportStorageServiceLayer().pipe(
			Layer.provide(Layer.succeed(AppConfig, testAppConfig as never)),
			Layer.provide(
				Layer.succeed(FirebaseAdminService, {
					app: {} as never,
					auth: {} as never,
					collections: {} as never,
					db: {} as never,
					dbFieldValue: {} as never,
					fieldPath: {} as never,
					paths: {} as never,
					secondaryApp: {} as never,
					secondaryDb: {} as never,
					getStorageBucket: () => bucketStub.bucket as never,
					sendMessage: () => Effect.succeed("ok"),
				} as never),
			),
		);
		const program = Effect.gen(function* () {
			const service = yield* ExportStorageService;
			yield* service.uploadPrivateFile({
				contentType: "application/pdf",
				data: Buffer.from("hello"),
				objectPath: "exports/file.pdf",
			});
		});

		await runProvided(Effect.provide(program, layer));

		expect(bucketStub.file).toHaveBeenCalledWith("exports/file.pdf");
		expect(bucketStub.save).toHaveBeenCalledTimes(1);
		expect(bucketStub.makePrivate).toHaveBeenCalledTimes(1);
	});
});
