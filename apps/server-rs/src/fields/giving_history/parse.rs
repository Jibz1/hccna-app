//! `parseGiving` (`apps/server/src/effect/services/giving/parseGiving.ts`): one year of a member's
//! gifts from their family's `transactions_by_family` answer.
//!
//! CCB's yearly window filters on modification date, so the answer also holds older gifts edited
//! during the year; only the member's own transactions dated in `year` are kept. Each transaction
//! detail is one gift, newest first.
//!
//! Dates are read like date-fns' `parseISO` on a server running in UTC, for the calendar-date forms
//! CCB writes: `yyyy-MM-dd`, optionally followed by `T` or a space and a time, with or without a
//! `Z` or `±hh:mm` offset (an offset moves the date to its UTC day). `parseISO`'s week, ordinal and
//! basic forms fail here, as an invalid date does in TS.

use chrono::{DateTime, NaiveDate, NaiveDateTime};
use serde::{Deserialize, Serialize};

use crate::ccb::records::{FamilyTransactions, TransactionDetail};

/// One gift (`UserGiving["giving"][number]`). `campus` and `campusId` are `""` when CCB has none,
/// as the giving service returns them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gift {
    pub amount: f64,
    /// `yyyy-MM-dd`.
    pub date: String,
    pub name: String,
    pub transaction_id: String,
    pub tax_deductible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payment_type: Option<String>,
    pub campus: String,
    pub campus_id: String,
}

/// Where TS's `parseGiving` throws; the giving service reports it as invalid CCB data.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ParseGivingError {
    /// `format(parseISO(date))` on a date that does not parse (`RangeError: Invalid time value`).
    #[error("Invalid transaction date in giving data")]
    InvalidDate,
    /// `Invalid amount in giving transaction`.
    #[error("Invalid amount in giving transaction")]
    InvalidAmount,
    /// `DetailSchema` rejecting a `tax_deductible` other than `true` or `false`.
    #[error("Invalid tax_deductible in giving transaction")]
    InvalidTaxDeductible,
}

/// `parseGiving(givingData, ccbId, year).giving`.
pub fn parse_giving(
    answer: &FamilyTransactions,
    ccb_id: &str,
    year: i32,
) -> Result<Vec<Gift>, ParseGivingError> {
    let year_prefix = format!("{year}-");
    let mut giving = Vec::new();
    let transactions = answer
        .transactions
        .as_ref()
        .map(|transactions| transactions.transaction.as_slice())
        .unwrap_or_default();
    for transaction in transactions {
        let individual_id = transaction
            .individual
            .as_ref()
            .and_then(|individual| individual.id.as_deref());
        if individual_id != Some(ccb_id) {
            continue;
        }
        let date = calendar_date(&transaction.date)?;
        if !date.starts_with(&year_prefix) {
            continue;
        }
        let campus = transaction.campus.as_ref();
        let details = transaction
            .transaction_details
            .as_ref()
            .map(|details| details.transaction_detail.as_slice())
            .unwrap_or_default();
        for detail in details {
            giving.push(Gift {
                amount: detail
                    .amount_value()
                    .ok_or(ParseGivingError::InvalidAmount)?,
                date: date.clone(),
                name: non_empty(detail.coa.as_ref().and_then(|coa| coa.text.as_deref()))
                    .unwrap_or("Giving")
                    .to_owned(),
                transaction_id: non_empty(detail.id.as_deref()).unwrap_or("N/A").to_owned(),
                tax_deductible: tax_deductible(detail)?,
                payment_type: transaction.payment_type.clone(),
                campus: campus
                    .and_then(|campus| campus.text.clone())
                    .unwrap_or_default(),
                campus_id: campus
                    .and_then(|campus| campus.id.clone())
                    .unwrap_or_default(),
            });
        }
    }
    // `toSorted((a, b) => b.date.localeCompare(a.date))`: stable, newest first.
    giving.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(giving)
}

/// `value || fallback`: an empty string falls back.
fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.is_empty())
}

/// `normalizeTaxDeductible`: absent is `true`.
fn tax_deductible(detail: &TransactionDetail) -> Result<bool, ParseGivingError> {
    match detail.tax_deductible.as_deref() {
        None | Some("true") => Ok(true),
        Some("false") => Ok(false),
        Some(_) => Err(ParseGivingError::InvalidTaxDeductible),
    }
}

/// `format(parseISO(value), "yyyy-MM-dd")` in UTC.
fn calendar_date(value: &str) -> Result<String, ParseGivingError> {
    let bytes = value.as_bytes();
    let shaped = bytes.len() >= 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[..10]
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit());
    if !shaped {
        return Err(ParseGivingError::InvalidDate);
    }
    let date = NaiveDate::parse_from_str(&value[..10], "%Y-%m-%d")
        .map_err(|_| ParseGivingError::InvalidDate)?;
    if bytes.len() == 10 {
        return Ok(date.format("%Y-%m-%d").to_string());
    }
    if !matches!(bytes[10], b'T' | b' ') {
        return Err(ParseGivingError::InvalidDate);
    }
    let normalized = format!("{}T{}", &value[..10], &value[11..]);
    if let Ok(instant) = DateTime::parse_from_rfc3339(&normalized) {
        return Ok(instant.naive_utc().date().format("%Y-%m-%d").to_string());
    }
    ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M"]
        .iter()
        .find_map(|format| NaiveDateTime::parse_from_str(&normalized, format).ok())
        .map(|local| local.date().format("%Y-%m-%d").to_string())
        .ok_or(ParseGivingError::InvalidDate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ccb::records::testing::decode;

    /// A family answer: Ada (1001) and Grace (1002) Example.
    const FAMILY: &str = r#"<ccb_api><response><transactions count="4">
      <transaction id="9001">
        <campus id="1">Example Campus</campus>
        <individual id="1001">Ada Example</individual>
        <date>2026-01-04</date>
        <payment_type>Credit Card</payment_type>
        <transaction_details>
          <transaction_detail id="5001"><coa id="7">General Fund</coa><amount>50.00</amount><tax_deductible>true</tax_deductible></transaction_detail>
          <transaction_detail id="5002"><coa id="8">Building Fund</coa><amount>25.50</amount><tax_deductible>false</tax_deductible></transaction_detail>
        </transaction_details>
      </transaction>
      <transaction id="9002">
        <campus id="1">Example Campus</campus>
        <individual id="1002">Grace Example</individual>
        <date>not a date</date>
        <transaction_details>
          <transaction_detail id="5003"><amount>1,000.00</amount></transaction_detail>
        </transaction_details>
      </transaction>
      <transaction id="9003">
        <individual id="1001">Ada Example</individual>
        <date>2025-12-28</date>
        <transaction_details>
          <transaction_detail id="5004"><coa id="7">General Fund</coa><amount>10</amount></transaction_detail>
        </transaction_details>
      </transaction>
      <transaction id="9004">
        <individual id="1001">Ada Example</individual>
        <date>2026-03-01</date>
        <transaction_details>
          <transaction_detail><amount>5</amount></transaction_detail>
        </transaction_details>
      </transaction>
    </transactions></response></ccb_api>"#;

    fn gift(amount: f64, date: &str, name: &str, id: &str) -> Gift {
        Gift {
            amount,
            date: date.to_owned(),
            name: name.to_owned(),
            transaction_id: id.to_owned(),
            tax_deductible: true,
            payment_type: None,
            campus: String::new(),
            campus_id: String::new(),
        }
    }

    #[test]
    fn keeps_the_members_gifts_dated_in_the_year_newest_first() {
        let answer: FamilyTransactions = decode(FAMILY);
        let giving = parse_giving(&answer, "1001", 2026).unwrap();
        let campus_gift = |amount, name: &str, id: &str, tax| Gift {
            tax_deductible: tax,
            payment_type: Some("Credit Card".to_owned()),
            campus: "Example Campus".to_owned(),
            campus_id: "1".to_owned(),
            ..gift(amount, "2026-01-04", name, id)
        };
        assert_eq!(
            giving,
            vec![
                // No `id` and no `coa`: `N/A` and `Giving`.
                gift(5.0, "2026-03-01", "Giving", "N/A"),
                campus_gift(50.0, "General Fund", "5001", true),
                campus_gift(25.5, "Building Fund", "5002", false),
            ]
        );
        // Grace's bad date and amount are never read; 2025's gift belongs to 2025.
        assert_eq!(
            parse_giving(&answer, "1001", 2025).unwrap(),
            vec![gift(10.0, "2025-12-28", "General Fund", "5004")]
        );
        assert_eq!(parse_giving(&answer, "1003", 2026).unwrap(), vec![]);
    }

    #[test]
    fn fails_where_parse_giving_throws() {
        let answer: FamilyTransactions = decode(FAMILY);
        assert_eq!(
            parse_giving(&answer, "1002", 2026),
            Err(ParseGivingError::InvalidDate)
        );
        let bad = |detail: &str| -> FamilyTransactions {
            decode(&format!(
                r#"<ccb_api><response><transactions count="1"><transaction id="1"><individual id="1001">Ada Example</individual><date>2026-01-04</date><transaction_details>{detail}</transaction_details></transaction></transactions></response></ccb_api>"#
            ))
        };
        assert_eq!(
            parse_giving(
                &bad("<transaction_detail><amount>1,000.00</amount></transaction_detail>"),
                "1001",
                2026
            ),
            Err(ParseGivingError::InvalidAmount)
        );
        assert_eq!(
            parse_giving(
                &bad("<transaction_detail><amount/></transaction_detail>"),
                "1001",
                2026
            ),
            Err(ParseGivingError::InvalidAmount)
        );
        assert_eq!(
            parse_giving(
                &bad(
                    "<transaction_detail><amount>5</amount><tax_deductible>yes</tax_deductible></transaction_detail>"
                ),
                "1001",
                2026
            ),
            Err(ParseGivingError::InvalidTaxDeductible)
        );
    }

    #[test]
    fn answers_no_transactions_with_no_gifts() {
        let answer: FamilyTransactions =
            decode(r#"<ccb_api><response><transactions count="0"/></response></ccb_api>"#);
        assert_eq!(parse_giving(&answer, "1001", 2026).unwrap(), vec![]);
        assert_eq!(
            parse_giving(&FamilyTransactions::default(), "1001", 2026).unwrap(),
            vec![]
        );
    }

    #[test]
    fn reads_dates_like_parse_iso_in_utc() {
        let cases = [
            ("2026-01-04", Some("2026-01-04")),
            ("2026-01-04T23:30:00", Some("2026-01-04")),
            ("2026-01-04 23:30", Some("2026-01-04")),
            ("2026-01-04T23:30:00.250", Some("2026-01-04")),
            ("2026-01-04T23:30:00Z", Some("2026-01-04")),
            ("2026-01-04T23:30:00-05:00", Some("2026-01-05")),
            ("2026-01-04T00:30:00+02:00", Some("2026-01-03")),
            ("2026-02-30", None),
            ("2026-1-4", None),
            ("20260104", None),
            ("2026-01-04X10:00", None),
            ("2026-01-04T25:00", None),
            ("", None),
        ];
        for (input, expected) in cases {
            assert_eq!(calendar_date(input).ok().as_deref(), expected, "{input:?}");
        }
    }
}
