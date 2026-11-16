//! `thoughtOfGod` (`apps/server/src/graphql/schema/cms/thoughtOfGod.ts`): the Thought of God
//! page from `CmsContent.thoughtOfGod`. Missing text becomes `""` (`value || ""`), blogs and
//! videos come back in reverse CMS order, and a missing single type is an empty page. A CMS
//! failure is not caught, so it is masked as `Unexpected error.`.

use std::sync::Arc;

use async_graphql::{Context, Object, SimpleObject};

use crate::graphql::guards::Authorized;
use crate::strapi::CmsSource;
use crate::strapi::records::ThoughtOfGodRecord;

#[derive(Clone, Debug, PartialEq, SimpleObject)]
#[graphql(name = "ThoughtOfBlog")]
pub struct ThoughtOfBlog {
    pub date: String,
    pub description: String,
    pub link: String,
    pub thumbnail: Option<String>,
    pub title: String,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct ThoughtOfGodYoutube {
    pub body: String,
    pub thumbnail: Option<String>,
    pub title: String,
    pub youtube_link: String,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct ThoughtOfGodPage {
    pub blogs: Option<Vec<ThoughtOfBlog>>,
    pub description: String,
    pub thumbnail: Option<String>,
    pub title: String,
    pub youtube: Option<Vec<ThoughtOfGodYoutube>>,
}

/// `value || ""`.
fn or_empty(value: Option<&String>) -> String {
    value.cloned().unwrap_or_default()
}

/// The resolver's mapping of the CMS record.
pub fn to_page(record: Option<&ThoughtOfGodRecord>) -> ThoughtOfGodPage {
    let Some(record) = record else {
        return ThoughtOfGodPage {
            title: String::new(),
            thumbnail: Some(String::new()),
            description: String::new(),
            blogs: Some(Vec::new()),
            youtube: Some(Vec::new()),
        };
    };
    ThoughtOfGodPage {
        title: or_empty(record.title.as_ref()),
        description: or_empty(record.description.as_ref()),
        thumbnail: Some(or_empty(record.thumbnail.as_ref())),
        blogs: Some(
            record
                .blogs
                .iter()
                .rev()
                .map(|blog| ThoughtOfBlog {
                    title: or_empty(blog.title.as_ref()),
                    description: or_empty(blog.description.as_ref()),
                    link: or_empty(blog.link.as_ref()),
                    date: or_empty(blog.date.as_ref()),
                    thumbnail: Some(or_empty(blog.thumbnail.as_ref())),
                })
                .collect(),
        ),
        youtube: Some(
            record
                .youtube
                .iter()
                .rev()
                .map(|video| ThoughtOfGodYoutube {
                    youtube_link: or_empty(video.youtube_link.as_ref()),
                    title: or_empty(video.title.as_ref()),
                    thumbnail: Some(or_empty(video.thumbnail.as_ref())),
                    body: or_empty(video.body.as_ref()),
                })
                .collect(),
        ),
    }
}

#[derive(Default)]
pub struct ThoughtOfGodQuery;

#[Object]
impl ThoughtOfGodQuery {
    /// Thought Of God
    #[graphql(guard = "Authorized")]
    async fn thought_of_god(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<ThoughtOfGodPage>> {
        let cms = ctx.data::<Arc<dyn CmsSource>>()?;
        let record = cms.thought_of_god().await?;
        Ok(Some(to_page(record.as_ref())))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::{Value, json};

    use super::*;
    use crate::strapi::records::{ThoughtOfGodBlog, ThoughtOfGodVideo};
    use crate::strapi::{CmsContentError, CmsContentErrorReason};
    use crate::test_support::{FakeCms, execute_with_variables, schema_with, viewer};

    const QUERY: &str = "query ThoughtOfGodQuery { thoughtOfGod {
        title description thumbnail
        blogs { title description link date thumbnail }
        youtube { youtubeLink title thumbnail body }
    } }";

    async fn run(cms: FakeCms) -> Value {
        execute_with_variables(
            &schema_with(Arc::new(cms)),
            QUERY,
            Value::Null,
            Some(viewer()),
        )
        .await
    }

    fn blog(title: &str) -> ThoughtOfGodBlog {
        ThoughtOfGodBlog {
            title: Some(title.to_owned()),
            description: Some(format!("About {title}")),
            link: Some(format!("https://example.com/{title}")),
            date: None,
            thumbnail: Some(format!("https://example.com/{title}.jpg")),
        }
    }

    fn video(title: &str) -> ThoughtOfGodVideo {
        ThoughtOfGodVideo {
            youtube_link: Some(format!("https://youtu.be/{title}")),
            title: Some(title.to_owned()),
            thumbnail: Some(format!("https://example.com/{title}.jpg")),
            body: Some(r#"{"time":0,"blocks":[],"version":"2.31.0"}"#.to_owned()),
        }
    }

    #[tokio::test]
    async fn reverses_blogs_and_videos() {
        let record = ThoughtOfGodRecord {
            title: Some("Thought of God".to_owned()),
            description: Some("Daily words".to_owned()),
            thumbnail: Some("https://example.com/tog.jpg".to_owned()),
            blogs: vec![blog("first"), blog("second")],
            youtube: vec![video("one"), video("two")],
        };
        let response =
            run(FakeCms::default().with_thought_of_god(move || Ok(Some(record.clone())))).await;
        assert_eq!(
            response,
            json!({ "data": { "thoughtOfGod": {
                "title": "Thought of God",
                "description": "Daily words",
                "thumbnail": "https://example.com/tog.jpg",
                "blogs": [
                    {
                        "title": "second", "description": "About second",
                        "link": "https://example.com/second", "date": "",
                        "thumbnail": "https://example.com/second.jpg",
                    },
                    {
                        "title": "first", "description": "About first",
                        "link": "https://example.com/first", "date": "",
                        "thumbnail": "https://example.com/first.jpg",
                    },
                ],
                "youtube": [
                    {
                        "youtubeLink": "https://youtu.be/two", "title": "two",
                        "thumbnail": "https://example.com/two.jpg",
                        "body": r#"{"time":0,"blocks":[],"version":"2.31.0"}"#,
                    },
                    {
                        "youtubeLink": "https://youtu.be/one", "title": "one",
                        "thumbnail": "https://example.com/one.jpg",
                        "body": r#"{"time":0,"blocks":[],"version":"2.31.0"}"#,
                    },
                ],
            } } })
        );
    }

    // Review Focus 3: every missing value coalesces to "", nullable or not.
    #[tokio::test]
    async fn coalesces_missing_values_to_empty_strings() {
        let record = ThoughtOfGodRecord {
            title: None,
            description: Some(String::new()),
            thumbnail: None,
            blogs: vec![ThoughtOfGodBlog {
                title: None,
                description: None,
                link: None,
                date: None,
                thumbnail: None,
            }],
            youtube: vec![ThoughtOfGodVideo {
                youtube_link: None,
                title: None,
                thumbnail: None,
                body: None,
            }],
        };
        let response =
            run(FakeCms::default().with_thought_of_god(move || Ok(Some(record.clone())))).await;
        assert_eq!(
            response,
            json!({ "data": { "thoughtOfGod": {
                "title": "", "description": "", "thumbnail": "",
                "blogs": [{ "title": "", "description": "", "link": "", "date": "", "thumbnail": "" }],
                "youtube": [{ "youtubeLink": "", "title": "", "thumbnail": "", "body": "" }],
            } } })
        );
    }

    #[tokio::test]
    async fn answers_an_empty_page_without_a_record() {
        let response = run(FakeCms::default().with_thought_of_god(|| Ok(None))).await;
        assert_eq!(
            response,
            json!({ "data": { "thoughtOfGod": {
                "title": "", "description": "", "thumbnail": "", "blogs": [], "youtube": [],
            } } })
        );
    }

    #[tokio::test]
    async fn masks_cms_failures() {
        let response = run(FakeCms::default().with_thought_of_god(|| {
            Err(CmsContentError {
                reason: CmsContentErrorReason::Malformed,
                operation: "thoughtOfGod",
                detail: "Strapi 5 StrapiV2ThoughtOfGod failed (Decode): example".to_owned(),
            })
        }))
        .await;
        assert_eq!(
            response,
            json!({
                "errors": [{
                    "message": "Unexpected error.",
                    "locations": [{ "line": 1, "column": 27 }],
                    "path": ["thoughtOfGod"],
                    "extensions": { "code": "INTERNAL_SERVER_ERROR" },
                }],
                "data": { "thoughtOfGod": null },
            })
        );
    }

    #[tokio::test]
    async fn requires_an_authorized_caller() {
        let cms = Arc::new(FakeCms::default().with_thought_of_god(|| Ok(None)));
        let response =
            execute_with_variables(&schema_with(cms.clone()), QUERY, Value::Null, None).await;
        assert_eq!(
            response["errors"][0]["message"],
            "Not authorized to resolve Query.thoughtOfGod"
        );
        assert_eq!(response["data"], json!({ "thoughtOfGod": null }));
        assert_eq!(cms.calls(), 0);
    }
}
