//! The records the server reads from Strapi 5 (`packages/strapi-v2/src/records.ts`), the read
//! inputs (`inputs.ts`) and the CMS enums (`enums.ts`). Each record carries what the TS record
//! carries, with the same JSON field names, so the TS resolvers port unchanged on top of them and
//! a cached record has the TS shape.

use serde::{Deserialize, Serialize};

use super::rich_content::RichDocument;

/// `CmsSpeaker`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerRecord {
    pub full_name: Option<String>,
    pub title: Option<String>,
    pub image: Option<String>,
}

/// `CmsSermon`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SermonRecord {
    pub slug: String,
    pub title: Option<String>,
    pub date: Option<String>,
    pub thumbnail: Option<String>,
    pub speaker: Option<SpeakerRecord>,
    pub youtube_link: Option<String>,
    /// Strapi 4 kept a separate page name that always equalled the title.
    pub page_name: Option<String>,
}

/// `CmsSermonPage`: what `CmsContent.sermons` returns.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SermonPage {
    pub items: Vec<SermonRecord>,
    pub featured_img: Option<String>,
    /// The sermon page's EditorJS string.
    pub body: Option<String>,
}

/// `CmsThoughtOfGod["blogs"][number]`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThoughtOfGodBlog {
    pub title: Option<String>,
    pub description: Option<String>,
    pub link: Option<String>,
    /// Strapi 5 blogs have no date: always `None`.
    pub date: Option<String>,
    pub thumbnail: Option<String>,
}

/// `CmsThoughtOfGod["youtube"][number]`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThoughtOfGodVideo {
    pub youtube_link: Option<String>,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub body: Option<String>,
}

/// `CmsThoughtOfGod`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThoughtOfGodRecord {
    pub title: Option<String>,
    pub description: Option<String>,
    pub thumbnail: Option<String>,
    pub blogs: Vec<ThoughtOfGodBlog>,
    pub youtube: Vec<ThoughtOfGodVideo>,
}

/// `GivingPlatformName`. An unknown platform fails the decode of the whole campus list.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum GivingPlatform {
    Zelle,
    Cashapp,
    Givelify,
    Website,
    Other,
}

impl GivingPlatform {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Zelle => "Zelle",
            Self::Cashapp => "Cashapp",
            Self::Givelify => "Givelify",
            Self::Website => "Website",
            Self::Other => "Other",
        }
    }
}

/// `CmsGivingEntry`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GivingEntry {
    pub platform: GivingPlatform,
    pub value: String,
}

/// `CmsLeader`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LeaderRecord {
    pub name: Option<String>,
    pub slug: Option<String>,
    /// The CMS display value, e.g. "Lead Pastors/Campus Leads".
    pub group: Option<String>,
    /// The first line of the bio intro, without a trailing ": <name>".
    pub bio: Option<String>,
    pub image: Option<String>,
    /// EditorJS string.
    pub body: Option<String>,
}

/// `CmsCampus`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampusRecord {
    pub slug: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub phone: Option<String>,
    /// `None` for a placeholder such as "-".
    pub address: Option<String>,
    pub city_state: Option<String>,
    pub facebook: Option<String>,
    pub instagram: Option<String>,
    pub stream_link: Option<String>,
    pub castr_stream_id: Option<String>,
    /// EditorJS string installed apps read.
    pub body: Option<String>,
    /// The rich document the app renders (`content: JSON`).
    pub content: Option<RichDocument>,
    pub giving: Vec<GivingEntry>,
    /// In CMS order; the server picks the lead pastor from it.
    pub leaders: Vec<LeaderRecord>,
}

/// `CmsEventSession`: one dated session of a one-time event (New York wall-clock values).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventSession {
    pub date: String,
    pub start_time: String,
    pub end_time: Option<String>,
    pub label: Option<String>,
}

/// `CmsRecurringTime`: a New York start time on every day a recurring event happens.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringTime {
    pub start_time: String,
    pub label: Option<String>,
}

/// `CmsEvent`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRecord {
    pub slug: String,
    pub page_name: Option<String>,
    pub event_title: Option<String>,
    pub description: Option<String>,
    /// EditorJS string installed apps read.
    pub body: Option<String>,
    /// The rich document the app renders (`content: JSON`).
    pub content: Option<RichDocument>,
    pub start_date: String,
    pub end_date: Option<String>,
    /// The CMS display value, e.g. "One time Event".
    pub reoccurring: Option<String>,
    /// Always `None` on Strapi 5.
    pub room: Option<String>,
    pub zoom_link: Option<String>,
    pub speakers: Option<Vec<SpeakerRecord>>,
    pub image_url: Option<String>,
    /// Only for one-time events; empty when the event has one start and end.
    pub sessions: Vec<EventSession>,
    /// Only for recurring events with multiple times switched on.
    pub recurring_times: Vec<RecurringTime>,
}

/// `CmsSermonCursor`: a sermon's position in the newest-first order. Several sermons can share
/// a date, so the slug breaks ties.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SermonCursor {
    pub date: String,
    pub slug: String,
}

/// `CmsSermonsQuery`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SermonQuery {
    /// `{ kind: "slugs", slugs }`: the given sermons, newest first.
    Slugs(Vec<String>),
    /// `{ kind: "page", pageSize, after?, before? }`. `after`: sermons older than the cursor,
    /// newest first. `before`: sermons newer than the cursor, oldest first. The resolver passes
    /// `limit + 1`, which can be zero or negative, so the size is signed.
    Page {
        page_size: i64,
        after: Option<SermonCursor>,
        before: Option<SermonCursor>,
    },
}

/// `CmsEventsFilter`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EventQuery {
    /// Already defaulted by the caller; "house-of-stars" also includes events with no campus.
    pub campus_slug: String,
    /// CMS display value, e.g. "Weekly" or "Daily " (trimmed before use).
    pub reoccurring: Option<String>,
    pub slug: Option<String>,
    /// "yyyy-MM-dd". When set, only events ending on/after this day or recurring ones, sorted by
    /// start.
    pub upcoming_from: Option<String>,
}

/// `REOCCURRENCE_DISPLAY_VALUES`: the stored recurrence values, in `ReoccurrenceName` order.
pub const REOCCURRENCE_DISPLAY_VALUES: [&str; 6] = [
    "One time Event",
    "Daily",
    "Weekly",
    "BiWeekly",
    "Monthly",
    "Twice a month",
];

/// `ReoccurrenceName`: Strapi 5 GraphQL rewrites enum values into GraphQL names in responses
/// ("One time Event" → `One_time_Event`); filters still compare the stored value.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
pub enum Reoccurrence {
    #[serde(rename = "One_time_Event")]
    OneTimeEvent,
    Daily,
    Weekly,
    BiWeekly,
    Monthly,
    #[serde(rename = "Twice_a_month")]
    TwiceAMonth,
}

impl Reoccurrence {
    /// `reoccurrenceValue`: the stored display value.
    pub fn display_value(self) -> &'static str {
        let index = match self {
            Self::OneTimeEvent => 0,
            Self::Daily => 1,
            Self::Weekly => 2,
            Self::BiWeekly => 3,
            Self::Monthly => 4,
            Self::TwiceAMonth => 5,
        };
        REOCCURRENCE_DISPLAY_VALUES[index]
    }
}

/// `LeadershipGroupName`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
pub enum LeadershipGroup {
    #[serde(rename = "Regional_Pastors")]
    RegionalPastors,
    #[serde(rename = "Lead_Pastors_Campus_Leads")]
    LeadPastorsCampusLeads,
    Ministers,
    #[serde(rename = "HODs")]
    Hods,
    Decons,
}

impl LeadershipGroup {
    /// `leadershipGroupValue`: the stored display value.
    pub fn display_value(self) -> &'static str {
        match self {
            Self::RegionalPastors => "Regional Pastors",
            Self::LeadPastorsCampusLeads => "Lead Pastors/Campus Leads",
            Self::Ministers => "Ministers",
            Self::Hods => "HODs",
            Self::Decons => "Decons",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Strapi derives GraphQL enum names by replacing every non-alphanumeric run with "_".
    fn to_graphql_name(value: &str) -> String {
        let mut name = String::new();
        let mut in_run = false;
        for c in value.chars() {
            if c.is_ascii_alphanumeric() {
                name.push(c);
                in_run = false;
            } else if !in_run {
                name.push('_');
                in_run = true;
            }
        }
        name
    }

    fn decode<T: serde::de::DeserializeOwned>(name: &str) -> T {
        serde_json::from_value(json!(name)).unwrap()
    }

    #[test]
    fn maps_every_recurrence_graphql_name_back_to_its_cms_value() {
        let names = [
            "One_time_Event",
            "Daily",
            "Weekly",
            "BiWeekly",
            "Monthly",
            "Twice_a_month",
        ];
        let values: Vec<_> = names
            .iter()
            .map(|name| decode::<Reoccurrence>(name).display_value())
            .collect();
        for (name, value) in names.iter().zip(&values) {
            assert_eq!(to_graphql_name(value), *name);
        }
        assert_eq!(values, REOCCURRENCE_DISPLAY_VALUES);
    }

    #[test]
    fn maps_every_leadership_group_graphql_name_back_to_its_cms_value() {
        for name in [
            "Regional_Pastors",
            "Lead_Pastors_Campus_Leads",
            "Ministers",
            "HODs",
            "Decons",
        ] {
            let value = decode::<LeadershipGroup>(name).display_value();
            assert_eq!(to_graphql_name(value), name);
        }
        assert_eq!(
            decode::<LeadershipGroup>("Lead_Pastors_Campus_Leads").display_value(),
            "Lead Pastors/Campus Leads"
        );
    }

    #[test]
    fn rejects_unknown_enum_values() {
        assert!(serde_json::from_value::<Reoccurrence>(json!("Yearly")).is_err());
        assert!(serde_json::from_value::<LeadershipGroup>(json!("Elders")).is_err());
        assert!(serde_json::from_value::<GivingPlatform>(json!("Venmo")).is_err());
    }

    #[test]
    fn round_trips_records_through_json_with_the_ts_field_names() {
        let page = SermonPage {
            items: vec![SermonRecord {
                slug: "sample-sermon".to_owned(),
                title: Some("Sample".to_owned()),
                date: None,
                thumbnail: None,
                speaker: Some(SpeakerRecord {
                    full_name: Some("Ada Example".to_owned()),
                    title: None,
                    image: None,
                }),
                youtube_link: None,
                page_name: Some("Sample".to_owned()),
            }],
            featured_img: None,
            body: None,
        };
        let text = serde_json::to_string(&page).unwrap();
        assert_eq!(
            text,
            r#"{"items":[{"slug":"sample-sermon","title":"Sample","date":null,"thumbnail":null,"speaker":{"fullName":"Ada Example","title":null,"image":null},"youtubeLink":null,"pageName":"Sample"}],"featuredImg":null,"body":null}"#
        );
        assert_eq!(serde_json::from_str::<SermonPage>(&text).unwrap(), page);
    }
}
