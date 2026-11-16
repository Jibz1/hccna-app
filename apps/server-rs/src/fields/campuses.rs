//! `campuses` and `campusesV2` (`apps/server/src/graphql/schema/cms/campuses.ts`). Both read
//! `CmsContent.campuses` through [`load_campuses`] (`loadCampuses`), which logs a CMS failure with
//! its reason and detail, and list the campuses in `CAMPUS_SLUGS`
//! (`apps/server/src/utils/campuses.ts`), House of Stars first and then in that order, built by
//! `toCampus`.
//!
//! - `campuses` (legacy V1) answers `Campuses { pageBody, campus }`: the first CMS record's body
//!   (taken before the campus filter) or "", and the campuses as the CMS wrote them (names, cities
//!   and lead names untouched), with no preferred campus. A CMS failure rejects the field with
//!   `CMSFetchError`'s message, which the pipeline masks as `Unexpected error.`.
//! - `campusesV2` moves the preferred campus to the front, normalizes names and cities, and takes
//!   the titles off lead names. A CMS failure is `CampusesFetchError`; no listed campus is
//!   `CampusesNotFoundError`.

use std::sync::{Arc, LazyLock};

use async_graphql::{Context, Object, SimpleObject, Union};
use regex::Regex;

use crate::fields::giving::{GivingCard, campus_giving_platforms, house_of_stars_giving_platforms};
use crate::fields::legacy_wire::{giving_text, lead_pastor_of};
use crate::fields::scalars::Json;
use crate::graphql::guards::Authorized;
use crate::strapi::records::{CampusRecord, LeaderRecord};
use crate::strapi::{CmsContentError, CmsSource, js};

/// `CAMPUS_SLUGS`: the campuses the server lists, in display order.
pub const CAMPUS_SLUGS: [&str; 6] = [
    "house-of-stars",
    "jubilee-place",
    "new-breed",
    "light-house",
    "impact-house",
    "house-of-grace",
];

const HOUSE_OF_STARS: &str = "house-of-stars";
const LEAD_PASTOR_GROUP: &str = "Lead Pastors/Campus Leads";

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct LeadPastor {
    pub body: Option<String>,
    pub image: Option<String>,
    pub leadership_group: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub sub_title: Option<String>,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct CampusLead {
    pub image: Option<String>,
    pub name: Option<String>,
    pub sub_title: Option<String>,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
#[graphql(name = "GivingPlatform")]
pub struct GivingPlatformCard {
    pub icon: Option<String>,
    pub link: Option<String>,
    pub text: Option<String>,
    pub title: Option<String>,
}

impl From<GivingCard> for GivingPlatformCard {
    fn from(card: GivingCard) -> Self {
        Self {
            icon: Some(card.icon),
            link: card.link,
            text: Some(card.text),
            title: Some(card.title.to_owned()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct Campus {
    pub address: Option<String>,
    pub body: Option<String>,
    /// The campus lead's display name, photo, and subtitle for campus locations and details.
    pub campus_lead: Option<CampusLead>,
    pub campus_name: Option<String>,
    pub castr_stream_id: Option<String>,
    pub city_state: Option<String>,
    /// The campus page's rich text as a Tiptap document (paragraphs, headings, nested lists, marks, media), or null when the page has none. Prefer it over body, the EditorJS JSON string installed apps render.
    pub content: Option<Json>,
    pub description: String,
    pub facebook: Option<String>,
    pub giving: Option<String>,
    pub giving_platforms: Option<Vec<GivingPlatformCard>>,
    pub image: Option<String>,
    pub instagram: Option<String>,
    /// Whether this campus matches the preferredCampus argument.
    pub is_preferred: bool,
    pub lead_pastor: Option<Vec<LeadPastor>>,
    /// Display address, falling back to city and state when the address is blank.
    pub location: Option<String>,
    pub phone: Option<String>,
    pub slug: String,
    pub stream_link: Option<String>,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct CampusesSuccess {
    pub campuses: Vec<Campus>,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct CampusesFetchError {
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct CampusesNotFoundError {
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Union)]
pub enum CampusesResult {
    CampusesFetchError(CampusesFetchError),
    CampusesNotFoundError(CampusesNotFoundError),
    CampusesSuccess(CampusesSuccess),
}

// `Campuses`, the legacy `campuses` field's type. (No doc comment: it would become a GraphQL
// description; TS has none.)
#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct Campuses {
    pub campus: Option<Vec<Campus>>,
    pub page_body: Option<String>,
}

/// A leader as `toCampus` exposes it (`LeadPastor`).
#[derive(Clone, Debug, PartialEq)]
struct Lead {
    name: Option<String>,
    slug: String,
    image: Option<String>,
    sub_title: Option<String>,
    body: Option<String>,
    leadership_group: Option<String>,
}

impl Lead {
    fn of(leader: &LeaderRecord) -> Self {
        Self {
            name: leader.name.clone(),
            slug: leader.slug.clone().unwrap_or_default(),
            image: leader.image.clone(),
            sub_title: leader.bio.clone(),
            body: leader.body.clone(),
            leadership_group: leader.group.clone(),
        }
    }
}

/// `normalizeText`: whitespace runs become one space, then the text is trimmed.
fn normalize_text(text: Option<&str>) -> Option<String> {
    let text = text?;
    let mut out = String::with_capacity(text.len());
    let mut in_space = false;
    for c in text.chars() {
        if js::is_whitespace(c) {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    Some(js::trim(&out).to_owned())
}

/// `/^(?:Pastor|Reverend|Rev\.?|Dr\.?|Bishop|Apostle)\s+(?<name>.+)$/iu`, with JavaScript's
/// `\s` and `.` (which stops at line terminators).
static LEAD_TITLE: LazyLock<Regex> = LazyLock::new(|| {
    let space = r"[\t\n\x0B\x0C\r \u{A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]";
    Regex::new(&format!(
        r"(?i)^(?:Pastor|Reverend|Rev\.?|Dr\.?|Bishop|Apostle){space}+(?P<name>[^\n\r\u{{2028}}\u{{2029}}]+)$"
    ))
    .expect("a valid pattern")
});

/// `cleanLeadName`: the name without a leading title such as "Pastor" or "Dr.".
fn clean_lead_name(name: Option<&str>) -> Option<String> {
    let name = js::trim(name?);
    let cleaned = LEAD_TITLE.replace(name, "$name");
    Some(js::trim(&cleaned).to_owned())
}

/// `campusGiving` (and `houseOfStarsGiving`): the legacy `giving` text and the cards.
fn campus_giving(record: &CampusRecord) -> (Option<String>, Option<Vec<GivingCard>>) {
    if record.slug == HOUSE_OF_STARS {
        // House of Stars' cards are fixed: any CMS giving switches them on, and its `giving` is
        // the Cash App and Zelle text, or else the first entry.
        let Some(first) = record.giving.first() else {
            return (None, None);
        };
        return (
            Some(giving_text(&record.giving).unwrap_or_else(|| first.value.clone())),
            Some(house_of_stars_giving_platforms()),
        );
    }
    let cards = campus_giving_platforms(&record.giving);
    let giving = giving_text(&record.giving).or_else(|| {
        cards
            .first()
            .map(|card| card.link.clone().unwrap_or_else(|| card.text.clone()))
    });
    (giving, (!cards.is_empty()).then_some(cards))
}

/// `toCampus`: the campus as the CMS wrote it, which `campuses` answers as is. `location` comes
/// from the normalized address and city, as the `Campus.location` resolver computes it for both
/// fields. `is_preferred` stays false until `campusesV2` sets it.
fn to_campus(record: &CampusRecord) -> Campus {
    let (giving, giving_platforms) = campus_giving(record);
    let leader = lead_pastor_of(&record.leaders);
    let campus_leads: Vec<&LeaderRecord> = record
        .leaders
        .iter()
        .filter(|item| item.group.as_deref() == Some(LEAD_PASTOR_GROUP))
        .collect();
    // Some campuses are led by regional pastors; keep every leader in the fallback group.
    let display_leads: Vec<&LeaderRecord> = if campus_leads.is_empty() {
        let group = leader.map(|leader| &leader.group);
        record
            .leaders
            .iter()
            .filter(|item| Some(&item.group) == group)
            .collect()
    } else {
        campus_leads
    };
    let lead_pastor = leader
        .filter(|leader| leader.name.as_deref().is_some_and(|name| !name.is_empty()))
        .map(Lead::of);
    let leads: Vec<Lead> = display_leads
        .into_iter()
        .filter(|item| {
            item.name
                .as_deref()
                .is_some_and(|name| !js::trim(name).is_empty())
        })
        .map(Lead::of)
        .collect();
    Campus {
        location: normalize_text(record.address.as_deref())
            .filter(|text| !text.is_empty())
            .or_else(|| {
                normalize_text(record.city_state.as_deref()).filter(|text| !text.is_empty())
            }),
        slug: record.slug.clone(),
        body: record.body.clone(),
        content: record.content.as_ref().and_then(Json::of),
        campus_name: Some(record.name.clone().unwrap_or_default()),
        // Campus.description is String!: a missing CMS description must not fail every campus.
        description: record.description.clone().unwrap_or_default(),
        phone: record.phone.clone(),
        giving,
        address: record.address.clone(),
        city_state: record.city_state.clone(),
        image: record.image.clone(),
        facebook: record.facebook.clone(),
        instagram: record.instagram.clone(),
        stream_link: record.stream_link.clone(),
        castr_stream_id: record.castr_stream_id.clone(),
        is_preferred: false,
        campus_lead: lead_pastor.map(|lead| CampusLead {
            name: lead.name,
            image: lead.image,
            sub_title: lead.sub_title,
        }),
        lead_pastor: Some(
            leads
                .into_iter()
                .map(|lead| LeadPastor {
                    name: lead.name,
                    slug: Some(lead.slug),
                    image: lead.image,
                    sub_title: lead.sub_title,
                    body: lead.body,
                    leadership_group: lead.leadership_group,
                })
                .collect(),
        ),
        giving_platforms: giving_platforms
            .map(|cards| cards.into_iter().map(GivingPlatformCard::from).collect()),
    }
}

/// `loadCampusesV2`'s cleanup: the name and city normalized, and lead names without a title.
fn cleaned(campus: Campus) -> Campus {
    Campus {
        campus_name: normalize_text(campus.campus_name.as_deref()),
        city_state: normalize_text(campus.city_state.as_deref()),
        campus_lead: campus.campus_lead.map(|lead| CampusLead {
            name: clean_lead_name(lead.name.as_deref()),
            ..lead
        }),
        lead_pastor: campus.lead_pastor.map(|leads| {
            leads
                .into_iter()
                .map(|lead| LeadPastor {
                    name: clean_lead_name(lead.name.as_deref()),
                    ..lead
                })
                .collect()
        }),
        ..campus
    }
}

/// `loadCampuses` after the read: the listed campuses, House of Stars first, then
/// `CAMPUS_SLUGS` order (a stable sort, as `toSorted` is).
fn listed_campuses(records: &[CampusRecord]) -> Vec<Campus> {
    let order = |slug: &str| CAMPUS_SLUGS.iter().position(|listed| *listed == slug);
    let mut listed: Vec<&CampusRecord> = records
        .iter()
        .filter(|record| order(&record.slug).is_some())
        .collect();
    listed.sort_by_key(|record| (record.slug != HOUSE_OF_STARS, order(&record.slug)));
    listed.into_iter().map(to_campus).collect()
}

/// The `campuses` field's value (`loadCampuses`'s result). `pageBody` is the first CMS record's
/// body, taken before the campus filter, or "" (`records[0]?.body || ""`).
pub fn to_campuses(records: &[CampusRecord]) -> Campuses {
    Campuses {
        campus: Some(listed_campuses(records)),
        page_body: Some(
            records
                .first()
                .and_then(|record| record.body.clone())
                .unwrap_or_default(),
        ),
    }
}

/// `loadCampusesV2` after the CMS read.
pub fn to_result(records: &[CampusRecord], preferred_campus: Option<&str>) -> CampusesResult {
    let listed = listed_campuses(records);
    if listed.is_empty() {
        return CampusesResult::CampusesNotFoundError(CampusesNotFoundError {
            message: Some("No campuses found".to_owned()),
        });
    }
    let preferred = preferred_campus.map(js::trim);
    let mut campuses: Vec<Campus> = listed
        .into_iter()
        .map(|campus| {
            let is_preferred = Some(campus.slug.as_str()) == preferred;
            Campus {
                is_preferred,
                ..cleaned(campus)
            }
        })
        .collect();
    campuses.sort_by_key(|campus| !campus.is_preferred);
    CampusesResult::CampusesSuccess(CampusesSuccess { campuses })
}

/// `loadCampuses`'s CMS read, shared by both fields. A failure is logged with the reason and
/// detail the CMS reported; clients only get a generic error.
pub async fn load_campuses(cms: &dyn CmsSource) -> Result<Vec<CampusRecord>, CmsContentError> {
    cms.campuses().await.inspect_err(|error| {
        tracing::error!(
            reason = ?error.reason,
            detail = %error.detail,
            "CMS fetch: Unable to load campuses"
        );
    })
}

/// The `campusesV2` resolver: [`load_campuses`], then [`to_result`]; a CMS failure is the typed
/// error.
pub async fn resolve(cms: &dyn CmsSource, preferred_campus: Option<&str>) -> CampusesResult {
    match load_campuses(cms).await {
        Ok(records) => to_result(&records, preferred_campus),
        Err(_) => CampusesResult::CampusesFetchError(CampusesFetchError {
            message: Some("Unable to load campuses".to_owned()),
        }),
    }
}

#[derive(Default)]
pub struct CampusesQuery;

/// `CMSFetchError.message` for `loadCampuses`' failure. The `campuses` resolver fails with it;
/// clients get the masked `Unexpected error.` (`INTERNAL_SERVER_ERROR`), and the pipeline logs it.
const CAMPUSES_FETCH_ERROR: &str = "CMS fetch: Unable to load campuses";

#[Object]
impl CampusesQuery {
    /// Get Campuses
    #[graphql(guard = "Authorized")]
    async fn campuses(&self, ctx: &Context<'_>) -> async_graphql::Result<Option<Campuses>> {
        let cms = ctx.data::<Arc<dyn CmsSource>>()?;
        let records = load_campuses(cms.as_ref())
            .await
            .map_err(|_| async_graphql::Error::new(CAMPUSES_FETCH_ERROR))?;
        Ok(Some(to_campuses(&records)))
    }

    /// Get campuses with preferred-campus ordering, cleaned lead names, and typed success and error responses
    #[graphql(name = "campusesV2", guard = "Authorized")]
    async fn campuses_v2(
        &self,
        ctx: &Context<'_>,
        #[graphql(
            desc = "Optional campus slug to place first. Omitted, null, blank, or unknown slugs keep the default campus order."
        )]
        preferred_campus: Option<String>,
    ) -> async_graphql::Result<Option<CampusesResult>> {
        let cms = ctx.data::<Arc<dyn CmsSource>>()?;
        Ok(Some(
            resolve(cms.as_ref(), preferred_campus.as_deref()).await,
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::{Value, json};

    use super::*;
    use crate::strapi::CmsContentErrorReason;
    use crate::strapi::record_cache::testing::LogCapture;
    use crate::strapi::records::{GivingEntry, GivingPlatform};
    use crate::strapi::rich_content::RichDocument;
    use crate::test_support::{FakeCms, execute_with_variables, schema_with, viewer};

    fn campus() -> CampusRecord {
        CampusRecord {
            slug: "new-breed".to_owned(),
            name: Some("New Breed".to_owned()),
            description: None,
            image: None,
            phone: None,
            address: None,
            city_state: Some("Example City, TX".to_owned()),
            facebook: None,
            instagram: None,
            stream_link: None,
            castr_stream_id: None,
            body: None,
            content: None,
            giving: Vec::new(),
            leaders: Vec::new(),
        }
    }

    fn lead(name: Option<&str>, slug: Option<&str>, group: Option<&str>) -> LeaderRecord {
        LeaderRecord {
            name: name.map(str::to_owned),
            slug: slug.map(str::to_owned),
            group: group.map(str::to_owned),
            bio: None,
            image: None,
            body: None,
        }
    }

    fn led(name: &str, slug: &str) -> LeaderRecord {
        lead(Some(name), Some(slug), Some(LEAD_PASTOR_GROUP))
    }

    async fn run(records: Vec<CampusRecord>, query: &str) -> Value {
        let cms = FakeCms::default().with_campuses(move || Ok(records.clone()));
        execute_with_variables(
            &schema_with(Arc::new(cms)),
            query,
            Value::Null,
            Some(viewer()),
        )
        .await
    }

    // campuses.test.ts: "returns an empty description instead of failing every campus".
    #[tokio::test]
    async fn returns_an_empty_description_instead_of_failing_every_campus() {
        let response = run(
            vec![campus()],
            "query { campusesV2 { __typename ... on CampusesSuccess { campuses { slug description } } } }",
        )
        .await;
        assert_eq!(
            response,
            json!({ "data": { "campusesV2": {
                "__typename": "CampusesSuccess",
                "campuses": [{ "slug": "new-breed", "description": "" }],
            } } })
        );
    }

    // campuses.test.ts: "exposes the rich text content the app renders next to the EditorJS body".
    #[tokio::test]
    async fn exposes_the_rich_text_content_next_to_the_editorjs_body() {
        let content = json!({
            "type": "doc",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Welcome" }] }],
        });
        let document: RichDocument = serde_json::from_value(content.clone()).unwrap();
        let record = CampusRecord {
            body: Some("{}".to_owned()),
            content: Some(document),
            ..campus()
        };
        let response = run(
            vec![record],
            "query { campusesV2 { __typename ... on CampusesSuccess { campuses { slug body content } } } }",
        )
        .await;
        assert_eq!(
            response,
            json!({ "data": { "campusesV2": {
                "__typename": "CampusesSuccess",
                "campuses": [{ "slug": "new-breed", "body": "{}", "content": content }],
            } } })
        );
    }

    // campuses.test.ts: "answers its typed error and logs the CMS failure behind it".
    #[tokio::test]
    async fn answers_its_typed_error_and_logs_the_cms_failure_behind_it() {
        let failure = CmsContentError {
            reason: CmsContentErrorReason::Malformed,
            operation: "campuses",
            detail:
                "Strapi 5 StrapiV2Campuses failed (Decode): Expected string\n  at [\"campuses\"][0]"
                    .to_owned(),
        };
        let reply = failure.clone();
        let cms = FakeCms::default().with_campuses(move || Err(reply.clone()));
        let logs = LogCapture::default();
        let _guard = logs.install();

        let response = execute_with_variables(
            &schema_with(Arc::new(cms)),
            "query { campusesV2 { __typename ... on CampusesFetchError { message } } }",
            Value::Null,
            Some(viewer()),
        )
        .await;

        assert_eq!(
            response,
            json!({ "data": { "campusesV2": {
                "__typename": "CampusesFetchError", "message": "Unable to load campuses",
            } } })
        );
        let annotations = json!({ "reason": "Malformed", "detail": failure.detail });
        assert_eq!(
            logs.lines(),
            [format!(
                "Error CMS fetch: Unable to load campuses {annotations}"
            )]
        );
    }

    // campuses.test.ts `LEADS_QUERY`: both fields in one request.
    const LEADS_QUERY: &str = "query {
        campuses { campus { campusLead { name } leadPastor { name } } }
        campusesV2 { ... on CampusesSuccess { campuses {
            campusLead { name }
            leadPastor { name }
            campusLeads: leadPastor { slug name image subTitle }
        } } }
    }";

    // campuses.test.ts, campus leads.
    #[tokio::test]
    async fn includes_both_house_of_stars_regional_pastors_without_changing_the_singular_lead() {
        let leaders = vec![
            lead(
                Some("Pastor Ada Example"),
                Some("pastor-ada-example"),
                Some("Regional Pastors"),
            ),
            lead(
                Some("Pastor Ben Example"),
                Some("pastor-ben-example"),
                Some("Regional Pastors"),
            ),
            lead(Some("Minister"), Some("minister"), Some("Ministers")),
        ];
        let record = CampusRecord {
            slug: "house-of-stars".to_owned(),
            leaders,
            ..campus()
        };
        assert_eq!(
            run(vec![record], LEADS_QUERY).await,
            json!({ "data": {
                "campuses": { "campus": [{
                    "campusLead": { "name": "Pastor Ada Example" },
                    "leadPastor": [{ "name": "Pastor Ada Example" }, { "name": "Pastor Ben Example" }],
                }] },
                "campusesV2": { "campuses": [{
                    "campusLead": { "name": "Ada Example" },
                    "leadPastor": [{ "name": "Ada Example" }, { "name": "Ben Example" }],
                    "campusLeads": [
                        { "slug": "pastor-ada-example", "name": "Ada Example", "image": null, "subTitle": null },
                        { "slug": "pastor-ben-example", "name": "Ben Example", "image": null, "subTitle": null },
                    ],
                }] },
            } })
        );
    }

    #[tokio::test]
    async fn returns_all_campus_leads_in_cms_order_while_preserving_the_singular_selection() {
        let leaders = vec![
            lead(
                Some("Regional Pastor"),
                Some("regional"),
                Some("Regional Pastors"),
            ),
            LeaderRecord {
                image: Some("https://example.com/first.jpg".to_owned()),
                bio: Some("First bio".to_owned()),
                ..led(" Pastor First Lead ", "first")
            },
            led("Dr. Second Lead", "second"),
            lead(Some("Minister"), Some("minister"), Some("Ministers")),
        ];
        let record = CampusRecord {
            leaders,
            ..campus()
        };
        assert_eq!(
            run(vec![record], LEADS_QUERY).await,
            json!({ "data": {
                "campuses": { "campus": [{
                    "campusLead": { "name": " Pastor First Lead " },
                    "leadPastor": [{ "name": " Pastor First Lead " }, { "name": "Dr. Second Lead" }],
                }] },
                "campusesV2": { "campuses": [{
                    "campusLead": { "name": "First Lead" },
                    "leadPastor": [{ "name": "First Lead" }, { "name": "Second Lead" }],
                    "campusLeads": [
                        {
                            "slug": "first", "name": "First Lead",
                            "image": "https://example.com/first.jpg", "subTitle": "First bio",
                        },
                        { "slug": "second", "name": "Second Lead", "image": null, "subTitle": null },
                    ],
                }] },
            } })
        );
    }

    // campuses.test.ts: "handles $label" (it.each).
    #[tokio::test]
    async fn handles_lead_variations() {
        let cases: Vec<(&str, Vec<LeaderRecord>, Vec<&str>)> = vec![
            ("no leaders", vec![], vec![]),
            ("one lead", vec![led("Pastor One", "one")], vec!["One"]),
            (
                "multiple leads without a group",
                vec![
                    lead(Some("Pastor One"), Some("one"), None),
                    lead(Some("Pastor Two"), Some("two"), None),
                ],
                vec!["One", "Two"],
            ),
            (
                "missing group and slug",
                vec![
                    lead(Some("Rev. Legacy"), None, None),
                    lead(Some("Other"), Some("other"), Some("Ministers")),
                ],
                vec!["Legacy"],
            ),
            (
                "unnamed leads",
                vec![
                    lead(None, Some("null"), Some(LEAD_PASTOR_GROUP)),
                    led("", "empty"),
                    led("   ", "blank"),
                    led("Pastor Named", "named"),
                ],
                vec!["Named"],
            ),
        ];
        for (label, leaders, names) in cases {
            let record = CampusRecord {
                leaders,
                ..campus()
            };
            let response = run(
                vec![record],
                "query { campusesV2 { ... on CampusesSuccess { campuses { campusLeads: leadPastor { name } } } } }",
            )
            .await;
            let names: Vec<Value> = names.iter().map(|name| json!({ "name": name })).collect();
            assert_eq!(
                response,
                json!({ "data": { "campusesV2": { "campuses": [{ "campusLeads": names }] } } }),
                "{label}"
            );
        }
    }

    const GIVING_QUERY: &str = "query { campusesV2 { ... on CampusesSuccess { campuses { slug giving givingPlatforms { title } } } } }";

    fn giving_answer(slug: &str, giving: Option<&str>, cards: Option<&[&str]>) -> Value {
        let cards = cards.map(|cards| {
            cards
                .iter()
                .map(|title| json!({ "title": title }))
                .collect::<Vec<_>>()
        });
        json!({ "data": { "campusesV2": { "campuses": [
            { "slug": slug, "giving": giving, "givingPlatforms": cards },
        ] } } })
    }

    fn entry(platform: GivingPlatform, value: &str) -> GivingEntry {
        GivingEntry {
            platform,
            value: value.to_owned(),
        }
    }

    fn house_of_stars() -> CampusRecord {
        CampusRecord {
            slug: "house-of-stars".to_owned(),
            name: Some("House of Stars".to_owned()),
            ..campus()
        }
    }

    const HOUSE_OF_STARS_CARDS: [&str; 4] = ["Website", "Cashapp", "Givelify", "Zelle"];

    // campuses.test.ts, campusesV2 giving.
    #[tokio::test]
    async fn shows_house_of_stars_cards_and_its_first_link_without_cash_app_or_zelle() {
        let record = CampusRecord {
            giving: vec![
                entry(
                    GivingPlatform::Givelify,
                    "https://www.givelify.com/givenow/example",
                ),
                entry(GivingPlatform::Website, "https://example.org/giving"),
            ],
            ..house_of_stars()
        };
        assert_eq!(
            run(vec![record], GIVING_QUERY).await,
            giving_answer(
                "house-of-stars",
                Some("https://www.givelify.com/givenow/example"),
                Some(&HOUSE_OF_STARS_CARDS)
            )
        );
    }

    #[tokio::test]
    async fn shows_no_house_of_stars_giving_when_the_cms_lists_none() {
        assert_eq!(
            run(vec![house_of_stars()], GIVING_QUERY).await,
            giving_answer("house-of-stars", None, None)
        );
    }

    #[tokio::test]
    async fn shows_house_of_stars_cash_app_and_zelle_text() {
        let record = CampusRecord {
            giving: vec![
                entry(GivingPlatform::Website, "https://example.org/giving"),
                entry(GivingPlatform::Cashapp, "$examplestars"),
            ],
            ..house_of_stars()
        };
        assert_eq!(
            run(vec![record], GIVING_QUERY).await,
            giving_answer(
                "house-of-stars",
                Some("$examplestars"),
                Some(&HOUSE_OF_STARS_CARDS)
            )
        );
    }

    #[tokio::test]
    async fn shows_a_campus_that_only_lists_givelify() {
        let record = CampusRecord {
            giving: vec![entry(
                GivingPlatform::Givelify,
                "https://www.givelify.com/givenow/example",
            )],
            ..campus()
        };
        assert_eq!(
            run(vec![record], GIVING_QUERY).await,
            giving_answer(
                "new-breed",
                Some("https://www.givelify.com/givenow/example"),
                Some(&["Givelify"])
            )
        );
    }

    #[tokio::test]
    async fn keeps_every_website_alongside_legacy_giving_without_changing_the_legacy_text() {
        let record = CampusRecord {
            giving: vec![
                entry(GivingPlatform::Zelle, "campus@example.org"),
                entry(GivingPlatform::Website, "https://giving.example.org/tithe"),
                entry(GivingPlatform::Website, "https://giving.example.org/donate"),
            ],
            ..campus()
        };
        assert_eq!(
            run(vec![record], GIVING_QUERY).await,
            giving_answer(
                "new-breed",
                Some("Zelle - campus@example.org"),
                Some(&["Zelle", "Website", "Website"])
            )
        );
    }

    #[tokio::test]
    async fn keeps_a_giving_address_entered_as_a_website_even_without_cash_app_or_zelle() {
        let record = CampusRecord {
            giving: vec![entry(GivingPlatform::Website, "campus@example.org")],
            ..campus()
        };
        assert_eq!(
            run(vec![record], GIVING_QUERY).await,
            giving_answer("new-breed", Some("campus@example.org"), Some(&["Website"]))
        );
    }

    #[tokio::test]
    async fn keeps_absent_giving_null_for_other_campuses() {
        assert_eq!(
            run(vec![campus()], GIVING_QUERY).await,
            giving_answer("new-breed", None, None)
        );
    }

    fn named(slug: &str) -> CampusRecord {
        CampusRecord {
            slug: slug.to_owned(),
            ..campus()
        }
    }

    const ORDER_QUERY: &str =
        "query Order($preferred: String) { campusesV2(preferredCampus: $preferred) {
        __typename
        ... on CampusesSuccess { campuses { slug isPreferred } }
        ... on CampusesNotFoundError { message }
    } }";

    async fn order(records: Vec<CampusRecord>, preferred: Value) -> Value {
        let cms = FakeCms::default().with_campuses(move || Ok(records.clone()));
        execute_with_variables(
            &schema_with(Arc::new(cms)),
            ORDER_QUERY,
            json!({ "preferred": preferred }),
            Some(viewer()),
        )
        .await
    }

    fn slugs(response: &Value) -> Vec<(String, bool)> {
        response["data"]["campusesV2"]["campuses"]
            .as_array()
            .unwrap()
            .iter()
            .map(|campus| {
                (
                    campus["slug"].as_str().unwrap().to_owned(),
                    campus["isPreferred"].as_bool().unwrap(),
                )
            })
            .collect()
    }

    fn listed() -> Vec<CampusRecord> {
        [
            "light-house",
            "unlisted-campus",
            "new-breed",
            "house-of-stars",
            "jubilee-place",
        ]
        .into_iter()
        .map(named)
        .collect()
    }

    #[tokio::test]
    async fn lists_known_campuses_house_of_stars_first_then_in_campus_order() {
        let response = order(listed(), Value::Null).await;
        assert_eq!(
            slugs(&response),
            [
                ("house-of-stars".to_owned(), false),
                ("jubilee-place".to_owned(), false),
                ("new-breed".to_owned(), false),
                ("light-house".to_owned(), false),
            ]
        );
        for preferred in [json!(""), json!("   "), json!("unknown")] {
            assert_eq!(slugs(&order(listed(), preferred).await), slugs(&response));
        }
    }

    #[tokio::test]
    async fn moves_the_preferred_campus_first() {
        let response = order(listed(), json!(" light-house ")).await;
        assert_eq!(
            slugs(&response),
            [
                ("light-house".to_owned(), true),
                ("house-of-stars".to_owned(), false),
                ("jubilee-place".to_owned(), false),
                ("new-breed".to_owned(), false),
            ]
        );
    }

    #[tokio::test]
    async fn answers_not_found_without_a_listed_campus() {
        for records in [vec![], vec![named("unlisted-campus")]] {
            assert_eq!(
                order(records, Value::Null).await,
                json!({ "data": { "campusesV2": {
                    "__typename": "CampusesNotFoundError", "message": "No campuses found",
                } } })
            );
        }
    }

    #[tokio::test]
    async fn normalizes_names_and_locations() {
        let records = vec![
            CampusRecord {
                name: Some("  New\n  Breed ".to_owned()),
                city_state: Some(" Example\tCity,  TX ".to_owned()),
                address: Some("  ".to_owned()),
                ..campus()
            },
            CampusRecord {
                slug: "light-house".to_owned(),
                name: None,
                address: Some(" 1 Example  Road ".to_owned()),
                city_state: None,
                ..campus()
            },
            CampusRecord {
                slug: "impact-house".to_owned(),
                address: None,
                city_state: Some(" ".to_owned()),
                ..campus()
            },
        ];
        let response = run(
            records,
            "query { campusesV2 { ... on CampusesSuccess { campuses { campusName cityState address location } } } }",
        )
        .await;
        assert_eq!(
            response,
            json!({ "data": { "campusesV2": { "campuses": [
                { "campusName": "New Breed", "cityState": "Example City, TX", "address": "  ", "location": "Example City, TX" },
                { "campusName": "", "cityState": null, "address": " 1 Example  Road ", "location": "1 Example Road" },
                { "campusName": "New Breed", "cityState": "", "address": null, "location": null },
            ] } } })
        );
    }

    #[test]
    fn cleans_lead_names_like_the_ts_pattern() {
        let clean = |name: &str| clean_lead_name(Some(name)).unwrap();
        assert_eq!(clean(" Pastor Ada Example "), "Ada Example");
        assert_eq!(clean("REV. Ada"), "Ada");
        assert_eq!(clean("Rev Ada"), "Ada");
        assert_eq!(clean("Reverend Dr. Ada"), "Dr. Ada");
        assert_eq!(clean("Bishop\u{a0}Ada"), "Ada");
        assert_eq!(clean("apostle ada"), "ada");
        // A title alone, or a title not followed by whitespace, stays.
        assert_eq!(clean("Pastor"), "Pastor");
        assert_eq!(clean("Pastorale"), "Pastorale");
        // `.` stops at a line terminator, so a multi-line name keeps its title.
        assert_eq!(clean("Pastor Ada\nExample"), "Pastor Ada\nExample");
        assert_eq!(clean_lead_name(None), None);
    }

    #[tokio::test]
    async fn requires_an_authorized_caller() {
        let cms = Arc::new(FakeCms::default().with_campuses(|| Ok(vec![campus()])));
        let response = execute_with_variables(
            &schema_with(cms.clone()),
            "query { campusesV2 { __typename } }",
            Value::Null,
            None,
        )
        .await;
        assert_eq!(
            response["errors"][0]["message"],
            "Not authorized to resolve Query.campusesV2"
        );
        assert_eq!(cms.calls(), 0);
    }

    // campuses.ts `loadCampuses`: the listed campuses in campus order, and `pageBody` from the
    // first CMS record before the filter.
    #[test]
    fn builds_v1_campuses_in_campus_order_with_the_first_records_body() {
        let mut records = vec![CampusRecord {
            body: Some("Welcome to every campus".to_owned()),
            ..named("unlisted-campus")
        }];
        records.extend(
            [
                "light-house",
                "new-breed",
                "house-of-stars",
                "jubilee-place",
            ]
            .into_iter()
            .map(named),
        );
        let campuses = to_campuses(&records);
        assert_eq!(
            campuses.page_body.as_deref(),
            Some("Welcome to every campus")
        );
        let slugs: Vec<(&str, bool)> = campuses
            .campus
            .as_deref()
            .unwrap()
            .iter()
            .map(|campus| (campus.slug.as_str(), campus.is_preferred))
            .collect();
        assert_eq!(
            slugs,
            [
                ("house-of-stars", false),
                ("jubilee-place", false),
                ("new-breed", false),
                ("light-house", false),
            ]
        );
    }

    // `records[0]?.body || ""`.
    #[test]
    fn answers_an_empty_page_body_without_a_first_body() {
        for body in [None, Some(String::new())] {
            let records = vec![CampusRecord { body, ..campus() }];
            assert_eq!(to_campuses(&records).page_body.as_deref(), Some(""));
        }
        assert_eq!(
            to_campuses(&[]),
            Campuses {
                campus: Some(vec![]),
                page_body: Some(String::new()),
            }
        );
    }

    // `campuses` leaves names, cities and lead names as the CMS wrote them; `campusesV2` cleans
    // the same record.
    #[test]
    fn keeps_v1_names_cities_and_leads_as_the_cms_wrote_them() {
        let record = CampusRecord {
            name: Some("  New\n  Breed ".to_owned()),
            city_state: Some(" Example\tCity,  TX ".to_owned()),
            address: Some("  ".to_owned()),
            leaders: vec![
                led(" Pastor First Lead ", "first"),
                led("Dr. Second Lead", "second"),
            ],
            ..campus()
        };
        let campuses = to_campuses(std::slice::from_ref(&record));
        let v1 = &campuses.campus.as_deref().unwrap()[0];
        assert_eq!(v1.campus_name.as_deref(), Some("  New\n  Breed "));
        assert_eq!(v1.city_state.as_deref(), Some(" Example\tCity,  TX "));
        assert_eq!(v1.location.as_deref(), Some("Example City, TX"));
        assert_eq!(
            v1.campus_lead
                .as_ref()
                .and_then(|lead| lead.name.as_deref()),
            Some(" Pastor First Lead ")
        );
        let names: Vec<Option<&str>> = v1
            .lead_pastor
            .as_deref()
            .unwrap()
            .iter()
            .map(|lead| lead.name.as_deref())
            .collect();
        assert_eq!(
            names,
            [Some(" Pastor First Lead "), Some("Dr. Second Lead")]
        );

        let CampusesResult::CampusesSuccess(v2) = to_result(&[record], None) else {
            panic!("campusesV2 lists the campus");
        };
        assert_eq!(v2.campuses[0].campus_name.as_deref(), Some("New Breed"));
        assert_eq!(
            v2.campuses[0].city_state.as_deref(),
            Some("Example City, TX")
        );
        assert_eq!(
            v2.campuses[0]
                .campus_lead
                .as_ref()
                .and_then(|lead| lead.name.as_deref()),
            Some("First Lead")
        );

        // `record.name ?? ""`.
        let unnamed = to_campuses(&[CampusRecord {
            name: None,
            ..campus()
        }]);
        assert_eq!(unnamed.campus.unwrap()[0].campus_name.as_deref(), Some(""));
    }

    #[tokio::test]
    async fn answers_campuses_as_the_cms_wrote_them() {
        let records = vec![
            CampusRecord {
                body: Some("Welcome to every campus".to_owned()),
                ..named("unlisted-campus")
            },
            CampusRecord {
                name: Some("  Light\n House ".to_owned()),
                city_state: Some(" Example\tCity,  TX ".to_owned()),
                ..named("light-house")
            },
            named("house-of-stars"),
        ];
        let response = run(
            records,
            "query { campuses { pageBody campus { slug campusName cityState location isPreferred } } }",
        )
        .await;
        assert_eq!(
            response,
            json!({ "data": { "campuses": {
                "pageBody": "Welcome to every campus",
                "campus": [
                    {
                        "slug": "house-of-stars", "campusName": "New Breed",
                        "cityState": "Example City, TX", "location": "Example City, TX",
                        "isPreferred": false,
                    },
                    {
                        "slug": "light-house", "campusName": "  Light\n House ",
                        "cityState": " Example\tCity,  TX ", "location": "Example City, TX",
                        "isPreferred": false,
                    },
                ],
            } } })
        );
    }

    // Unlike `campusesV2`, no listed campus is not an error.
    #[tokio::test]
    async fn answers_an_empty_list_and_page_body_without_campuses() {
        assert_eq!(
            run(vec![], "query { campuses { pageBody campus { slug } } }").await,
            json!({ "data": { "campuses": { "pageBody": "", "campus": [] } } })
        );
    }

    // `runPromise(loadCampuses)` rejects with `CMSFetchError`, which yoga masks.
    #[tokio::test]
    async fn masks_a_cms_failure_and_logs_it() {
        let failure = CmsContentError {
            reason: CmsContentErrorReason::Unavailable,
            operation: "campuses",
            detail: "Strapi 5 StrapiV2Campuses failed (Status): HTTP 503".to_owned(),
        };
        let reply = failure.clone();
        let cms = FakeCms::default().with_campuses(move || Err(reply.clone()));
        let logs = LogCapture::default();
        let _guard = logs.install();

        let response = execute_with_variables(
            &schema_with(Arc::new(cms)),
            "query { campuses { pageBody } }",
            Value::Null,
            Some(viewer()),
        )
        .await;

        assert_eq!(
            response,
            json!({
                "errors": [{
                    "message": "Unexpected error.",
                    "locations": [{ "line": 1, "column": 9 }],
                    "path": ["campuses"],
                    "extensions": { "code": "INTERNAL_SERVER_ERROR" },
                }],
                "data": { "campuses": null },
            })
        );
        let annotations = json!({ "reason": "Unavailable", "detail": failure.detail });
        let masked =
            json!({ "gql_path": "campuses", "error": "CMS fetch: Unable to load campuses" });
        assert_eq!(
            logs.lines(),
            [
                format!("Error CMS fetch: Unable to load campuses {annotations}"),
                format!("Error GraphQL resolver error {masked}"),
            ]
        );
    }

    #[tokio::test]
    async fn requires_an_authorized_caller_for_campuses() {
        let cms = Arc::new(FakeCms::default().with_campuses(|| Ok(vec![campus()])));
        let response = execute_with_variables(
            &schema_with(cms.clone()),
            "query { campuses { pageBody } }",
            Value::Null,
            None,
        )
        .await;
        assert_eq!(response["data"], json!({ "campuses": null }));
        assert_eq!(
            response["errors"][0]["message"],
            "Not authorized to resolve Query.campuses"
        );
        assert_eq!(cms.calls(), 0);
    }

    // The pipeline: `campuses` is a shared field, so the stored result is keyed without the
    // caller and served before authentication, as on TS.
    #[tokio::test]
    async fn shares_campuses_through_the_response_cache() {
        use crate::google::GoogleAuth;
        use crate::graphql::auth::testing::{GoogleMock, anonymous_claims, sign};
        use crate::test_support::{TestApp, post_graphql, post_graphql_as};

        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_account(1).await;
        let cms = Arc::new(FakeCms::default().with_campuses(|| Ok(vec![campus()])));
        let app = TestApp::with_cms(
            &mock,
            GoogleAuth::fixed("example-access-token"),
            cms.clone(),
        );
        let body = json!({ "query": "query CampusesQuery { campuses { campus { slug } } }" });

        let first = app
            .send(post_graphql_as(body.clone(), &sign(&anonymous_claims())))
            .await;
        assert_eq!(
            first.json(),
            json!({ "data": { "campuses": { "campus": [{ "slug": "new-breed" }] } } })
        );
        assert!(first.headers.contains_key("etag"));

        let second = app.send(post_graphql(body)).await;
        assert_eq!(second.json(), first.json());
        assert_eq!(cms.calls(), 1);
    }
}
