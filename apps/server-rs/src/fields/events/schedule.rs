//! When an event happens: `RecurrenceCalculator.getNextOccurrence`
//! (`apps/server/src/utils/recurrenceCalculator.ts`), `eventSessions` and `currentSession`
//! (`apps/server/src/utils/eventSessions.ts`), on the Luxon port in [`super::luxon`].
//!
//! The calculator's quirks are kept: "Daily" and same-weekday "Weekly" events compare the
//! reference time with the end of the event's day, so they never move to the next occurrence
//! while that day lasts; "Monthly" sets the event's day of month, which rolls into the next
//! month when the reference month is shorter.

use super::luxon::{DateTime, Duration, Set, Zone};
use crate::strapi::js;
use crate::strapi::records::EventRecord;

const ONE_TIME_EVENT: &str = "One time Event";

/// A failure `mapEventRecord` throws; the text is the JavaScript error message.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ScheduleError {
    /// Luxon's `InvalidArgumentError` for a `NaN` unit: a recurring event whose start date
    /// does not parse.
    #[error("Invalid unit value NaN")]
    InvalidUnit,
    #[error("Unsupported recurring type: {0}")]
    UnsupportedRecurrence(String),
    /// date-fns-tz's `RangeError` from the date-fns fallback (`getNextOccurrence` in
    /// `utils/events.ts`) given an invalid date: an event with no valid date at all.
    #[error("Invalid time zone specified: America/New_York")]
    InvalidTime,
}

fn days(days: i64) -> Duration {
    Duration {
        days,
        ..Duration::default()
    }
}

/// `RecurrenceCalculator.getNextOccurrence(eventDate, recurringType, referenceDate)`. `None`
/// is an invalid `DateTime` (a one-time event whose start does not parse).
pub fn next_occurrence(
    event_date: Option<&DateTime>,
    recurring_type: &str,
    reference: &DateTime,
) -> Result<Option<DateTime>, ScheduleError> {
    let event = event_date.and_then(|date| date.set_zone(Zone::NewYork));
    let reference = reference.set_zone(Zone::NewYork);
    let recurring = |next: fn(&DateTime, &DateTime) -> Option<DateTime>| match (&event, &reference)
    {
        (Some(event), Some(reference)) => Ok(next(event, reference)),
        // Every recurring rule reads the event's time, which is NaN for an invalid date.
        _ => Err(ScheduleError::InvalidUnit),
    };
    match recurring_type {
        ONE_TIME_EVENT => Ok(event),
        "Daily" => recurring(next_daily),
        "Weekly" => recurring(next_weekly),
        "BiWeekly" => recurring(next_bi_weekly),
        "Monthly" => recurring(next_monthly),
        "Twice a month" => recurring(next_twice_monthly),
        other => Err(ScheduleError::UnsupportedRecurrence(other.to_owned())),
    }
}

/// `getNextDaily`.
fn next_daily(event: &DateTime, reference: &DateTime) -> Option<DateTime> {
    let next = reference.start_of_day()?.set(Set::time_of(event))?;
    if reference.millis() > next.end_of_day()?.millis() {
        return next.plus(days(1));
    }
    Some(next)
}

/// `getNextWeekly`.
fn next_weekly(event: &DateTime, reference: &DateTime) -> Option<DateTime> {
    // Luxon weekdays (1-7, Monday first) as `getDay` (0-6, Sunday first).
    let mut days_until_next = event.weekday() % 7 - reference.weekday() % 7;
    if days_until_next < 0 {
        days_until_next += 7;
    } else if days_until_next == 0 {
        let today = reference.start_of_day()?.set(Set::time_of(event))?;
        if reference.millis() > today.end_of_day()?.millis() {
            days_until_next = 7;
        }
    }
    reference
        .start_of_day()?
        .plus(days(days_until_next))?
        .set(Set::time_of(event))
}

/// `getNextBiWeekly`: the next weekly occurrence, a week later when it is off the event's
/// two-week cadence.
fn next_bi_weekly(event: &DateTime, reference: &DateTime) -> Option<DateTime> {
    let next = next_weekly(event, reference)?;
    let weeks = next.diff_weeks(event)?.floor() as i64;
    if weeks % 2 != 0 {
        return next.plus(Duration {
            weeks: 1,
            ..Duration::default()
        });
    }
    Some(next)
}

/// `getNextMonthly`.
fn next_monthly(event: &DateTime, reference: &DateTime) -> Option<DateTime> {
    let next = reference.set(Set::time_of(event).with_day(event.day()))?;
    if reference.millis() > next.end_of_day()?.millis() {
        return next.plus(Duration {
            months: 1,
            ..Duration::default()
        });
    }
    Some(next)
}

/// `getNextTwiceMonthly`: the 1st and the 15th.
fn next_twice_monthly(event: &DateTime, reference: &DateTime) -> Option<DateTime> {
    const FIRST: i64 = 1;
    const MID: i64 = 15;
    let time = Set::time_of(event);
    let current_day = reference.day();
    let next = if current_day < MID {
        let first = reference.set(time.with_day(FIRST))?;
        if current_day == FIRST && reference.millis() <= first.millis() {
            first
        } else {
            reference.set(Set::default().with_day(MID))?
        }
    } else {
        let mid = reference.set(time.with_day(MID))?;
        if current_day == MID && reference.millis() <= mid.millis() {
            mid
        } else {
            reference
                .plus(Duration {
                    months: 1,
                    ..Duration::default()
                })?
                .set(Set::default().with_day(FIRST))?
        }
    };
    next.set(time)
}

/// `EventSession` in `eventSessions.ts`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Session<'a> {
    pub starts_at: DateTime,
    pub ends_at: Option<DateTime>,
    pub label: Option<&'a str>,
}

/// `EventSchedule`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Schedule<'a> {
    /// False when the event has no sessions or recurring times: its one session is its own dates.
    pub scheduled: bool,
    pub sessions: Vec<Session<'a>>,
}

/// `inNewYork`: CMS dates and times are New York wall-clock values. `now` is Luxon's clock,
/// which picks the offset it tries first.
fn in_new_york(date: &str, time: &str, now: i64) -> Option<DateTime> {
    DateTime::from_iso(&format!("{date}T{time}"), Zone::NewYork, now)
}

/// `cmsSessions`, with Luxon's invalid `DateTime`s dropped as `eventSessions` drops them.
fn cms_sessions<'a>(
    record: &'a EventRecord,
    occurrence: Option<&DateTime>,
    now: i64,
) -> Vec<Session<'a>> {
    if !record.sessions.is_empty() {
        return record
            .sessions
            .iter()
            .filter_map(|session| {
                let starts_at = in_new_york(&session.date, &session.start_time, now)?;
                let ends_at = match &session.end_time {
                    None => None,
                    // An invalid end drops the session.
                    Some(end) => Some(in_new_york(&session.date, end, now)?),
                };
                // An end time before the start time finishes after midnight.
                let ends_at = match ends_at {
                    Some(end) if end.millis() < starts_at.millis() => Some(end.plus(days(1))?),
                    other => other,
                };
                Some(Session {
                    starts_at,
                    ends_at,
                    label: session.label.as_deref(),
                })
            })
            .collect();
    }
    let Some(day) = occurrence
        .and_then(|occurrence| occurrence.set_zone(Zone::NewYork))
        .map(|occurrence| occurrence.to_iso_date())
    else {
        return Vec::new();
    };
    record
        .recurring_times
        .iter()
        .filter_map(|time| {
            Some(Session {
                starts_at: in_new_york(&day, &time.start_time, now)?,
                ends_at: None,
                label: time.label.as_deref(),
            })
        })
        .collect()
}

/// `eventSessions(record, occurrence)`: the sessions shown for an event whose next date is
/// `occurrence`, soonest first.
pub fn event_sessions<'a>(
    record: &'a EventRecord,
    occurrence: Option<&DateTime>,
    now: i64,
) -> Schedule<'a> {
    let mut scheduled = cms_sessions(record, occurrence, now);
    if !scheduled.is_empty() {
        scheduled.sort_by_key(|session| session.starts_at.millis());
        return Schedule {
            scheduled: true,
            sessions: scheduled,
        };
    }
    let Some(occurrence) = occurrence else {
        return Schedule {
            scheduled: false,
            sessions: Vec::new(),
        };
    };
    // A recurring event's end date ends the series, not this occurrence.
    let one_time = record
        .reoccurring
        .as_deref()
        .map_or(ONE_TIME_EVENT, js::trim)
        == ONE_TIME_EVENT;
    let ends_at = record
        .end_date
        .as_deref()
        .filter(|end| one_time && !end.is_empty())
        .and_then(|end| DateTime::from_iso(end, Zone::System, now));
    Schedule {
        scheduled: false,
        sessions: vec![Session {
            starts_at: *occurrence,
            ends_at,
            label: None,
        }],
    }
}

/// `currentSession`: the first session that has not finished, or the last one once all have.
pub fn current_session<'s, 'a>(sessions: &'s [Session<'a>], now: i64) -> Option<&'s Session<'a>> {
    sessions
        .iter()
        .find(|session| session.ends_at.unwrap_or(session.starts_at).millis() > now)
        .or_else(|| sessions.last())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-10-06T16:00:00Z: Tuesday noon in New York.
    const TUESDAY_NOON: i64 = 1_791_302_400_000;

    fn ny(text: &str) -> DateTime {
        DateTime::from_iso(text, Zone::NewYork, TUESDAY_NOON).unwrap()
    }

    fn next(start: &str, recurrence: &str, reference: &str) -> String {
        let event = DateTime::from_iso(start, Zone::System, TUESDAY_NOON).unwrap();
        next_occurrence(Some(&event), recurrence, &ny(reference))
            .unwrap()
            .unwrap()
            .to_iso()
    }

    #[test]
    fn finds_the_next_occurrence_of_each_recurrence() {
        // Sunday 4 October 2026, 10:00 in New York.
        let start = "2026-10-04T14:00:00.000Z";
        let tuesday = "2026-10-06T12:00";
        assert_eq!(
            next(start, "One time Event", tuesday),
            "2026-10-04T10:00:00.000-04:00"
        );
        assert_eq!(
            next(start, "Daily", tuesday),
            "2026-10-06T10:00:00.000-04:00"
        );
        assert_eq!(
            next(start, "Weekly", tuesday),
            "2026-10-11T10:00:00.000-04:00"
        );
        assert_eq!(
            next(start, "BiWeekly", tuesday),
            "2026-10-18T10:00:00.000-04:00"
        );
        assert_eq!(
            next(start, "Monthly", tuesday),
            "2026-11-04T10:00:00.000-05:00"
        );
        assert_eq!(
            next(start, "Twice a month", tuesday),
            "2026-10-15T10:00:00.000-04:00"
        );
        // On the weekday itself, after the event's time, the event is still today.
        assert_eq!(
            next(start, "Weekly", "2026-10-11T23:00"),
            "2026-10-11T10:00:00.000-04:00"
        );
        assert_eq!(
            next(start, "Twice a month", "2026-10-15T09:00"),
            "2026-10-15T10:00:00.000-04:00"
        );
        assert_eq!(
            next(start, "Twice a month", "2026-10-15T11:00"),
            "2026-11-01T10:00:00.000-05:00"
        );
        assert_eq!(
            next(start, "Twice a month", "2026-11-01T09:00"),
            "2026-11-01T10:00:00.000-05:00"
        );
    }

    #[test]
    fn rolls_a_monthly_day_past_a_short_month() {
        // The 31st set on a 30-day month is the 1st of the next.
        assert_eq!(
            next("2026-08-31T14:00:00.000Z", "Monthly", "2026-09-10T12:00"),
            "2026-10-01T10:00:00.000-04:00"
        );
    }

    #[test]
    fn fails_like_the_ts_calculator() {
        let reference = ny("2026-10-06T12:00");
        for recurrence in ["Daily", "Weekly", "BiWeekly", "Monthly", "Twice a month"] {
            assert_eq!(
                next_occurrence(None, recurrence, &reference),
                Err(ScheduleError::InvalidUnit)
            );
        }
        assert_eq!(
            next_occurrence(None, "One time Event", &reference),
            Ok(None)
        );
        let event = ny("2026-10-04T10:00");
        assert_eq!(
            next_occurrence(Some(&event), "Yearly", &reference)
                .unwrap_err()
                .to_string(),
            "Unsupported recurring type: Yearly"
        );
    }
}
