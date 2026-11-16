import { Effect, Result, Schedule, Schema } from "effect";

import {
	CASTR_Response,
	CastrFetchError,
	CastrParseError,
	CastrPatchError,
	CASTRRequestType,
	type CASTRResponse,
	type LiveStreams,
	type UpdatePlatformRequest,
} from "./types";

// using CastrFetchFn instead of HttpClient directly If client.ts used @effect/platform HttpClient directly, the client would either
// (a) require Effect environment dependencies in its API (Runtime includes HttpClient) or
// (b) hide runtime provisioning internally; both increase coupling for a small shared package.

export type CastrFetchFn = (
	url: string,
	options: {
		method: "GET" | "PATCH";
		headers: Record<string, string>;
		body?: string;
		timeout?: number;
	},
) => Promise<Response>;

export interface CastrClientConfig {
	apiEndpoint: string;
	username: string;
	password: string;
}

export interface CastrClient {
	getLiveStreams: () => Effect.Effect<LiveStreams, CastrFetchError | CastrParseError>;
	patchPlatform: (args: {
		streamId: string;
		platformId: string;
		data: UpdatePlatformRequest;
	}) => Effect.Effect<CASTRResponse[CASTRRequestType.UPDATE_PLATFORM], CastrPatchError>;
}

const retrySchedule = Schedule.exponential("500 millis").pipe(
	Schedule.upTo({ times: 2 }), // 2 retries = 3 total attempts
);

const MAX_RESPONSE_PREVIEW_LENGTH = 200;

const sanitizeResponsePreview = (rawResponse: string): string => {
	const normalized = rawResponse.replaceAll(/\s+/gu, " ").trim();
	if (normalized.length === 0) {
		return "<empty>";
	}
	return normalized.slice(0, MAX_RESPONSE_PREVIEW_LENGTH);
};

// Enough bytes for a preview even after whitespace collapses; an error body is
// never buffered whole just to keep its start.
const MAX_ERROR_BODY_BYTES = 4096;

const readErrorBodyPreview = async (res: Response): Promise<string> => {
	const reader = res.body?.getReader();
	if (!reader) {
		return sanitizeResponsePreview("");
	}
	const decoder = new TextDecoder();
	let text = "";
	let readBytes = 0;
	try {
		while (readBytes < MAX_ERROR_BODY_BYTES) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			const kept = value.subarray(0, MAX_ERROR_BODY_BYTES - readBytes);
			readBytes += kept.byteLength;
			text += decoder.decode(kept, { stream: true });
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	return sanitizeResponsePreview(text + decoder.decode());
};

export const parseJsonResponse = async (res: Response): Promise<unknown> => {
	const rawResponse = await res.text();
	if (rawResponse.trim().length === 0) {
		return null;
	}

	try {
		return JSON.parse(rawResponse) as unknown;
	} catch {
		const contentType = res.headers.get("content-type") ?? "unknown";
		const preview = sanitizeResponsePreview(rawResponse);
		throw new Error(
			`[CastrClient] JSON parse failed (content-type: ${contentType}, preview: ${preview})`,
		);
	}
};

export const getAuthHeader = ({ username, password }: { username: string; password: string }) =>
	`Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

export function createCastrClient(config: CastrClientConfig, httpFetch: CastrFetchFn): CastrClient {
	const { apiEndpoint, username, password } = config;
	const authHeader = getAuthHeader({ username, password });

	const getLiveStreams = Effect.fn("CastrClient.getLiveStreams")(function* () {
		return yield* Effect.gen(function* () {
			const res = yield* Effect.tryPromise({
				try: () =>
					httpFetch(`${apiEndpoint}/v2/live_streams`, {
						method: "GET",
						headers: {
							"Content-Type": "application/json",
							Authorization: authHeader,
						},
						// Callers run inside a 20s request budget (APP_TIMEOUT_MS); all
						// 3 retry attempts plus backoff must resolve within it so a hung
						// upstream fails into the stale-cache path instead of a 504.
						timeout: 4000,
					}),
				catch: (error) =>
					new CastrFetchError({
						message: "Failed to fetch from Castr API",
						cause: error,
					}),
			});

			if (!res.ok) {
				return yield* Effect.fail(
					new CastrFetchError({
						message: `Castr API error: ${res.status} ${res.statusText}`,
					}),
				);
			}

			const jsonData = yield* Effect.tryPromise({
				try: () => parseJsonResponse(res),
				catch: (error) =>
					new CastrFetchError({
						message: "Failed to parse Castr response as JSON",
						cause: error,
					}),
			});

			const parsedData = Schema.decodeUnknownResult(
				CASTR_Response[CASTRRequestType.GET_LIVE_STREAMS],
			)(jsonData);

			if (Result.isFailure(parsedData)) {
				yield* Effect.logWarning("Castr parse error").pipe(
					Effect.annotateLogs({
						operation: "createCastrClient.getLiveStreams",
						error: String(parsedData.failure),
					}),
				);
				return yield* Effect.fail(
					new CastrParseError({
						message: "Failed to parse Castr data",
						cause: parsedData.failure,
					}),
				);
			}

			return parsedData.success;
		}).pipe(
			Effect.retry({
				schedule: retrySchedule,
				while: (err) => {
					if (err._tag !== "CastrFetchError") {
						return false;
					}
					// Transport failure (timeout, connection reset, DNS, etc.)
					// Only retry the fetch-level error, not downstream parse errors
					if (err.message === "Failed to fetch from Castr API" && err.cause !== null) {
						return true;
					}
					// HTTP status-based retry (5xx, 408, 429)
					return /API error: (?<statusCode>5\d{2}|408|429)/u.test(err.message);
				},
			}),
		);
	});

	const patchPlatform = Effect.fn("CastrClient.patchPlatform")(function* ({
		streamId,
		platformId,
		data,
	}: {
		streamId: string;
		platformId: string;
		data: UpdatePlatformRequest;
	}) {
		const res = yield* Effect.tryPromise({
			try: () =>
				httpFetch(`${apiEndpoint}/v2/live_streams/${streamId}/platforms/${platformId}`, {
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: authHeader,
					},
					body: JSON.stringify({
						enabled: data.enabled,
						key: data.key || undefined,
						template: data.template || undefined,
						server: data.server || undefined,
						metadata: data.metadata
							? {
									title: data.metadata.title,
									description: data.metadata.description,
								}
							: undefined,
					}),
					// No retries here, but must still finish inside the 20s request budget.
					timeout: 10_000,
				}),
			catch: (error) =>
				new CastrPatchError({
					message: "Failed to patch Castr platform",
					cause: error,
				}),
		});

		if (!res.ok) {
			const body = yield* Effect.promise(() =>
				readErrorBodyPreview(res).catch(() => "<unreadable>"),
			);
			return yield* Effect.fail(
				new CastrPatchError({
					message: `Castr API error: ${res.status} ${res.statusText}`,
					status: res.status,
					body,
				}),
			);
		}

		const responseData = yield* Effect.tryPromise({
			try: () => parseJsonResponse(res),
			catch: (error) =>
				new CastrPatchError({
					message: "Failed to parse patch response as JSON",
					cause: error,
				}),
		});

		const parsedData = Schema.decodeUnknownResult(CASTR_Response[CASTRRequestType.UPDATE_PLATFORM])(
			responseData,
		);

		if (Result.isFailure(parsedData)) {
			yield* Effect.logWarning("Castr patch parse error").pipe(
				Effect.annotateLogs({
					operation: "createCastrClient.patchPlatform",
					error: String(parsedData.failure),
				}),
			);
			return yield* Effect.fail(
				new CastrPatchError({
					message: "Failed to parse Castr patch response",
					cause: parsedData.failure,
				}),
			);
		}

		return parsedData.success;
	});

	return {
		getLiveStreams,
		patchPlatform,
	};
}
