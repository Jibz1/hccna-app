import { CMS_WEBHOOK_SECRET_HEADER } from "@/effect/services/cms/strapiWebhook";
import {
	RedactedHeaderNamesLive,
	sanitizeHeaders,
	sanitizeTelemetryData,
	withoutSecretRequestHeaders,
	withRedactedGraphQLVariables,
} from "@/platform/observability/redaction";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { Headers } from "effect/http";

import type { Event } from "@sentry/bun";

describe("CMS webhook secret header", () => {
	it("is dropped from Sentry events in any case, and the other headers are kept", () => {
		const captured: Event = {
			request: {
				url: "https://api.hccnj.org/graphql",
				headers: {
					[CMS_WEBHOOK_SECRET_HEADER]: "s3cret",
					"X-CMS-Webhook-Secret": "s3cret",
					"user-agent": "strapi",
				},
			},
		};
		const event = withoutSecretRequestHeaders(captured);
		expect(event.request).toEqual({
			url: "https://api.hccnj.org/graphql",
			headers: { "user-agent": "strapi" },
		});
	});

	it("leaves Sentry events without captured headers untouched", () => {
		const event = { message: "boom" };
		expect(withoutSecretRequestHeaders(event)).toBe(event);
	});

	it("is redacted in Effect's HTTP spans, next to Effect's own defaults", async () => {
		const names = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* Headers.CurrentRedactedNames;
			}).pipe(Effect.provide(RedactedHeaderNamesLive)),
		);
		for (const name of [
			"authorization",
			"cookie",
			"set-cookie",
			"x-api-key",
			CMS_WEBHOOK_SECRET_HEADER,
		]) {
			expect(Headers.isRedactedName(name, names)).toBe(true);
		}
		expect(Headers.isRedactedName("user-agent", names)).toBe(false);
	});

	it("is redacted in request telemetry", () => {
		const header = { [CMS_WEBHOOK_SECRET_HEADER]: "s3cret" };
		expect(sanitizeHeaders(header)).toEqual({ [CMS_WEBHOOK_SECRET_HEADER]: "[REDACTED]" });
		expect(sanitizeTelemetryData(header)).toEqual({ [CMS_WEBHOOK_SECRET_HEADER]: "[REDACTED]" });
	});
});

describe("observability redaction", () => {
	it("redacts sensitive keys from telemetry payloads", () => {
		const input = {
			email: "person@example.com",
			token: "super-secret-token",
			requestId: "req_123",
			nested: {
				authorization: "Bearer abc",
				path: "/graphql",
			},
		};

		const result = sanitizeTelemetryData(input);

		expect(result.email).toBe("[REDACTED]");
		expect(result.token).toBe("[REDACTED]");
		expect(result.requestId).toBe("req_123");
		expect(result.nested.authorization).toBe("[REDACTED]");
		expect(result.nested.path).toBe("/graphql");
	});

	it("redacts sensitive headers and preserves safe headers", () => {
		const result = sanitizeHeaders({
			authorization: "Bearer abc",
			"x-request-id": "req_123",
			"user-agent": "bun-test",
			email: "person@example.com",
		});

		expect(result.authorization).toBe("[REDACTED]");
		expect(result["x-request-id"]).toBe("req_123");
		expect(result["user-agent"]).toBe("bun-test");
		expect(result.email).toBe("[REDACTED]");
	});

	it("redacts emails inside free-text values on every call", () => {
		const payload = { note: "Contact person@example.com or other@example.org" };

		for (let index = 0; index < 3; index += 1) {
			expect(sanitizeTelemetryData(payload).note).toBe(
				"Contact [REDACTED_EMAIL] or [REDACTED_EMAIL]",
			);
		}
	});
});

it("redacts push logout capabilities", () => {
	expect(sanitizeTelemetryData({ logoutKey: "secret" })).toEqual({ logoutKey: "[REDACTED]" });
});

it("redacts the GraphQL variables Sentry error events carry", () => {
	const event = withRedactedGraphQLVariables({
		contexts: {
			GraphQL: {
				operationName: "PushTokensUnregisterPushTokenMutation",
				variables: { token: "fcm", logoutKey: "secret", legacyUserId: null },
			},
		},
	});
	expect(event.contexts?.["GraphQL"]).toEqual({
		operationName: "PushTokensUnregisterPushTokenMutation",
		variables: { token: "[REDACTED]", logoutKey: "[REDACTED]", legacyUserId: null },
	});
	const plain = { message: "boom" };
	expect(withRedactedGraphQLVariables(plain)).toBe(plain);
});
