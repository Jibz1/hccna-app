import { DateTime, Effect, Schedule, Schema } from "effect";

import {
	CCB_Response,
	CCBFetchError,
	CCBParseError,
	CCBRemoteError,
	CCBRequestType,
	type CCBError,
	type CCBParams,
	type CCBResponse,
	type CreateEventAttendanceInput,
} from "./types";
import { buildCCBUrl } from "./url";
import { buildCCBXmlBody, type CCBXmlInput, parseCCBXmlResponse } from "./xml";

const retrySchedule = Schedule.exponential("500 millis").pipe(
	Schedule.upTo({ times: 2 }), // 2 retries = 3 total attempts
);

/** Generic HTTP fetch function the app injects (e.g. wrapping serviceRequest). */
// using CCBFetchFn instead of HttpClient directly If client.ts used @effect/platform HttpClient directly, the client would either
// (a) require Effect environment dependencies in its API (Runtime includes HttpClient) or
// (b) hide runtime provisioning internally; both increase coupling for a small shared package.
export type CCBFetchFn = (
	url: string,
	options: {
		method: "GET" | "POST";
		headers: Record<string, string>;
		body?: FormData;
		timeout?: number;
	},
) => Promise<Response>;

export interface CCBClientConfig {
	apiEndpoint: string;
	username: string;
	password: string;
}

export interface CCBClient {
	/** Low-level GET: fetch + XML parse + schema validation. */
	fetchGet: <T extends CCBRequestType>(
		url: string,
		type: T,
	) => Effect.Effect<CCBResponse<T>, CCBFetchError | CCBParseError>;

	/**
	 * Low-level POST: build XML body, fetch, parse, and surface remote errors.
	 *
	 * POST endpoints do not currently share stable response schemas the way GET
	 * endpoints do. Callers use POST for side effects and only rely on
	 * transport-level success plus the `<error>` envelope returned by CCB.
	 */
	fetchPost: <TOut = unknown>(
		endpoint: string,
		jsonData: CCBXmlInput,
	) => Effect.Effect<TOut, CCBError>;

	/** High-level: build URL from type+params, then fetchGet. */
	request: <T extends CCBRequestType>(
		type: T,
		params: CCBParams[T],
	) => Effect.Effect<CCBResponse<T>, CCBFetchError | CCBParseError>;

	// Convenience methods
	searchUserByEmail: (
		email: string,
	) => Effect.Effect<
		CCBResponse<CCBRequestType.SEARCH_USER_BY_EMAIL>,
		CCBFetchError | CCBParseError
	>;
	getUserGroupsById: (
		individualId: number,
	) => Effect.Effect<
		CCBResponse<CCBRequestType.GET_USER_GROUPS_BY_ID>,
		CCBFetchError | CCBParseError
	>;
	getGroups: (
		modifiedSince?: string,
	) => Effect.Effect<CCBResponse<CCBRequestType.GET_GROUPS>, CCBFetchError | CCBParseError>;
	addUserToGroup: (params: {
		individualId: number;
		groupId: number;
		isPending?: boolean;
	}) => Effect.Effect<CCBResponse<CCBRequestType.ADD_USER_GROUPS>, CCBFetchError | CCBParseError>;
	removeUserFromGroup: (params: {
		individualId: number;
		groupId: number;
	}) => Effect.Effect<CCBResponse<CCBRequestType.REMOVE_USER_GROUP>, CCBFetchError | CCBParseError>;
	getGroupParticipants: (
		groupId: number,
	) => Effect.Effect<CCBResponse<CCBRequestType.GET_GROUPS_MEMBERS>, CCBFetchError | CCBParseError>;
	getGiving: (
		familyId: string,
		year?: number,
	) => Effect.Effect<CCBResponse<CCBRequestType.GET_GIVING>, CCBFetchError | CCBParseError>;
	getAttendanceProfile: (
		eventId: number,
		occurrence: string,
	) => Effect.Effect<
		CCBResponse<CCBRequestType.GET_ATTENDANCE_PROFILE>,
		CCBFetchError | CCBParseError
	>;
	createEventAttendance: (input: CreateEventAttendanceInput) => Effect.Effect<unknown, CCBError>;
}

function getAuthHeader(username: string, password: string): string {
	return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function parseWithSchema<T extends CCBRequestType, Input>(
	schema: (typeof CCB_Response)[T],
	data: Input,
): Effect.Effect<CCBResponse<T>, CCBParseError> {
	return Schema.decodeUnknownEffect(schema)(data).pipe(
		Effect.mapError(
			(error) =>
				new CCBParseError({
					message: "Schema validation failed",
					cause: String(error),
				}),
		),
		Effect.tapError(() =>
			Effect.logError("CCB parse error").pipe(
				Effect.annotateLogs({ operation: "parseWithSchema" }),
			),
		),
	) as Effect.Effect<CCBResponse<T>, CCBParseError>;
}

/**
 * Create a CCB API client.
 *
 * The `httpFetch` callback is the only point of contact with app infrastructure.
 * The app typically wraps `serviceRequest` to add Sentry spans and metrics.
 */
export function createCCBClient(config: CCBClientConfig, httpFetch: CCBFetchFn): CCBClient {
	const { apiEndpoint, username, password } = config;
	const authHeader = getAuthHeader(username, password);

	const fetchGet = <T extends CCBRequestType>(
		url: string,
		type: T,
	): Effect.Effect<CCBResponse<T>, CCBFetchError | CCBParseError> =>
		Effect.fn("CCBClient.fetchGet")(function* () {
			return yield* Effect.gen(function* () {
				const startTime = DateTime.toEpochMillis(yield* DateTime.now);

				const res = yield* Effect.tryPromise({
					try: () =>
						httpFetch(`${apiEndpoint}?${url}`, {
							method: "GET",
							headers: { Authorization: authHeader },
							timeout: 15_000,
						}),
					catch: (error) =>
						new CCBFetchError({
							message: "CCB request failed",
							cause: error,
						}),
				});

				const fetchDurationMs = DateTime.toEpochMillis(yield* DateTime.now) - startTime;

				if (!res.ok) {
					yield* Effect.logWarning("CCB GET request failed").pipe(
						Effect.annotateLogs({
							type,
							status: res.status,
							statusText: res.statusText,
							durationMs: fetchDurationMs,
						}),
					);
					return yield* Effect.fail(
						new CCBFetchError({
							message: `CCB API error: ${res.status} ${res.statusText}`,
						}),
					);
				}

				const xmlText = yield* Effect.tryPromise({
					try: () => res.text(),
					catch: (error) =>
						new CCBFetchError({
							message: "Failed to read response",
							cause: error,
						}),
				});

				const body = yield* Effect.try({
					try: () => parseCCBXmlResponse(xmlText),
					catch: (error) =>
						new CCBParseError({
							message: "Failed to parse CCB XML",
							cause: String(error),
						}),
				});

				if (!body && type === CCBRequestType.GET_ATTENDANCE_PROFILE) {
					return yield* Effect.fail(new CCBParseError({ message: "No response body from CCB" }));
				}

				const result = yield* parseWithSchema(CCB_Response[type], body).pipe(
					Effect.tapError(() =>
						Effect.logWarning("CCB response schema validation failed").pipe(
							Effect.annotateLogs({
								type,
								durationMs: fetchDurationMs,
							}),
						),
					),
				);

				const totalDurationMs = DateTime.toEpochMillis(yield* DateTime.now) - startTime;
				yield* Effect.logInfo("CCB GET request completed").pipe(
					Effect.annotateLogs({
						type,
						status: res.status,
						fetchDurationMs,
						totalDurationMs,
					}),
				);

				return result;
			}).pipe(
				Effect.retry({
					schedule: retrySchedule,
					while: (err) => {
						if (err._tag !== "CCBFetchError") {
							return false;
						}
						// Transport failure (timeout, connection reset, DNS, etc.)
						if (
							err.cause !== null &&
							(err.message === "CCB request failed" || err.message === "Failed to read response")
						) {
							return true;
						}
						// HTTP status-based retry (5xx, 408, 429)
						return /API error: (?<statusCode>5\d{2}|408|429)/u.test(err.message);
					},
				}),
			);
		})();

	// POST endpoints are currently used for side effects only. We validate the
	// transport status and the CCB error envelope, but return the parsed payload
	// as-is because there is no shared schema map for POST responses yet.
	const fetchPost = <TOut = unknown>(endpoint: string, jsonData: CCBXmlInput) =>
		Effect.fn("CCBClient.fetchPost")(function* () {
			const startTime = DateTime.toEpochMillis(yield* DateTime.now);

			const xml = buildCCBXmlBody(jsonData);

			const form = new FormData();
			form.append("filedata", new Blob([xml], { type: "application/xml" }), "request.xml");

			const action = endpoint.includes("=")
				? (endpoint.split("=")[1]?.split("&")[0] ?? "post")
				: "post";

			const res = yield* Effect.tryPromise({
				try: () =>
					httpFetch(`${apiEndpoint}?${endpoint}`, {
						method: "POST",
						headers: { Authorization: authHeader },
						body: form,
						timeout: 30_000,
					}),
				catch: (error) =>
					new CCBFetchError({
						message: "CCB POST request failed",
						cause: error,
					}),
			});

			const fetchDurationMs = DateTime.toEpochMillis(yield* DateTime.now) - startTime;

			if (!res.ok) {
				yield* Effect.logWarning("CCB POST request failed").pipe(
					Effect.annotateLogs({
						action,
						status: res.status,
						statusText: res.statusText,
						durationMs: fetchDurationMs,
					}),
				);
				return yield* Effect.fail(
					new CCBFetchError({
						message: `CCB POST error: ${res.status} ${res.statusText}`,
					}),
				);
			}

			const xmlText = yield* Effect.tryPromise({
				try: () => res.text(),
				catch: (error) =>
					new CCBFetchError({
						message: "Failed to read POST response",
						cause: error,
					}),
			});

			const parsed = yield* Effect.try({
				try: () => parseCCBXmlResponse(xmlText),
				catch: (error) =>
					new CCBParseError({
						message: "Failed to parse CCB XML",
						cause: String(error),
					}),
			});

			const parsedObj = parsed as
				| {
						errors?: { error?: { text?: string } };
						error?: { text?: string };
				  }
				| undefined;
			if (parsedObj?.errors || parsedObj?.error) {
				const errorMsg =
					parsedObj?.errors?.error?.text ?? parsedObj?.error?.text ?? "CCB returned an error";
				yield* Effect.logWarning("CCB POST returned remote error").pipe(
					Effect.annotateLogs({
						action,
						ccbError: errorMsg,
						durationMs: fetchDurationMs,
					}),
				);
				return yield* Effect.fail(new CCBRemoteError({ message: errorMsg }));
			}

			const totalDurationMs = DateTime.toEpochMillis(yield* DateTime.now) - startTime;
			yield* Effect.logInfo("CCB POST request completed").pipe(
				Effect.annotateLogs({
					action,
					status: res.status,
					fetchDurationMs,
					totalDurationMs,
				}),
			);

			return parsed as TOut;
		})();

	const request = <T extends CCBRequestType>(
		type: T,
		params: CCBParams[T],
	): Effect.Effect<CCBResponse<T>, CCBFetchError | CCBParseError> => {
		const url = buildCCBUrl(type, params);
		return fetchGet(url, type);
	};

	return {
		fetchGet,
		fetchPost,
		request,

		searchUserByEmail: (email) => request(CCBRequestType.SEARCH_USER_BY_EMAIL, { email }),

		getUserGroupsById: (individualId) =>
			request(CCBRequestType.GET_USER_GROUPS_BY_ID, { individualId }),

		getGroups: (modifiedSince?) =>
			request(CCBRequestType.GET_GROUPS, modifiedSince ? { modifiedSince } : {}),

		addUserToGroup: (params) => request(CCBRequestType.ADD_USER_GROUPS, params),

		removeUserFromGroup: (params) => request(CCBRequestType.REMOVE_USER_GROUP, params),

		getGroupParticipants: (groupId) => request(CCBRequestType.GET_GROUPS_MEMBERS, { groupId }),

		getGiving: (familyId, year?) =>
			request(CCBRequestType.GET_GIVING, year ? { familyId, year } : { familyId }),

		getAttendanceProfile: (eventId, occurrence) =>
			request(CCBRequestType.GET_ATTENDANCE_PROFILE, { eventId, occurrence }),

		createEventAttendance: (input) =>
			fetchPost("srv=create_event_attendance", {
				events: {
					event: {
						"@_id": input.eventId,
						"@_occurrence": input.occurrence,
						did_not_meet: "false",
						head_count: input.attendeeIds.length,
						attendees: {
							attendee: input.attendeeIds.map((id) => ({
								"@_id": id,
								"#text": "",
							})),
						},
						topic: input.topic ?? "",
						notes: input.notes ?? "",
						email_notification: "none",
					},
				},
			}),
	};
}
