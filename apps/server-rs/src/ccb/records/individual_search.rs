//! `individual_search` (`CCBRequestType.SEARCH_USER_BY_EMAIL`): `ResponseSchema` of
//! `packages/ccb/src/schemas/RSP.ts`, keeping what `getOnboardingProfileEffect`
//! (`apps/server/src/services/onboarding/userProvisioning.ts`) reads: each individual's id,
//! names, login, email, family id and phones.

use serde::{Deserialize, Serialize};

use super::IdText;
use crate::ccb::xml::trimmed;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndividualSearch {
    pub individuals: Option<SearchIndividuals>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchIndividuals {
    #[serde(rename = "@count", default, deserialize_with = "trimmed")]
    pub count: Option<String>,
    /// One `<individual>` is a one-item list. TS keeps a lone individual as an object and uses
    /// it without checking `login`, but searches a list for `login == email`; callers branch on
    /// `len() == 1` to do the same.
    #[serde(default)]
    pub individual: Vec<SearchIndividual>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchIndividual {
    #[serde(rename = "@id", default, deserialize_with = "trimmed")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "trimmed")]
    pub first_name: Option<String>,
    #[serde(default, deserialize_with = "trimmed")]
    pub last_name: Option<String>,
    #[serde(default, deserialize_with = "trimmed")]
    pub login: Option<String>,
    #[serde(default, deserialize_with = "trimmed")]
    pub email: Option<String>,
    /// `family.id` is the CCB family id.
    pub family: Option<IdText>,
    pub phones: Option<Phones>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Phones {
    /// TS reads `phone[0].text`, the first phone's number.
    #[serde(default)]
    pub phone: Vec<Phone>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Phone {
    #[serde(rename = "@type", default, deserialize_with = "trimmed")]
    pub kind: Option<String>,
    /// `None` for an empty `<phone>`, to which fast-xml-parser gives no text.
    #[serde(rename = "$text", default, deserialize_with = "trimmed")]
    pub text: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ccb::records::testing::{assert_json_round_trip, decode};

    const ONE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<ccb_api>
  <request><parameters><argument value="individual_search" name="srv"/><argument value="ada@example.com" name="email"/></parameters></request>
  <response>
    <service>individual_search</service>
    <service_action>execute</service_action>
    <availability>public</availability>
    <individuals count="1">
      <individual id="1001">
        <giving_number>4242</giving_number>
        <campus id="1">Example Campus</campus>
        <family id="2001">The Example Family</family>
        <first_name>Ada</first_name>
        <last_name>Example</last_name>
        <middle_name></middle_name>
        <full_name>Ada Example</full_name>
        <login>ada@example.com</login>
        <email>ada@example.com</email>
        <phones>
          <phone type="contact">555-0100</phone>
          <phone type="home"></phone>
        </phones>
        <active>true</active>
      </individual>
    </individuals>
  </response>
</ccb_api>"#;

    fn text(value: &str) -> Option<String> {
        Some(value.to_owned())
    }

    fn ada() -> SearchIndividual {
        SearchIndividual {
            id: text("1001"),
            first_name: text("Ada"),
            last_name: text("Example"),
            login: text("ada@example.com"),
            email: text("ada@example.com"),
            family: Some(IdText {
                id: text("2001"),
                text: text("The Example Family"),
            }),
            phones: Some(Phones {
                phone: vec![
                    Phone {
                        kind: text("contact"),
                        text: text("555-0100"),
                    },
                    Phone {
                        kind: text("home"),
                        text: None,
                    },
                ],
            }),
        }
    }

    #[test]
    fn decodes_one_individual_as_a_one_item_list() {
        let search: IndividualSearch = decode(ONE);
        assert_eq!(
            search,
            IndividualSearch {
                individuals: Some(SearchIndividuals {
                    count: text("1"),
                    individual: vec![ada()],
                }),
            }
        );
        assert_json_round_trip(&search);
    }

    #[test]
    fn decodes_several_individuals_in_order() {
        let grace = r#"<individual id="1002"><family id="2001">The Example Family</family><first_name>Grace</first_name><last_name>Example</last_name><login>grace@example.com</login><email>ada@example.com</email></individual>"#;
        let xml = ONE
            .replace(r#"count="1""#, r#"count="2""#)
            .replace("</individual>", &format!("</individual>{grace}"));
        let search: IndividualSearch = decode(&xml);
        let individuals = search.individuals.unwrap().individual;
        let logins: Vec<_> = individuals.iter().map(|i| i.login.as_deref()).collect();
        assert_eq!(logins, [Some("ada@example.com"), Some("grace@example.com")]);
        assert_eq!(individuals[1].phones, None);
    }

    #[test]
    fn decodes_no_individuals_as_an_empty_list() {
        let search: IndividualSearch = decode(
            r#"<ccb_api><response><service>individual_search</service><individuals count="0"></individuals></response></ccb_api>"#,
        );
        assert_eq!(
            search.individuals,
            Some(SearchIndividuals {
                count: text("0"),
                individual: Vec::new(),
            })
        );
    }

    // Review Focus: a list with exactly one item (TS's schema rejects a lone <phone>).
    #[test]
    fn decodes_a_single_phone_as_a_one_item_list() {
        let xml = ONE.replace(r#"<phone type="home"></phone>"#, "");
        let search: IndividualSearch = decode(&xml);
        let phones = search.individuals.unwrap().individual[0]
            .phones
            .clone()
            .unwrap();
        assert_eq!(
            phones.phone,
            [Phone {
                kind: text("contact"),
                text: text("555-0100"),
            }]
        );
    }
}
