import { Duration } from "effect";

import { CCBRequestType } from "./types";

export interface CCBCacheConfig {
	ttl: Duration.Duration;
	swr: Duration.Duration;
}

type CCBCacheConfigMap = Partial<Record<CCBRequestType, CCBCacheConfig>>;

/**
 * Default cache TTLs for each CCB request type.
 * These represent CCB domain knowledge about data freshness:
 * - Groups change infrequently → long TTL
 * - Giving data is nearly static within a year → very long TTL
 * - Attendance is real-time → very short TTL
 */
export const DefaultCCBCacheConfig: CCBCacheConfigMap = {
	[CCBRequestType.SEARCH_USER_BY_EMAIL]: {
		ttl: Duration.minutes(20),
		swr: Duration.minutes(30),
	},
	[CCBRequestType.GET_GROUPS]: {
		ttl: Duration.hours(1),
		swr: Duration.hours(2),
	},
	[CCBRequestType.GET_GROUPS_MEMBERS]: {
		ttl: Duration.minutes(15),
		swr: Duration.minutes(30),
	},
	[CCBRequestType.GET_USER_GROUPS_BY_ID]: {
		ttl: Duration.minutes(25),
		swr: Duration.minutes(50),
	},
	[CCBRequestType.GET_GIVING]: {
		ttl: Duration.hours(40),
		swr: Duration.hours(80),
	},
	[CCBRequestType.GET_ATTENDANCE_PROFILE]: {
		ttl: Duration.seconds(5),
		swr: Duration.seconds(10),
	},
};
