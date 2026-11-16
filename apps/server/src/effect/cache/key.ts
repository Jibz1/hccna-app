import { Predicate } from "effect";

export type CacheKeyPart =
	| boolean
	| number
	| string
	| null
	| undefined
	| readonly CacheKeyPart[]
	| { readonly [key: string]: CacheKeyPart };

type NormalizedCacheKeyPart =
	| boolean
	| number
	| string
	| null
	| readonly NormalizedCacheKeyPart[]
	| { readonly [key: string]: NormalizedCacheKeyPart };

function normalizePart(value: CacheKeyPart): NormalizedCacheKeyPart {
	if (value === undefined) {
		return null;
	}

	if (Array.isArray(value)) {
		return (value as readonly CacheKeyPart[]).map((entry) => normalizePart(entry));
	}

	if (Predicate.isObject(value)) {
		return Object.fromEntries(
			Object.entries(value)
				.toSorted(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, normalizePart(entry)]),
		);
	}

	return value as boolean | number | string | null;
}

function getCacheKeyPartType(value: CacheKeyPart): string {
	if (value === null) {
		return "l";
	}

	if (value === undefined) {
		return "u";
	}

	if (Array.isArray(value)) {
		return "a";
	}

	if (Predicate.isObject(value)) {
		return "o";
	}

	if (Predicate.isString(value)) {
		return "s";
	}

	if (Predicate.isNumber(value)) {
		return "n";
	}

	return "b";
}

function encodeCacheKeyPayload<Input>(value: Input): string {
	return encodeURIComponent(
		Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)
			? String(value)
			: JSON.stringify(value),
	);
}

function normalizeCacheKeyPart(value: CacheKeyPart): string {
	const type = getCacheKeyPartType(value);
	if (type === "l" || type === "u") {
		return type;
	}

	const normalized = normalizePart(value);
	return `${type}:${encodeCacheKeyPayload(normalized)}`;
}

export function buildVersionedCacheKey(
	keyPrefix: string,
	version: string,
	parts: readonly CacheKeyPart[],
): string {
	return [keyPrefix, version, ...parts.map((part) => normalizeCacheKeyPart(part))].join(":");
}
