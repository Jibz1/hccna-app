import { AppConfig, type StreamEditUnauthorizedPlatformPolicy } from "@/effect/AppConfig";
import { StrapiStreamAclProvider } from "@/effect/services/StrapiStreamAclProvider";
import {
	StreamAuthorizationService,
	StreamAuthorizationServiceLive,
	type StreamAuthorizationDeniedError,
	type StreamAuthorizationSourceError,
	type StreamEditGrant,
} from "@/effect/services/StreamAuthorizationService";
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Schema } from "effect";

class FakeAclMissingError extends Schema.TaggedError<FakeAclMissingError>()(
	"StreamAclMissingStreamError",
	{ campusSlug: Schema.String },
) {}

class FakeAclMalformedError extends Schema.TaggedError<FakeAclMalformedError>()(
	"StreamAclMalformedError",
	{ campusSlug: Schema.String, detail: Schema.String },
) {}

class FakeAclSourceError extends Schema.TaggedError<FakeAclSourceError>()("StreamAclSourceError", {
	campusSlug: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

interface FakeCoordinator {
	normalizedEmail: string;
	excludedPlatformIds: Set<string>;
	canEditMetadata: boolean;
}

type FakeAclOutcome =
	| { record: { streamId: string; coordinators: FakeCoordinator[] } }
	| { failure: "missing" | "malformed" | "source" };

const aclFailure = (campusSlug: string, failure: "missing" | "malformed" | "source") => {
	switch (failure) {
		case "missing": {
			return new FakeAclMissingError({ campusSlug });
		}
		case "malformed": {
			return new FakeAclMalformedError({ campusSlug, detail: "bad shape" });
		}
		case "source": {
			return new FakeAclSourceError({ campusSlug, cause: new Error("strapi down") });
		}
	}
};

const defaultInput = {
	principalEmail: "coordinator@example.com",
	campusSlug: "house-of-stars",
	claimedStreamId: "stream-123",
	knownPlatformIds: ["platform-1", "platform-2", "platform-3"],
	requestedPlatformIds: ["platform-1"],
	changesMetadata: false,
};

const runAuthorize = (
	outcome: FakeAclOutcome,
	input: Partial<typeof defaultInput> = {},
	policy: StreamEditUnauthorizedPlatformPolicy = "filter",
): Promise<
	| { grant: StreamEditGrant }
	| { error: StreamAuthorizationDeniedError | StreamAuthorizationSourceError }
> => {
	const aclLayer = Layer.succeed(StrapiStreamAclProvider, {
		loadFreshBySlug: (campusSlug: string) =>
			"record" in outcome
				? Effect.succeed({ campusSlug, ...outcome.record })
				: Effect.fail(aclFailure(campusSlug, outcome.failure)),
	} as never);
	const configLayer = Layer.succeed(AppConfig, {
		streamEdit: { unauthorizedPlatformPolicy: policy },
	} as never);
	const dependencyLayer = Layer.mergeAll(aclLayer, configLayer);
	const serviceLayer = StreamAuthorizationServiceLive.pipe(Layer.provide(dependencyLayer));
	const program = Effect.gen(function* () {
		const authorization = yield* StreamAuthorizationService;
		return yield* authorization.authorizeEdit({ ...defaultInput, ...input }).pipe(
			Effect.match({
				onSuccess: (grant) => ({ grant }),
				onFailure: (error) => ({ error }),
			}),
		);
	}).pipe(Effect.provide(serviceLayer));

	return Effect.runPromise(program);
};

const matchingRecord = (overrides: Partial<FakeCoordinator> = {}): FakeAclOutcome => ({
	record: {
		streamId: "stream-123",
		coordinators: [
			{
				normalizedEmail: "coordinator@example.com",
				excludedPlatformIds: new Set<string>(),
				canEditMetadata: true,
				...overrides,
			},
		],
	},
});

describe("StreamAuthorizationService", () => {
	it("derives the allowed set from known platforms minus the matching coordinators' exclusions", async () => {
		const outcome: FakeAclOutcome = {
			record: {
				streamId: "stream-123",
				coordinators: [
					{
						normalizedEmail: "coordinator@example.com",
						excludedPlatformIds: new Set(["platform-2"]),
						canEditMetadata: true,
					},
					{
						normalizedEmail: "other@example.com",
						excludedPlatformIds: new Set(["platform-1"]),
						canEditMetadata: true,
					},
				],
			},
		};

		const result = await runAuthorize(outcome);

		if (!("grant" in result)) {
			throw new Error(`expected grant, got ${result.error._tag}`);
		}
		// other@example.com's exclusions must not restrict this caller.
		expect([...result.grant.allowedPlatformIds].toSorted()).toEqual(["platform-1", "platform-3"]);
		expect(result.grant.streamId).toBe("stream-123");
		expect(result.grant.canEditMetadata).toBe(true);
	});

	it("denies an empty principal identity", async () => {
		const result = await runAuthorize(matchingRecord(), { principalEmail: "   " });

		if (!("error" in result)) {
			throw new Error("expected denial");
		}
		expect(result.error._tag).toBe("StreamAuthorizationDeniedError");
		expect((result.error as StreamAuthorizationDeniedError).reason).toBe("missing-identity");
	});

	it("denies when no coordinator matches the principal", async () => {
		const result = await runAuthorize(matchingRecord({ normalizedEmail: "someone@example.com" }));

		if (!("error" in result)) {
			throw new Error("expected denial");
		}
		expect((result.error as StreamAuthorizationDeniedError).reason).toBe("no-matching-coordinator");
	});

	it("denies when the claimed streamId does not match the Strapi-owned ID", async () => {
		const result = await runAuthorize(matchingRecord(), { claimedStreamId: "someone-elses" });

		if (!("error" in result)) {
			throw new Error("expected denial");
		}
		expect((result.error as StreamAuthorizationDeniedError).reason).toBe("stream-mismatch");
	});

	it("maps ACL missing/malformed to fail-closed denials and source failure to a source error", async () => {
		const missing = await runAuthorize({ failure: "missing" });
		const malformed = await runAuthorize({ failure: "malformed" });
		const source = await runAuthorize({ failure: "source" });

		expect("error" in missing && (missing.error as StreamAuthorizationDeniedError).reason).toBe(
			"missing-stream",
		);
		expect("error" in malformed && (malformed.error as StreamAuthorizationDeniedError).reason).toBe(
			"malformed-acl",
		);
		expect("error" in source && source.error._tag).toBe("StreamAuthorizationSourceError");
	});

	it("filter policy grants even when unauthorized platforms are requested", async () => {
		const result = await runAuthorize(
			matchingRecord({ excludedPlatformIds: new Set(["platform-2"]) }),
			{ requestedPlatformIds: ["platform-1", "platform-2"] },
			"filter",
		);

		if (!("grant" in result)) {
			throw new Error("expected grant under filter policy");
		}
		expect(result.grant.allowedPlatformIds.has("platform-2")).toBe(false);
	});

	it("reject policy denies the whole command when any requested platform is unauthorized (B1)", async () => {
		const result = await runAuthorize(
			matchingRecord({ excludedPlatformIds: new Set(["platform-2"]) }),
			{ requestedPlatformIds: ["platform-1", "platform-2"] },
			"reject",
		);

		if (!("error" in result)) {
			throw new Error("expected B1 rejection");
		}
		const denial = result.error as StreamAuthorizationDeniedError;
		expect(denial.reason).toBe("unauthorized-platforms");
		expect(denial.detail).toBe("platform-2");
	});

	it("reject policy denies metadata changes without metadata permission (B2)", async () => {
		const result = await runAuthorize(
			matchingRecord({ canEditMetadata: false }),
			{ changesMetadata: true },
			"reject",
		);

		if (!("error" in result)) {
			throw new Error("expected B2 rejection");
		}
		expect((result.error as StreamAuthorizationDeniedError).reason).toBe("metadata-denied");
	});
});
