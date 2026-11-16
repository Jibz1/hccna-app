//! `transactions_by_family` (`CCBRequestType.GET_GIVING`): `ResponseSchema` of
//! `packages/ccb/src/schemas/Givings.ts`, keeping what `parseGiving`
//! (`apps/server/src/effect/services/giving/parseGiving.ts`) reads. TS's schema leaves each
//! `transaction_detail` undecoded (`S.Any`), and `parseGiving` checks a detail only after keeping
//! the user's own transactions, so detail values stay as text here: a bad amount on another
//! family member's gift must not fail the answer. [`TransactionDetail::amount_value`] applies
//! `parseGiving`'s amount rule.

use serde::{Deserialize, Serialize};

use super::IdText;
use crate::ccb::xml::{trimmed, trimmed_string};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FamilyTransactions {
    pub transactions: Option<Transactions>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transactions {
    #[serde(rename = "@count", default, deserialize_with = "trimmed")]
    pub count: Option<String>,
    /// One `<transaction>` is a one-item list (TS accepts one or many and calls `toArray`).
    #[serde(default)]
    pub transaction: Vec<Transaction>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transaction {
    /// `parseGiving` keeps the transactions whose `individual.id` is the user's CCB id.
    pub individual: Option<IdText>,
    /// `campus.text` and `campus.id` become the gift's campus and campus id.
    pub campus: Option<IdText>,
    /// Required, as in TS; `parseGiving` reformats it as `yyyy-MM-dd`.
    #[serde(deserialize_with = "trimmed_string")]
    pub date: String,
    /// A plain element's text. TS reads an element with attributes as `undefined`.
    #[serde(default, deserialize_with = "trimmed")]
    pub payment_type: Option<String>,
    pub transaction_details: Option<TransactionDetails>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransactionDetails {
    /// One `<transaction_detail>` is a one-item list (TS calls `toArray`).
    #[serde(default)]
    pub transaction_detail: Vec<TransactionDetail>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransactionDetail {
    /// `detail.id || "N/A"` is the gift's transaction id.
    #[serde(rename = "@id", default, deserialize_with = "trimmed")]
    pub id: Option<String>,
    /// `coa.text || "Giving"` names the gift.
    pub coa: Option<IdText>,
    /// As written; see [`Self::amount_value`].
    #[serde(default, deserialize_with = "trimmed")]
    pub amount: Option<String>,
    /// As written. In `parseGiving`, absent is `true`, `true` and `false` are themselves, and
    /// anything else throws.
    #[serde(default, deserialize_with = "trimmed")]
    pub tax_deductible: Option<String>,
}

impl TransactionDetail {
    /// `Number(detail.amount)` as `parseGiving` checks it (fast-xml-parser has already turned
    /// numeric text into a number): `None` wherever TS throws, which is a missing or blank amount
    /// or text that is not a finite number, such as `1,000.00`.
    pub fn amount_value(&self) -> Option<f64> {
        let text = self.amount.as_deref().filter(|text| !text.is_empty())?;
        text.parse::<f64>().ok().filter(|amount| amount.is_finite())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ccb::CcbError;
    use crate::ccb::records::testing::{assert_json_round_trip, decode};
    use crate::ccb::xml::decode_body;

    const TWO: &str = r#"<ccb_api>
  <request><parameters><argument value="transactions_by_family" name="srv"/></parameters></request>
  <response>
    <service>transactions_by_family</service>
    <service_action>execute</service_action>
    <availability>public</availability>
    <transactions count="2">
      <transaction id="9001">
        <campus id="1">Example Campus</campus>
        <individual id="1001">Ada Example</individual>
        <date>2026-01-04</date>
        <grouping id="1">Online</grouping>
        <payment_type>Credit Card</payment_type>
        <check_number/>
        <transaction_details>
          <transaction_detail id="5001">
            <coa id="7">General Fund</coa>
            <amount>50.00</amount>
            <tax_deductible>true</tax_deductible>
            <note/>
          </transaction_detail>
          <transaction_detail id="5002">
            <coa id="8">Building Fund</coa>
            <amount>25.50</amount>
            <tax_deductible>false</tax_deductible>
          </transaction_detail>
        </transaction_details>
        <created>2026-01-04 10:00:00</created>
      </transaction>
      <transaction id="9002">
        <campus id="1">Example Campus</campus>
        <individual id="1002">Grace Example</individual>
        <date>2026-02-01</date>
        <payment_type>Check</payment_type>
        <transaction_details>
          <transaction_detail id="5003">
            <coa id="7">General Fund</coa>
            <amount>1,000.00</amount>
          </transaction_detail>
        </transaction_details>
      </transaction>
    </transactions>
  </response>
</ccb_api>"#;

    fn id_text(id: &str, text: &str) -> Option<IdText> {
        Some(IdText {
            id: Some(id.to_owned()),
            text: Some(text.to_owned()),
        })
    }

    fn detail(id: &str, coa: Option<IdText>, amount: &str, tax: Option<&str>) -> TransactionDetail {
        TransactionDetail {
            id: Some(id.to_owned()),
            coa,
            amount: Some(amount.to_owned()),
            tax_deductible: tax.map(str::to_owned),
        }
    }

    #[test]
    fn decodes_transactions_with_their_details_as_written() {
        let answer: FamilyTransactions = decode(TWO);
        let transactions = answer.transactions.clone().unwrap();
        assert_eq!(transactions.count.as_deref(), Some("2"));
        assert_eq!(
            transactions.transaction[0],
            Transaction {
                individual: id_text("1001", "Ada Example"),
                campus: id_text("1", "Example Campus"),
                date: "2026-01-04".to_owned(),
                payment_type: Some("Credit Card".to_owned()),
                transaction_details: Some(TransactionDetails {
                    transaction_detail: vec![
                        detail("5001", id_text("7", "General Fund"), "50.00", Some("true")),
                        detail(
                            "5002",
                            id_text("8", "Building Fund"),
                            "25.50",
                            Some("false")
                        ),
                    ],
                }),
            }
        );
        // A single detail is a one-item list, and its unparseable amount does not fail decoding.
        assert_eq!(
            transactions.transaction[1].transaction_details,
            Some(TransactionDetails {
                transaction_detail: vec![detail(
                    "5003",
                    id_text("7", "General Fund"),
                    "1,000.00",
                    None
                )],
            })
        );
        assert_json_round_trip(&answer);
    }

    #[test]
    fn reads_amounts_the_way_parse_giving_does() {
        let amount = |text: Option<&str>| TransactionDetail {
            amount: text.map(str::to_owned),
            ..TransactionDetail::default()
        };
        let cases = [
            (Some("50.00"), Some(50.0)),
            (Some("25.50"), Some(25.5)),
            (Some("1e3"), Some(1000.0)),
            (Some("-5"), Some(-5.0)),
            (Some("1,000.00"), None),
            (Some(""), None),
            (Some("Infinity"), None),
            (Some("NaN"), None),
            (None, None),
        ];
        for (text, expected) in cases {
            assert_eq!(amount(text).amount_value(), expected, "{text:?}");
        }
    }

    // Review Focus: an empty result set.
    #[test]
    fn decodes_no_transactions_as_an_empty_list() {
        let answer: FamilyTransactions =
            decode(r#"<ccb_api><response><transactions count="0"/></response></ccb_api>"#);
        assert_eq!(
            answer.transactions,
            Some(Transactions {
                count: Some("0".to_owned()),
                transaction: Vec::new(),
            })
        );
    }

    #[test]
    fn rejects_a_transaction_without_a_date_as_ts_does() {
        let xml = r#"<ccb_api><response><transactions count="1"><transaction id="9001"><individual id="1001">Ada Example</individual></transaction></transactions></response></ccb_api>"#;
        assert!(matches!(
            decode_body::<FamilyTransactions>(xml.as_bytes()),
            Err(CcbError::Decode(_))
        ));
    }
}
