//! `attendance_profile` (`CCBRequestType.GET_ATTENDANCE_PROFILE`): `ResponseSchema` of
//! `packages/ccb/src/schemas/AttendanceProfile.ts`, keeping what the attendance readers
//! (`apps/server/src/effect/services/attendanceExport/ccb.ts`,
//! `apps/server/src/graphql/schema/event/attendance.ts`) use: the event's topic and notes, and
//! its attendees. TS requires `<events>`, `<event>`, `<attendees>` and every attendee's id and
//! names; so does this. An occurrence without saved attendance comes back without a
//! `<response>`: [`crate::ccb::CcbError::EmptyResponse`].

use serde::{Deserialize, Serialize};

use crate::ccb::xml::{trimmed, trimmed_string};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttendanceProfile {
    pub events: AttendanceEvents,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttendanceEvents {
    pub event: AttendanceEvent,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttendanceEvent {
    /// `Some("")` for an empty element; TS callers skip an empty topic (`if (event.topic)`).
    #[serde(default, deserialize_with = "trimmed")]
    pub topic: Option<String>,
    /// `Some("")` for an empty element; TS callers skip empty notes.
    #[serde(default, deserialize_with = "trimmed")]
    pub notes: Option<String>,
    pub attendees: Attendees,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attendees {
    /// One `<attendee>`, or none, is a list of one or none; TS's schema rejects both.
    #[serde(default)]
    pub attendee: Vec<Attendee>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attendee {
    #[serde(rename = "@id", deserialize_with = "trimmed_string")]
    pub id: String,
    #[serde(deserialize_with = "trimmed_string")]
    pub first_name: String,
    #[serde(deserialize_with = "trimmed_string")]
    pub last_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ccb::CcbError;
    use crate::ccb::records::testing::{assert_json_round_trip, decode};
    use crate::ccb::xml::decode_body;

    const TWO: &str = r#"<ccb_api>
  <request><parameters><argument value="attendance_profile" name="srv"/></parameters></request>
  <response>
    <service>attendance_profile</service>
    <events count="1">
      <event id="4001" occurrence="2026-10-04 10:00:00">
        <name>Example Service</name>
        <occurrence>2026-10-04 10:00:00</occurrence>
        <did_not_meet>false</did_not_meet>
        <topic>Example topic</topic>
        <notes></notes>
        <prayer_requests></prayer_requests>
        <attendees>
          <attendee id="1001"><first_name>Ada</first_name><last_name>Example</last_name></attendee>
          <attendee id="1002"><first_name>Grace</first_name><last_name>Example</last_name></attendee>
        </attendees>
        <head_count>2</head_count>
      </event>
    </events>
  </response>
</ccb_api>"#;

    fn attendee(id: &str, first_name: &str) -> Attendee {
        Attendee {
            id: id.to_owned(),
            first_name: first_name.to_owned(),
            last_name: "Example".to_owned(),
        }
    }

    #[test]
    fn decodes_the_topic_notes_and_attendees() {
        let profile: AttendanceProfile = decode(TWO);
        assert_eq!(
            profile,
            AttendanceProfile {
                events: AttendanceEvents {
                    event: AttendanceEvent {
                        topic: Some("Example topic".to_owned()),
                        notes: Some(String::new()),
                        attendees: Attendees {
                            attendee: vec![attendee("1001", "Ada"), attendee("1002", "Grace")],
                        },
                    },
                },
            }
        );
        assert_json_round_trip(&profile);
    }

    // Review Focus: a list with exactly one item, and an empty result set (TS rejects both).
    #[test]
    fn decodes_one_or_no_attendees_as_a_list() {
        let one = TWO.replace(
            r#"<attendee id="1002"><first_name>Grace</first_name><last_name>Example</last_name></attendee>"#,
            "",
        );
        let profile: AttendanceProfile = decode(&one);
        assert_eq!(
            profile.events.event.attendees.attendee,
            [attendee("1001", "Ada")]
        );

        let none: AttendanceProfile = decode(
            r#"<ccb_api><response><events count="1"><event id="4001"><topic/><attendees/></event></events></response></ccb_api>"#,
        );
        assert!(none.events.event.attendees.attendee.is_empty());
        assert_eq!(none.events.event.topic.as_deref(), Some(""));
        assert_eq!(none.events.event.notes, None);
    }

    #[test]
    fn rejects_what_ts_rejects_missing_attendees_or_an_attendee_without_an_id() {
        for xml in [
            r#"<ccb_api><response><events count="1"><event id="4001"><topic>Example topic</topic></event></events></response></ccb_api>"#,
            r#"<ccb_api><response><events count="1"><event id="4001"><attendees><attendee><first_name>Ada</first_name><last_name>Example</last_name></attendee></attendees></event></events></response></ccb_api>"#,
        ] {
            assert!(
                matches!(
                    decode_body::<AttendanceProfile>(xml.as_bytes()),
                    Err(CcbError::Decode(_))
                ),
                "{xml}"
            );
        }
    }
}
