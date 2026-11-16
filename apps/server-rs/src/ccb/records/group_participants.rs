//! `group_participants` (`CCBRequestType.GET_GROUPS_MEMBERS`): `GroupParticipantsSchema` of
//! `packages/ccb/src/schemas/GroupsParticipants.ts`, keeping what the attendance readers
//! (`apps/server/src/effect/services/attendanceExport/ccb.ts`,
//! `apps/server/src/graphql/schema/event/attendance.ts`) use: the participant count, the group's
//! id and name, and each participant's id, name and email. TS requires `<groups>`, `<group>`,
//! `<participants>` and every participant's name and email; so does this.

use serde::{Deserialize, Serialize};

use crate::ccb::xml::{trimmed, trimmed_string};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupParticipants {
    pub groups: ParticipantGroups,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParticipantGroups {
    /// TS reads it as the attendee count: `Number(groups.count || "0")`.
    #[serde(rename = "@count", default, deserialize_with = "trimmed")]
    pub count: Option<String>,
    pub group: ParticipantGroup,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParticipantGroup {
    #[serde(rename = "@id", default, deserialize_with = "trimmed")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "trimmed")]
    pub name: Option<String>,
    pub participants: Participants,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Participants {
    /// One `<participant>`, or none, is a list of one or none; TS's schema rejects both.
    #[serde(default)]
    pub participant: Vec<Participant>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Participant {
    #[serde(rename = "@id", default, deserialize_with = "trimmed")]
    pub id: Option<String>,
    #[serde(deserialize_with = "trimmed_string")]
    pub name: String,
    #[serde(deserialize_with = "trimmed_string")]
    pub email: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ccb::CcbError;
    use crate::ccb::records::testing::{assert_json_round_trip, decode};
    use crate::ccb::xml::decode_body;

    const TWO: &str = r#"<ccb_api>
  <request><parameters><argument value="group_participants" name="srv"/><argument value="3001" name="id"/></parameters></request>
  <response>
    <service>group_participants</service>
    <service_action>execute</service_action>
    <availability>public</availability>
    <groups count="2">
      <group id="3001">
        <name>Example Choir</name>
        <participants count="2">
          <participant id="1001">
            <name>Ada Example</name>
            <email>ada@example.com</email>
            <mobile_phone>555-0100</mobile_phone>
            <carrier id="0"></carrier>
            <status id="1">Member</status>
            <date_joined>2026-01-04</date_joined>
            <created>2026-01-04 10:00:00</created>
            <modified>2026-01-04 10:00:00</modified>
          </participant>
          <participant id="1002">
            <name>grace EXAMPLE</name>
            <email></email>
            <mobile_phone>5550102</mobile_phone>
          </participant>
        </participants>
      </group>
    </groups>
  </response>
</ccb_api>"#;

    fn participant(id: &str, name: &str, email: &str) -> Participant {
        Participant {
            id: Some(id.to_owned()),
            name: name.to_owned(),
            email: email.to_owned(),
        }
    }

    #[test]
    fn decodes_the_group_and_its_participants() {
        let answer: GroupParticipants = decode(TWO);
        assert_eq!(
            answer,
            GroupParticipants {
                groups: ParticipantGroups {
                    count: Some("2".to_owned()),
                    group: ParticipantGroup {
                        id: Some("3001".to_owned()),
                        name: Some("Example Choir".to_owned()),
                        participants: Participants {
                            participant: vec![
                                participant("1001", "Ada Example", "ada@example.com"),
                                participant("1002", "grace EXAMPLE", ""),
                            ],
                        },
                    },
                },
            }
        );
        assert_json_round_trip(&answer);
    }

    // Review Focus: a list with exactly one item, and an empty result set (TS rejects both).
    #[test]
    fn decodes_one_or_no_participants_as_a_list() {
        let one = TWO.replace(
            r#"<participant id="1002">
            <name>grace EXAMPLE</name>
            <email></email>
            <mobile_phone>5550102</mobile_phone>
          </participant>"#,
            "",
        );
        let answer: GroupParticipants = decode(&one);
        assert_eq!(
            answer.groups.group.participants.participant,
            [participant("1001", "Ada Example", "ada@example.com")]
        );

        let none: GroupParticipants = decode(
            r#"<ccb_api><response><groups count="0"><group id="3001"><name>Example Choir</name><participants count="0"/></group></groups></response></ccb_api>"#,
        );
        assert!(none.groups.group.participants.participant.is_empty());
        assert_eq!(none.groups.count.as_deref(), Some("0"));
    }

    #[test]
    fn rejects_what_ts_rejects_a_missing_group_or_participant_email() {
        for xml in [
            r#"<ccb_api><response><groups count="0"/></response></ccb_api>"#,
            r#"<ccb_api><response><groups count="1"><group id="3001"><name>Example Choir</name></group></groups></response></ccb_api>"#,
            r#"<ccb_api><response><groups count="1"><group id="3001"><participants><participant id="1001"><name>Ada Example</name></participant></participants></group></groups></response></ccb_api>"#,
        ] {
            assert!(
                matches!(
                    decode_body::<GroupParticipants>(xml.as_bytes()),
                    Err(CcbError::Decode(_))
                ),
                "{xml}"
            );
        }
    }
}
