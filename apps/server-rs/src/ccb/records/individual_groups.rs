//! `individual_groups` (`CCBRequestType.GET_USER_GROUPS_BY_ID`): `ResponseSchema` of
//! `packages/ccb/src/schemas/GroupById.ts`, keeping the group ids `getOnboardingProfileEffect`
//! (`apps/server/src/services/onboarding/userProvisioning.ts`) compares with the `ccbId` of the
//! CMS departments and ministries.

use serde::{Deserialize, Serialize};

use crate::ccb::xml::trimmed;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndividualGroups {
    pub individuals: Option<GroupsIndividuals>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupsIndividuals {
    /// A single individual, as TS's schema has it: a second `<individual>` is a decode error.
    pub individual: Option<GroupsIndividual>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupsIndividual {
    /// Required, as in TS.
    pub groups: MemberGroups,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberGroups {
    #[serde(rename = "@count", default, deserialize_with = "trimmed")]
    pub count: Option<String>,
    #[serde(default)]
    pub group: Vec<MemberGroup>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberGroup {
    pub group_id: Option<GroupId>,
}

/// `<group_id>`: its text, and the `type` attribute that some CCB id elements carry.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupId {
    #[serde(rename = "@type", default, deserialize_with = "trimmed")]
    pub kind: Option<String>,
    #[serde(rename = "$text", default, deserialize_with = "trimmed")]
    pub text: Option<String>,
}

impl MemberGroup {
    /// `Number(item.group_id)` in `userProvisioning.ts`. fast-xml-parser reads
    /// `<group_id>3001</group_id>` as the number 3001; an element with a `type` attribute becomes
    /// an object whose text the TS schema drops, and `Number` of it is `NaN`. `None` stands for
    /// `NaN`, which matches no `ccbId`.
    pub fn numeric_id(&self) -> Option<i64> {
        let id = self.group_id.as_ref()?;
        if id.kind.is_some() {
            return None;
        }
        id.text.as_deref()?.parse().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ccb::CcbError;
    use crate::ccb::records::testing::{assert_json_round_trip, decode};
    use crate::ccb::xml::decode_body;

    const GROUPS: &str = r#"<ccb_api>
  <response>
    <service>individual_groups</service>
    <service_action>execute</service_action>
    <availability>public</availability>
    <individuals count="1">
      <individual>
        <individual_id type="individual">1001</individual_id>
        <name_first>Ada</name_first>
        <name_last>Example</name_last>
        <full_name>Ada Example</full_name>
        <receive_email_from_church>1</receive_email_from_church>
        <groups count="3">
          <group>
            <group_id>3001</group_id>
            <name>Example Choir</name>
            <receive_email_from_group>1</receive_email_from_group>
            <receive_sms_from_group/>
            <notify_comments>1</notify_comments>
          </group>
          <group>
            <group_id> 3002 </group_id>
            <name>Example Ushers</name>
          </group>
          <group>
            <group_id type="groups">3003</group_id>
            <name>Example Greeters</name>
          </group>
        </groups>
      </individual>
    </individuals>
  </response>
</ccb_api>"#;

    fn groups(xml: &str) -> Vec<MemberGroup> {
        let answer: IndividualGroups = decode(xml);
        answer.individuals.unwrap().individual.unwrap().groups.group
    }

    #[test]
    fn reads_group_ids_the_way_number_reads_them() {
        let ids: Vec<_> = groups(GROUPS).iter().map(MemberGroup::numeric_id).collect();
        assert_eq!(ids, [Some(3001), Some(3002), None]);
    }

    #[test]
    fn keeps_each_group_id_element_and_round_trips_through_json() {
        let answer: IndividualGroups = decode(GROUPS);
        let group = answer
            .individuals
            .as_ref()
            .unwrap()
            .individual
            .as_ref()
            .unwrap();
        assert_eq!(group.groups.count.as_deref(), Some("3"));
        assert_eq!(
            group.groups.group[2].group_id,
            Some(GroupId {
                kind: Some("groups".to_owned()),
                text: Some("3003".to_owned()),
            })
        );
        assert_json_round_trip(&answer);
    }

    // Review Focus: a list with exactly one item (TS's schema rejects a lone <group>).
    #[test]
    fn decodes_a_single_group_as_a_one_item_list() {
        let one = r#"<ccb_api><response><individuals count="1"><individual><groups count="1"><group><group_id>3001</group_id></group></groups></individual></individuals></response></ccb_api>"#;
        let ids: Vec<_> = groups(one).iter().map(MemberGroup::numeric_id).collect();
        assert_eq!(ids, [Some(3001)]);
    }

    #[test]
    fn decodes_no_groups_and_an_empty_search_as_empty() {
        let none = r#"<ccb_api><response><individuals count="1"><individual><groups count="0"/></individual></individuals></response></ccb_api>"#;
        assert!(groups(none).is_empty());
        let empty: IndividualGroups =
            decode(r#"<ccb_api><response><individuals count="0"/></response></ccb_api>"#);
        assert_eq!(
            empty.individuals,
            Some(GroupsIndividuals { individual: None })
        );
    }

    #[test]
    fn rejects_what_ts_rejects_an_individual_without_groups_or_two_individuals() {
        for xml in [
            r#"<ccb_api><response><individuals count="1"><individual><name_first>Ada</name_first></individual></individuals></response></ccb_api>"#,
            r#"<ccb_api><response><individuals count="2"><individual><groups/></individual><individual><groups/></individual></individuals></response></ccb_api>"#,
        ] {
            assert!(
                matches!(
                    decode_body::<IndividualGroups>(xml.as_bytes()),
                    Err(CcbError::Decode(_))
                ),
                "{xml}"
            );
        }
    }
}
