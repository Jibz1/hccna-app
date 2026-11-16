//! `queries/thoughtOfGod.ts`: the Thought of God single type.

use serde::Deserialize;

use super::{Media, Meta, media_url, nullable};
use crate::strapi::records::{ThoughtOfGodBlog, ThoughtOfGodRecord, ThoughtOfGodVideo};

/// `TogData`.
#[derive(Debug, Deserialize)]
pub struct Data {
    #[serde(deserialize_with = "nullable")]
    tog: Option<Tog>,
}

#[derive(Debug, Deserialize)]
struct Tog {
    #[serde(rename = "Heading", deserialize_with = "nullable")]
    heading: Option<Meta>,
    #[serde(rename = "TOGBlogs", deserialize_with = "nullable")]
    blogs: Option<Vec<Blog>>,
    #[serde(rename = "Youtube", deserialize_with = "nullable")]
    youtube: Option<Vec<Video>>,
}

#[derive(Debug, Deserialize)]
struct Blog {
    #[serde(rename = "Title", deserialize_with = "nullable")]
    title: Option<String>,
    #[serde(rename = "Description", deserialize_with = "nullable")]
    description: Option<String>,
    #[serde(rename = "BlogLink", deserialize_with = "nullable")]
    link: Option<String>,
    #[serde(rename = "Thumbnail", deserialize_with = "nullable")]
    thumbnail: Option<Media>,
}

#[derive(Debug, Deserialize)]
struct Video {
    #[serde(rename = "YoutubeLink", deserialize_with = "nullable")]
    youtube_link: Option<String>,
    #[serde(rename = "VideoName", deserialize_with = "nullable")]
    name: Option<String>,
    #[serde(deserialize_with = "nullable")]
    description: Option<String>,
    #[serde(rename = "Thumbname", deserialize_with = "nullable")]
    thumbnail: Option<Media>,
}

/// `toThoughtOfGod`: `None` when the single type is missing.
pub fn to_record(data: Data) -> Option<ThoughtOfGodRecord> {
    let tog = data.tog?;
    let heading = tog.heading;
    Some(ThoughtOfGodRecord {
        title: heading.as_ref().and_then(|heading| heading.title.clone()),
        description: heading
            .as_ref()
            .and_then(|heading| heading.description.clone()),
        thumbnail: media_url(
            heading
                .as_ref()
                .and_then(|heading| heading.feature_image.as_ref()),
        ),
        // Strapi 5 blogs have no date; the server already sends "" for a missing one.
        blogs: tog
            .blogs
            .unwrap_or_default()
            .into_iter()
            .map(|blog| ThoughtOfGodBlog {
                thumbnail: media_url(blog.thumbnail.as_ref()),
                title: blog.title,
                description: blog.description,
                link: blog.link,
                date: None,
            })
            .collect(),
        youtube: tog
            .youtube
            .unwrap_or_default()
            .into_iter()
            .map(|video| ThoughtOfGodVideo {
                thumbnail: media_url(video.thumbnail.as_ref()),
                youtube_link: video.youtube_link,
                title: video.name,
                body: video.description,
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn decode(data: Value) -> Data {
        serde_json::from_value(data).unwrap()
    }

    #[test]
    fn maps_blogs_and_videos_with_no_blog_dates() {
        let data = decode(json!({
            "tog": {
                "Heading": { "title": "Thought Of God", "description": "Daily", "featureImage": null },
                "TOGBlogs": [{ "Title": "Faith", "Description": "On faith", "BlogLink": "https://example.com/faith", "Thumbnail": null }],
                "Youtube": [{ "YoutubeLink": "https://example.com/x", "VideoName": "Sample Video", "description": "Sermon", "Thumbname": { "url": "https://example.com/t.jpg" } }],
            },
        }));

        assert_eq!(
            to_record(data),
            Some(ThoughtOfGodRecord {
                title: Some("Thought Of God".to_owned()),
                description: Some("Daily".to_owned()),
                thumbnail: None,
                blogs: vec![ThoughtOfGodBlog {
                    title: Some("Faith".to_owned()),
                    description: Some("On faith".to_owned()),
                    link: Some("https://example.com/faith".to_owned()),
                    date: None,
                    thumbnail: None,
                }],
                youtube: vec![ThoughtOfGodVideo {
                    youtube_link: Some("https://example.com/x".to_owned()),
                    title: Some("Sample Video".to_owned()),
                    thumbnail: Some("https://example.com/t.jpg".to_owned()),
                    body: Some("Sermon".to_owned()),
                }],
            })
        );
    }

    #[test]
    fn returns_none_when_the_single_type_is_missing() {
        assert_eq!(to_record(decode(json!({ "tog": null }))), None);
    }

    #[test]
    fn tolerates_missing_components() {
        let record = to_record(decode(json!({
            "tog": { "Heading": null, "TOGBlogs": null, "Youtube": null },
        })))
        .unwrap();
        assert_eq!(
            (
                record.title,
                record.thumbnail,
                record.blogs.len(),
                record.youtube.len()
            ),
            (None, None, 0, 0)
        );
    }
}
