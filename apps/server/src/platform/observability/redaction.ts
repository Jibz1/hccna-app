import { Layer, Predicate } from "effect";
// Aliased: sanitizeHeaders below takes the global Fetch `Headers`.
import { Headers as EffectHeaders } from "effect/http";

import type { Event } from "@sentry/bun";

/**
 * Request headers that carry secrets, lowercase as Fetch `Headers` and Sentry name them. The
 * request logger, Effect's HTTP spans and Sentry events all drop them.
 */
export const SECRET_REQUEST_HEADERS = ["x-cms-webhook-secret"] as const;

const SECRET_REQUEST_HEADER_NAMES = new Set<string>(SECRET_REQUEST_HEADERS);

/** Effect's HTTP server and client spans record request headers: keep its defaults, add ours. */
export const RedactedHeaderNamesLive = Layer.succeed(EffectHeaders.CurrentRedactedNames, [
	...EffectHeaders.CurrentRedactedNames.defaultValue(),
	...SECRET_REQUEST_HEADERS,
]);

/**
 * Sentry copies every incoming request header into the events it sends; its own filter covers
 * span attributes only. Drops the secret headers before an event leaves the process.
 */
export function withoutSecretRequestHeaders<SentryEvent extends Event>(
	event: SentryEvent,
): SentryEvent {
	const headers = event.request?.headers;
	if (headers === undefined) {
		return event;
	}
	const kept = Object.entries(headers).filter(
		([name]) => !SECRET_REQUEST_HEADER_NAMES.has(name.toLowerCase()),
	);
	return { ...event, request: { ...event.request, headers: Object.fromEntries(kept) } };
}

/**
 * `@envelop/sentry` attaches the raw GraphQL variables to every error it captures, and Sentry's
 * own scrubbing does not know our credential names. Applies the telemetry redaction to them.
 */
export function withRedactedGraphQLVariables<SentryEvent extends Event>(
	event: SentryEvent,
): SentryEvent {
	const graphql = event.contexts?.["GraphQL"];
	if (graphql?.["variables"] === undefined) {
		return event;
	}
	// Variables are the request's decoded JSON, so they are already telemetry values.
	const variables = sanitizeTelemetryData(graphql["variables"] as TelemetryValue);
	return { ...event, contexts: { ...event.contexts, GraphQL: { ...graphql, variables } } };
}

const DEFAULT_ALLOWLIST = new Set([
	"action",
	"fields",
	"method",
	"operationName",
	"operationType",
	"path",
	"requestId",
	"service",
	"spanId",
	"status",
	"time",
	"traceId",
	"userAgent",
]);

const SENSITIVE_KEY_PATTERNS = [
	/^logoutKey$/iu,
	/(?:^|_|-)auth(?:entication|orization)?(?:$|_|-)/iu,
	/(?:^|_|-)token(?:$|_|-)/iu,
	/(?:^|_|-)secret(?:$|_|-)/iu,
	/(?:^|_|-)password(?:$|_|-)/iu,
	/(?:^|_|-)cookie(?:$|_|-)/iu,
	/(?:^|_|-)api(?:_|-)?key(?:$|_|-)/iu,
	/(?:^|_|-)session(?:$|_|-)/iu,
	/(?:^|_|-)email(?:$|_|-)/iu,
	/(?:^|_|-)uid(?:$|_|-)/iu,
];

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;

export type TelemetryValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly TelemetryValue[]
	| TelemetryRecord;

interface TelemetryRecord {
	readonly [key: string]: TelemetryValue;
}

type SanitizedHeaders = Record<string, string>;

function isSensitiveKey(key: string): boolean {
	if (DEFAULT_ALLOWLIST.has(key)) {
		return false;
	}

	return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function sanitizeString(value: string): string {
	return value.replace(EMAIL_PATTERN, "[REDACTED_EMAIL]");
}

function sanitizeObject(input: TelemetryRecord): TelemetryRecord {
	const output: Record<string, TelemetryValue> = {};

	for (const [key, value] of Object.entries(input)) {
		output[key] = isSensitiveKey(key) ? "[REDACTED]" : sanitizeUnknown(value);
	}

	return output;
}

function sanitizeUnknown(value: TelemetryValue): TelemetryValue {
	if (Predicate.isString(value)) {
		return sanitizeString(value);
	}

	if (Array.isArray(value)) {
		return value.map((item) => sanitizeUnknown(item));
	}

	if (Predicate.isObject(value)) {
		return sanitizeObject(
			Object.fromEntries(Object.entries(value)) as Record<string, TelemetryValue>,
		);
	}

	return value;
}

export function sanitizeTelemetryData<T extends TelemetryValue>(value: T): T {
	return sanitizeUnknown(value) as T;
}

export function sanitizeHeaders(headers: Headers | Record<string, string | undefined>) {
	const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);

	const sanitized: SanitizedHeaders = {};

	for (const [key, value] of entries) {
		if (Predicate.isNotUndefined(value)) {
			sanitized[key] = isSensitiveKey(key) ? "[REDACTED]" : sanitizeString(value);
		}
	}

	return sanitized;
}
