export interface CachePolicy {
	readonly name: string;
	readonly keyPrefix: string;
	readonly version: string;
	readonly ttlMs: number;
	readonly swrMs: number;
	readonly jitterPct?: number | undefined;
}

export type CacheBackendKind = "lru" | "redis" | "two-tier";

export interface CacheObservabilityAttributes {
	readonly cacheName: string;
	readonly cacheBackend: CacheBackendKind;
	readonly cacheStrategy: "legacy-single-tier" | "two-tier";
}

export function getCacheObservabilityAttributes(
	policy: CachePolicy,
	cacheBackend: CacheBackendKind,
): CacheObservabilityAttributes {
	return {
		cacheName: policy.name,
		cacheBackend,
		cacheStrategy: cacheBackend === "two-tier" ? "two-tier" : "legacy-single-tier",
	};
}

export const CACHE_POLICIES = {
	profile: {
		name: "profile",
		keyPrefix: "cache:profile",
		version: "v1",
		ttlMs: 60 * 60 * 1000,
		swrMs: 30 * 60 * 1000,
		jitterPct: 0.1,
	},
	cms: {
		name: "cms",
		keyPrefix: "cache:cms",
		version: "v1",
		ttlMs: 10 * 60 * 1000,
		swrMs: 5 * 60 * 1000,
		jitterPct: 0.1,
	},
	attendance: {
		name: "attendance",
		keyPrefix: "cache:attendance",
		version: "v1",
		ttlMs: 5 * 60 * 1000,
		swrMs: 10 * 60 * 1000,
		jitterPct: 0.1,
	},
	shorts: {
		name: "shorts",
		keyPrefix: "cache:shorts",
		version: "v1",
		ttlMs: 60 * 60 * 1000,
		// The stale window is what "serve the last good list" means: while YouTube
		// keeps failing, a list up to 30 days old is still served.
		swrMs: 30 * 24 * 60 * 60 * 1000,
		jitterPct: 0.1,
	},
} satisfies Record<string, CachePolicy>;
