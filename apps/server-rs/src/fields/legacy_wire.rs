//! `apps/server/src/graphql/schema/cms/legacyWire.ts`: records keep the CMS's structure, and
//! these functions turn them back into the strings installed apps already receive.

use crate::fields::giving::cash_tag;
use crate::strapi::records::{GivingEntry, GivingPlatform, LeaderRecord, SpeakerRecord};

const LEAD_PASTOR_GROUP: &str = "Lead Pastors/Campus Leads";

/// `givingText`: `Campus.giving`, "$tag; Zelle - account" in CMS order. Other platforms are not
/// part of the text; `None` when there is nothing to write.
pub fn giving_text(entries: &[GivingEntry]) -> Option<String> {
    let parts: Vec<String> = entries
        .iter()
        .filter_map(|entry| match entry.platform {
            GivingPlatform::Cashapp => Some(cash_tag(&entry.value)),
            GivingPlatform::Zelle => Some(format!("Zelle - {}", entry.value)),
            _ => None,
        })
        .collect();
    (!parts.is_empty()).then(|| parts.join("; "))
}

/// `speakerFullName`: `EventSpeaker.fullName`, the name, then the title on the next line.
pub fn speaker_full_name(speaker: &SpeakerRecord) -> Option<String> {
    match &speaker.title {
        None => speaker.full_name.clone(),
        Some(title) => Some(format!(
            "{}\n{title}",
            speaker.full_name.as_deref().unwrap_or_default()
        )),
    }
}

/// `leadPastorOf`: the first Lead Pastor/Campus Lead, otherwise the first leader.
pub fn lead_pastor_of(leaders: &[LeaderRecord]) -> Option<&LeaderRecord> {
    leaders
        .iter()
        .find(|leader| leader.group.as_deref() == Some(LEAD_PASTOR_GROUP))
        .or_else(|| leaders.first())
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

    fn leader(name: &str, group: Option<&str>) -> LeaderRecord {
        LeaderRecord {
            name: Some(name.to_owned()),
            slug: None,
            group: group.map(str::to_owned),
            bio: None,
            image: None,
            body: None,
        }
    }

    // legacyWire.test.ts, givingText.
    #[test]
    fn writes_cash_app_and_zelle_entries_in_the_strapi_4_text_format_in_order() {
        assert_eq!(
            giving_text(&[
                entry(GivingPlatform::Cashapp, "$examplecampus"),
                entry(GivingPlatform::Zelle, "campus@example.org"),
            ])
            .as_deref(),
            Some("$examplecampus; Zelle - campus@example.org")
        );
        assert_eq!(
            giving_text(&[
                entry(GivingPlatform::Zelle, "praise@example.org"),
                entry(GivingPlatform::Cashapp, "$examplepraise"),
            ])
            .as_deref(),
            Some("Zelle - praise@example.org; $examplepraise")
        );
    }

    #[test]
    fn formats_strapi_5_entries_and_skips_other_platforms() {
        assert_eq!(
            giving_text(&[
                entry(GivingPlatform::Cashapp, "https://cash.app/$examplechurch"),
                entry(GivingPlatform::Zelle, "giving@example.org"),
                entry(GivingPlatform::Givelify, "https://givelify.example"),
            ])
            .as_deref(),
            Some("$examplechurch; Zelle - giving@example.org")
        );
        assert_eq!(
            giving_text(&[entry(GivingPlatform::Website, "https://example.org/giving")]),
            None
        );
    }

    // legacyWire.test.ts, speakerFullName.
    #[test]
    fn keeps_a_name_without_a_title_as_is() {
        let speaker = SpeakerRecord {
            full_name: Some("Pastor Bea Example".to_owned()),
            title: None,
            image: None,
        };
        assert_eq!(
            speaker_full_name(&speaker).as_deref(),
            Some("Pastor Bea Example")
        );
    }

    #[test]
    fn joins_a_strapi_5_name_and_title() {
        let speaker = SpeakerRecord {
            full_name: Some("Dr.Eli Example".to_owned()),
            title: Some("General Overseer".to_owned()),
            image: None,
        };
        assert_eq!(
            speaker_full_name(&speaker).as_deref(),
            Some("Dr.Eli Example\nGeneral Overseer")
        );
        let untitled = SpeakerRecord {
            full_name: None,
            ..speaker
        };
        assert_eq!(
            speaker_full_name(&untitled).as_deref(),
            Some("\nGeneral Overseer")
        );
    }

    // legacyWire.test.ts, leadPastorOf.
    #[test]
    fn prefers_a_lead_pastor_then_the_first_leader() {
        let name = |leaders: &[LeaderRecord]| {
            lead_pastor_of(leaders).and_then(|leader| leader.name.clone())
        };
        assert_eq!(
            name(&[
                leader("A", Some("Regional Pastors")),
                leader("B", Some("Lead Pastors/Campus Leads")),
            ])
            .as_deref(),
            Some("B")
        );
        assert_eq!(
            name(&[
                leader("First", Some("Regional Pastors")),
                leader("Second", Some("Regional Pastors")),
            ])
            .as_deref(),
            Some("First")
        );
        assert_eq!(name(&[]), None);
    }
}
