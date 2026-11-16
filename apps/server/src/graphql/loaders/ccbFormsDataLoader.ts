import { redis } from "@/redis";
import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import { capitalizeText } from "@/utils/capitalizeText";
import { createRedisCache } from "@/utils/redisCache";
import { serviceRequest } from "@/utils/serviceRequest";
import { CCBFormsSchema } from "@hccnj/ccb/schemas/CCBForms";
import { Temporal } from "@js-temporal/polyfill";
import DataLoader from "dataloader";
import { Result, Schema } from "effect";
import { LRUCache } from "lru-cache";

const CCB_FORMS_URL =
	"https://hccnj.ccbchurch.com/api/forms?publicly_listed=true&status=ACTIVE&name=&sort_by=DATE_CREATED&sort_direction=DESC&page=1";

// Type for CCB Form data
interface CCBFormData {
	id: number;
	title: string;
	url: string;
	campus_id: number;
	status: string;
}

type CCBFormsResponse = Schema.Schema.Type<typeof CCBFormsSchema>;

interface CCBFormsParseError {
	readonly _tag: "CCBFormsParseError";
	readonly cause: unknown;
}

type FetchAndParseFormsResult =
	| {
			readonly ok: true;
			readonly data: CCBFormData[];
	  }
	| {
			readonly ok: false;
			readonly error: CCBFormsParseError;
	  };

// Cache configuration
const ttl = Temporal.Duration.from({ minutes: 15 });
const staleDuration = Temporal.Duration.from({ minutes: 5 });

// Redis cache for CCB Forms (shared across requests)
const redisCache = createRedisCache<CCBFormData[]>({
	redis,
	prefix: "ccb-forms-dataloader",
	ttl,
	staleDuration,
});

// In-memory L1 cache
const memoryCache = new LRUCache<string, CCBFormData[]>({
	max: 5,
	ttl: ttl.total({ unit: "milliseconds" }),
	allowStale: true,
	allowStaleOnFetchRejection: true,
	allowStaleOnFetchAbort: true,
	updateAgeOnGet: true,
});

async function fetchAndParseForms(): Promise<FetchAndParseFormsResult> {
	const response = await serviceRequest({
		url: CCB_FORMS_URL,
		options: { method: "GET" },
		service: "ccb",
		action: "get_ccb_forms",
	});

	const jsonData: unknown = await response.json();

	const parsed = Schema.decodeUnknownResult(CCBFormsSchema)(jsonData);
	if (Result.isFailure(parsed)) {
		return {
			ok: false,
			error: {
				_tag: "CCBFormsParseError",
				cause: parsed.failure,
			},
		};
	}

	return {
		ok: true,
		data: parsed.success.map((item: CCBFormsResponse[number]) => ({
			id: item.id,
			title: capitalizeText(item.title),
			url: item.url,
			campus_id: item.campus_id,
			status: item.status,
		})),
	};
}

/**
 * Batch function for CCB Forms DataLoader with three-tier caching
 */
async function batchCCBFormsRequests(keys: readonly string[]): Promise<CCBFormData[][]> {
	const cacheKey = "ccbForms";

	// L1: Check in-memory cache
	const cached = memoryCache.get(cacheKey);
	if (cached) {
		return keys.map(() => cached);
	}

	// L2: Check Redis cache
	try {
		const redisCached = await redisCache.get(cacheKey);
		if (redisCached?.value) {
			memoryCache.set(cacheKey, redisCached.value);
			return keys.map(() => redisCached.value!);
		}
	} catch (error) {
		getLogger().warn({ err: error, cacheKey }, "CCB Forms DataLoader redis cache read failed");
	}

	// L3: Fetch from source
	try {
		const result = await fetchAndParseForms();
		if (!result.ok) {
			getLogger().error(
				{ cacheKey, errorTag: result.error._tag, cause: String(result.error.cause) },
				"CCB Forms DataLoader response parsing failed",
			);
			return keys.map(() => []);
		}

		await redisCache.set(cacheKey, result.data);
		memoryCache.set(cacheKey, result.data);

		return keys.map(() => result.data);
	} catch (error) {
		getLogger().error({ err: error, cacheKey }, "CCB Forms DataLoader fetch failed");
		return keys.map(() => []);
	}
}

/**
 * Creates a new CCB Forms DataLoader
 */
export const createCCBFormsDataLoader = () =>
	new DataLoader<string, CCBFormData[]>(batchCCBFormsRequests);
