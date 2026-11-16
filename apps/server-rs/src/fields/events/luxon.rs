//! The part of Luxon 3.7 (`luxon/src/datetime.js`, `impl/diff.js`, `impl/regexParser.js`,
//! `impl/util.js`) that `events.ts`, `utils/recurrenceCalculator.ts` and `utils/eventSessions.ts`
//! use, with its arithmetic kept as written so DST edges and month overflows land where they do
//! in TS: `set`, `plus` and `fromObject` guess an offset and correct it once (`fixOffset`), `set`
//! lets a day past the month's end roll over (`Date.UTC`), `plus({ months })` clamps it, and a
//! derived value is recomputed from its instant and its zone's offset.
//!
//! Zones: the process zone (the TS server runs with `TZ` unset, so UTC, but it is not a fixed
//! offset zone: ISO output writes `+00:00` rather than `Z`), fixed offsets (parsed ISO offsets
//! and `toUTC`) and America/New_York (from `chrono-tz`). Offsets are whole seconds; Luxon reads
//! `Intl` offsets that are whole seconds too, but holds them as fractional minutes.
//!
//! Instants are milliseconds within JavaScript's `Date` range (±8.64e15); anything that would
//! leave it is invalid, as a `NaN` time is in Luxon. Not ported: ISO week and ordinal dates,
//! time-only strings and bracketed IANA zones (Luxon parses them; here they are invalid). The
//! CMS only sends calendar dates and times.

use std::sync::LazyLock;

use chrono::{Offset, TimeZone};
use chrono_tz::America::New_York;
use regex::Regex;

const MS_PER_DAY: i64 = 86_400_000;
/// `Date`'s time value range.
const MAX_DATE: i64 = 8_640_000_000_000_000;

/// A Luxon zone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Zone {
    /// `Settings.defaultZone` with `TZ` unset: UTC, not a fixed-offset zone.
    System,
    /// `FixedOffsetZone`, in seconds east of UTC.
    Fixed(i32),
    /// `America/New_York`, where the church schedules its events.
    NewYork,
}

impl Zone {
    /// `zone.offset(ts)` in seconds; `None` where Luxon would get `NaN`.
    fn offset(self, ts: i64) -> Option<i32> {
        match self {
            Self::System => Some(0),
            Self::Fixed(seconds) => Some(seconds),
            Self::NewYork => {
                let utc = chrono::DateTime::from_timestamp_millis(ts)?.naive_utc();
                Some(
                    New_York
                        .offset_from_utc_datetime(&utc)
                        .fix()
                        .local_minus_utc(),
                )
            }
        }
    }

    /// `zone.isUniversal`.
    fn is_universal(self) -> bool {
        matches!(self, Self::Fixed(_))
    }
}

/// Calendar fields, possibly out of range before normalization.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fields {
    pub year: i64,
    pub month: i64,
    pub day: i64,
    pub hour: i64,
    pub minute: i64,
    pub second: i64,
    pub millisecond: i64,
}

/// Days from 1970-01-01 to `year-month-day` in the proleptic Gregorian calendar.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The calendar date of `days` since 1970-01-01.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

/// `isLeapYear`.
fn is_leap_year(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

/// `daysInMonth`, with a month outside 1..=12 counted into the neighbouring years.
pub fn days_in_month(year: i64, month: i64) -> i64 {
    let mod_month = (month - 1).rem_euclid(12) + 1;
    let mod_year = year + (month - mod_month) / 12;
    match mod_month {
        2 if is_leap_year(mod_year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// `MakeDay`: days for a year, a zero-based month that may overflow, and a day that may too.
fn make_day(year: i64, month0: i64, day: i64) -> Option<i64> {
    let year = year.checked_add(month0.div_euclid(12))?;
    // Beyond this the result is far outside `Date`'s range anyway.
    if year.abs() > 1_000_000 || day.abs() > 1_000_000_000 {
        return None;
    }
    Some(days_from_civil(year, month0.rem_euclid(12) + 1, 1) + day - 1)
}

/// `MakeTime`.
fn make_time(fields: &Fields) -> Option<i64> {
    fields
        .hour
        .checked_mul(3_600_000)?
        .checked_add(fields.minute.checked_mul(60_000)?)?
        .checked_add(fields.second.checked_mul(1000)?)?
        .checked_add(fields.millisecond)
}

/// `TimeClip`.
fn time_clip(value: i64) -> Option<i64> {
    (value.abs() <= MAX_DATE).then_some(value)
}

/// `objToLocalTS`: `Date.UTC` of the fields (which maps years 0 to 99 to 19xx), with Luxon's
/// `setUTCFullYear` correction for those years.
fn obj_to_local_ts(fields: &Fields) -> Option<i64> {
    let utc = |year: i64| {
        let days = make_day(year, fields.month - 1, fields.day)?;
        time_clip(
            days.checked_mul(MS_PER_DAY)?
                .checked_add(make_time(fields)?)?,
        )
    };
    if (0..100).contains(&fields.year) {
        let legacy = utc(fields.year + 1900)?;
        let days = make_day(fields.year, fields.month - 1, fields.day)?;
        time_clip(days.checked_mul(MS_PER_DAY)? + legacy.rem_euclid(MS_PER_DAY))
    } else {
        utc(fields.year)
    }
}

/// `tsToObj`: the calendar fields at `ts` shifted by `offset` seconds.
fn ts_to_obj(ts: i64, offset: i32) -> Option<Fields> {
    let local = time_clip(ts.checked_add(i64::from(offset) * 1000)?)?;
    let days = local.div_euclid(MS_PER_DAY);
    let ms = local.rem_euclid(MS_PER_DAY);
    let (year, month, day) = civil_from_days(days);
    Some(Fields {
        year,
        month,
        day,
        hour: ms / 3_600_000,
        minute: ms / 60_000 % 60,
        second: ms / 1000 % 60,
        millisecond: ms % 1000,
    })
}

/// `fixOffset`: the instant for `local_ts` in `zone`, guessing `guess` first; in a DST gap it
/// keeps Luxon's choice of instant and offset.
fn fix_offset(local_ts: i64, guess: i32, zone: Zone) -> Option<(i64, i32)> {
    let mut utc_guess = local_ts.checked_sub(i64::from(guess) * 1000)?;
    let o2 = zone.offset(utc_guess)?;
    if guess == o2 {
        return Some((utc_guess, guess));
    }
    utc_guess -= i64::from(o2 - guess) * 1000;
    let o3 = zone.offset(utc_guess)?;
    if o2 == o3 {
        return Some((utc_guess, o2));
    }
    Some((local_ts - i64::from(o2.min(o3)) * 1000, o2.max(o3)))
}

/// A valid Luxon `DateTime` (an invalid one is `None` wherever it can arise).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DateTime {
    ts: i64,
    zone: Zone,
    /// The offset used for `c`: trusted from `fromObject`, recomputed by `clone`.
    o: i32,
    c: Fields,
}

/// Duration units `plus` takes here (whole units only).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Duration {
    pub months: i64,
    pub weeks: i64,
    pub days: i64,
    pub milliseconds: i64,
}

/// The fields `set` changes here.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Set {
    pub day: Option<i64>,
    pub hour: Option<i64>,
    pub minute: Option<i64>,
    pub second: Option<i64>,
    pub millisecond: Option<i64>,
}

impl Set {
    /// `{ hour, minute, second, millisecond }` of `time`.
    pub fn time_of(time: &DateTime) -> Self {
        Self {
            day: None,
            hour: Some(time.c.hour),
            minute: Some(time.c.minute),
            second: Some(time.c.second),
            millisecond: Some(time.c.millisecond),
        }
    }

    pub fn with_day(self, day: i64) -> Self {
        Self {
            day: Some(day),
            ..self
        }
    }
}

/// `/^([+-]\d{6}|\d{4})(?:-?(\d\d)(?:-?(\d\d))?)?(?:[Tt](\d\d)(?::?(\d\d)(?::?(\d\d)(?:[.,](\d{1,30}))?)?)?(?:([Zz])|([+-]\d\d)(?::?(\d\d))?)?)?$/`:
/// `isoYmdWithTimeExtensionRegex` without the bracketed IANA zone.
static ISO_YMD_TIME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^([+-][0-9]{6}|[0-9]{4})(?:-?([0-9]{2})(?:-?([0-9]{2}))?)?(?:[Tt]([0-9]{2})(?::?([0-9]{2})(?::?([0-9]{2})(?:[.,]([0-9]{1,30}))?)?)?(?:([Zz])|([+-][0-9]{2})(?::?([0-9]{2}))?)?)?$",
    )
    .expect("a valid pattern")
});

impl DateTime {
    /// `new DateTime({ ts, zone, o })`: the fields at `ts` with offset `o`.
    fn at(ts: i64, zone: Zone, o: i32) -> Option<Self> {
        Some(Self {
            ts,
            zone,
            o,
            c: ts_to_obj(ts, o)?,
        })
    }

    /// `clone(this, { ts })`: an unchanged instant keeps its fields and offset; otherwise the
    /// offset is the zone's at the new instant.
    fn with_ts(&self, ts: i64) -> Option<Self> {
        if ts == self.ts {
            return Some(*self);
        }
        Self::at(ts, self.zone, self.zone.offset(ts)?)
    }

    /// `DateTime.fromMillis(ts)` in `zone` (`DateTime.now()` when `ts` is the clock).
    pub fn from_millis(ts: i64, zone: Zone) -> Option<Self> {
        Self::at(ts, zone, zone.offset(ts)?)
    }

    /// `DateTime.fromObject(fields, { zone })`: validated fields, the offset guessed from
    /// `now` (`Settings.now()`) and corrected once.
    pub fn from_object(fields: Fields, zone: Zone, now: i64) -> Option<Self> {
        let valid_time = (0..=23).contains(&fields.hour)
            || (fields.hour == 24
                && fields.minute == 0
                && fields.second == 0
                && fields.millisecond == 0);
        let valid = (1..=12).contains(&fields.month)
            && (1..=days_in_month(fields.year, fields.month)).contains(&fields.day)
            && valid_time
            && (0..=59).contains(&fields.minute)
            && (0..=59).contains(&fields.second)
            && (0..=999).contains(&fields.millisecond);
        if !valid {
            return None;
        }
        let (ts, o) = fix_offset(obj_to_local_ts(&fields)?, zone.offset(now)?, zone)?;
        Self::at(ts, zone, o)
    }

    /// `DateTime.fromISO(text, { zone })`: an offset in the text decides the instant, and the
    /// result is then shown in `zone`. `now` is `Settings.now()`.
    pub fn from_iso(text: &str, zone: Zone, now: i64) -> Option<Self> {
        let m = ISO_YMD_TIME.captures(text)?;
        let int = |index: usize, fallback: i64| {
            m.get(index)
                .map_or(Some(fallback), |group| group.as_str().parse::<i64>().ok())
        };
        let millisecond = match m.get(7) {
            // `parseMillis`: Math.floor(parseFloat("0." + fraction) * 1000).
            Some(fraction) => {
                (format!("0.{}", fraction.as_str()).parse::<f64>().ok()? * 1000.0).floor() as i64
            }
            None => 0,
        };
        let fields = Fields {
            year: int(1, 0)?,
            month: int(2, 1)?,
            day: int(3, 1)?,
            hour: int(4, 0)?,
            minute: int(5, 0)?,
            second: int(6, 0)?,
            millisecond,
        };
        let parsed_zone = if m.get(8).is_some() {
            Some(Zone::Fixed(0))
        } else {
            m.get(9).map(|hours| {
                // `signedOffset`: the minutes take the hours' sign, "-00" included.
                let hours_text = hours.as_str();
                let negative = hours_text.starts_with('-');
                let hours: i32 = hours_text[1..].parse().unwrap_or(0);
                let minutes: i32 = m
                    .get(10)
                    .and_then(|minutes| minutes.as_str().parse().ok())
                    .unwrap_or(0);
                let seconds = (hours * 60 + minutes) * 60;
                Zone::Fixed(if negative { -seconds } else { seconds })
            })
        };
        Self::from_object(fields, parsed_zone.unwrap_or(zone), now)?.set_zone(zone)
    }

    /// `setZone(zone)`: the same instant in `zone`.
    pub fn set_zone(&self, zone: Zone) -> Option<Self> {
        if zone == self.zone {
            return Some(*self);
        }
        Self::at(self.ts, zone, zone.offset(self.ts)?)
    }

    /// `set(values)`: a day past the month's end rolls into the next month; without a new day,
    /// the day is clamped to the month.
    pub fn set(&self, values: Set) -> Option<Self> {
        let c = self.c;
        let mut mixed = Fields {
            day: values.day.unwrap_or(c.day),
            hour: values.hour.unwrap_or(c.hour),
            minute: values.minute.unwrap_or(c.minute),
            second: values.second.unwrap_or(c.second),
            millisecond: values.millisecond.unwrap_or(c.millisecond),
            ..c
        };
        if values.day.is_none() {
            mixed.day = mixed.day.min(days_in_month(mixed.year, mixed.month));
        }
        let (ts, _) = fix_offset(obj_to_local_ts(&mixed)?, self.o, self.zone)?;
        self.with_ts(ts)
    }

    /// `plus(duration)` (`adjustTime`): calendar units on the local fields (the day clamped to
    /// the target month), then milliseconds on the instant.
    pub fn plus(&self, duration: Duration) -> Option<Self> {
        let c = self.c;
        let month = c.month + duration.months;
        let shifted = Fields {
            month,
            day: c.day.min(days_in_month(c.year, month)) + duration.days + duration.weeks * 7,
            ..c
        };
        let (mut ts, _) = fix_offset(obj_to_local_ts(&shifted)?, self.o, self.zone)?;
        if duration.milliseconds != 0 {
            ts = ts.checked_add(duration.milliseconds)?;
        }
        self.with_ts(ts)
    }

    /// `startOf("day")`.
    pub fn start_of_day(&self) -> Option<Self> {
        self.set(Set {
            hour: Some(0),
            minute: Some(0),
            second: Some(0),
            millisecond: Some(0),
            day: None,
        })
    }

    /// `endOf("day")`: `plus({ days: 1 }).startOf("day").minus(1)`.
    pub fn end_of_day(&self) -> Option<Self> {
        self.plus(Duration {
            days: 1,
            ..Duration::default()
        })?
        .start_of_day()?
        .plus(Duration {
            milliseconds: -1,
            ..Duration::default()
        })
    }

    pub fn millis(&self) -> i64 {
        self.ts
    }

    pub fn zone(&self) -> Zone {
        self.zone
    }

    pub fn year(&self) -> i64 {
        self.c.year
    }

    pub fn month(&self) -> i64 {
        self.c.month
    }

    pub fn day(&self) -> i64 {
        self.c.day
    }

    /// `weekday`: ISO, Monday 1 to Sunday 7.
    pub fn weekday(&self) -> i64 {
        (days_from_civil(self.c.year, self.c.month, self.c.day) + 3).rem_euclid(7) + 1
    }

    /// `diff(other, "weeks").weeks`.
    pub fn diff_weeks(&self, other: &Self) -> Option<f64> {
        let other_is_later = other.ts > self.ts;
        let (earlier, later) = if other_is_later {
            (self, other)
        } else {
            (other, self)
        };
        let weeks = diff_weeks(earlier, later)?;
        Some(if other_is_later { -weeks } else { weeks })
    }

    /// `toISO()`: extended date, time with milliseconds, and the offset (`Z` only for a fixed
    /// zero offset).
    pub fn to_iso(&self) -> String {
        let c = &self.c;
        let mut out = format!(
            "{}T{}:{}:{}.{}",
            self.to_iso_date(),
            pad(c.hour, 2),
            pad(c.minute, 2),
            pad(c.second, 2),
            pad(c.millisecond, 3)
        );
        if self.zone.is_universal() && self.o == 0 {
            out.push('Z');
        } else {
            // Luxon writes `Math.trunc` of the hours and of the remaining minutes.
            let minutes = i64::from(self.o.abs()) / 60;
            out.push(if self.o < 0 { '-' } else { '+' });
            out.push_str(&format!(
                "{}:{}",
                pad(minutes / 60, 2),
                pad(minutes % 60, 2)
            ));
        }
        out
    }

    /// `toISODate()`.
    pub fn to_iso_date(&self) -> String {
        let c = &self.c;
        let long = c.year > 9999 || c.year < 0;
        let sign = if long && c.year >= 0 { "+" } else { "" };
        format!(
            "{sign}{}-{}-{}",
            pad(c.year, if long { 6 } else { 4 }),
            pad(c.month, 2),
            pad(c.day, 2)
        )
    }

    /// `toFormat("MMMM")` in English.
    pub fn month_name(&self) -> &'static str {
        month_name(self.c.month)
    }
}

/// `dayDiff`: whole local calendar days from `earlier` to `later`.
fn day_diff(earlier: &DateTime, later: &DateTime) -> i64 {
    let day = |dt: &DateTime| days_from_civil(dt.c.year, dt.c.month, dt.c.day);
    day(later) - day(earlier)
}

/// `diff(earlier, later, ["weeks"])` (`impl/diff.js`): whole weeks by calendar days, backed off
/// when adding them overshoots, plus the remaining fraction of the next week.
fn diff_weeks(earlier: &DateTime, later: &DateTime) -> Option<f64> {
    let plus_weeks = |weeks: i64| {
        earlier.plus(Duration {
            weeks,
            ..Duration::default()
        })
    };
    let days = day_diff(earlier, later);
    let mut weeks = (days - days % 7) / 7;
    let mut high_water = plus_weeks(weeks)?;
    let cursor;
    // `highWater !== cursor` compares objects: only a cursor that is highWater itself skips the
    // fraction.
    let mut same_object = false;
    if high_water.ts > later.ts {
        weeks -= 1;
        let mut backed = plus_weeks(weeks)?;
        if backed.ts > later.ts {
            high_water = backed;
            weeks -= 1;
            backed = plus_weeks(weeks)?;
        }
        cursor = backed;
    } else {
        cursor = high_water;
        same_object = true;
    }
    let remaining = later.ts - cursor.ts;
    if high_water.ts < later.ts {
        high_water = cursor.plus(Duration {
            weeks: 1,
            ..Duration::default()
        })?;
        same_object = false;
    }
    let mut result = weeks as f64;
    if !same_object {
        result += remaining as f64 / (high_water.ts - cursor.ts) as f64;
    }
    Some(result)
}

/// `padStart(value, n)`: a negative value keeps its sign in front of the padded digits.
fn pad(value: i64, width: usize) -> String {
    if value < 0 {
        format!("-{:0width$}", value.unsigned_abs())
    } else {
        format!("{value:0width$}")
    }
}

/// English month names.
pub fn month_name(month: i64) -> &'static str {
    const NAMES: [&str; 12] = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    usize::try_from(month - 1)
        .ok()
        .and_then(|index| NAMES.get(index))
        .copied()
        .unwrap_or_default()
}

/// The UTC calendar fields at `ts` (`Date`'s `getUTC*`), for the JavaScript `Date` helpers.
pub fn utc_fields(ts: i64) -> Option<Fields> {
    ts_to_obj(ts, 0)
}

/// `date.toISOString()`.
pub fn to_iso_string(ts: i64) -> Option<String> {
    let c = utc_fields(ts)?;
    let year = if (0..=9999).contains(&c.year) {
        pad(c.year, 4)
    } else if c.year < 0 {
        pad(c.year, 6)
    } else {
        format!("+{}", pad(c.year, 6))
    };
    Some(format!(
        "{year}-{}-{}T{}:{}:{}.{}Z",
        pad(c.month, 2),
        pad(c.day, 2),
        pad(c.hour, 2),
        pad(c.minute, 2),
        pad(c.second, 2),
        pad(c.millisecond, 3)
    ))
}

/// The New York wall clock at `ts` (`formatInTimeZone`), and the offset in seconds.
pub fn new_york_fields(ts: i64) -> Option<(Fields, i32)> {
    let offset = Zone::NewYork.offset(ts)?;
    Some((ts_to_obj(ts, offset)?, offset))
}

/// `formatInTimeZone(date, "America/New_York", "HH:mm:ssXXX")`.
pub fn new_york_time(ts: i64) -> Option<String> {
    let (c, offset) = new_york_fields(ts)?;
    let zone = if offset == 0 {
        "Z".to_owned()
    } else {
        let minutes = i64::from(offset.abs()) / 60;
        format!(
            "{}{}:{}",
            if offset < 0 { '-' } else { '+' },
            pad(minutes / 60, 2),
            pad(minutes % 60, 2)
        )
    };
    Some(format!(
        "{}:{}:{}{zone}",
        pad(c.hour, 2),
        pad(c.minute, 2),
        pad(c.second, 2)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_791_302_400_000; // 2026-10-06T16:00:00Z

    fn iso(text: &str, zone: Zone) -> DateTime {
        DateTime::from_iso(text, zone, NOW).unwrap_or_else(|| panic!("{text} parses"))
    }

    #[test]
    fn converts_between_days_and_dates() {
        for days in [-1_000_000, -719_468, -1, 0, 1, 365, 20_000, 2_932_896] {
            let (y, m, d) = civil_from_days(days);
            assert_eq!(days_from_civil(y, m, d), days);
        }
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(days_from_civil(2026, 10, 6), 20_732);
    }

    #[test]
    fn parses_iso_strings_like_luxon() {
        let utc = iso("2026-10-04T14:00:00.000Z", Zone::System);
        assert_eq!(utc.millis(), 1_791_122_400_000);
        assert_eq!(utc.to_iso(), "2026-10-04T14:00:00.000+00:00");
        let ny = utc.set_zone(Zone::NewYork).unwrap();
        assert_eq!(ny.to_iso(), "2026-10-04T10:00:00.000-04:00");
        assert_eq!(ny.weekday(), 7);
        // A wall-clock time in New York, in and out of daylight saving time.
        assert_eq!(
            iso("2026-10-07T19:00:00.000", Zone::NewYork).to_iso(),
            "2026-10-07T19:00:00.000-04:00"
        );
        assert_eq!(
            iso("2026-12-31T22:00", Zone::NewYork).to_iso(),
            "2026-12-31T22:00:00.000-05:00"
        );
        // Basic format, comma fractions, offsets with and without a colon, a lone date.
        assert_eq!(
            iso("20261004T140000,5+0130", Zone::System).to_iso(),
            "2026-10-04T12:30:00.500+00:00"
        );
        assert_eq!(
            iso("2026-10-04T14:00-00:30", Zone::System).to_iso(),
            "2026-10-04T14:30:00.000+00:00"
        );
        assert_eq!(
            iso("2026-10-04", Zone::System).to_iso(),
            "2026-10-04T00:00:00.000+00:00"
        );
        assert_eq!(iso("2026", Zone::System).to_iso_date(), "2026-01-01");
        // parseMillis floors the fraction.
        assert_eq!(
            iso("2026-10-04T14:00:00.123987Z", Zone::System).to_iso(),
            "2026-10-04T14:00:00.123+00:00"
        );
        // 24:00 is the next midnight.
        assert_eq!(
            iso("2026-10-04T24:00Z", Zone::System).to_iso(),
            "2026-10-05T00:00:00.000+00:00"
        );
        assert_eq!(
            iso("+012026-10-04T00:00Z", Zone::System).to_iso_date(),
            "+012026-10-04"
        );
    }

    #[test]
    fn rejects_what_luxon_rejects_and_what_is_not_ported() {
        for text in [
            "",
            "garbage",
            "2026-13-01",
            "2026-02-30",
            "2026-10-04T24:01",
            "2026-10-04T23:60",
            "2026-10-04 14:00",
            "2026-10-04T14:00:00.000Z[America/New_York]",
            "2026-W40-1",
            "2026-277",
            "14:00",
            "٢٠٢٦-10-04",
        ] {
            assert_eq!(DateTime::from_iso(text, Zone::System, NOW), None, "{text}");
        }
    }

    #[test]
    fn resolves_dst_gaps_and_overlaps_like_luxon() {
        // 2:30 on 8 March 2026 does not exist in New York; Luxon lands on 3:30 EDT.
        assert_eq!(
            iso("2026-03-08T02:30", Zone::NewYork).to_iso(),
            "2026-03-08T03:30:00.000-04:00"
        );
        // 1:30 on 1 November 2026 happens twice; the guess from `now` (EDT in October) picks
        // the first.
        assert_eq!(
            iso("2026-11-01T01:30", Zone::NewYork).to_iso(),
            "2026-11-01T01:30:00.000-04:00"
        );
        let december = 1_796_000_000_000;
        assert_eq!(
            DateTime::from_iso("2026-11-01T01:30", Zone::NewYork, december)
                .unwrap()
                .to_iso(),
            "2026-11-01T01:30:00.000-05:00"
        );
    }

    #[test]
    fn rolls_a_set_day_over_and_clamps_a_month_shift() {
        let april = iso("2026-04-15T10:00", Zone::NewYork);
        let set = april.set(Set::default().with_day(31)).unwrap();
        assert_eq!(set.to_iso(), "2026-05-01T10:00:00.000-04:00");
        let january = iso("2026-01-31T10:00", Zone::NewYork);
        let plus = january
            .plus(Duration {
                months: 1,
                ..Duration::default()
            })
            .unwrap();
        assert_eq!(plus.to_iso(), "2026-02-28T10:00:00.000-05:00");
        let end = april.end_of_day().unwrap();
        assert_eq!(end.to_iso(), "2026-04-15T23:59:59.999-04:00");
        assert_eq!(
            april.start_of_day().unwrap().to_iso(),
            "2026-04-15T00:00:00.000-04:00"
        );
    }

    #[test]
    fn adds_days_across_dst_on_the_wall_clock() {
        let before = iso("2026-10-31T09:00", Zone::NewYork);
        let after = before
            .plus(Duration {
                days: 1,
                ..Duration::default()
            })
            .unwrap();
        assert_eq!(after.to_iso(), "2026-11-01T09:00:00.000-05:00");
        assert_eq!(after.millis() - before.millis(), 25 * 3_600_000);
    }

    #[test]
    fn diffs_weeks_with_a_fraction_and_a_sign() {
        let start = iso("2026-10-04T09:00", Zone::NewYork);
        let later = iso("2026-10-18T09:00", Zone::NewYork);
        assert_eq!(later.diff_weeks(&start), Some(2.0));
        assert_eq!(start.diff_weeks(&later), Some(-2.0));
        let partial = iso("2026-10-21T21:00", Zone::NewYork);
        assert_eq!(partial.diff_weeks(&start), Some(2.5));
        // Across the end of daylight saving time a week is 169 hours.
        let after_dst = iso("2026-11-08T09:00", Zone::NewYork);
        assert_eq!(after_dst.diff_weeks(&start), Some(5.0));
    }

    #[test]
    fn writes_javascript_date_strings() {
        assert_eq!(
            to_iso_string(1_791_122_400_000).as_deref(),
            Some("2026-10-04T14:00:00.000Z")
        );
        assert_eq!(
            to_iso_string(-62_198_755_200_000).as_deref(),
            Some("-000001-01-01T00:00:00.000Z")
        );
        assert_eq!(
            to_iso_string(253_402_300_800_000).as_deref(),
            Some("+010000-01-01T00:00:00.000Z")
        );
        assert_eq!(to_iso_string(MAX_DATE + 1), None);
        assert_eq!(
            new_york_time(1_791_122_400_000).as_deref(),
            Some("10:00:00-04:00")
        );
        assert_eq!(month_name(10), "October");
    }
}
