import { Duration } from "effect";

const WEEK_MS = Duration.toMillis(Duration.weeks(1));

// CCB records each week's gifts on Sunday night. Monday 10:00 UTC (6am EDT, 5am EST) leaves the import
// time to finish, so giving read from CCB after it stays current until the same time the next Monday.
const FIRST_REFRESH_MS = Date.UTC(1970, 0, 5, 10); // the first Monday of the epoch

/** The latest weekly refresh at or before `nowMs`: giving synced before it may miss that week's gifts. */
export const lastGivingRefresh = (nowMs: number): number =>
	nowMs - ((nowMs - FIRST_REFRESH_MS) % WEEK_MS);

/** How long giving read at `nowMs` stays current: until the next weekly refresh. */
export const untilNextGivingRefresh = (nowMs: number): Duration.Duration =>
	Duration.millis(lastGivingRefresh(nowMs) + WEEK_MS - nowMs);
