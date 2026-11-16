//! `events` and `upcomingEventsByMonth` (`apps/server/src/graphql/schema/cms/events.ts`): a
//! campus's events from `CmsContent.events`, each dated by its next occurrence or its current
//! session in New York time, either as a list (`events`, sorted by date unless a slug was
//! asked for) or grouped by New York month (`upcomingEventsByMonth`).
//!
//! Failures follow TS: `events` throws `Error fetching events`, which the masking turns into
//! `Unexpected error.`; `upcomingEventsByMonth` answers `UpcomingEventsByMonthFetchError` with
//! the error's own message (a `CmsContentError`'s text, or the date error `mapEventRecord`
//! throws).
//!
//! Deliberate difference: when neither Luxon nor the sessions give an event a date (a one-time
//! event whose start date Luxon cannot parse), TS falls back to date-fns (`getNextOccurrence`
//! in `utils/events.ts`). For a date date-fns cannot read either, that throws
//! `Invalid time zone specified: America/New_York`, which Rust reproduces; for the ISO variants
//! only date-fns reads (a space instead of `T`, for example) TS dates the event as
//! `yyyy-MM-dd HH:mm:ssXXX`, which Rust does not port: it fails with the same error. Strapi 5
//! sends ISO `DateTime`s, so the fallback is never reached with CMS data.

pub mod luxon;
pub mod schedule;

use std::sync::{Arc, LazyLock};

use async_graphql::{Context, Enum, ID, Object, SimpleObject, Union};
use regex::Regex;

use self::luxon::{DateTime, Zone};
use self::schedule::{ScheduleError, current_session, event_sessions, next_occurrence};
use crate::fields::Clock;
use crate::fields::legacy_wire::speaker_full_name;
use crate::fields::scalars::{JsDate, Json};
use crate::graphql::guards::Authorized;
use crate::strapi::records::{EventQuery, EventRecord};
use crate::strapi::{CmsContentError, CmsSource, js};
use crate::text::capitalize_text;

/// The upcoming-events page is stored as an event; it is never listed.
const UPCOMING_EVENTS_PAGE_SLUG: &str = "UPCOMING-EVENTS";
/// Also includes events without a campus.
const DEFAULT_EVENT_CAMPUS: &str = "house-of-stars";
const ONE_TIME_EVENT: &str = "One time Event";

// `ReoccurringEnum`: the GraphQL names of the stored recurrence values. (No doc comment: it
// would become a GraphQL description, which TS has none of.)
#[derive(Clone, Copy, Debug, PartialEq, Eq, Enum)]
pub enum Reoccurring {
    OneTimeEvent,
    Daily,
    Weekly,
    BiWeekly,
    Monthly,
    TwiceAMonth,
}

impl Reoccurring {
    /// The enum's value, which the CMS filter receives (Strapi 4 stored "Daily " with a space).
    pub fn value(self) -> &'static str {
        match self {
            Self::OneTimeEvent => ONE_TIME_EVENT,
            Self::Daily => "Daily ",
            Self::Weekly => "Weekly",
            Self::BiWeekly => "BiWeekly",
            Self::Monthly => "Monthly",
            Self::TwiceAMonth => "Twice a month",
        }
    }
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct EventSpeaker {
    pub full_name: Option<String>,
    pub image: Option<String>,
}

/// One time an event happens. Times are instants; the church schedules them in New York time.
#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct EventSession {
    /// Null when the session has no end time
    pub ends_at: Option<JsDate>,
    /// The event slug and the session start, e.g. sunday-service@2026-10-11T13:00:00.000Z
    pub id: ID,
    /// The editor's name for the session, e.g. "Opening night"
    pub label: Option<String>,
    pub starts_at: JsDate,
}

/// A start time on every day a recurring event happens
#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct EventRecurringTime {
    /// The editor's name for the time, e.g. "First service"
    pub label: Option<String>,
    /// New York wall-clock time, 24-hour "HH:mm", e.g. "09:00"
    pub start_time: String,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct Event {
    pub body: Option<String>,
    /// The event page's rich text as a Tiptap document (paragraphs, headings, nested lists, marks, media), or null when the page has none. Prefer it over body, the EditorJS JSON string installed apps render.
    pub content: Option<Json>,
    pub description: Option<String>,
    /// When the last session ends; null when it has no end time
    pub ends_at: Option<JsDate>,
    pub event_date: Option<String>,
    pub event_image_url: Option<String>,
    pub event_month: Option<String>,
    pub event_speakers: Option<Vec<EventSpeaker>>,
    pub event_time: Option<String>,
    pub event_title: Option<String>,
    pub page_name: Option<String>,
    pub page_title: Option<String>,
    /// Each time on every day a recurring event happens, earliest first, from the CMS RecurringTimes. Empty for one-time events and while the CMS MultipleTimes switch is off.
    pub recurring_times: Vec<EventRecurringTime>,
    pub reoccurring: Option<String>,
    /// Event room
    pub room: Option<String>,
    /// When the event happens, soonest first: every session of a one-time event, or each time on a recurring event's next day. Events without a schedule have one session from their own dates. eventDate, eventTime and eventMonth describe the first session that has not finished.
    pub sessions: Vec<EventSession>,
    pub slug: Option<String>,
    /// When the first session starts
    pub starts_at: Option<JsDate>,
    pub zoom_link: Option<String>,
    /// `eventDate` as an instant, which is what TS sorts and groups by (`new Date(eventDate)`).
    #[graphql(skip)]
    pub dated_at: i64,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct EventMonthGroup {
    /// Events occurring in this month, soonest first
    pub events: Option<Vec<Event>>,
    /// Full month name, e.g. "August"
    pub month: Option<String>,
    /// Calendar year the month belongs to
    pub year: Option<i32>,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct UpcomingEventsByMonthSuccess {
    /// Upcoming events grouped by month in chronological order
    pub months: Option<Vec<EventMonthGroup>>,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct UpcomingEventsByMonthFetchError {
    /// Error message describing what went wrong
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Union)]
pub enum UpcomingEventsByMonthResult {
    UpcomingEventsByMonthFetchError(UpcomingEventsByMonthFetchError),
    UpcomingEventsByMonthSuccess(UpcomingEventsByMonthSuccess),
}

/// Why events could not be listed; the text is the JavaScript error's message.
#[derive(Debug, thiserror::Error)]
pub enum EventsError {
    #[error(transparent)]
    Cms(#[from] CmsContentError),
    #[error(transparent)]
    Schedule(#[from] ScheduleError),
}

/// `/^(?:[01]\d|2[0-3]):[0-5]\d/u`: the "HH:mm" at the start of a CMS time.
static CLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]").expect("a valid pattern"));

/// `mapEventRecord`, with Luxon's clock at `now`.
pub fn map_event(record: &EventRecord, now: i64) -> Result<Event, ScheduleError> {
    let event_date = DateTime::from_iso(&record.start_date, Zone::System, now);
    let recurrence = record
        .reoccurring
        .as_deref()
        .map_or(ONE_TIME_EVENT, js::trim);
    let reference = DateTime::from_millis(now, Zone::System).ok_or(ScheduleError::InvalidTime)?;
    let next = next_occurrence(event_date.as_ref(), recurrence, &reference)?;
    let schedule = event_sessions(record, next.as_ref(), now);
    // An event with a schedule is dated by its session in progress or next; others as before.
    let dated = if schedule.scheduled {
        current_session(&schedule.sessions, now)
            .and_then(|session| session.starts_at.set_zone(Zone::NewYork))
            .or(next)
    } else {
        next
    };
    let dated = dated.ok_or(ScheduleError::InvalidTime)?;
    let event_time = luxon::new_york_time(dated.millis()).ok_or(ScheduleError::InvalidTime)?;

    let page_name = capitalize_text(js::trim(record.page_name.as_deref().unwrap_or_default()));
    let event_title = capitalize_text(js::trim(record.event_title.as_deref().unwrap_or_default()));
    let sessions: Vec<EventSession> = schedule
        .sessions
        .iter()
        .map(|session| {
            let utc = session
                .starts_at
                .set_zone(Zone::Fixed(0))
                .map(|start| start.to_iso())
                .unwrap_or_default();
            EventSession {
                id: ID(format!("{}@{utc}", record.slug)),
                starts_at: JsDate(session.starts_at.millis()),
                ends_at: session.ends_at.map(|end| JsDate(end.millis())),
                label: session.label.map(str::to_owned),
            }
        })
        .collect();
    let mut recurring_times: Vec<EventRecurringTime> = record
        .recurring_times
        .iter()
        .filter_map(|time| {
            Some(EventRecurringTime {
                start_time: CLOCK.find(&time.start_time)?.as_str().to_owned(),
                label: time.label.clone(),
            })
        })
        .collect();
    // "HH:mm" sorts chronologically as text.
    recurring_times.sort_by(|a, b| a.start_time.cmp(&b.start_time));

    Ok(Event {
        page_title: Some(page_name.clone()),
        event_title: Some(event_title),
        description: record.description.clone(),
        body: record.body.as_ref().map(|body| {
            body.replace("&gt;", ">")
                .replace("&lt;", "<")
                .replace("&nbsp;", " ")
        }),
        content: record.content.as_ref().and_then(Json::of),
        event_image_url: Some(record.image_url.clone().unwrap_or_default()),
        page_name: Some(page_name),
        reoccurring: record.reoccurring.clone(),
        room: record.room.clone(),
        slug: Some(record.slug.clone()),
        event_speakers: record.speakers.as_ref().map(|speakers| {
            speakers
                .iter()
                .map(|speaker| EventSpeaker {
                    full_name: speaker_full_name(speaker),
                    image: speaker.image.clone(),
                })
                .collect()
        }),
        zoom_link: record.zoom_link.clone(),
        event_time: Some(event_time),
        event_date: Some(dated.to_iso()),
        event_month: Some(dated.month_name().to_owned()),
        starts_at: sessions.first().map(|session| session.starts_at.clone()),
        ends_at: sessions.last().and_then(|session| session.ends_at.clone()),
        sessions,
        recurring_times,
        dated_at: dated.millis(),
    })
}

/// `campusSlug?.trim() || DEFAULT_EVENT_CAMPUS`.
fn campus_slug(campus_slug: Option<&str>) -> String {
    campus_slug
        .map(js::trim)
        .filter(|slug| !slug.is_empty())
        .unwrap_or(DEFAULT_EVENT_CAMPUS)
        .to_owned()
}

/// `format(new Date(), "yyyy-MM-dd")` in the process zone (UTC).
fn today(now: i64) -> Option<String> {
    let c = luxon::utc_fields(now)?;
    Some(format!("{:04}-{:02}-{:02}", c.year, c.month, c.day))
}

/// The listed events of `records`, in CMS order.
fn listed(records: &[EventRecord], now: i64) -> Result<Vec<Event>, ScheduleError> {
    records
        .iter()
        .filter(|record| record.slug != UPCOMING_EVENTS_PAGE_SLUG)
        .map(|record| map_event(record, now))
        .collect()
}

/// The `events` resolver body.
pub async fn resolve_events(
    cms: &dyn CmsSource,
    now: i64,
    campus: Option<&str>,
    slug: Option<String>,
    reoccurring: Option<Reoccurring>,
) -> Result<Vec<Event>, EventsError> {
    let by_slug = slug.as_deref().is_some_and(|slug| !slug.is_empty());
    let query = EventQuery {
        campus_slug: campus_slug(campus),
        reoccurring: reoccurring.map(|value| value.value().to_owned()),
        slug,
        upcoming_from: if by_slug { None } else { today(now) },
    };
    let records = cms.events(query).await?;
    let mut events = listed(&records, now)?;
    if !by_slug && events.len() > 1 {
        events.sort_by_key(|event| event.dated_at);
    }
    Ok(events)
}

/// `groupEventsByMonth`: soonest first, grouped by New York month in order of appearance.
fn group_by_month(mut events: Vec<Event>) -> Vec<EventMonthGroup> {
    events.sort_by_key(|event| event.dated_at);
    let mut groups: Vec<(i64, i64, EventMonthGroup)> = Vec::new();
    for event in events {
        let Some((c, _)) = luxon::new_york_fields(event.dated_at) else {
            continue;
        };
        match groups
            .iter_mut()
            .find(|(year, month, _)| *year == c.year && *month == c.month)
        {
            Some((_, _, group)) => group.events.get_or_insert_with(Vec::new).push(event),
            None => groups.push((
                c.year,
                c.month,
                EventMonthGroup {
                    month: Some(luxon::month_name(c.month).to_owned()),
                    year: i32::try_from(c.year).ok(),
                    events: Some(vec![event]),
                },
            )),
        }
    }
    groups.into_iter().map(|(_, _, group)| group).collect()
}

/// The `upcomingEventsByMonth` resolver body.
pub async fn resolve_upcoming(
    cms: &dyn CmsSource,
    now: i64,
    campus: Option<&str>,
) -> UpcomingEventsByMonthResult {
    let query = EventQuery {
        campus_slug: campus_slug(campus),
        upcoming_from: today(now),
        ..EventQuery::default()
    };
    let result = async {
        let records = cms.events(query).await?;
        Ok::<_, EventsError>(listed(&records, now)?)
    }
    .await;
    match result {
        Ok(events) => UpcomingEventsByMonthResult::UpcomingEventsByMonthSuccess(
            UpcomingEventsByMonthSuccess {
                months: Some(group_by_month(events)),
            },
        ),
        Err(error) => UpcomingEventsByMonthResult::UpcomingEventsByMonthFetchError(
            UpcomingEventsByMonthFetchError {
                message: Some(error.to_string()),
            },
        ),
    }
}

#[derive(Default)]
pub struct EventsQuery;

#[Object]
impl EventsQuery {
    /// Get events from Strapi. If slug is provided, returns a single event. If reoccurring is provided, filters events by reoccurring type.
    #[graphql(
        guard = "Authorized",
        deprecation = "Use upcomingEventsByMonth instead, which groups upcoming events by month and returns typed success/error responses. The slug argument for single-event lookup has no replacement yet."
    )]
    async fn events(
        &self,
        ctx: &Context<'_>,
        #[graphql(
            desc = "Campus slug. Defaults to house-of-stars, which also includes events without a campus. Other campuses include only events assigned to that campus."
        )]
        campus_slug: Option<String>,
        #[graphql(desc = "Event slug")] slug: Option<String>,
        reoccurring: Option<Reoccurring>,
    ) -> async_graphql::Result<Option<Vec<Event>>> {
        let cms = ctx.data::<Arc<dyn CmsSource>>()?;
        let now = ctx.data::<Clock>()?.now_ms();
        match resolve_events(cms.as_ref(), now, campus_slug.as_deref(), slug, reoccurring).await {
            Ok(events) => Ok(Some(events)),
            Err(error) => {
                tracing::error!(error = %error, "Error fetching events");
                Err(async_graphql::Error::new("Error fetching events"))
            }
        }
    }

    /// Get upcoming events grouped by month with typed success and error responses
    #[graphql(guard = "Authorized")]
    async fn upcoming_events_by_month(
        &self,
        ctx: &Context<'_>,
        #[graphql(
            desc = "Campus slug. Defaults to house-of-stars, which also includes events without a campus. Other campuses include only events assigned to that campus."
        )]
        campus_slug: Option<String>,
    ) -> async_graphql::Result<Option<UpcomingEventsByMonthResult>> {
        let cms = ctx.data::<Arc<dyn CmsSource>>()?;
        let now = ctx.data::<Clock>()?.now_ms();
        Ok(Some(
            resolve_upcoming(cms.as_ref(), now, campus_slug.as_deref()).await,
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::{Value, json};

    use super::*;
    use crate::strapi::CmsContentErrorReason;
    use crate::strapi::records::{EventSession as CmsSession, RecurringTime, SpeakerRecord};
    use crate::strapi::rich_content::RichDocument;
    use crate::test_support::{FakeCms, execute_with_variables, schema_at, viewer};

    /// Tuesday 6 October 2026, noon in New York.
    const TUESDAY_NOON: &str = "2026-10-06T16:00:00.000Z";

    fn at(iso: &str) -> i64 {
        DateTime::from_iso(iso, Zone::System, 0).unwrap().millis()
    }

    fn event() -> EventRecord {
        EventRecord {
            slug: "sunday-service".to_owned(),
            page_name: Some("Sunday Service".to_owned()),
            event_title: Some("Sunday Service".to_owned()),
            description: None,
            body: None,
            content: None,
            start_date: "2026-10-04T14:00:00.000Z".to_owned(),
            end_date: None,
            reoccurring: Some("Weekly".to_owned()),
            room: None,
            zoom_link: None,
            speakers: None,
            image_url: None,
            sessions: Vec::new(),
            recurring_times: Vec::new(),
        }
    }

    fn record(
        slug: &str,
        title: &str,
        start: &str,
        end: Option<&str>,
        reoccurring: &str,
    ) -> EventRecord {
        EventRecord {
            slug: slug.to_owned(),
            page_name: Some(title.to_owned()),
            event_title: Some(title.to_owned()),
            start_date: start.to_owned(),
            end_date: end.map(str::to_owned),
            reoccurring: Some(reoccurring.to_owned()),
            ..event()
        }
    }

    fn harvest_night() -> EventRecord {
        record(
            "harvest-night",
            "Harvest Night",
            "2026-11-14T14:00:00.000Z",
            Some("2026-11-14T17:00:00.000Z"),
            "One time Event",
        )
    }

    /// Strapi 4 stored the daily recurrence with a trailing space.
    fn prayer_line() -> EventRecord {
        record(
            "prayer-line",
            "Prayer Line",
            "2026-09-01T23:00:00.000Z",
            None,
            "Daily ",
        )
    }

    fn youth_retreat() -> EventRecord {
        record(
            "youth-retreat",
            "Youth Retreat",
            "2026-10-05T23:00:00.000Z",
            Some("2026-10-08T01:00:00.000Z"),
            "One time Event",
        )
    }

    fn session(date: &str, start: &str, end: Option<&str>, label: Option<&str>) -> CmsSession {
        CmsSession {
            date: date.to_owned(),
            start_time: start.to_owned(),
            end_time: end.map(str::to_owned),
            label: label.map(str::to_owned),
        }
    }

    fn kingdom_culture() -> EventRecord {
        EventRecord {
            slug: "kingdom-culture".to_owned(),
            start_date: "2026-10-05T23:00:00.000Z".to_owned(),
            end_date: Some("2026-10-08T01:00:00.000Z".to_owned()),
            reoccurring: Some("One time Event".to_owned()),
            sessions: vec![
                session(
                    "2026-10-07",
                    "19:00:00.000",
                    Some("21:00:00.000"),
                    Some("Night three"),
                ),
                session(
                    "2026-10-05",
                    "19:00:00.000",
                    Some("21:00:00.000"),
                    Some("Opening night"),
                ),
                session(
                    "2026-10-06",
                    "10:00:00.000",
                    Some("12:30:00.000"),
                    Some("Morning"),
                ),
                session("2026-10-06", "19:00:00.000", None, None),
            ],
            ..event()
        }
    }

    /// The CMS moves a recurring start to its earliest time: Sunday 9:00 in New York.
    fn two_services() -> EventRecord {
        EventRecord {
            start_date: "2026-10-04T13:00:00.000Z".to_owned(),
            recurring_times: vec![
                RecurringTime {
                    start_time: "11:00:00.000".to_owned(),
                    label: Some("Second service".to_owned()),
                },
                RecurringTime {
                    start_time: "09:00:00.000".to_owned(),
                    label: Some("First service".to_owned()),
                },
            ],
            ..event()
        }
    }

    async fn run_at(now: &str, query: &str, variables: Value, events: Vec<EventRecord>) -> Value {
        let cms = FakeCms::default().with_events(move || Ok(events.clone()));
        let schema = schema_at(Arc::new(cms), Clock::fixed(at(now)));
        let response = execute_with_variables(&schema, query, variables, Some(viewer())).await;
        assert!(response.get("errors").is_none(), "{response}");
        response
    }

    // events.test.ts: "exposes the rich text content the app renders next to the EditorJS body".
    #[tokio::test]
    async fn exposes_the_rich_text_content_next_to_the_editorjs_body() {
        let content = json!({
            "type": "doc",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Join us" }] }],
        });
        let document: RichDocument = serde_json::from_value(content.clone()).unwrap();
        let record = EventRecord {
            body: Some("{}".to_owned()),
            content: Some(document),
            ..event()
        };
        let response = run_at(
            TUESDAY_NOON,
            r#"query { events(slug: "sunday-service", campusSlug: "house-of-stars") { slug body content } }"#,
            Value::Null,
            vec![record],
        )
        .await;
        assert_eq!(
            response,
            json!({ "data": { "events": [{ "slug": "sunday-service", "body": "{}", "content": content }] } })
        );
    }

    // events.test.ts: "answers null content when the event has no body".
    #[tokio::test]
    async fn answers_null_content_when_the_event_has_no_body() {
        let response = run_at(
            TUESDAY_NOON,
            r#"query { events(slug: "sunday-service") { slug content } }"#,
            Value::Null,
            vec![event()],
        )
        .await;
        assert_eq!(
            response,
            json!({ "data": { "events": [{ "slug": "sunday-service", "content": null }] } })
        );
    }

    // The operations installed 2.0.x apps send; their fields must keep their exact formats.
    const INSTALLED_LATEST_EVENTS: &str = "query LatestEventsQuery($campusSlug: String!) {
  upcomingEventsByMonth(campusSlug: $campusSlug) {
    __typename
    ... on UpcomingEventsByMonthSuccess {
      months { month year events { eventTitle eventDate description slug eventSpeakers { image } } }
    }
    ... on UpcomingEventsByMonthFetchError { message }
  }
}";
    const INSTALLED_EVENT_DETAIL: &str =
        "query EventDetailQuery($slug: String!, $campusSlug: String!) {
  events(slug: $slug, campusSlug: $campusSlug) {
    description eventDate eventImageUrl eventTime eventTitle pageTitle reoccurring slug
    eventMonth pageName body zoomLink eventSpeakers { fullName image } room
  }
}";

    fn listed(slug: &str, title: &str, event_date: &str) -> Value {
        json!({
            "eventTitle": title, "eventDate": event_date, "description": null, "slug": slug,
            "eventSpeakers": null,
        })
    }

    async fn detail(events: Vec<EventRecord>) -> Value {
        let slug = events[0].slug.clone();
        let response = run_at(
            TUESDAY_NOON,
            INSTALLED_EVENT_DETAIL,
            json!({ "slug": slug, "campusSlug": "house-of-stars" }),
            events,
        )
        .await;
        response["data"]["events"][0].clone()
    }

    // events.test.ts: "lists upcoming events by New York month at their next date".
    #[tokio::test]
    async fn lists_upcoming_events_by_new_york_month_at_their_next_date() {
        let response = run_at(
            TUESDAY_NOON,
            INSTALLED_LATEST_EVENTS,
            json!({ "campusSlug": "house-of-stars" }),
            vec![harvest_night(), event(), prayer_line(), youth_retreat()],
        )
        .await;
        assert_eq!(
            response,
            json!({ "data": { "upcomingEventsByMonth": {
                "__typename": "UpcomingEventsByMonthSuccess",
                "months": [
                    {
                        "month": "October",
                        "year": 2026,
                        "events": [
                            listed("youth-retreat", "Youth Retreat", "2026-10-05T19:00:00.000-04:00"),
                            listed("prayer-line", "Prayer Line", "2026-10-06T19:00:00.000-04:00"),
                            listed("sunday-service", "Sunday Service", "2026-10-11T10:00:00.000-04:00"),
                        ],
                    },
                    {
                        "month": "November",
                        "year": 2026,
                        "events": [listed("harvest-night", "Harvest Night", "2026-11-14T09:00:00.000-05:00")],
                    },
                ],
            } } })
        );
    }

    // events.test.ts: "details an event with its next date, Eastern time and month".
    #[tokio::test]
    async fn details_an_event_with_its_next_date_eastern_time_and_month() {
        assert_eq!(
            detail(vec![harvest_night()]).await,
            json!({
                "description": null,
                "eventDate": "2026-11-14T09:00:00.000-05:00",
                "eventImageUrl": "",
                "eventTime": "09:00:00-05:00",
                "eventTitle": "Harvest Night",
                "pageTitle": "Harvest Night",
                "reoccurring": "One time Event",
                "slug": "harvest-night",
                "eventMonth": "November",
                "pageName": "Harvest Night",
                "body": null,
                "zoomLink": null,
                "eventSpeakers": null,
                "room": null,
            })
        );
        let weekly = detail(vec![event()]).await;
        assert_eq!(weekly["eventDate"], "2026-10-11T10:00:00.000-04:00");
        assert_eq!(weekly["eventTime"], "10:00:00-04:00");
        assert_eq!(weekly["eventMonth"], "October");
        assert_eq!(weekly["reoccurring"], "Weekly");
        let daily = detail(vec![prayer_line()]).await;
        assert_eq!(daily["eventDate"], "2026-10-06T19:00:00.000-04:00");
        assert_eq!(daily["eventTime"], "19:00:00-04:00");
        assert_eq!(daily["eventMonth"], "October");
        assert_eq!(daily["reoccurring"], "Daily ");
    }

    const SCHEDULE: &str = "query Schedule($slug: String!) {
  events(slug: $slug) {
    eventDate eventTime eventMonth startsAt endsAt
    sessions { id startsAt endsAt label }
  }
}";

    async fn schedule(now: &str, events: Vec<EventRecord>) -> Value {
        let slug = events[0].slug.clone();
        let response = run_at(now, SCHEDULE, json!({ "slug": slug }), events).await;
        response["data"]["events"][0].clone()
    }

    fn session_of(
        slug: &str,
        starts_at: &str,
        ends_at: Option<&str>,
        label: Option<&str>,
    ) -> Value {
        json!({ "id": format!("{slug}@{starts_at}"), "startsAt": starts_at, "endsAt": ends_at, "label": label })
    }

    // events.test.ts, event sessions.
    #[tokio::test]
    async fn lists_every_session_of_a_multi_day_event_and_dates_the_event_by_the_current_one() {
        let s = |start, end, label| session_of("kingdom-culture", start, end, label);
        assert_eq!(
            schedule(TUESDAY_NOON, vec![kingdom_culture()]).await,
            json!({
                "eventDate": "2026-10-06T10:00:00.000-04:00",
                "eventTime": "10:00:00-04:00",
                "eventMonth": "October",
                "startsAt": "2026-10-05T23:00:00.000Z",
                "endsAt": "2026-10-08T01:00:00.000Z",
                "sessions": [
                    s("2026-10-05T23:00:00.000Z", Some("2026-10-06T01:00:00.000Z"), Some("Opening night")),
                    s("2026-10-06T14:00:00.000Z", Some("2026-10-06T16:30:00.000Z"), Some("Morning")),
                    s("2026-10-06T23:00:00.000Z", None, None),
                    s("2026-10-07T23:00:00.000Z", Some("2026-10-08T01:00:00.000Z"), Some("Night three")),
                ],
            })
        );
    }

    #[tokio::test]
    async fn dates_a_finished_multi_day_event_by_its_last_session() {
        let response = schedule("2026-10-09T16:00:00.000Z", vec![kingdom_culture()]).await;
        assert_eq!(response["eventDate"], "2026-10-07T19:00:00.000-04:00");
        assert_eq!(response["eventTime"], "19:00:00-04:00");
    }

    #[tokio::test]
    async fn ends_an_overnight_session_on_the_next_day() {
        let watch_night = EventRecord {
            slug: "watch-night".to_owned(),
            start_date: "2027-01-01T03:00:00.000Z".to_owned(),
            reoccurring: Some("One time Event".to_owned()),
            sessions: vec![session(
                "2026-12-31",
                "22:00:00.000",
                Some("01:00:00.000"),
                None,
            )],
            ..event()
        };
        let response = schedule(TUESDAY_NOON, vec![watch_night]).await;
        assert_eq!(
            response["sessions"],
            json!([session_of(
                "watch-night",
                "2027-01-01T03:00:00.000Z",
                Some("2027-01-01T06:00:00.000Z"),
                None
            )])
        );
    }

    #[tokio::test]
    async fn lists_each_recurring_time_on_the_next_day_the_event_happens() {
        let s = |start, label| session_of("sunday-service", start, None, label);
        assert_eq!(
            schedule(TUESDAY_NOON, vec![two_services()]).await,
            json!({
                "eventDate": "2026-10-11T09:00:00.000-04:00",
                "eventTime": "09:00:00-04:00",
                "eventMonth": "October",
                "startsAt": "2026-10-11T13:00:00.000Z",
                "endsAt": null,
                "sessions": [
                    s("2026-10-11T13:00:00.000Z", Some("First service")),
                    s("2026-10-11T15:00:00.000Z", Some("Second service")),
                ],
            })
        );
    }

    #[tokio::test]
    async fn dates_a_recurring_event_by_its_next_time_that_day_in_new_york_time() {
        // Sunday 10:00 in New York, between the two services.
        let between = schedule("2026-10-11T14:00:00.000Z", vec![two_services()]).await;
        assert_eq!(between["eventDate"], "2026-10-11T11:00:00.000-04:00");
        assert_eq!(between["eventTime"], "11:00:00-04:00");
        // Daylight saving time ends on Sunday 1 November.
        let after_dst = schedule("2026-10-28T16:00:00.000Z", vec![two_services()]).await;
        assert_eq!(after_dst["eventDate"], "2026-11-01T09:00:00.000-05:00");
        let s = |start, label| session_of("sunday-service", start, None, label);
        assert_eq!(
            after_dst["sessions"],
            json!([
                s("2026-11-01T14:00:00.000Z", Some("First service")),
                s("2026-11-01T16:00:00.000Z", Some("Second service")),
            ])
        );
    }

    #[tokio::test]
    async fn gives_events_without_a_schedule_one_session_from_their_own_dates() {
        let harvest = schedule(TUESDAY_NOON, vec![harvest_night()]).await;
        assert_eq!(harvest["startsAt"], "2026-11-14T14:00:00.000Z");
        assert_eq!(harvest["endsAt"], "2026-11-14T17:00:00.000Z");
        assert_eq!(
            harvest["sessions"],
            json!([session_of(
                "harvest-night",
                "2026-11-14T14:00:00.000Z",
                Some("2026-11-14T17:00:00.000Z"),
                None
            )])
        );
        let weekly = schedule(TUESDAY_NOON, vec![event()]).await;
        assert_eq!(weekly["startsAt"], "2026-10-11T14:00:00.000Z");
        assert_eq!(weekly["endsAt"], Value::Null);
        assert_eq!(
            weekly["sessions"],
            json!([session_of(
                "sunday-service",
                "2026-10-11T14:00:00.000Z",
                None,
                None
            )])
        );
    }

    const RECURRING_TIMES: &str = "query RecurringTimes($slug: String!) { events(slug: $slug) { recurringTimes { startTime label } } }";

    async fn recurring_times(events: Vec<EventRecord>) -> Value {
        let slug = events[0].slug.clone();
        let response = run_at(
            TUESDAY_NOON,
            RECURRING_TIMES,
            json!({ "slug": slug }),
            events,
        )
        .await;
        response["data"]["events"][0].clone()
    }

    // events.test.ts, event recurring times.
    #[tokio::test]
    async fn lists_a_recurring_events_times_in_new_york_time_earliest_first() {
        assert_eq!(
            recurring_times(vec![two_services()]).await,
            json!({ "recurringTimes": [
                { "startTime": "09:00", "label": "First service" },
                { "startTime": "11:00", "label": "Second service" },
            ] })
        );
    }

    #[tokio::test]
    async fn is_empty_for_events_without_recurring_times() {
        assert_eq!(
            recurring_times(vec![event()]).await,
            json!({ "recurringTimes": [] })
        );
        assert_eq!(
            recurring_times(vec![kingdom_culture()]).await,
            json!({ "recurringTimes": [] })
        );
    }

    #[tokio::test]
    async fn keeps_only_valid_clock_times() {
        let record = EventRecord {
            recurring_times: ["24:00:00.000", "7:30", "23:59:00.000", "08:05"]
                .into_iter()
                .map(|start| RecurringTime {
                    start_time: start.to_owned(),
                    label: None,
                })
                .collect(),
            ..event()
        };
        assert_eq!(
            recurring_times(vec![record]).await,
            json!({ "recurringTimes": [
                { "startTime": "08:05", "label": null },
                { "startTime": "23:59", "label": null },
            ] })
        );
    }

    #[tokio::test]
    async fn asks_the_cms_for_the_campus_recurrence_slug_and_upcoming_window() {
        let cms = Arc::new(FakeCms::default().with_events(|| Ok(Vec::new())));
        let schema = schema_at(cms.clone(), Clock::fixed(at(TUESDAY_NOON)));
        for query in [
            "query { events { slug } }",
            r#"query { events(campusSlug: "  new-breed ", reoccurring: DAILY) { slug } }"#,
            r#"query { events(slug: "harvest-night", campusSlug: " ") { slug } }"#,
            r#"query { events(slug: "") { slug } }"#,
            r#"query { upcomingEventsByMonth(campusSlug: "light-house") { __typename } }"#,
        ] {
            let response =
                execute_with_variables(&schema, query, Value::Null, Some(viewer())).await;
            assert!(response.get("errors").is_none(), "{response}");
        }
        let query = |campus: &str,
                     reoccurring: Option<&str>,
                     slug: Option<&str>,
                     from: Option<&str>| EventQuery {
            campus_slug: campus.to_owned(),
            reoccurring: reoccurring.map(str::to_owned),
            slug: slug.map(str::to_owned),
            upcoming_from: from.map(str::to_owned),
        };
        assert_eq!(
            *cms.event_queries.lock().unwrap(),
            [
                query("house-of-stars", None, None, Some("2026-10-06")),
                query("new-breed", Some("Daily "), None, Some("2026-10-06")),
                query("house-of-stars", None, Some("harvest-night"), None),
                query("house-of-stars", None, Some(""), Some("2026-10-06")),
                query("light-house", None, None, Some("2026-10-06")),
            ]
        );
    }

    #[tokio::test]
    async fn sorts_listed_events_by_date_hides_the_page_record_and_maps_their_text() {
        let page = EventRecord {
            slug: "UPCOMING-EVENTS".to_owned(),
            ..event()
        };
        let mut late = harvest_night();
        late.page_name = Some("  harvest NIGHT ".to_owned());
        late.event_title = None;
        late.body = Some("a &gt; b &lt; c&nbsp;d &amp;gt;".to_owned());
        late.image_url = Some("https://example.com/harvest.jpg".to_owned());
        late.speakers = Some(vec![
            SpeakerRecord {
                full_name: Some("Ada Example".to_owned()),
                title: Some("Guest".to_owned()),
                image: None,
            },
            SpeakerRecord {
                full_name: None,
                title: None,
                image: Some("https://example.com/ada.jpg".to_owned()),
            },
        ]);
        let response = run_at(
            TUESDAY_NOON,
            "query { events { slug pageTitle pageName eventTitle body eventImageUrl eventSpeakers { fullName image } } }",
            Value::Null,
            vec![late, page, youth_retreat()],
        )
        .await;
        assert_eq!(
            response,
            json!({ "data": { "events": [
                {
                    "slug": "youth-retreat", "pageTitle": "Youth Retreat", "pageName": "Youth Retreat",
                    "eventTitle": "Youth Retreat", "body": null, "eventImageUrl": "", "eventSpeakers": null,
                },
                {
                    "slug": "harvest-night", "pageTitle": "Harvest Night", "pageName": "Harvest Night",
                    "eventTitle": "", "body": "a > b < c d &amp;gt;",
                    "eventImageUrl": "https://example.com/harvest.jpg",
                    "eventSpeakers": [
                        { "fullName": "Ada Example\nGuest", "image": null },
                        { "fullName": null, "image": "https://example.com/ada.jpg" },
                    ],
                },
            ] } })
        );
    }

    #[tokio::test]
    async fn keeps_cms_order_for_a_slug() {
        let response = run_at(
            TUESDAY_NOON,
            r#"query { events(slug: "x") { slug } }"#,
            Value::Null,
            vec![harvest_night(), youth_retreat()],
        )
        .await;
        assert_eq!(
            response,
            json!({ "data": { "events": [{ "slug": "harvest-night" }, { "slug": "youth-retreat" }] } })
        );
    }

    fn unavailable() -> CmsContentError {
        CmsContentError {
            reason: CmsContentErrorReason::Unavailable,
            operation: "events",
            detail: "Strapi 5 StrapiV2Events failed (Status): Strapi 5 responded 503 Service Unavailable"
                .to_owned(),
        }
    }

    async fn answer(now: &str, query: &str, cms: FakeCms) -> Value {
        let schema = schema_at(Arc::new(cms), Clock::fixed(at(now)));
        execute_with_variables(&schema, query, Value::Null, Some(viewer())).await
    }

    const UPCOMING: &str = "query { upcomingEventsByMonth {
        __typename
        ... on UpcomingEventsByMonthFetchError { message }
        ... on UpcomingEventsByMonthSuccess { months { month } }
    } }";

    #[tokio::test]
    async fn answers_the_typed_error_with_the_failures_message() {
        let response = answer(
            TUESDAY_NOON,
            UPCOMING,
            FakeCms::default().with_events(|| Err(unavailable())),
        )
        .await;
        assert_eq!(
            response,
            json!({ "data": { "upcomingEventsByMonth": {
                "__typename": "UpcomingEventsByMonthFetchError",
                "message": "CMS events unavailable: Strapi 5 StrapiV2Events failed (Status): Strapi 5 responded 503 Service Unavailable",
            } } })
        );
    }

    // Review Focus 3: an unreadable start date fails the whole list as TS does.
    #[tokio::test]
    async fn fails_the_list_on_an_unreadable_start_date() {
        for (reoccurring, message) in [
            ("Weekly", "Invalid unit value NaN"),
            (
                "One time Event",
                "Invalid time zone specified: America/New_York",
            ),
            ("Yearly", "Unsupported recurring type: Yearly"),
        ] {
            let mut broken = event();
            broken.start_date = "not a date".to_owned();
            broken.reoccurring = Some(reoccurring.to_owned());
            let records = vec![harvest_night(), broken];
            let cms = FakeCms::default().with_events(move || Ok(records.clone()));
            assert_eq!(
                answer(TUESDAY_NOON, UPCOMING, cms).await,
                json!({ "data": { "upcomingEventsByMonth": {
                    "__typename": "UpcomingEventsByMonthFetchError", "message": message,
                } } }),
                "{reoccurring}"
            );
        }
        // A one-time event with sessions is dated by them, whatever its start date.
        let mut sessions_only = kingdom_culture();
        sessions_only.start_date = "not a date".to_owned();
        let response = schedule(TUESDAY_NOON, vec![sessions_only]).await;
        assert_eq!(response["eventDate"], "2026-10-06T10:00:00.000-04:00");
    }

    #[tokio::test]
    async fn masks_events_failures() {
        let mut broken = event();
        broken.start_date = String::new();
        for cms in [
            FakeCms::default().with_events(|| Err(unavailable())),
            FakeCms::default().with_events(move || Ok(vec![broken.clone()])),
        ] {
            assert_eq!(
                answer(TUESDAY_NOON, "query { events { slug } }", cms).await,
                json!({
                    "errors": [{
                        "message": "Unexpected error.",
                        "locations": [{ "line": 1, "column": 9 }],
                        "path": ["events"],
                        "extensions": { "code": "INTERNAL_SERVER_ERROR" },
                    }],
                    "data": { "events": null },
                })
            );
        }
    }

    #[tokio::test]
    async fn requires_an_authorized_caller() {
        let cms = Arc::new(FakeCms::default().with_events(|| Ok(Vec::new())));
        let schema = schema_at(cms.clone(), Clock::fixed(at(TUESDAY_NOON)));
        let response = execute_with_variables(
            &schema,
            "query { events { slug } upcomingEventsByMonth { __typename } }",
            Value::Null,
            None,
        )
        .await;
        let messages: Vec<&str> = response["errors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|error| error["message"].as_str().unwrap())
            .collect();
        assert_eq!(
            messages,
            [
                "Not authorized to resolve Query.events",
                "Not authorized to resolve Query.upcomingEventsByMonth"
            ]
        );
        assert_eq!(cms.calls(), 0);
    }

    /// What the TS `mapEventRecord` gave for a case, as `parity.json` records it.
    fn actual(record: &EventRecord, now: i64) -> Value {
        match map_event(record, now) {
            Err(error) => json!({ "error": error.to_string() }),
            Ok(event) => {
                let date = |at: &Option<JsDate>| {
                    at.as_ref()
                        .and_then(|at| luxon::to_iso_string(at.0))
                        .map_or(Value::Null, Value::String)
                };
                json!({
                    "eventDate": event.event_date,
                    "eventTime": event.event_time,
                    "eventMonth": event.event_month,
                    "startsAt": date(&event.starts_at),
                    "endsAt": date(&event.ends_at),
                    "sessions": event.sessions.iter().map(|session| json!({
                        "id": session.id.0,
                        "startsAt": date(&Some(session.starts_at.clone())),
                        "endsAt": date(&session.ends_at),
                        "label": session.label,
                    })).collect::<Vec<_>>(),
                    "recurringTimes": event.recurring_times.iter().map(|time| json!({
                        "startTime": time.start_time,
                        "label": time.label,
                    })).collect::<Vec<_>>(),
                })
            }
        }
    }

    /// Synthetic events dated by the real TS code (Luxon 3.7, date-fns-tz 3.2) at varied
    /// clocks: every recurrence, sessions, recurring times, DST gaps and overlaps, month ends
    /// and unreadable start dates. `HCCNA_EVENTS_PARITY_CASES` points at a larger set.
    #[test]
    fn dates_events_as_the_ts_code_does() {
        let text = match std::env::var("HCCNA_EVENTS_PARITY_CASES") {
            Ok(path) => std::fs::read_to_string(path).unwrap(),
            Err(_) => include_str!("events/parity.json").to_owned(),
        };
        let cases: Vec<Value> = serde_json::from_str(&text).unwrap();
        let mut compared = 0;
        let mut mismatches = Vec::new();
        for case in &cases {
            let expected = &case["expected"];
            // Deliberate difference: the date-fns fallback's own format is not ported.
            if expected["eventDate"]
                .as_str()
                .is_some_and(|date| !date.contains('T'))
            {
                continue;
            }
            let record: EventRecord = serde_json::from_value(case["record"].clone()).unwrap();
            let now = at(case["now"].as_str().unwrap());
            let actual = actual(&record, now);
            compared += 1;
            if &actual != expected {
                mismatches.push(format!(
                    "{} at {}: expected {expected}, got {actual}",
                    record.slug, case["now"]
                ));
            }
        }
        assert!(compared > 0);
        assert!(
            mismatches.is_empty(),
            "{} of {compared} differ:\n{}",
            mismatches.len(),
            mismatches.join("\n")
        );
    }
}
