//! `queries/events.ts`: a campus's events, optionally one recurrence, one slug, or upcoming only.

use serde::Deserialize;
use serde_json::{Value, json};

use super::{Media, Meta, media_url, nullable, trimmed_or_null};
use crate::strapi::js;
use crate::strapi::records::{
    EventQuery, EventRecord, EventSession, RecurringTime, Reoccurrence, SpeakerRecord,
};
use crate::strapi::rich_content::to_rich_content;
use crate::strapi::rich_text::{UnsupportedRichTextError, to_editor_js_string};

/// `EventsData`.
#[derive(Debug, Deserialize)]
pub struct Data {
    events: Vec<Event>,
}

#[derive(Debug, Deserialize)]
struct Event {
    #[serde(deserialize_with = "nullable")]
    slug: Option<String>,
    #[serde(rename = "EventName", deserialize_with = "nullable")]
    name: Option<String>,
    #[serde(rename = "EventStartDate", deserialize_with = "nullable")]
    start_date: Option<String>,
    #[serde(rename = "EventEndDate", deserialize_with = "nullable")]
    end_date: Option<String>,
    #[serde(rename = "Reoccurrence", deserialize_with = "nullable")]
    reoccurrence: Option<Reoccurrence>,
    #[serde(rename = "ZoomLink", deserialize_with = "nullable")]
    zoom_link: Option<String>,
    body: Value,
    #[serde(rename = "Header", deserialize_with = "nullable")]
    header: Option<Meta>,
    #[serde(rename = "Speaker", deserialize_with = "nullable")]
    speakers: Option<Vec<Speaker>>,
    #[serde(rename = "Sessions", deserialize_with = "nullable")]
    sessions: Option<Vec<Session>>,
    #[serde(rename = "MultipleTimes", deserialize_with = "nullable")]
    multiple_times: Option<bool>,
    #[serde(rename = "RecurringTimes", deserialize_with = "nullable")]
    recurring_times: Option<Vec<Time>>,
}

#[derive(Debug, Deserialize)]
struct Speaker {
    #[serde(rename = "FullName", deserialize_with = "nullable")]
    full_name: Option<String>,
    #[serde(rename = "Title", deserialize_with = "nullable")]
    title: Option<String>,
    #[serde(rename = "Image", deserialize_with = "nullable")]
    image: Option<Media>,
}

#[derive(Debug, Deserialize)]
struct Session {
    #[serde(rename = "Date", deserialize_with = "nullable")]
    date: Option<String>,
    #[serde(rename = "StartTime", deserialize_with = "nullable")]
    start_time: Option<String>,
    #[serde(rename = "EndTime", deserialize_with = "nullable")]
    end_time: Option<String>,
    #[serde(rename = "Label", deserialize_with = "nullable")]
    label: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Time {
    #[serde(rename = "StartTime", deserialize_with = "nullable")]
    start_time: Option<String>,
    #[serde(rename = "Label", deserialize_with = "nullable")]
    label: Option<String>,
}

const HOUSE_OF_STARS: &str = "house-of-stars";
/// The stored value, not the GraphQL name: Strapi 5 filters compare stored strings.
const ONE_TIME_EVENT: &str = "One time Event";

/// `eventsVariables`.
pub fn variables(filter: &EventQuery) -> Value {
    let campus = &filter.campus_slug;
    let mut conditions = vec![if campus == HOUSE_OF_STARS {
        json!({
            "or": [
                { "campuses": { "documentId": { "null": true } } },
                { "campuses": { "slug": { "eq": campus } } },
            ],
        })
    } else {
        json!({ "campuses": { "slug": { "eq": campus } } })
    }];
    if let Some(reoccurring) = filter
        .reoccurring
        .as_deref()
        .map(js::trim)
        .filter(|reoccurring| !reoccurring.is_empty())
    {
        conditions.push(json!({ "Reoccurrence": { "eq": reoccurring } }));
    }
    if let Some(slug) = filter.slug.as_deref().filter(|slug| !slug.is_empty()) {
        conditions.push(json!({ "slug": { "eq": slug } }));
    }
    let upcoming_from = filter
        .upcoming_from
        .as_deref()
        .filter(|from| !from.is_empty());
    if let Some(from) = upcoming_from {
        conditions.push(json!({
            "or": [
                { "EventEndDate": { "gte": format!("{from}T00:00:00.000Z") } },
                { "Reoccurrence": { "ne": ONE_TIME_EVENT } },
            ],
        }));
    }
    let sort: &[&str] = if upcoming_from.is_some() {
        &["EventStartDate:asc"]
    } else {
        &[]
    };
    json!({ "filters": { "and": conditions }, "sort": sort })
}

/// The server schedules an event without a recurrence as a one-time event.
fn is_one_time(event: &Event) -> bool {
    matches!(event.reoccurrence, None | Some(Reoccurrence::OneTimeEvent))
}

/// Hidden fields keep rows saved through the API, so read only the field editors can see.
fn sessions_of(event: &mut Event) -> Vec<EventSession> {
    if !is_one_time(event) {
        return Vec::new();
    }
    event
        .sessions
        .take()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|session| {
            let date = session.date.filter(|date| !date.is_empty())?;
            let start_time = session.start_time.filter(|start| !start.is_empty())?;
            Some(EventSession {
                date,
                start_time,
                end_time: session.end_time,
                label: trimmed_or_null(session.label.as_deref()),
            })
        })
        .collect()
}

fn recurring_times_of(event: &mut Event) -> Vec<RecurringTime> {
    if is_one_time(event) || event.multiple_times != Some(true) {
        return Vec::new();
    }
    event
        .recurring_times
        .take()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|time| {
            Some(RecurringTime {
                start_time: time.start_time.filter(|start| !start.is_empty())?,
                label: trimmed_or_null(time.label.as_deref()),
            })
        })
        .collect()
}

/// `toEventRecords`: events without a slug or start date are dropped; rich text the app cannot
/// render fails the whole list.
pub fn to_records(data: Data) -> Result<Vec<EventRecord>, UnsupportedRichTextError> {
    let mut records = Vec::with_capacity(data.events.len());
    for mut event in data.events {
        // Without a slug or start date the server cannot link or schedule the event.
        let (Some(slug), Some(start_date)) = (event.slug.take(), event.start_date.take()) else {
            continue;
        };
        let body = to_editor_js_string(&event.body)?;
        let content = to_rich_content(&event.body);
        let sessions = sessions_of(&mut event);
        let recurring_times = recurring_times_of(&mut event);
        let header = event.header.as_ref();
        records.push(EventRecord {
            slug,
            event_title: header
                .and_then(|header| header.title.clone())
                .or_else(|| event.name.clone()),
            description: header.and_then(|header| header.description.clone()),
            image_url: media_url(header.and_then(|header| header.feature_image.as_ref())),
            page_name: event.name,
            body,
            content,
            start_date,
            end_date: event.end_date,
            reoccurring: event
                .reoccurrence
                .map(|reoccurrence| reoccurrence.display_value().to_owned()),
            room: None,
            zoom_link: event.zoom_link,
            speakers: Some(
                event
                    .speakers
                    .unwrap_or_default()
                    .into_iter()
                    .map(|speaker| SpeakerRecord {
                        image: media_url(speaker.image.as_ref()),
                        full_name: speaker.full_name,
                        title: trimmed_or_null(speaker.title.as_deref()),
                    })
                    .collect(),
            ),
            sessions,
            recurring_times,
        });
    }
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter(campus_slug: &str) -> EventQuery {
        EventQuery {
            campus_slug: campus_slug.to_owned(),
            ..EventQuery::default()
        }
    }

    #[test]
    fn includes_events_with_no_campus_for_house_of_stars() {
        assert_eq!(
            serde_json::to_string(&variables(&filter("house-of-stars"))).unwrap(),
            r#"{"filters":{"and":[{"or":[{"campuses":{"documentId":{"null":true}}},{"campuses":{"slug":{"eq":"house-of-stars"}}}]}]},"sort":[]}"#
        );
    }

    #[test]
    fn filters_other_campuses_by_slug_only() {
        assert_eq!(
            variables(&filter("light-house"))["filters"],
            json!({ "and": [{ "campuses": { "slug": { "eq": "light-house" } } }] })
        );
    }

    // Strapi 5 filters compare the STORED enum value, not the GraphQL name.
    #[test]
    fn filters_recurrence_with_stored_display_values() {
        let variables = variables(&EventQuery {
            campus_slug: "jubilee-place".to_owned(),
            reoccurring: Some("Daily ".to_owned()),
            slug: Some("sunday-service".to_owned()),
            upcoming_from: Some("2026-10-02".to_owned()),
        });
        assert_eq!(
            variables,
            json!({
                "filters": {
                    "and": [
                        { "campuses": { "slug": { "eq": "jubilee-place" } } },
                        { "Reoccurrence": { "eq": "Daily" } },
                        { "slug": { "eq": "sunday-service" } },
                        { "or": [
                            { "EventEndDate": { "gte": "2026-10-02T00:00:00.000Z" } },
                            { "Reoccurrence": { "ne": "One time Event" } },
                        ] },
                    ],
                },
                "sort": ["EventStartDate:asc"],
            })
        );
        assert!(!variables.to_string().contains("One_time_Event"));
    }

    #[test]
    fn skips_blank_recurrence_and_empty_slug_filters() {
        let variables = variables(&EventQuery {
            campus_slug: "light-house".to_owned(),
            reoccurring: Some(" \u{a0}".to_owned()),
            slug: Some(String::new()),
            upcoming_from: Some(String::new()),
        });
        assert_eq!(
            variables,
            json!({ "filters": { "and": [{ "campuses": { "slug": { "eq": "light-house" } } }] }, "sort": [] })
        );
    }

    fn event(overrides: Value) -> Value {
        let mut event = json!({
            "slug": "youth-retreat",
            "EventName": "Youth Retreat",
            "EventStartDate": "2026-11-14T14:00:00.000Z",
            "EventEndDate": "2026-11-14T18:30:00.000Z",
            "Reoccurrence": "One_time_Event",
            "ZoomLink": null,
            "body": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Join us" }] }] },
            "Header": { "title": null, "description": "A gathering", "featureImage": { "url": "https://example.com/retreat.jpg" } },
            "Speaker": [
                { "FullName": "Pastor Ada Example", "Title": " Senior Pastor Example Church ", "Image": null },
                { "FullName": "Guest", "Title": "  ", "Image": { "url": "https://example.com/guest.jpg" } },
            ],
            // Events saved before the schedule fields existed answer null for the switch.
            "Sessions": [],
            "MultipleTimes": null,
            "RecurringTimes": [],
        });
        if let (Some(base), Value::Object(overrides)) = (event.as_object_mut(), overrides) {
            base.extend(overrides);
        }
        event
    }

    fn records(events: Vec<Value>) -> Vec<EventRecord> {
        let data: Data = serde_json::from_value(json!({ "events": events })).unwrap();
        to_records(data).unwrap()
    }

    #[test]
    fn maps_a_strapi_5_event_to_the_record_the_server_reads() {
        let record = records(vec![event(json!({}))]).remove(0);
        assert_eq!(
            serde_json::to_value(&record).unwrap(),
            json!({
                "slug": "youth-retreat",
                "pageName": "Youth Retreat",
                "eventTitle": "Youth Retreat",
                "description": "A gathering",
                "body": r#"{"time":0,"blocks":[{"id":"block-0","type":"paragraph","data":{"text":"Join us"}}],"version":"2.31.0"}"#,
                "content": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Join us" }] }] },
                "startDate": "2026-11-14T14:00:00.000Z",
                "endDate": "2026-11-14T18:30:00.000Z",
                "reoccurring": "One time Event",
                "room": null,
                "zoomLink": null,
                "speakers": [
                    { "fullName": "Pastor Ada Example", "title": "Senior Pastor Example Church", "image": null },
                    { "fullName": "Guest", "title": null, "image": "https://example.com/guest.jpg" },
                ],
                "imageUrl": "https://example.com/retreat.jpg",
                "sessions": [],
                "recurringTimes": [],
            })
        );
    }

    #[test]
    fn keeps_the_sessions_of_a_one_time_event_and_ignores_hidden_recurring_times() {
        let record = records(vec![event(json!({
            "Sessions": [
                { "Date": "2026-11-15", "StartTime": "10:00:00.000", "EndTime": null, "Label": "Day two" },
                { "Date": "2026-11-14", "StartTime": "19:00:00.000", "EndTime": "21:30:00.000", "Label": " Opening night " },
                { "Date": null, "StartTime": "08:00:00.000", "EndTime": null, "Label": null },
                { "Date": "2026-11-16", "StartTime": "", "EndTime": null, "Label": null },
            ],
            "MultipleTimes": true,
            "RecurringTimes": [{ "StartTime": "09:00:00.000", "Label": null }],
        }))])
        .remove(0);
        assert_eq!(
            record.sessions,
            [
                EventSession {
                    date: "2026-11-15".to_owned(),
                    start_time: "10:00:00.000".to_owned(),
                    end_time: None,
                    label: Some("Day two".to_owned()),
                },
                EventSession {
                    date: "2026-11-14".to_owned(),
                    start_time: "19:00:00.000".to_owned(),
                    end_time: Some("21:30:00.000".to_owned()),
                    label: Some("Opening night".to_owned()),
                },
            ]
        );
        assert!(record.recurring_times.is_empty());
    }

    #[test]
    fn treats_an_event_without_a_recurrence_as_one_time() {
        let record = records(vec![event(json!({
            "Reoccurrence": null,
            "Sessions": [{ "Date": "2026-11-14", "StartTime": "19:00:00.000", "EndTime": null, "Label": null }],
            "MultipleTimes": true,
            "RecurringTimes": [{ "StartTime": "09:00:00.000", "Label": null }],
        }))])
        .remove(0);
        assert_eq!(record.sessions.len(), 1);
        assert!(record.recurring_times.is_empty());
        assert_eq!(record.reoccurring, None);
    }

    #[test]
    fn keeps_recurring_times_only_while_multiple_times_is_on() {
        let weekly = |multiple_times: Value| {
            event(json!({
                "Reoccurrence": "Weekly",
                "Sessions": [{ "Date": "2026-11-14", "StartTime": "19:00:00.000", "EndTime": null, "Label": null }],
                "MultipleTimes": multiple_times,
                "RecurringTimes": [
                    { "StartTime": "11:00:00.000", "Label": "Second service" },
                    { "StartTime": "09:00:00.000", "Label": "  " },
                    { "StartTime": null, "Label": "Unscheduled" },
                ],
            }))
        };
        let records = records(vec![
            weekly(json!(true)),
            weekly(json!(false)),
            weekly(json!(null)),
        ]);
        assert_eq!(
            records[0].recurring_times,
            [
                RecurringTime {
                    start_time: "11:00:00.000".to_owned(),
                    label: Some("Second service".to_owned()),
                },
                RecurringTime {
                    start_time: "09:00:00.000".to_owned(),
                    label: None,
                },
            ]
        );
        assert!(records[0].sessions.is_empty());
        assert!(records[1].recurring_times.is_empty());
        assert!(records[2].recurring_times.is_empty());
        assert_eq!(records[0].reoccurring.as_deref(), Some("Weekly"));
    }

    #[test]
    fn skips_events_without_a_slug_or_a_start_date() {
        let records = records(vec![
            event(json!({ "slug": null })),
            event(
                json!({ "slug": "no-date", "EventStartDate": null, "body": { "type": "doc", "content": [{ "type": "mystery" }] } }),
            ),
            event(json!({ "slug": "kept" })),
        ]);
        let slugs: Vec<_> = records.iter().map(|record| record.slug.as_str()).collect();
        assert_eq!(slugs, ["kept"]);
    }

    #[test]
    fn uses_the_header_title_and_tolerates_missing_components() {
        let record = records(vec![event(json!({
            "Header": { "title": "Retreat Weekend", "description": null, "featureImage": null },
            "Speaker": null,
            "Sessions": null,
            "RecurringTimes": null,
            "body": null,
        }))])
        .remove(0);
        assert_eq!(record.event_title.as_deref(), Some("Retreat Weekend"));
        assert_eq!(record.speakers, Some(Vec::new()));
        assert_eq!(
            (record.body, record.content, record.image_url),
            (None, None, None)
        );
    }

    #[test]
    fn rejects_unknown_recurrences_and_unsupported_rich_text() {
        let unknown = event(json!({ "Reoccurrence": "Yearly" }));
        assert!(serde_json::from_value::<Data>(json!({ "events": [unknown] })).is_err());

        let data: Data = serde_json::from_value(json!({ "events": [
            event(json!({ "body": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "x", "marks": [{ "type": "glow" }] }] }] } })),
        ] }))
        .unwrap();
        assert_eq!(to_records(data).unwrap_err().node_type, "mark:glow");
    }
}
