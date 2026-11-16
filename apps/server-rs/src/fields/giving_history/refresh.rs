//! The weekly giving refresh (`apps/server/src/effect/services/giving/weeklyRefresh.ts`): CCB
//! records each week's gifts on Sunday night, so giving read after Monday 10:00 UTC stays current
//! until the same time the next Monday. Every cache tier keeps a year until then.

use std::time::Duration;

const WEEK_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// `FIRST_REFRESH_MS`: Monday 1970-01-05 10:00 UTC, the first Monday of the epoch.
const FIRST_REFRESH_MS: i64 = (4 * 24 + 10) * 60 * 60 * 1000;

/// `lastGivingRefresh`: the latest weekly refresh at or before `now_ms`. Giving synced before it
/// may miss that week's gifts.
pub fn last_giving_refresh(now_ms: i64) -> i64 {
    now_ms - (now_ms - FIRST_REFRESH_MS).rem_euclid(WEEK_MS)
}

/// `untilNextGivingRefresh`: how long giving read at `now_ms` stays current.
pub fn until_next_giving_refresh(now_ms: i64) -> Duration {
    let left = last_giving_refresh(now_ms) + WEEK_MS - now_ms;
    Duration::from_millis(u64::try_from(left).unwrap_or(0))
}

/// `getRedisTtlSeconds`: [`until_next_giving_refresh`] in whole seconds, rounded up.
pub fn redis_ttl_seconds(now_ms: i64) -> u64 {
    until_next_giving_refresh(now_ms)
        .as_millis()
        .div_ceil(1000)
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `Date.UTC(year, month - 1, day, hour, minute)`.
    fn utc(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> i64 {
        chrono::NaiveDate::from_ymd_opt(year, month, day)
            .and_then(|date| date.and_hms_opt(hour, minute, 0))
            .unwrap()
            .and_utc()
            .timestamp_millis()
    }

    #[test]
    fn the_refresh_is_monday_ten_utc() {
        // 2026-10-12 is a Monday.
        let monday = utc(2026, 10, 12, 10, 0);
        assert_eq!(last_giving_refresh(monday), monday);
        assert_eq!(last_giving_refresh(monday - 1), monday - WEEK_MS);
        assert_eq!(last_giving_refresh(utc(2026, 10, 16, 15, 30)), monday);
        assert_eq!(last_giving_refresh(utc(2026, 10, 19, 9, 59)), monday);
        assert_eq!(
            last_giving_refresh(utc(2026, 10, 19, 10, 0)),
            monday + WEEK_MS
        );
    }

    #[test]
    fn giving_stays_current_until_the_next_refresh() {
        let monday = utc(2026, 10, 12, 10, 0);
        assert_eq!(
            until_next_giving_refresh(monday),
            Duration::from_millis(WEEK_MS as u64)
        );
        assert_eq!(
            until_next_giving_refresh(utc(2026, 10, 19, 9, 0)),
            Duration::from_secs(60 * 60)
        );
        // Redis keeps whole seconds, rounded up.
        assert_eq!(redis_ttl_seconds(utc(2026, 10, 19, 9, 0) + 1), 3600);
        assert_eq!(redis_ttl_seconds(utc(2026, 10, 19, 9, 0) + 1001), 3599);
    }
}
