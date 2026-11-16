import { Effect, Option, Schedule, Schema } from "effect";

import { StrapiV2Error } from "./errors";

export type GraphQLVariableValue =
	| string
	| number
	| boolean
	| null
	| readonly GraphQLVariableValue[]
	| { readonly [key: string]: GraphQLVariableValue };

export type GraphQLVariables = { readonly [key: string]: GraphQLVariableValue };

export interface StrapiV2RequestInit {
	readonly method: "POST";
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
	readonly timeout: number;
}

/** Injected so the server keeps its instrumented `serviceRequest` (metrics, spans). */
export type StrapiV2FetchFn = (
	url: string,
	init: StrapiV2RequestInit,
	operation: string,
) => Effect.Effect<Response, unknown>;

export interface StrapiV2ClientConfig {
	/** Full GraphQL URL, for example https://cms.hccna.church/graphql */
	readonly endpoint: string;
	readonly token: string;
}

// Callers run inside the server's 20 s request budget: 3 attempts plus backoff stay well inside it.
const REQUEST_TIMEOUT_MS = 4000;
const retrySchedule = Schedule.exponential("500 millis").pipe(Schedule.upTo({ times: 2 }));

const Envelope = Schema.Struct({
	data: Schema.optional(Schema.NullOr(Schema.Unknown)),
	errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
});

const isRetryable = (error: StrapiV2Error): boolean =>
	error.reason === "Transport" ||
	(error.reason === "Status" &&
		error.status !== undefined &&
		(error.status >= 500 || error.status === 408 || error.status === 429));

// Enough for Strapi's GraphQL validation messages (a renamed field answers 400 with
// `errors[].message`); the rest of an error body is never read.
const ERROR_BODY_MAX_BYTES = 2048;

const ErrorBody = Schema.fromJsonString(
	Schema.Struct({ errors: Schema.Array(Schema.Struct({ message: Schema.String })) }),
);

/** The first 2 KB of a non-OK body, best-effort: a body that cannot be read counts as empty. */
const readErrorBodyStart = (response: Response): Effect.Effect<string> =>
	Effect.tryPromise(async () => {
		const bytes: number[] = [];
		for await (const chunk of response.body ?? []) {
			bytes.push(...chunk.subarray(0, ERROR_BODY_MAX_BYTES - bytes.length));
			if (bytes.length >= ERROR_BODY_MAX_BYTES) {
				break;
			}
		}
		return new TextDecoder().decode(new Uint8Array(bytes));
	}).pipe(Effect.orElseSucceed(() => ""));

/** `: <message>; <message>` when the body is a GraphQL error response, otherwise "". */
const graphQLErrorsSuffix = (body: string): string =>
	Option.match(Schema.decodeUnknownOption(ErrorBody)(body), {
		onNone: () => "",
		onSome: ({ errors }) =>
			errors.length === 0 ? "" : `: ${errors.map((error) => error.message).join("; ")}`,
	});

export const makeTransport = (config: StrapiV2ClientConfig, fetch: StrapiV2FetchFn) => {
	const once = <A>(
		operation: string,
		document: string,
		variables: GraphQLVariables,
		data: Schema.Codec<A>,
	): Effect.Effect<A, StrapiV2Error> =>
		Effect.gen(function* () {
			const response = yield* fetch(
				config.endpoint,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${config.token}`,
						// The CMS's strapi-cache plugin caches /graphql answers, authorized ones too, and
						// misses some purges, so a read right after a publish could get the old answer.
						// no-cache makes it skip its cache; the server keeps its own record cache.
						"Cache-Control": "no-cache",
					},
					body: JSON.stringify({ operationName: operation, query: document, variables }),
					timeout: REQUEST_TIMEOUT_MS,
				},
				operation,
			).pipe(
				Effect.mapError(
					(cause) =>
						new StrapiV2Error({
							reason: "Transport",
							operation,
							detail: "Failed to reach Strapi 5",
							cause,
						}),
				),
			);

			if (!response.ok) {
				const body = yield* readErrorBodyStart(response);
				return yield* new StrapiV2Error({
					reason: "Status",
					operation,
					status: response.status,
					detail: `Strapi 5 responded ${response.status} ${response.statusText}${graphQLErrorsSuffix(body)}`,
				});
			}

			const text = yield* Effect.tryPromise({
				try: () => response.text(),
				catch: (cause) =>
					new StrapiV2Error({
						reason: "Transport",
						operation,
						detail: "Failed to read the Strapi 5 response body",
						cause,
					}),
			});

			const body = yield* Effect.try({
				try: () => JSON.parse(text),
				catch: (cause) =>
					new StrapiV2Error({
						reason: "Decode",
						operation,
						detail: "Response body is not JSON",
						cause,
					}),
			});

			const envelope = yield* Schema.decodeUnknownEffect(Envelope)(body).pipe(
				Effect.mapError(
					(cause) =>
						new StrapiV2Error({ reason: "Decode", operation, detail: cause.message, cause }),
				),
			);

			if (envelope.errors !== undefined && envelope.errors.length > 0) {
				return yield* new StrapiV2Error({
					reason: "GraphQL",
					operation,
					detail: envelope.errors.map((error) => error.message).join("; "),
				});
			}

			return yield* Schema.decodeUnknownEffect(data)(envelope.data).pipe(
				Effect.mapError(
					(cause) =>
						new StrapiV2Error({ reason: "Decode", operation, detail: cause.message, cause }),
				),
			);
		});

	const query = <A>(
		operation: string,
		document: string,
		variables: GraphQLVariables,
		data: Schema.Codec<A>,
	): Effect.Effect<A, StrapiV2Error> =>
		once(operation, document, variables, data).pipe(
			Effect.retry({ schedule: retrySchedule, while: isRetryable }),
			Effect.withSpan(`StrapiV2.${operation}`),
		);

	return { query };
};
