//! `sermons` (`apps/server/src/graphql/schema/cms/sermon.ts`): a Relay-style connection over
//! `CmsContent.sermons`, either the sermons with the given slugs or a page after or before a
//! cursor.
//!
//! The TS rules are kept as written, quirks included:
//! - `first`, `last`, `after` and `before` are tested for JavaScript truthiness, so `first: 0` is
//!   "not given" and `limit = min(first || last || 20, 100)`; a negative `first` or `last` is a
//!   negative limit, and the trim below then uses `Array.prototype.slice`'s negative end.
//! - The CMS returns a `before` page oldest first and the resolver does not reverse it.
//! - `hasNextPage` counts the sermons that survived validation, not the CMS rows.
//! - Every failure (argument errors, an undecodable cursor, no sermons, the CMS) is a plain
//!   `Error fetching sermons`, which the error masking turns into `Unexpected error.`.

use std::sync::Arc;

use async_graphql::{Context, ID, Object, SimpleObject};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};

use crate::graphql::guards::Authorized;
use crate::strapi::js;
use crate::strapi::records::{SermonCursor, SermonPage, SermonQuery, SermonRecord};
use crate::strapi::{CmsContentError, CmsSource};
use crate::text::capitalize_text;

/// `Math.min(first || last || 20, 100)`'s default and cap.
const DEFAULT_LIMIT: i64 = 20;
const MAX_LIMIT: i64 = 100;

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct Sermon {
    /// Sermon date
    pub date: Option<String>,
    /// Sermon ID
    pub id: Option<ID>,
    /// Sermon page name
    pub page_name: Option<String>,
    /// Sermon slug
    pub slug: Option<String>,
    /// Sermon speaker full name
    pub speaker_full_name: Option<String>,
    /// Sermon speaker image
    pub speaker_image: Option<String>,
    /// Sermon thumbnail
    pub thumbnail: Option<String>,
    /// Sermon title
    pub title: Option<String>,
    /// Sermon youtube link
    pub youtube_link: Option<String>,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct SermonEdge {
    /// Cursor for pagination
    pub cursor: Option<String>,
    pub node: Option<Sermon>,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct PageInfo {
    /// Cursor for the last item in this page
    pub end_cursor: Option<String>,
    /// Whether there are more items after this page
    pub has_next_page: Option<bool>,
    /// Whether there are more items before this page
    pub has_previous_page: Option<bool>,
    /// Cursor for the first item in this page
    pub start_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct SermonConnectionMetadata {
    /// Body content for the sermons page
    pub body: Option<String>,
    /// Featured image for the sermons page
    pub featured_img: Option<String>,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct SermonConnection {
    pub edges: Option<Vec<SermonEdge>>,
    pub metadata: Option<SermonConnectionMetadata>,
    pub page_info: Option<PageInfo>,
}

/// Why `sermons` failed; all of them reach the client as `Error fetching sermons`.
#[derive(Debug, thiserror::Error)]
pub enum SermonsError {
    #[error("Cannot specify both first and last")]
    FirstAndLast,
    #[error("Cannot specify both after and before")]
    AfterAndBefore,
    #[error("invalid cursor: {0}")]
    Cursor(String),
    #[error("No sermons found")]
    NoSermons,
    #[error(transparent)]
    Cms(#[from] CmsContentError),
}

/// The field's arguments.
#[derive(Clone, Debug, Default)]
pub struct SermonsArgs {
    pub slugs: Option<String>,
    pub first: Option<i32>,
    pub after: Option<String>,
    pub last: Option<i32>,
    pub before: Option<String>,
}

/// `SermonDataSchema`: a sermon after mapping, before validation.
#[derive(Clone, Debug, PartialEq)]
struct SermonData {
    slug: String,
    title: String,
    date: String,
    thumbnail: Option<String>,
    speaker_full_name: Option<String>,
    speaker_image: Option<String>,
    youtube_link: String,
    page_name: String,
}

fn truthy_int(value: Option<i32>) -> Option<i64> {
    value.filter(|n| *n != 0).map(i64::from)
}

fn truthy_str(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.is_empty())
}

/// The CMS query and the page size limit for `args` (the resolver's argument checks).
fn plan(args: &SermonsArgs) -> Result<(SermonQuery, i64), SermonsError> {
    let first = truthy_int(args.first);
    let last = truthy_int(args.last);
    if first.is_some() && last.is_some() {
        return Err(SermonsError::FirstAndLast);
    }
    let after = truthy_str(args.after.as_deref());
    let before = truthy_str(args.before.as_deref());
    if after.is_some() && before.is_some() {
        return Err(SermonsError::AfterAndBefore);
    }
    let limit = first.or(last).unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
    let query = match truthy_str(args.slugs.as_deref()) {
        Some(slugs) => SermonQuery::Slugs(slugs.split(',').map(str::to_owned).collect()),
        None => SermonQuery::Page {
            // One more than the limit, to tell whether there is a next page.
            page_size: limit + 1,
            after: after.map(parse_cursor).transpose()?,
            before: before.map(parse_cursor).transpose()?,
        },
    };
    Ok((query, limit))
}

/// `createCursor`: base64 of `JSON.stringify({ slug, date })`.
fn create_cursor(sermon: &SermonData) -> String {
    let position = json!({ "slug": sermon.slug, "date": sermon.date });
    STANDARD.encode(js::stringify(&position))
}

/// `parseCursor`: Node's lenient base64 decoding, UTF-8 with replacement characters, then
/// `JSON.parse` into `{ slug: string, date: string }` (other keys ignored).
fn parse_cursor(cursor: &str) -> Result<SermonCursor, SermonsError> {
    let text = String::from_utf8_lossy(&node_base64_decode(cursor)).into_owned();
    let value: Value =
        serde_json::from_str(&text).map_err(|error| SermonsError::Cursor(error.to_string()))?;
    let field = |name: &str| match value.get(name) {
        Some(Value::String(text)) => Ok(text.clone()),
        _ => Err(SermonsError::Cursor(format!(
            "{name} is not a string in {text:?}"
        ))),
    };
    if !value.is_object() {
        return Err(SermonsError::Cursor(format!("not an object: {text:?}")));
    }
    Ok(SermonCursor {
        slug: field("slug")?,
        date: field("date")?,
    })
}

/// `Buffer.from(text, "base64")`: both alphabets, characters outside them skipped, decoding
/// stops at the first `=`; a trailing group of two or three characters yields its full bytes.
fn node_base64_decode(text: &str) -> Vec<u8> {
    fn value(byte: u8) -> Option<u32> {
        match byte {
            b'A'..=b'Z' => Some(u32::from(byte - b'A')),
            b'a'..=b'z' => Some(u32::from(byte - b'a') + 26),
            b'0'..=b'9' => Some(u32::from(byte - b'0') + 52),
            b'+' | b'-' => Some(62),
            b'/' | b'_' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(text.len() / 4 * 3 + 2);
    let mut group = 0u32;
    let mut count = 0;
    for byte in text.bytes() {
        if byte == b'=' {
            break;
        }
        let Some(bits) = value(byte) else { continue };
        group = (group << 6) | bits;
        count += 1;
        if count == 4 {
            out.extend_from_slice(&[(group >> 16) as u8, (group >> 8) as u8, group as u8]);
            group = 0;
            count = 0;
        }
    }
    match count {
        2 => out.push((group >> 4) as u8),
        3 => out.extend_from_slice(&[(group >> 10) as u8, (group >> 2) as u8]),
        _ => {}
    }
    out
}

/// The resolver's mapping, then `SermonDataSchema`'s validation: a sermon without a title,
/// date, YouTube link or page name is dropped.
fn validated(record: &SermonRecord) -> Option<SermonData> {
    let speaker = record.speaker.as_ref();
    Some(SermonData {
        slug: record.slug.clone(),
        title: capitalize_text(js::trim(record.title.as_deref()?)),
        date: record.date.clone()?,
        thumbnail: record.thumbnail.clone(),
        speaker_full_name: speaker
            .and_then(|speaker| speaker.full_name.as_deref())
            .map(|name| js::trim(name).to_owned()),
        speaker_image: speaker.and_then(|speaker| speaker.image.clone()),
        youtube_link: record.youtube_link.clone()?,
        page_name: js::trim(record.page_name.as_deref()?).to_owned(),
    })
}

/// `Array.prototype.slice(0, end)`.
fn js_slice_to<T>(mut items: Vec<T>, end: i64) -> Vec<T> {
    let len = i64::try_from(items.len()).unwrap_or(i64::MAX);
    let end = if end < 0 {
        (len + end).max(0)
    } else {
        end.min(len)
    };
    items.truncate(usize::try_from(end).unwrap_or(0));
    items
}

/// The connection for `page`, as the resolver builds it after the CMS read.
fn connection(
    args: &SermonsArgs,
    limit: i64,
    page: SermonPage,
) -> Result<SermonConnection, SermonsError> {
    let slugs = truthy_str(args.slugs.as_deref()).is_some();
    let sermons: Vec<SermonData> = page.items.iter().filter_map(validated).collect();
    if sermons.is_empty() && !slugs {
        return Err(SermonsError::NoSermons);
    }
    let count = i64::try_from(sermons.len()).unwrap_or(i64::MAX);
    let has_next_page = !slugs && count > limit;
    let has_previous_page = !slugs
        && (truthy_str(args.after.as_deref()).is_some()
            || truthy_str(args.before.as_deref()).is_some());
    let sermons = if has_next_page {
        js_slice_to(sermons, limit)
    } else {
        sermons
    };
    let edges: Vec<SermonEdge> = sermons
        .into_iter()
        .map(|sermon| SermonEdge {
            cursor: Some(create_cursor(&sermon)),
            node: Some(Sermon {
                id: Some(ID(sermon.slug.clone())),
                slug: Some(sermon.slug),
                title: Some(sermon.title),
                date: Some(sermon.date),
                thumbnail: sermon.thumbnail,
                speaker_full_name: sermon.speaker_full_name,
                speaker_image: sermon.speaker_image,
                youtube_link: Some(sermon.youtube_link),
                page_name: Some(sermon.page_name),
            }),
        })
        .collect();
    Ok(SermonConnection {
        page_info: Some(PageInfo {
            has_next_page: Some(has_next_page),
            has_previous_page: Some(has_previous_page),
            start_cursor: edges.first().and_then(|edge| edge.cursor.clone()),
            end_cursor: edges.last().and_then(|edge| edge.cursor.clone()),
        }),
        edges: Some(edges),
        metadata: Some(SermonConnectionMetadata {
            featured_img: page.featured_img,
            body: page.body,
        }),
    })
}

/// The resolver body: argument checks, the CMS read, validation and paging.
pub async fn resolve(
    cms: &dyn CmsSource,
    args: &SermonsArgs,
) -> Result<SermonConnection, SermonsError> {
    let (query, limit) = plan(args)?;
    let page = cms.sermons(query).await?;
    connection(args, limit, page)
}

#[derive(Default)]
pub struct SermonsQuery;

#[Object]
impl SermonsQuery {
    /// Get Sermons with Relay Connection Pagination
    #[graphql(guard = "Authorized")]
    async fn sermons(
        &self,
        ctx: &Context<'_>,
        #[graphql(desc = "Sermons slugs, comma separated")] slugs: Option<String>,
        #[graphql(desc = "Number of items to return (max 100)")] first: Option<i32>,
        #[graphql(desc = "Cursor to start after")] after: Option<String>,
        #[graphql(desc = "Number of items to return from the end (max 100)")] last: Option<i32>,
        #[graphql(desc = "Cursor to start before")] before: Option<String>,
    ) -> async_graphql::Result<Option<SermonConnection>> {
        let cms = ctx.data::<Arc<dyn CmsSource>>()?;
        let args = SermonsArgs {
            slugs,
            first,
            after,
            last,
            before,
        };
        match resolve(cms.as_ref(), &args).await {
            Ok(connection) => Ok(Some(connection)),
            Err(error) => {
                tracing::error!(error = %error, "Error fetching sermons:");
                Err(async_graphql::Error::new("Error fetching sermons"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::{Value, json};

    use super::*;
    use crate::strapi::CmsContentErrorReason;
    use crate::strapi::records::SpeakerRecord;
    use crate::test_support::{FakeCms, execute_with_variables, schema_with, viewer};

    fn sermon(slug: &str, date: &str) -> SermonRecord {
        SermonRecord {
            slug: slug.to_owned(),
            title: Some(slug.to_owned()),
            date: Some(date.to_owned()),
            thumbnail: None,
            speaker: None,
            youtube_link: Some(format!("https://youtu.be/{slug}")),
            page_name: Some(slug.to_owned()),
        }
    }

    fn page(items: Vec<SermonRecord>) -> SermonPage {
        SermonPage {
            items,
            featured_img: None,
            body: None,
        }
    }

    fn position(item: &SermonRecord) -> (String, String) {
        (item.date.clone().unwrap_or_default(), item.slug.clone())
    }

    /// Whether `item` comes later than `cursor` in newest-first (date, slug) order.
    fn is_after(item: &SermonRecord, cursor: &SermonCursor) -> bool {
        let (date, slug) = position(item);
        date < cursor.date || (date == cursor.date && slug < cursor.slug)
    }

    /// Serves pages the way both Strapi layers do (`sermons.test.ts`'s `fakeCms`): newest
    /// first, strictly after the cursor; `before` pages oldest first, strictly before it.
    fn strapi_like(sermons: Vec<SermonRecord>) -> FakeCms {
        FakeCms::default().with_sermons(move |query| {
            let SermonQuery::Page {
                page_size,
                after,
                before,
            } = query
            else {
                return Ok(page(Vec::new()));
            };
            let mut items = sermons.clone();
            items.sort_by_key(|item| std::cmp::Reverse(position(item)));
            let mut items: Vec<SermonRecord> = items
                .into_iter()
                .filter(|item| after.as_ref().is_none_or(|after| is_after(item, after)))
                .collect();
            if let Some(before) = before {
                items.retain(|item| {
                    let (date, slug) = position(item);
                    date > before.date || (date == before.date && slug > before.slug)
                });
                items.reverse();
            }
            items.truncate(usize::try_from(*page_size).unwrap_or(0));
            Ok(page(items))
        })
    }

    async fn run(cms: Arc<FakeCms>, query: &str, variables: Value) -> Value {
        execute_with_variables(&schema_with(cms), query, variables, Some(viewer())).await
    }

    const PAGE: &str = "query SermonsPage($first: Int, $last: Int, $after: String, $before: String, $slugs: String) {
        sermons(first: $first, last: $last, after: $after, before: $before, slugs: $slugs) {
            edges { cursor node { id slug title date youtubeLink pageName speakerFullName speakerImage thumbnail } }
            pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
            metadata { featuredImg body }
        }
    }";

    fn slugs(response: &Value) -> Vec<String> {
        response["data"]["sermons"]["edges"]
            .as_array()
            .unwrap()
            .iter()
            .map(|edge| edge["node"]["slug"].as_str().unwrap().to_owned())
            .collect()
    }

    fn cursor(slug: &str, date: &str) -> String {
        STANDARD.encode(format!(r#"{{"slug":"{slug}","date":"{date}"}}"#))
    }

    fn masked() -> Value {
        json!({
            "errors": [{
                "message": "Unexpected error.",
                "locations": [{ "line": 2, "column": 9 }],
                "path": ["sermons"],
                "extensions": { "code": "INTERNAL_SERVER_ERROR" },
            }],
            "data": { "sermons": null },
        })
    }

    fn five() -> Vec<SermonRecord> {
        vec![
            sermon("sample-e", "2026-03-01"),
            sermon("sample-d", "2026-02-01"),
            sermon("sample-c", "2026-02-01"),
            sermon("sample-b", "2026-02-01"),
            sermon("sample-a", "2026-01-01"),
        ]
    }

    // sermons.test.ts: "serves every sermon once when several share a date".
    #[tokio::test]
    async fn serves_every_sermon_once_when_several_share_a_date() {
        let cms = Arc::new(strapi_like(five()));
        let mut served = Vec::new();
        let mut after = Value::Null;
        for _ in 0..10 {
            let response = run(cms.clone(), PAGE, json!({ "first": 2, "after": after })).await;
            assert!(response.get("errors").is_none(), "{response}");
            served.extend(slugs(&response));
            let info = &response["data"]["sermons"]["pageInfo"];
            if info["hasNextPage"] == json!(false) {
                break;
            }
            after = info["endCursor"].clone();
        }
        assert_eq!(
            served,
            ["sample-e", "sample-d", "sample-c", "sample-b", "sample-a"]
        );
    }

    #[tokio::test]
    async fn answers_a_page_with_cursors_and_metadata() {
        let mut first = sermon("ada-example-sermon", "2026-03-01");
        first.title = Some("  the GOOD shepherd ".to_owned());
        first.page_name = Some(" The Good Shepherd ".to_owned());
        first.thumbnail = Some("https://example.com/thumb.jpg".to_owned());
        first.speaker = Some(SpeakerRecord {
            full_name: Some(" Ada Example ".to_owned()),
            title: Some("Pastor".to_owned()),
            image: Some("https://example.com/ada.jpg".to_owned()),
        });
        let cms = Arc::new(FakeCms::default().with_sermons(move |_| {
            Ok(SermonPage {
                items: vec![first.clone(), sermon("sample-b", "2026-02-01")],
                featured_img: Some("https://example.com/featured.jpg".to_owned()),
                body: Some("{\"blocks\":[]}".to_owned()),
            })
        }));

        let response = run(cms.clone(), PAGE, json!({})).await;

        let first_cursor = cursor("ada-example-sermon", "2026-03-01");
        let last_cursor = cursor("sample-b", "2026-02-01");
        assert_eq!(
            response,
            json!({ "data": { "sermons": {
                "edges": [
                    { "cursor": first_cursor, "node": {
                        "id": "ada-example-sermon", "slug": "ada-example-sermon",
                        "title": "The Good Shepherd", "date": "2026-03-01",
                        "youtubeLink": "https://youtu.be/ada-example-sermon",
                        "pageName": "The Good Shepherd", "speakerFullName": "Ada Example",
                        "speakerImage": "https://example.com/ada.jpg",
                        "thumbnail": "https://example.com/thumb.jpg",
                    } },
                    { "cursor": last_cursor, "node": {
                        "id": "sample-b", "slug": "sample-b", "title": "Sample-b",
                        "date": "2026-02-01", "youtubeLink": "https://youtu.be/sample-b",
                        "pageName": "sample-b", "speakerFullName": null, "speakerImage": null,
                        "thumbnail": null,
                    } },
                ],
                "pageInfo": {
                    "hasNextPage": false, "hasPreviousPage": false,
                    "startCursor": first_cursor, "endCursor": last_cursor,
                },
                "metadata": {
                    "featuredImg": "https://example.com/featured.jpg",
                    "body": "{\"blocks\":[]}",
                },
            } } })
        );
        // The default limit is 20, so the CMS is asked for 21.
        assert_eq!(
            *cms.sermon_queries.lock().unwrap(),
            [SermonQuery::Page {
                page_size: 21,
                after: None,
                before: None
            }]
        );
    }

    #[test]
    fn encodes_cursors_as_base64_json_with_slug_then_date() {
        let data = validated(&sermon("sample-a", "2026-01-01")).unwrap();
        let cursor = create_cursor(&data);
        assert_eq!(
            cursor,
            "eyJzbHVnIjoic2FtcGxlLWEiLCJkYXRlIjoiMjAyNi0wMS0wMSJ9"
        );
        assert_eq!(
            STANDARD.decode(&cursor).unwrap(),
            br#"{"slug":"sample-a","date":"2026-01-01"}"#
        );
        assert_eq!(
            parse_cursor(&cursor).unwrap(),
            SermonCursor {
                slug: "sample-a".to_owned(),
                date: "2026-01-01".to_owned()
            }
        );
    }

    #[test]
    fn decodes_cursors_as_leniently_as_node() {
        let expected = SermonCursor {
            slug: "a".to_owned(),
            date: "b".to_owned(),
        };
        let canonical = STANDARD.encode(r#"{"date":"b","slug":"a","extra":1}"#);
        assert_eq!(parse_cursor(&canonical).unwrap(), expected);
        // Unpadded, URL-safe, with characters outside the alphabet and text after the padding.
        let unpadded = canonical.trim_end_matches('=');
        assert_eq!(parse_cursor(unpadded).unwrap(), expected);
        let noisy = format!("{}\n {}", &canonical[..8], &canonical[8..]);
        assert_eq!(parse_cursor(&noisy).unwrap(), expected);
        assert_eq!(node_base64_decode("YQ==YWJj"), b"a");
        assert_eq!(node_base64_decode("-_8"), [0xfb, 0xff]);
        assert_eq!(node_base64_decode("+/8"), [0xfb, 0xff]);
    }

    #[test]
    fn rejects_cursors_that_are_not_a_slug_and_date() {
        for text in [
            "not json",
            "[]",
            r#"{"slug":"a"}"#,
            r#"{"slug":"a","date":1}"#,
            r#"{"slug":null,"date":"b"}"#,
        ] {
            assert!(
                parse_cursor(&STANDARD.encode(text)).is_err(),
                "{text} decoded"
            );
        }
        assert!(parse_cursor("%%%").is_err());
    }

    // Review Focus 5: cursor and pagination edges.
    #[tokio::test]
    async fn masks_an_invalid_cursor_without_reading_the_cms() {
        let cms = Arc::new(strapi_like(five()));
        let response = run(cms.clone(), PAGE, json!({ "after": "bm90IGpzb24=" })).await;
        assert_eq!(response, masked());
        assert_eq!(cms.calls(), 0);
    }

    #[tokio::test]
    async fn rejects_first_with_last_and_after_with_before() {
        let after = cursor("sample-c", "2026-02-01");
        for variables in [
            json!({ "first": 2, "last": 2 }),
            json!({ "first": -1, "last": 3 }),
            json!({ "after": after, "before": after }),
            // Rejected even when the slugs make the cursors irrelevant.
            json!({ "slugs": "sample-a", "first": 1, "last": 1 }),
        ] {
            let cms = Arc::new(strapi_like(five()));
            let response = run(cms.clone(), PAGE, variables.clone()).await;
            assert_eq!(response, masked(), "{variables}");
            assert_eq!(cms.calls(), 0, "{variables}");
        }
    }

    #[test]
    fn computes_the_limit_like_javascript() {
        let page_size = |args: SermonsArgs| match plan(&args).unwrap() {
            (SermonQuery::Page { page_size, .. }, limit) => (page_size, limit),
            (other, _) => panic!("{other:?}"),
        };
        let args = |first: Option<i32>, last: Option<i32>| SermonsArgs {
            first,
            last,
            ..SermonsArgs::default()
        };
        assert_eq!(page_size(args(None, None)), (21, 20));
        assert_eq!(page_size(args(Some(5), None)), (6, 5));
        assert_eq!(page_size(args(None, Some(7))), (8, 7));
        assert_eq!(page_size(args(Some(150), None)), (101, 100));
        // 0 is falsy: `first: 0` with `last` is not "both", and `first: 0` alone is the default.
        assert_eq!(page_size(args(Some(0), Some(7))), (8, 7));
        assert_eq!(page_size(args(Some(0), None)), (21, 20));
        assert_eq!(page_size(args(Some(0), Some(0))), (21, 20));
        // A negative limit is passed through.
        assert_eq!(page_size(args(Some(-3), None)), (-2, -3));
        assert_eq!(
            page_size(args(Some(i32::MIN), None)),
            (i64::from(i32::MIN) + 1, i64::from(i32::MIN))
        );
        // Empty cursors are falsy too.
        let empty = SermonsArgs {
            after: Some(String::new()),
            before: Some(String::new()),
            ..SermonsArgs::default()
        };
        assert!(matches!(
            plan(&empty).unwrap().0,
            SermonQuery::Page {
                after: None,
                before: None,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn trims_a_full_page_to_the_limit_and_reports_a_next_page() {
        let cms = Arc::new(strapi_like(five()));
        let response = run(cms.clone(), PAGE, json!({ "first": 2 })).await;
        assert_eq!(slugs(&response), ["sample-e", "sample-d"]);
        let info = &response["data"]["sermons"]["pageInfo"];
        assert_eq!(info["hasNextPage"], json!(true));
        assert_eq!(info["hasPreviousPage"], json!(false));
        assert_eq!(info["endCursor"], json!(cursor("sample-d", "2026-02-01")));

        let response = run(cms.clone(), PAGE, json!({ "first": 5 })).await;
        assert_eq!(slugs(&response).len(), 5);
        assert_eq!(
            response["data"]["sermons"]["pageInfo"]["hasNextPage"],
            json!(false)
        );
        // `first` over 100 asks for 101.
        run(cms.clone(), PAGE, json!({ "first": 500 })).await;
        assert!(matches!(
            cms.sermon_queries.lock().unwrap().last(),
            Some(SermonQuery::Page { page_size: 101, .. })
        ));
    }

    // TS quirk (sermon.ts): a `before` page comes back oldest first and is not reversed.
    #[tokio::test]
    async fn keeps_a_before_page_in_ascending_order() {
        let cms = Arc::new(strapi_like(five()));
        let before = cursor("sample-c", "2026-02-01");
        let response = run(cms.clone(), PAGE, json!({ "before": before, "last": 2 })).await;
        assert_eq!(slugs(&response), ["sample-d", "sample-e"]);
        let info = &response["data"]["sermons"]["pageInfo"];
        assert_eq!(info["hasNextPage"], json!(false));
        assert_eq!(info["hasPreviousPage"], json!(true));
        assert_eq!(
            *cms.sermon_queries.lock().unwrap(),
            [SermonQuery::Page {
                page_size: 3,
                after: None,
                before: Some(SermonCursor {
                    date: "2026-02-01".to_owned(),
                    slug: "sample-c".to_owned()
                }),
            }]
        );
    }

    // Review Focus 3: sermons missing a required field are dropped, and `hasNextPage` counts
    // what is left.
    #[tokio::test]
    async fn drops_sermons_missing_a_required_field() {
        let mut no_title = sermon("no-title", "2026-03-05");
        no_title.title = None;
        let mut no_date = sermon("no-date", "2026-03-04");
        no_date.date = None;
        let mut no_link = sermon("no-link", "2026-03-03");
        no_link.youtube_link = None;
        let mut no_page_name = sermon("no-page-name", "2026-03-02");
        no_page_name.page_name = None;
        let mut empty_title = sermon("empty-title", "2026-03-01");
        empty_title.title = Some(String::new());
        let items = vec![
            no_title,
            no_date,
            no_link,
            no_page_name,
            empty_title,
            sermon("sample-a", "2026-01-01"),
        ];
        let cms = Arc::new(FakeCms::default().with_sermons(move |_| Ok(page(items.clone()))));
        let response = run(cms, PAGE, json!({ "first": 1 })).await;
        // Six rows come back for `first: 1` and two survive, so there is a next page.
        assert_eq!(slugs(&response), ["empty-title"]);
        assert_eq!(response["data"]["sermons"]["edges"][0]["node"]["title"], "");
        assert_eq!(
            response["data"]["sermons"]["pageInfo"]["hasNextPage"],
            json!(true)
        );
    }

    #[tokio::test]
    async fn masks_an_empty_page_as_no_sermons_found() {
        let mut untitled = sermon("untitled", "2026-01-01");
        untitled.title = None;
        for items in [Vec::new(), vec![untitled]] {
            let cms = Arc::new(FakeCms::default().with_sermons(move |_| Ok(page(items.clone()))));
            assert_eq!(run(cms, PAGE, json!({})).await, masked());
        }
    }

    #[tokio::test]
    async fn reads_slugs_without_paging() {
        let cms = Arc::new(FakeCms::default().with_sermons(|query| {
            match query {
                SermonQuery::Slugs(slugs) => Ok(page(
                    slugs
                        .iter()
                        .filter(|slug| slug.starts_with("sample"))
                        .map(|slug| sermon(slug, "2026-01-01"))
                        .collect(),
                )),
                SermonQuery::Page { .. } => panic!("slugs are not paged"),
            }
        }));
        let after = cursor("sample-c", "2026-02-01");
        let response = run(
            cms.clone(),
            PAGE,
            json!({ "slugs": "sample-a,sample-b,,missing", "first": 1, "after": after }),
        )
        .await;
        assert_eq!(slugs(&response), ["sample-a", "sample-b"]);
        let info = &response["data"]["sermons"]["pageInfo"];
        assert_eq!(info["hasNextPage"], json!(false));
        assert_eq!(info["hasPreviousPage"], json!(false));
        assert_eq!(
            *cms.sermon_queries.lock().unwrap(),
            [SermonQuery::Slugs(vec![
                "sample-a".to_owned(),
                "sample-b".to_owned(),
                String::new(),
                "missing".to_owned()
            ])]
        );

        // No match is an empty connection, not an error.
        let response = run(cms, PAGE, json!({ "slugs": "missing" })).await;
        assert_eq!(
            response["data"]["sermons"]["edges"],
            json!([]),
            "{response}"
        );
        assert_eq!(
            response["data"]["sermons"]["pageInfo"],
            json!({ "hasNextPage": false, "hasPreviousPage": false, "startCursor": null, "endCursor": null })
        );
    }

    // TS quirk: a negative limit asks the CMS for `limit + 1` rows and trims with a negative
    // `slice` end, dropping sermons from the end of the page.
    #[tokio::test]
    async fn trims_with_a_negative_slice_end_for_a_negative_first() {
        let cms = Arc::new(FakeCms::default().with_sermons(|_| Ok(page(five()))));
        let response = run(cms.clone(), PAGE, json!({ "first": -2 })).await;
        assert_eq!(slugs(&response), ["sample-e", "sample-d", "sample-c"]);
        assert_eq!(
            response["data"]["sermons"]["pageInfo"]["hasNextPage"],
            json!(true)
        );
        assert!(matches!(
            cms.sermon_queries.lock().unwrap()[0],
            SermonQuery::Page { page_size: -1, .. }
        ));
    }

    #[tokio::test]
    async fn masks_cms_failures() {
        let cms = Arc::new(FakeCms::default().with_sermons(|_| {
            Err(CmsContentError {
                reason: CmsContentErrorReason::Unavailable,
                operation: "sermons",
                detail: "Strapi 5 StrapiV2Sermons failed (Status): Strapi 5 responded 503"
                    .to_owned(),
            })
        }));
        assert_eq!(run(cms, PAGE, json!({})).await, masked());
    }

    #[tokio::test]
    async fn requires_an_authorized_caller() {
        let cms = Arc::new(strapi_like(five()));
        let response = execute_with_variables(
            &schema_with(cms.clone()),
            "query SermonsQuery { sermons { edges { cursor } } }",
            Value::Null,
            None,
        )
        .await;
        assert_eq!(
            response,
            json!({
                "errors": [{
                    "message": "Not authorized to resolve Query.sermons",
                    "locations": [{ "line": 1, "column": 22 }],
                    "path": ["sermons"],
                }],
                "data": { "sermons": null },
            })
        );
        assert_eq!(cms.calls(), 0);
    }

    // The seam: `Dependencies::cms` reaches the resolvers through the real router.
    #[tokio::test]
    async fn resolves_through_the_router_with_injected_content() {
        use crate::google::GoogleAuth;
        use crate::graphql::auth::testing::{GoogleMock, anonymous_claims, sign};
        use crate::test_support::{TestApp, post_graphql_as};

        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_account(1).await;
        let cms = Arc::new(strapi_like(five()));
        let app = TestApp::with_cms(&mock, GoogleAuth::fixed("example-access-token"), cms);
        let response = app
            .send(post_graphql_as(
                json!({ "query": "query SermonsQuery { sermons(first: 1) { edges { node { slug } } } }" }),
                &sign(&anonymous_claims()),
            ))
            .await;
        assert_eq!(
            response.json(),
            json!({ "data": { "sermons": { "edges": [{ "node": { "slug": "sample-e" } }] } } })
        );
    }

    #[test]
    fn slices_like_javascript() {
        assert_eq!(js_slice_to(vec![1, 2, 3], 2), [1, 2]);
        assert_eq!(js_slice_to(vec![1, 2, 3], 5), [1, 2, 3]);
        assert_eq!(js_slice_to(vec![1, 2, 3], -1), [1, 2]);
        assert_eq!(js_slice_to(vec![1, 2, 3], -5), Vec::<i32>::new());
    }
}
