//! `queries/sermons.ts`: the sermons page (or the sermons with the given slugs) and the sermon
//! page's metadata.

use serde::Deserialize;
use serde_json::{Value, json};

use super::{Media, Meta, media_url, nullable, trimmed_or_null};
use crate::strapi::records::{SermonCursor, SermonPage, SermonQuery, SermonRecord, SpeakerRecord};
use crate::strapi::rich_text::{UnsupportedRichTextError, to_editor_js_string};

/// `SermonsData`.
#[derive(Debug, Deserialize)]
pub struct Data {
    sermons: Vec<Sermon>,
    #[serde(rename = "sermonPage", deserialize_with = "nullable")]
    sermon_page: Option<SermonPageData>,
}

#[derive(Debug, Deserialize)]
struct Sermon {
    #[serde(deserialize_with = "nullable")]
    slug: Option<String>,
    #[serde(rename = "Title", deserialize_with = "nullable")]
    title: Option<String>,
    #[serde(deserialize_with = "nullable")]
    date: Option<String>,
    #[serde(rename = "YoutubeLink", deserialize_with = "nullable")]
    youtube_link: Option<String>,
    #[serde(rename = "Thumbnail", deserialize_with = "nullable")]
    thumbnail: Option<Media>,
    #[serde(rename = "Speaker", deserialize_with = "nullable")]
    speaker: Option<Speaker>,
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
struct SermonPageData {
    #[serde(rename = "Intro", deserialize_with = "nullable")]
    intro: Option<Meta>,
    body: Value,
}

/// `sermonsVariables`.
pub fn variables(query: &SermonQuery) -> Value {
    match query {
        SermonQuery::Slugs(slugs) => {
            json!({ "filters": { "slug": { "in": slugs } }, "sort": ["date:desc"], "pageSize": 100 })
        }
        SermonQuery::Page {
            page_size,
            after: Some(after),
            ..
        } => json!({
            "filters": beyond(after, "lt"),
            "sort": ["date:desc", "slug:desc"],
            "pageSize": page_size,
        }),
        SermonQuery::Page {
            page_size,
            before: Some(before),
            ..
        } => json!({
            "filters": beyond(before, "gt"),
            "sort": ["date:asc", "slug:asc"],
            "pageSize": page_size,
        }),
        SermonQuery::Page { page_size, .. } => {
            json!({ "filters": {}, "sort": ["date:desc", "slug:desc"], "pageSize": page_size })
        }
    }
}

/// Sermons past the cursor in (date, slug) order, so a page can end partway through a day.
fn beyond(cursor: &SermonCursor, operator: &str) -> Value {
    json!({
        "or": [
            { "date": { operator: cursor.date } },
            { "date": { "eq": cursor.date }, "slug": { operator: cursor.slug } },
        ],
    })
}

/// `toSermonPage`: sermons without a slug are dropped.
pub fn to_records(data: Data) -> Result<SermonPage, UnsupportedRichTextError> {
    let items = data
        .sermons
        .into_iter()
        .filter_map(|sermon| {
            let slug = sermon.slug?;
            Some(SermonRecord {
                slug,
                // Strapi 4 kept a separate pageName that always equalled the title.
                page_name: sermon.title.clone(),
                title: sermon.title,
                date: sermon.date,
                thumbnail: media_url(sermon.thumbnail.as_ref()),
                speaker: sermon.speaker.map(|speaker| SpeakerRecord {
                    full_name: speaker.full_name,
                    title: trimmed_or_null(speaker.title.as_deref()),
                    image: media_url(speaker.image.as_ref()),
                }),
                youtube_link: sermon.youtube_link,
            })
        })
        .collect();
    let page = data.sermon_page;
    let featured_img = media_url(
        page.as_ref()
            .and_then(|page| page.intro.as_ref())
            .and_then(|intro| intro.feature_image.as_ref()),
    );
    let body = match &page {
        Some(page) => to_editor_js_string(&page.body)?,
        None => None,
    };
    Ok(SermonPage {
        items,
        featured_img,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(data: Value) -> Data {
        serde_json::from_value(data).unwrap()
    }

    #[test]
    fn builds_slug_and_page_variables() {
        assert_eq!(
            serde_json::to_string(&variables(&SermonQuery::Slugs(vec![
                "a".to_owned(),
                "b".to_owned()
            ])))
            .unwrap(),
            r#"{"filters":{"slug":{"in":["a","b"]}},"sort":["date:desc"],"pageSize":100}"#
        );
        assert_eq!(
            variables(&SermonQuery::Page {
                page_size: 11,
                after: None,
                before: None
            }),
            json!({ "filters": {}, "sort": ["date:desc", "slug:desc"], "pageSize": 11 })
        );
    }

    // Several sermons can share a date, so a date-only cursor skips the rest of that day.
    #[test]
    fn continues_within_the_cursors_date_by_slug() {
        let cursor = SermonCursor {
            date: "2026-01-01".to_owned(),
            slug: "sample-sermon-2".to_owned(),
        };
        let after = variables(&SermonQuery::Page {
            page_size: 11,
            after: Some(cursor.clone()),
            before: None,
        });
        assert_eq!(
            serde_json::to_string(&after).unwrap(),
            r#"{"filters":{"or":[{"date":{"lt":"2026-01-01"}},{"date":{"eq":"2026-01-01"},"slug":{"lt":"sample-sermon-2"}}]},"sort":["date:desc","slug:desc"],"pageSize":11}"#
        );
        assert_eq!(
            variables(&SermonQuery::Page {
                page_size: 11,
                after: None,
                before: Some(cursor.clone()),
            }),
            json!({
                "filters": {
                    "or": [{ "date": { "gt": "2026-01-01" } }, { "date": { "eq": "2026-01-01" }, "slug": { "gt": "sample-sermon-2" } }],
                },
                "sort": ["date:asc", "slug:asc"],
                "pageSize": 11,
            })
        );
        // `after` wins when both are given, as in the TS.
        assert_eq!(
            variables(&SermonQuery::Page {
                page_size: -4,
                after: Some(cursor.clone()),
                before: Some(cursor),
            })["sort"],
            json!(["date:desc", "slug:desc"])
        );
    }

    #[test]
    fn maps_sermons_and_the_sermon_page_metadata() {
        let data = decode(json!({
            "sermons": [
                {
                    "slug": "sample-sermon-1",
                    "Title": "Sample Sermon Title",
                    "date": "2026-08-20",
                    "YoutubeLink": "https://www.example.com/watch?v=AAAAAAAAAAA",
                    "Thumbnail": { "url": "https://example.com/sermon.webp" },
                    "Speaker": { "FullName": "Dr. Ada Example ", "Title": "Senior Pastor Example Church", "Image": null },
                },
                { "slug": null, "Title": "Dropped", "date": null, "YoutubeLink": null, "Thumbnail": null, "Speaker": null },
            ],
            "sermonPage": { "Intro": { "title": null, "description": null, "featureImage": { "url": "https://example.com/page.png" } }, "body": null },
        }));

        assert_eq!(
            to_records(data).unwrap(),
            SermonPage {
                items: vec![SermonRecord {
                    slug: "sample-sermon-1".to_owned(),
                    title: Some("Sample Sermon Title".to_owned()),
                    date: Some("2026-08-20".to_owned()),
                    thumbnail: Some("https://example.com/sermon.webp".to_owned()),
                    speaker: Some(SpeakerRecord {
                        full_name: Some("Dr. Ada Example ".to_owned()),
                        title: Some("Senior Pastor Example Church".to_owned()),
                        image: None,
                    }),
                    youtube_link: Some("https://www.example.com/watch?v=AAAAAAAAAAA".to_owned()),
                    page_name: Some("Sample Sermon Title".to_owned()),
                }],
                featured_img: Some("https://example.com/page.png".to_owned()),
                body: None,
            }
        );
    }

    #[test]
    fn trims_the_speaker_title_and_converts_the_page_body() {
        let data = decode(json!({
            "sermons": [{
                "slug": "s", "Title": null, "date": null, "YoutubeLink": null, "Thumbnail": null,
                "Speaker": { "FullName": null, "Title": "   ", "Image": { "url": "https://example.com/a.png" } },
            }],
            "sermonPage": { "Intro": null, "body": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Hi" }] }] } },
        }));
        let page = to_records(data).unwrap();
        let speaker = page.items[0].speaker.clone().unwrap();
        assert_eq!(speaker.title, None);
        assert_eq!(speaker.image.as_deref(), Some("https://example.com/a.png"));
        assert_eq!(page.items[0].page_name, None);
        assert_eq!(page.featured_img, None);
        assert_eq!(
            page.body.as_deref(),
            Some(
                r#"{"time":0,"blocks":[{"id":"block-0","type":"paragraph","data":{"text":"Hi"}}],"version":"2.31.0"}"#
            )
        );
    }

    #[test]
    fn has_no_metadata_without_a_sermon_page_and_rejects_unsupported_page_bodies() {
        let page = to_records(decode(json!({ "sermons": [], "sermonPage": null }))).unwrap();
        assert_eq!(
            (page.items.len(), page.featured_img, page.body),
            (0, None, None)
        );

        let error = to_records(decode(json!({
            "sermons": [],
            "sermonPage": { "Intro": null, "body": { "type": "doc", "content": [{ "type": "mystery" }] } },
        })))
        .unwrap_err();
        assert_eq!(error.node_type, "mystery");
    }

    #[test]
    fn rejects_a_response_missing_a_key() {
        let missing = serde_json::from_value::<Data>(json!({
            "sermons": [{ "slug": "s", "Title": null, "date": null, "Thumbnail": null, "Speaker": null }],
            "sermonPage": null,
        }));
        assert!(missing.is_err());
    }
}
