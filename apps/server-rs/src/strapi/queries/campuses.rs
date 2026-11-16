//! `queries/campuses.ts`: every campus with its giving platforms and leaders.

use std::sync::LazyLock;

use regex::Regex;
use serde::Deserialize;
use serde_json::Value;

use super::{Media, Meta, media_url, nullable};
use crate::strapi::js;
use crate::strapi::records::{
    CampusRecord, GivingEntry, GivingPlatform, LeaderRecord, LeadershipGroup,
};
use crate::strapi::rich_content::to_rich_content;
use crate::strapi::rich_text::{UnsupportedRichTextError, to_editor_js_string};

/// `CampusesData`.
#[derive(Debug, Deserialize)]
pub struct Data {
    campuses: Vec<Campus>,
}

#[derive(Debug, Deserialize)]
struct Campus {
    #[serde(deserialize_with = "nullable")]
    slug: Option<String>,
    #[serde(rename = "CampusName", deserialize_with = "nullable")]
    name: Option<String>,
    #[serde(rename = "Phone", deserialize_with = "nullable")]
    phone: Option<String>,
    #[serde(rename = "Address", deserialize_with = "nullable")]
    address: Option<String>,
    #[serde(rename = "CityState", deserialize_with = "nullable")]
    city_state: Option<String>,
    #[serde(rename = "FacebookChannelLink", deserialize_with = "nullable")]
    facebook: Option<String>,
    #[serde(rename = "InstagramChannelLink", deserialize_with = "nullable")]
    instagram: Option<String>,
    #[serde(rename = "LiveStreamChannelLink", deserialize_with = "nullable")]
    stream_link: Option<String>,
    body: Value,
    #[serde(rename = "Header", deserialize_with = "nullable")]
    header: Option<Meta>,
    #[serde(rename = "Stream", deserialize_with = "nullable")]
    stream: Option<Stream>,
    #[serde(rename = "GivingPlatforms", deserialize_with = "nullable")]
    giving_platforms: Option<Vec<GivingPlatformEntry>>,
    leaderships: Vec<Leadership>,
}

#[derive(Debug, Deserialize)]
struct Stream {
    #[serde(rename = "CastrID", deserialize_with = "nullable")]
    castr_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GivingPlatformEntry {
    #[serde(rename = "Platform", deserialize_with = "nullable")]
    platform: Option<GivingPlatform>,
    #[serde(deserialize_with = "nullable")]
    link: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Leadership {
    #[serde(rename = "PageName", deserialize_with = "nullable")]
    page_name: Option<String>,
    #[serde(deserialize_with = "nullable")]
    slug: Option<String>,
    #[serde(rename = "Heading", deserialize_with = "nullable")]
    heading: Option<LeadershipHeading>,
    #[serde(rename = "Leader", deserialize_with = "nullable")]
    leader: Option<Leader>,
}

#[derive(Debug, Deserialize)]
struct LeadershipHeading {
    #[serde(rename = "featureImage", deserialize_with = "nullable")]
    feature_image: Option<Media>,
}

#[derive(Debug, Deserialize)]
struct Leader {
    #[serde(rename = "LeadershipGroup", deserialize_with = "nullable")]
    group: Option<LeadershipGroup>,
    #[serde(rename = "BioIntro", deserialize_with = "nullable")]
    bio_intro: Option<String>,
    body: Value,
    #[serde(rename = "ProfilePicture", deserialize_with = "nullable")]
    profile_picture: Option<Media>,
}

/// `toCampusRecords`: campuses without a slug are dropped; rich text the app cannot render fails
/// the whole list.
pub fn to_records(data: Data) -> Result<Vec<CampusRecord>, UnsupportedRichTextError> {
    let mut records = Vec::with_capacity(data.campuses.len());
    for campus in data.campuses {
        let Some(slug) = campus.slug else {
            continue;
        };
        // Evaluated in the TS object's order, so the first unsupported node is the one reported.
        let body = to_editor_js_string(&campus.body)?;
        let content = to_rich_content(&campus.body);
        let giving = campus
            .giving_platforms
            .unwrap_or_default()
            .into_iter()
            .filter_map(|entry| {
                let platform = entry.platform?;
                let value = js::trim(entry.link.as_deref()?);
                (!value.is_empty()).then(|| GivingEntry {
                    platform,
                    value: value.to_owned(),
                })
            })
            .collect();
        // CMS order is editor-controlled; the server picks the lead pastor from it.
        let mut leaders = Vec::with_capacity(campus.leaderships.len());
        for leadership in campus.leaderships {
            let leader = leadership.leader.as_ref();
            leaders.push(LeaderRecord {
                group: leader
                    .and_then(|leader| leader.group)
                    .map(|group| group.display_value().to_owned()),
                bio: leader_title(
                    leader.and_then(|leader| leader.bio_intro.as_deref()),
                    leadership.page_name.as_deref(),
                ),
                image: media_url(leader.and_then(|leader| leader.profile_picture.as_ref()))
                    .or_else(|| {
                        media_url(
                            leadership
                                .heading
                                .as_ref()
                                .and_then(|heading| heading.feature_image.as_ref()),
                        )
                    }),
                body: match leader {
                    Some(leader) => to_editor_js_string(&leader.body)?,
                    None => None,
                },
                name: leadership.page_name,
                slug: leadership.slug,
            });
        }
        let header = campus.header.as_ref();
        records.push(CampusRecord {
            slug,
            name: campus.name,
            description: header.and_then(|header| header.description.clone()),
            image: media_url(header.and_then(|header| header.feature_image.as_ref())),
            phone: campus.phone,
            address: place_name(campus.address),
            city_state: place_name(campus.city_state),
            facebook: campus.facebook,
            instagram: campus.instagram,
            stream_link: campus.stream_link,
            castr_stream_id: campus.stream.and_then(|stream| stream.castr_id),
            body,
            content,
            giving,
            leaders,
        });
    }
    Ok(records)
}

/// `collapse`: `text.replaceAll(/\s+/gu, " ").trim()` with JavaScript's whitespace.
fn collapse(text: &str) -> String {
    let mut collapsed = String::with_capacity(text.len());
    let mut in_space = false;
    for c in text.chars() {
        if js::is_whitespace(c) {
            if !in_space {
                collapsed.push(' ');
                in_space = true;
            }
        } else {
            collapsed.push(c);
            in_space = false;
        }
    }
    js::trim(&collapsed).to_owned()
}

static LETTER_OR_NUMBER: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"[\p{L}\p{N}]").ok());

/// `placeName`: Strapi 5 requires Address and CityState, so a campus without one holds a
/// placeholder like "-": text with no letter or digit is `None`.
fn place_name(text: Option<String>) -> Option<String> {
    let regex = LETTER_OR_NUMBER.as_ref()?;
    text.filter(|text| regex.is_match(text))
}

/// `leaderTitle`: the first non-empty line of the bio intro, without a trailing ": Name" that
/// repeats the leader's own name.
fn leader_title(bio_intro: Option<&str>, name: Option<&str>) -> Option<String> {
    let first = bio_intro
        .unwrap_or_default()
        .split('\n')
        .map(collapse)
        .find(|line| !line.is_empty())?;
    let separator = first.find(':').filter(|separator| *separator > 0);
    let named = separator.map_or(String::new(), |separator| {
        collapse(&first[separator + 1..]).to_lowercase()
    });
    match (separator, name) {
        (Some(separator), Some(name))
            if !named.is_empty() && collapse(name).to_lowercase().contains(&named) =>
        {
            Some(collapse(&first[..separator]))
        }
        _ => Some(first),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn campus(overrides: Value) -> Value {
        let mut campus = json!({
            "slug": "house-of-stars",
            "CampusName": "House of Stars",
            "Phone": "555-0100",
            "Address": "1 Main St",
            "CityState": "Newark, NJ",
            "FacebookChannelLink": null,
            "InstagramChannelLink": "https://example.com/instagram",
            "LiveStreamChannelLink": "https://example.com/live",
            "body": { "time": 1, "blocks": [{ "type": "paragraph", "data": { "text": "Welcome" } }], "version": "2.28.0" },
            "Header": { "title": "House of Stars", "description": "Main campus", "featureImage": { "url": "https://example.com/hos.jpg" } },
            "Stream": { "CastrID": "castr-1" },
            "GivingPlatforms": [
                { "Platform": "Cashapp", "link": "https://example.com/give" },
                { "Platform": "Zelle", "link": " giving@example.com " },
                { "Platform": "Website", "link": null },
                { "Platform": null, "link": "https://example.com/unknown" },
                { "Platform": "Other", "link": "   " },
            ],
            "leaderships": [{
                "PageName": "Pastor Ada Example",
                "slug": "pastor-ada-example",
                "Heading": { "featureImage": { "url": "https://example.com/heading.jpg" } },
                "Leader": { "LeadershipGroup": "Regional_Pastors", "BioIntro": "Regional Pastor", "body": null, "ProfilePicture": null },
            }],
        });
        if let (Some(base), Value::Object(overrides)) = (campus.as_object_mut(), overrides) {
            base.extend(overrides);
        }
        campus
    }

    fn records(campuses: Vec<Value>) -> Vec<CampusRecord> {
        let data: Data = serde_json::from_value(json!({ "campuses": campuses })).unwrap();
        to_records(data).unwrap()
    }

    #[test]
    fn maps_a_strapi_5_campus_to_the_record_the_server_reads() {
        let record = records(vec![campus(json!({}))]).remove(0);
        let expected = json!({
            "slug": "house-of-stars",
            "name": "House of Stars",
            "description": "Main campus",
            "image": "https://example.com/hos.jpg",
            "phone": "555-0100",
            "address": "1 Main St",
            "cityState": "Newark, NJ",
            "facebook": null,
            "instagram": "https://example.com/instagram",
            "streamLink": "https://example.com/live",
            "castrStreamId": "castr-1",
            "body": r#"{"time":1,"blocks":[{"id":"block-0","type":"paragraph","data":{"text":"Welcome"}}],"version":"2.28.0"}"#,
            "content": {
                "type": "doc",
                "attrs": { "schemaVersion": 1 },
                "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Welcome" }] }],
            },
            "giving": [
                { "platform": "Cashapp", "value": "https://example.com/give" },
                { "platform": "Zelle", "value": "giving@example.com" },
            ],
            "leaders": [{
                "name": "Pastor Ada Example",
                "slug": "pastor-ada-example",
                "group": "Regional Pastors",
                "bio": "Regional Pastor",
                "image": "https://example.com/heading.jpg",
                "body": null,
            }],
        });
        assert_eq!(serde_json::to_value(&record).unwrap(), expected);
    }

    #[test]
    fn skips_campuses_without_a_slug_and_tolerates_missing_components() {
        let records = records(vec![
            campus(
                json!({ "slug": null, "body": { "type": "doc", "content": [{ "type": "mystery" }] } }),
            ),
            campus(
                json!({ "slug": "place-of-power", "Header": null, "Stream": null, "GivingPlatforms": null, "leaderships": [] }),
            ),
        ]);
        assert_eq!(records.len(), 1);
        let record = &records[0];
        assert_eq!(record.slug, "place-of-power");
        assert_eq!(
            (&record.description, &record.image, &record.castr_stream_id),
            (&None, &None, &None)
        );
        assert!(record.giving.is_empty());
    }

    #[test]
    fn keeps_one_title_line_from_a_leaders_bio_intro_without_repeating_the_name() {
        let leader = |name: &str, bio: &str| {
            json!({
                "PageName": name,
                "slug": "lead",
                "Heading": null,
                "Leader": { "LeadershipGroup": "Lead_Pastors_Campus_Leads", "BioIntro": bio, "body": null, "ProfilePicture": null },
            })
        };
        let record = records(vec![campus(json!({ "leaderships": [
            leader("Pastor Ada Example", "Lead Pastor: Ada Example\n\nHouse of Grace\n\nPhone: 555-0100"),
            leader("Pastor Bea Example", "  Lead Pastor  HCC North Region "),
            leader("Pastor Cal Example", "\n\nRegional Pastor\nNewark"),
            leader("Pastor Dee Example", "   "),
            leader("Pastor Eve Example", ": Eve Example"),
            leader("Pastor Fay Example", "Elder: Someone Else"),
        ] }))])
        .remove(0);
        let bios: Vec<_> = record
            .leaders
            .iter()
            .map(|leader| leader.bio.as_deref())
            .collect();
        assert_eq!(
            bios,
            [
                Some("Lead Pastor"),
                Some("Lead Pastor HCC North Region"),
                Some("Regional Pastor"),
                None,
                Some(": Eve Example"),
                Some("Elder: Someone Else"),
            ]
        );
        assert_eq!(
            record.leaders[0].group.as_deref(),
            Some("Lead Pastors/Campus Leads")
        );
    }

    // Strapi 5 requires Address, so campuses without one hold a placeholder like "-".
    #[test]
    fn treats_a_placeholder_address_as_missing() {
        let records = records(vec![
            campus(
                json!({ "slug": "house-of-grace", "Address": "-", "CityState": "Springfield, IL" }),
            ),
            campus(json!({ "slug": "dashes", "Address": " — ", "CityState": " - " })),
            campus(
                json!({ "slug": "place-of-power", "Address": "Example City, ON", "CityState": "Example City, ON" }),
            ),
        ]);
        let places: Vec<_> = records
            .iter()
            .map(|record| {
                (
                    record.slug.as_str(),
                    record.address.as_deref(),
                    record.city_state.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            places,
            [
                ("house-of-grace", None, Some("Springfield, IL")),
                ("dashes", None, None),
                (
                    "place-of-power",
                    Some("Example City, ON"),
                    Some("Example City, ON")
                ),
            ]
        );
    }

    #[test]
    fn prefers_the_profile_picture_and_converts_the_leader_body() {
        let record = records(vec![campus(json!({ "leaderships": [{
            "PageName": null,
            "slug": null,
            "Heading": { "featureImage": { "url": "https://example.com/heading.jpg" } },
            "Leader": {
                "LeadershipGroup": null,
                "BioIntro": null,
                "body": "{\"time\":1,\"blocks\":[],\"version\":\"2.28.0\"}",
                "ProfilePicture": { "url": "https://example.com/profile.jpg" },
            },
        }, { "PageName": "X", "slug": "x", "Heading": null, "Leader": null }] }))])
        .remove(0);
        let leader = &record.leaders[0];
        assert_eq!(
            leader.image.as_deref(),
            Some("https://example.com/profile.jpg")
        );
        assert_eq!(
            leader.body.as_deref(),
            Some("{\"time\":1,\"blocks\":[],\"version\":\"2.28.0\"}")
        );
        assert_eq!(
            (leader.group.as_deref(), leader.bio.as_deref()),
            (None, None)
        );
        let bare = &record.leaders[1];
        assert_eq!((bare.image.as_deref(), bare.body.as_deref()), (None, None));
    }

    #[test]
    fn rejects_an_unknown_leadership_group_or_giving_platform_during_decoding() {
        let group = campus(json!({ "leaderships": [{
            "PageName": "X", "slug": "x", "Heading": null,
            "Leader": { "LeadershipGroup": "Elders", "BioIntro": null, "body": null, "ProfilePicture": null },
        }] }));
        assert!(serde_json::from_value::<Data>(json!({ "campuses": [group] })).is_err());
        let platform =
            campus(json!({ "GivingPlatforms": [{ "Platform": "Venmo", "link": null }] }));
        assert!(serde_json::from_value::<Data>(json!({ "campuses": [platform] })).is_err());
    }

    #[test]
    fn fails_the_whole_list_on_rich_text_the_app_cannot_render() {
        let data: Data = serde_json::from_value(json!({ "campuses": [
            campus(json!({})),
            campus(json!({ "slug": "x", "body": { "type": "doc", "content": [{ "type": "mysteryWidget" }] } })),
        ] }))
        .unwrap();
        assert_eq!(to_records(data).unwrap_err().node_type, "mysteryWidget");
    }

    #[test]
    fn collapses_javascript_whitespace() {
        assert_eq!(collapse(" a \u{a0}\t b\u{2028}c "), "a b c");
        assert_eq!(collapse("\u{85}x"), "\u{85}x");
    }
}
