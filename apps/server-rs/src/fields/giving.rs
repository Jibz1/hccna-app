//! Giving cards (`apps/server/src/effect/services/giving/platforms.ts`): the `GivingPlatform`
//! entries a campus shows, built from its CMS giving entries, and House of Stars' fixed cards.
//! Links are read with the WHATWG URL parser (`url`), as `URL.parse` reads them.

use std::sync::LazyLock;

use regex::Regex;
use url::Url;

use crate::strapi::js;
use crate::strapi::records::{GivingEntry, GivingPlatform};

const GIVELIFY_ICON: &str = "https://firebasestorage.googleapis.com/v0/b/app-hccnj.appspot.com/o/apps%2Fimages%2Fassets%2Fgiving%2FGivelify.svg?alt=media&token=c97aae53-ce72-4bce-b625-06d0e4dbd9be";
const CASHAPP_ICON: &str = "https://firebasestorage.googleapis.com/v0/b/app-hccnj.appspot.com/o/apps%2Fimages%2Fassets%2Fgiving%2Fcashapp.svg?alt=media&token=2119d6a0-1f95-4129-834b-4f6678669c1a";
const ZELLE_ICON: &str = "https://firebasestorage.googleapis.com/v0/b/app-hccnj.appspot.com/o/apps%2Fimages%2Fassets%2Fgiving%2Fzelle.svg?alt=media&token=96405337-3712-4e48-87e2-652a7ce48449";
const WEBSITE_ICON: &str = "https://firebasestorage.googleapis.com/v0/b/app-hccnj.appspot.com/o/apps%2Fimages%2Fassets%2Fgiving%2Fhcclogo2.svg?alt=media&token=75171ecf-e0a3-44a8-a5fb-c1c438623994";

const TITHELY_ICON: &str = "https://give.tithe.ly/icon/icon-192x192.png";

/// `WEBSITE_GIVING_ICONS`: by host, or by host and path for the known short links.
fn known_website_icon(key: &str) -> Option<&'static str> {
    match key {
        "tithe.ly" | "give.tithe.ly" => Some(TITHELY_ICON),
        "paypal.com" => Some("https://www.paypalobjects.com/webstatic/icon/pp196.png"),
        // These published campus links redirect to Tithe.ly. Match the complete short-link path.
        "bit.ly/Jubilee-Tithely" | "tiny.cc/hccgiving" => Some(TITHELY_ICON),
        _ => None,
    }
}

/// A `GivingPlatform` card.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GivingCard {
    pub icon: String,
    pub title: &'static str,
    pub link: Option<String>,
    pub text: String,
}

/// The card platforms (`GivingPlatform["platform"]`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CardPlatform {
    Givelify,
    Cashapp,
    Zelle,
    Website,
}

impl CardPlatform {
    fn title(self) -> &'static str {
        match self {
            Self::Givelify => "Givelify",
            Self::Cashapp => "Cashapp",
            Self::Zelle => "Zelle",
            Self::Website => "Website",
        }
    }
}

/// `websiteGivingIcon`.
fn website_giving_icon(link: Option<&str>) -> String {
    let Some(url) = link.and_then(|link| Url::parse(link).ok()) else {
        return WEBSITE_ICON.to_owned();
    };
    let hostname = url.host_str().unwrap_or_default();
    let host = hostname.strip_prefix("www.").unwrap_or(hostname);
    known_website_icon(&format!("{host}{}", url.path()))
        .or_else(|| known_website_icon(host))
        .unwrap_or(WEBSITE_ICON)
        .to_owned()
}

/// `toGivingPlatformCard`.
fn card(platform: CardPlatform, link: Option<String>, text: String) -> GivingCard {
    let icon = match platform {
        CardPlatform::Website => website_giving_icon(link.as_deref()),
        CardPlatform::Givelify => GIVELIFY_ICON.to_owned(),
        CardPlatform::Cashapp => CASHAPP_ICON.to_owned(),
        CardPlatform::Zelle => ZELLE_ICON.to_owned(),
    };
    GivingCard {
        icon,
        title: platform.title(),
        link,
        text,
    }
}

/// `getHouseOfStarsGivingPlatforms`: House of Stars' fixed cards.
pub fn house_of_stars_giving_platforms() -> Vec<GivingCard> {
    vec![
        card(
            CardPlatform::Website,
            Some("https://hccnj.org/giving".to_owned()),
            "Website".to_owned(),
        ),
        card(
            CardPlatform::Cashapp,
            Some("https://cash.app/$UnionNJhgccnj".to_owned()),
            "Cashapp".to_owned(),
        ),
        card(
            CardPlatform::Givelify,
            Some("https://www.givelify.com/givenow/1.0/MzIwODY=/selection".to_owned()),
            "Givelify".to_owned(),
        ),
        card(CardPlatform::Zelle, None, "giving@hccnj.org".to_owned()),
    ]
}

/// `CASH_APP_LINK`: `/^(?:https?:\/\/)?(?:www\.)?cash\.(?:app|me)\//iu`.
static CASH_APP_LINK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:https?://)?(?:www\.)?cash\.(?:app|me)/").expect("a valid pattern")
});

/// `cashTag`: "$tag" from a Cash App tag or link.
pub fn cash_tag(value: &str) -> String {
    let tag = CASH_APP_LINK.replace(js::trim(value), "");
    if tag.starts_with('$') {
        tag.into_owned()
    } else {
        format!("${tag}")
    }
}

/// `givingLink`: an http(s) link without credentials, or `None` for anything else (some CMS
/// Website entries are email addresses, which stay copyable text).
fn giving_link(value: &str) -> Option<String> {
    let candidate = if value.contains("://") {
        value.to_owned()
    } else {
        format!("https://{value}")
    };
    let url = Url::parse(&candidate).ok()?;
    let web = matches!(url.scheme(), "https" | "http");
    (web && url.username().is_empty() && url.password().is_none()).then(|| url.as_str().to_owned())
}

/// `getCampusGivingPlatforms`: the last Cash App entry, then the last Zelle entry (the legacy
/// order), then every Website and Givelify destination in CMS order.
pub fn campus_giving_platforms(entries: &[GivingEntry]) -> Vec<GivingCard> {
    let last = |platform: GivingPlatform| entries.iter().rev().find(|e| e.platform == platform);
    let mut cards = Vec::new();
    if let Some(cash_app) = last(GivingPlatform::Cashapp) {
        cards.push(card(
            CardPlatform::Cashapp,
            Some(format!("https://cash.me/{}", cash_tag(&cash_app.value))),
            "Cashapp".to_owned(),
        ));
    }
    if let Some(zelle) = last(GivingPlatform::Zelle) {
        cards.push(card(CardPlatform::Zelle, None, zelle.value.to_lowercase()));
    }
    for entry in entries {
        let platform = match entry.platform {
            GivingPlatform::Website => CardPlatform::Website,
            GivingPlatform::Givelify => CardPlatform::Givelify,
            _ => continue,
        };
        let link = giving_link(&entry.value);
        let text = match link {
            None => entry.value.clone(),
            Some(_) => platform.title().to_owned(),
        };
        cards.push(card(platform, link, text));
    }
    cards
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(platform: GivingPlatform, value: &str) -> GivingEntry {
        GivingEntry {
            platform,
            value: value.to_owned(),
        }
    }

    fn websites(values: &[&str]) -> Vec<GivingEntry> {
        values
            .iter()
            .map(|value| entry(GivingPlatform::Website, value))
            .collect()
    }

    fn summary(cards: &[GivingCard]) -> Vec<(&str, Option<&str>, &str)> {
        cards
            .iter()
            .map(|card| (card.title, card.link.as_deref(), card.text.as_str()))
            .collect()
    }

    // legacyWire.test.ts, getCampusGivingPlatforms.
    #[test]
    fn builds_the_same_cards_the_string_parser_built() {
        let cards = campus_giving_platforms(&[
            entry(GivingPlatform::Cashapp, "$examplecampus"),
            entry(GivingPlatform::Zelle, "Campus@example.org"),
        ]);
        assert_eq!(
            summary(&cards),
            [
                ("Cashapp", Some("https://cash.me/$examplecampus"), "Cashapp"),
                ("Zelle", None, "campus@example.org"),
            ]
        );
        assert_eq!(cards[0].icon, CASHAPP_ICON);
        assert_eq!(cards[1].icon, ZELLE_ICON);
    }

    #[test]
    fn keeps_the_last_cash_app_and_the_last_zelle_entry_cash_app_first() {
        let cards = campus_giving_platforms(&[
            entry(GivingPlatform::Zelle, "first@example.org"),
            entry(GivingPlatform::Cashapp, "$first"),
            entry(GivingPlatform::Zelle, "Second@example.org"),
            entry(GivingPlatform::Cashapp, "$second"),
        ]);
        assert_eq!(
            summary(&cards),
            [
                ("Cashapp", Some("https://cash.me/$second"), "Cashapp"),
                ("Zelle", None, "second@example.org"),
            ]
        );
    }

    #[test]
    fn includes_every_website_and_givelify_destination_including_scheme_less_links() {
        let cards = campus_giving_platforms(&[
            entry(GivingPlatform::Website, "giving.example.org/tithe"),
            entry(
                GivingPlatform::Website,
                "https://giving.example.org/donate?fund=missions",
            ),
            entry(
                GivingPlatform::Givelify,
                "https://www.givelify.com/givenow/example",
            ),
            entry(GivingPlatform::Other, "https://other.example.org"),
        ]);
        assert_eq!(
            summary(&cards),
            [
                (
                    "Website",
                    Some("https://giving.example.org/tithe"),
                    "Website"
                ),
                (
                    "Website",
                    Some("https://giving.example.org/donate?fund=missions"),
                    "Website"
                ),
                (
                    "Givelify",
                    Some("https://www.givelify.com/givenow/example"),
                    "Givelify"
                ),
            ]
        );
        assert_eq!(cards[2].icon, GIVELIFY_ICON);
    }

    #[test]
    fn exposes_an_email_entered_as_website_as_copyable_text() {
        assert_eq!(
            summary(&campus_giving_platforms(&websites(&["campus@example.org"]))),
            [("Website", None, "campus@example.org")]
        );
        // Credentials or another scheme are not links either.
        assert_eq!(
            summary(&campus_giving_platforms(&websites(&[
                "https://ada:secret@example.org/give",
                "mailto://giving@example.org",
            ]))),
            [
                ("Website", None, "https://ada:secret@example.org/give"),
                ("Website", None, "mailto://giving@example.org"),
            ]
        );
    }

    #[test]
    fn uses_each_giving_sites_png_icon_while_preserving_website_titles_and_donation_links() {
        let links = [
            "https://give.tithe.ly/?formId=example",
            "https://www.paypal.com/donate/?hosted_button_id=example",
        ];
        let cards = campus_giving_platforms(&websites(&links));
        assert_eq!(
            summary(&cards),
            [
                ("Website", Some(links[0]), "Website"),
                ("Website", Some(links[1]), "Website"),
            ]
        );
        let icons: Vec<&str> = cards.iter().map(|card| card.icon.as_str()).collect();
        assert_eq!(
            icons,
            [
                "https://give.tithe.ly/icon/icon-192x192.png",
                "https://www.paypalobjects.com/webstatic/icon/pp196.png",
            ]
        );
    }

    #[test]
    fn uses_the_destination_icon_for_the_known_short_links_including_query_parameters() {
        let cards = campus_giving_platforms(&websites(&[
            "https://give.tithe.ly/?formId=example",
            "https://bit.ly/Jubilee-Tithely?source=app",
            "tiny.cc/hccgiving",
        ]));
        assert!(cards.iter().all(|card| card.icon == TITHELY_ICON));
    }

    #[test]
    fn keeps_the_fallback_for_unknown_sites_other_short_links_and_giving_addresses() {
        let cards = campus_giving_platforms(&websites(&[
            "https://giving.example.org/donate",
            "https://bit.ly/another-campaign",
            "https://tiny.cc/another-campaign",
            "https://paypal.com.example.org/donate",
            "campus@example.org",
        ]));
        assert!(cards[0].icon.contains("hcclogo2.svg"));
        assert!(cards.iter().all(|card| card.icon == WEBSITE_ICON));
    }

    #[test]
    fn reads_cash_tags_from_tags_and_links() {
        assert_eq!(cash_tag(" $example "), "$example");
        assert_eq!(cash_tag("example"), "$example");
        assert_eq!(cash_tag("https://cash.app/$example"), "$example");
        assert_eq!(cash_tag("HTTP://WWW.Cash.Me/example"), "$example");
        assert_eq!(cash_tag("cash.app/$example"), "$example");
    }

    #[test]
    fn builds_house_of_stars_fixed_cards() {
        let cards = house_of_stars_giving_platforms();
        let titles: Vec<&str> = cards.iter().map(|card| card.title).collect();
        assert_eq!(titles, ["Website", "Cashapp", "Givelify", "Zelle"]);
        assert_eq!(cards[0].icon, WEBSITE_ICON);
        assert_eq!(cards[3].link, None);
    }
}
