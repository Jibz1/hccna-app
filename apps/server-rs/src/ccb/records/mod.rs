//! Typed CCB answers: each read service's `<response>`, nested like the TS schema the server
//! decodes it with (`packages/ccb/src/schemas/*`), keeping only the fields TS callers read. The
//! same structs serialize to JSON for the cache.
//!
//! Where TS and these records differ, the records accept more:
//! - one element where TS's schema demands an array (`S.Array`) is a one-item list here; TS
//!   rejects the whole answer;
//! - fields no TS caller reads are not decoded, so a value TS's schema rejects there (a
//!   digits-only `giving_number`, which fast-xml-parser turns into a number) does not fail here;
//! - text is always a string: fast-xml-parser turns digits-only text into a number, which a TS
//!   `S.String` field rejects.

pub mod attendance_profile;
pub mod group_participants;
pub mod individual_groups;
pub mod individual_search;
pub mod transactions;

use serde::{Deserialize, Serialize};

use crate::ccb::xml::trimmed;

pub use attendance_profile::{
    AttendanceEvent, AttendanceEvents, AttendanceProfile, Attendee, Attendees,
};
pub use group_participants::{
    GroupParticipants, Participant, ParticipantGroup, ParticipantGroups, Participants,
};
pub use individual_groups::{
    GroupId, GroupsIndividual, GroupsIndividuals, IndividualGroups, MemberGroup, MemberGroups,
};
pub use individual_search::{IndividualSearch, Phone, Phones, SearchIndividual, SearchIndividuals};
pub use transactions::{
    FamilyTransactions, Transaction, TransactionDetail, TransactionDetails, Transactions,
};

/// An element with an `id` attribute and text, such as
/// `<family id="2001">The Example Family</family>` (`IdTextSchema`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdText {
    #[serde(rename = "@id", default, deserialize_with = "trimmed")]
    pub id: Option<String>,
    #[serde(rename = "$text", default, deserialize_with = "trimmed")]
    pub text: Option<String>,
}

/// Test helpers: decode a fixture, and check the JSON round trip the cache relies on.
#[cfg(test)]
pub(crate) mod testing {
    use serde::Serialize;
    use serde::de::DeserializeOwned;
    use std::fmt::Debug;

    use crate::ccb::xml::decode_body;

    pub(crate) fn decode<T: DeserializeOwned>(xml: &str) -> T {
        decode_body(xml.as_bytes()).expect("the fixture decodes")
    }

    pub(crate) fn assert_json_round_trip<T>(value: &T)
    where
        T: Serialize + DeserializeOwned + PartialEq + Debug,
    {
        let json = serde_json::to_string(value).expect("records serialize");
        assert_eq!(
            &serde_json::from_str::<T>(&json).expect("records deserialize"),
            value
        );
    }
}
