//! Reads a CCB response body the way `parseCCBXmlResponse` (`packages/ccb/src/xml.ts`, on
//! fast-xml-parser) and the GET path of `fetchGet` (`packages/ccb/src/client.ts`) read it:
//!
//! - the body is UTF-8 with replacement characters and no byte-order mark (`response.text()`);
//! - bodies over 1 MiB are rejected;
//! - only the five XML entities are decoded: numeric references (`&#233;`) and other named
//!   entities (`&nbsp;`) stay as written, and a `&` that starts no reference is an error;
//! - text and attribute values are trimmed (`trimValues`); records apply [`trimmed`];
//! - a document without `<response>`, or with an empty one, is [`CcbError::EmptyResponse`];
//! - `<errors>` or `<error>` inside `<response>` is [`CcbError::Remote`]. This is the parity
//!   spec's rule: TS's GET path never looks for it, so there a search or giving answer decodes
//!   as empty and the other services fail schema validation.
//!
//! One element and a list are the same to quick-xml: a `Vec` field takes one or many.

use std::borrow::Cow;
use std::collections::BTreeMap;

use quick_xml::DeError;
use quick_xml::escape::EscapeError;
use serde::de::{DeserializeOwned, IgnoredAny};
use serde::{Deserialize, Deserializer};

use super::CcbError;

/// `MAX_XML_SIZE_BYTES`.
pub const MAX_XML_BYTES: usize = 1_048_576;

/// The entities fast-xml-parser decodes.
const XML_ENTITIES: [&str; 5] = ["lt", "gt", "amp", "apos", "quot"];

/// The most bytes a reference may span between its `&` and its `;`.
const MAX_REFERENCE_BYTES: usize = 64;

/// Decodes `<ccb_api><response>` of `bytes` as `T`.
pub fn decode_body<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, CcbError> {
    let text = String::from_utf8_lossy(bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    if text.len() > MAX_XML_BYTES {
        return Err(CcbError::Decode(format!(
            "XML response too large: {} bytes (max: {MAX_XML_BYTES})",
            text.len()
        )));
    }
    let text = keep_unknown_entities(text);

    let skeleton: Skeleton = from_str(&text)?;
    let Some(children) = skeleton.response.filter(|children| !children.is_empty()) else {
        return Err(CcbError::EmptyResponse);
    };
    if children.contains_key("errors") || children.contains_key("error") {
        let document: ErrorDocument = from_str(&text)?;
        return Err(CcbError::Remote {
            message: document.response.message(),
        });
    }
    let document: Document<T> = from_str(&text)?;
    Ok(document.response)
}

fn from_str<T: DeserializeOwned>(text: &str) -> Result<T, CcbError> {
    quick_xml::de::from_str(text).map_err(|error| CcbError::Decode(describe(&error)))
}

/// Describes a quick-xml or serde error without text of the body, which holds names and emails
/// and whose errors are logged. A message keeps the kind of problem, byte ranges, field names
/// from our own types and element names, and loses the values quoted from the document:
///
/// - quick-xml names the text of an unrecognized entity (`&` up to the next `;`), however long;
/// - serde quotes the rejected value, in double quotes or backticks (`invalid type: string "x"`,
///   `unknown variant `x``).
fn describe(error: &DeError) -> String {
    match error {
        DeError::InvalidXml(quick_xml::Error::Escape(error)) => match error {
            EscapeError::UnrecognizedEntity(range, _) => {
                format!("unrecognized entity at {range:?}")
            }
            // Its codepoint is a number from the document.
            EscapeError::InvalidCharRef(_) => "invalid character reference".to_owned(),
            other => other.to_string(),
        },
        DeError::Custom(message) => redact_quoted(message),
        other => other.to_string(),
    }
}

/// Replaces everything from the first to the last `"` or backtick of a serde message with `…`:
/// the rejected value sits between the two, whatever quotes it holds itself, and serde's own text
/// around it holds none of the document. A "missing field" or "duplicate field" message names a
/// field of ours and stays whole.
fn redact_quoted(message: &str) -> String {
    let names_a_field = ["missing field `", "duplicate field `"]
        .iter()
        .any(|prefix| {
            message
                .strip_prefix(prefix)
                .and_then(|name| name.strip_suffix('`'))
                .is_some_and(|name| !name.contains(['"', '`']))
        });
    let quote = |c: char| c == '"' || c == '`';
    match (message.find(quote), message.rfind(quote)) {
        (Some(first), Some(last)) if !names_a_field => {
            // A lone quote has no end: drop what follows it.
            let after = if last > first {
                &message[last + 1..]
            } else {
                ""
            };
            format!("{}…{after}", &message[..first])
        }
        _ => message.to_owned(),
    }
}

/// `trimValues` for an optional text or attribute value.
pub fn trimmed<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Ok(Option::<String>::deserialize(deserializer)?.map(|value| value.trim().to_owned()))
}

/// `trimValues` for a required text or attribute value.
pub fn trimmed_string<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    Ok(String::deserialize(deserializer)?.trim().to_owned())
}

/// The root element's `<response>`, as its children's names (attributes as `@name`).
#[derive(Deserialize)]
struct Skeleton {
    response: Option<BTreeMap<String, IgnoredAny>>,
}

#[derive(Deserialize)]
struct Document<T> {
    response: T,
}

#[derive(Deserialize)]
struct ErrorDocument {
    response: ErrorResponse,
}

#[derive(Deserialize)]
struct ErrorResponse {
    errors: Option<ErrorList>,
    error: Option<RemoteError>,
}

#[derive(Deserialize)]
struct ErrorList {
    #[serde(default)]
    error: Vec<RemoteError>,
}

#[derive(Deserialize)]
struct RemoteError {
    #[serde(rename = "$text", default, deserialize_with = "trimmed")]
    text: Option<String>,
}

impl ErrorResponse {
    /// `errors.error.text ?? error.text ?? "CCB returned an error"` (`fetchPost`), reading the
    /// first of several `<error>` elements.
    fn message(self) -> String {
        let listed = self
            .errors
            .and_then(|errors| errors.error.into_iter().next())
            .and_then(|error| error.text);
        listed
            .or_else(|| self.error.and_then(|error| error.text))
            .filter(|message| !message.is_empty())
            .unwrap_or_else(|| "CCB returned an error".to_owned())
    }
}

/// Escapes the `&` of every reference fast-xml-parser leaves as written (numeric ones and names
/// other than the five XML entities), so quick-xml decodes `&amp;…;` back to the original text.
/// CDATA sections are copied unchanged, and a `&` that starts no reference is left for quick-xml
/// to reject, as fast-xml-parser's validator rejects it.
///
/// The `;` is looked for within [`MAX_REFERENCE_BYTES`] of the `&`, so the scan stays linear in
/// the body however many `&` it holds. A reference longer than that is rejected (quick-xml
/// decodes only a zero-padded numeric one): this is a deliberate limit, because fast-xml-parser's
/// validator does not bound numeric references.
fn keep_unknown_entities(text: &str) -> Cow<'_, str> {
    if !text.contains('&') {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len() + 32);
    let mut rest = text;
    while let Some(index) = rest.find(['&', '<']) {
        let (before, from) = rest.split_at(index);
        out.push_str(before);
        if let Some(cdata) = from.strip_prefix("<![CDATA[") {
            let end = cdata.find("]]>").map_or(cdata.len(), |end| end + 3);
            out.push_str("<![CDATA[");
            out.push_str(&cdata[..end]);
            rest = &cdata[end..];
        } else if let Some(after) = from.strip_prefix('<') {
            out.push('<');
            rest = after;
        } else {
            let after = &from[1..];
            // `;` is ASCII, so the byte it is found at is a character boundary.
            let end = after
                .bytes()
                .take(MAX_REFERENCE_BYTES + 1)
                .position(|byte| byte == b';');
            let escape = end.is_some_and(|end| {
                let name = &after[..end];
                !XML_ENTITIES.contains(&name) && is_reference(name)
            });
            out.push_str(if escape { "&amp;" } else { "&" });
            rest = after;
        }
    }
    out.push_str(rest);
    Cow::Owned(out)
}

/// What fast-xml-parser's validator accepts between `&` and `;`: `#` and digits, `#x` and hex
/// digits, or up to 20 word characters, each at most [`MAX_REFERENCE_BYTES`] long.
fn is_reference(name: &str) -> bool {
    if name.len() > MAX_REFERENCE_BYTES {
        return false;
    }
    match name.strip_prefix('#') {
        Some(number) => match number.strip_prefix('x') {
            Some(hex) => !hex.is_empty() && hex.chars().all(|c| c.is_ascii_hexdigit()),
            None => !number.is_empty() && number.chars().all(|c| c.is_ascii_digit()),
        },
        None => {
            (1..=20).contains(&name.len())
                && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq, Deserialize)]
    struct Sample {
        #[serde(default, deserialize_with = "trimmed")]
        note: Option<String>,
        item: Option<Item>,
    }

    #[derive(Debug, PartialEq, Deserialize)]
    struct Item {
        #[serde(rename = "@id", default, deserialize_with = "trimmed")]
        id: Option<String>,
        #[serde(rename = "$text", default, deserialize_with = "trimmed")]
        text: Option<String>,
    }

    fn decode(xml: &str) -> Result<Sample, CcbError> {
        decode_body(xml.as_bytes())
    }

    fn sample(note: &str) -> Sample {
        Sample {
            note: Some(note.to_owned()),
            item: None,
        }
    }

    #[test]
    fn decodes_the_response_element_and_trims_values() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<ccb_api>
  <request><parameters><argument value="example" name="srv"/></parameters></request>
  <response>
    <note>  Faith &amp; works  </note>
    <item id=" 7 ">  Example item  </item>
  </response>
</ccb_api>"#;
        assert_eq!(
            decode(xml),
            Ok(Sample {
                note: Some("Faith & works".to_owned()),
                item: Some(Item {
                    id: Some("7".to_owned()),
                    text: Some("Example item".to_owned()),
                }),
            })
        );
    }

    #[test]
    fn keeps_numeric_and_unknown_entities_as_written() {
        let xml = r#"<ccb_api><response><note>A&nbsp;B &#233; &#x41; &lt;b&gt; &quot;q&apos;</note><item id="x&nbsp;&amp;y">t</item></response></ccb_api>"#;
        assert_eq!(
            decode(xml),
            Ok(Sample {
                note: Some(r#"A&nbsp;B &#233; &#x41; <b> "q'"#.to_owned()),
                item: Some(Item {
                    id: Some("x&nbsp;&y".to_owned()),
                    text: Some("t".to_owned()),
                }),
            })
        );
    }

    #[derive(Debug, PartialEq, Deserialize)]
    struct Named {
        #[serde(deserialize_with = "trimmed_string")]
        name: String,
    }

    #[test]
    fn trims_required_values_and_rejects_their_absence() {
        assert_eq!(
            decode_body::<Named>(
                b"<ccb_api><response><name>  Ada Example </name></response></ccb_api>"
            ),
            Ok(Named {
                name: "Ada Example".to_owned()
            })
        );
        assert!(matches!(
            decode_body::<Named>(b"<ccb_api><response><other/></response></ccb_api>"),
            Err(CcbError::Decode(_))
        ));
    }

    #[test]
    fn copies_cdata_unchanged() {
        assert_eq!(
            decode(
                "<ccb_api><response><note><![CDATA[&nbsp; &amp; <b>]]></note></response></ccb_api>"
            ),
            Ok(sample("&nbsp; &amp; <b>"))
        );
    }

    #[test]
    fn rejects_bodies_that_are_not_well_formed_xml() {
        for body in [
            "",
            "Service Unavailable",
            "<ccb_api><response><note>A & B</note></response></ccb_api>",
            "<ccb_api><response><note>&#233</note></response></ccb_api>",
            "<ccb_api><response><note>open</response></ccb_api>",
            r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>Down</title></head><body>Maintenance</body></html>"#,
        ] {
            assert!(
                matches!(decode(body), Err(CcbError::Decode(_))),
                "{body:?} gave {:?}",
                decode(body)
            );
        }
    }

    // Review Focus: CCB answers "no attendance yet" without a <response> element.
    #[test]
    fn reports_a_missing_or_empty_response_as_empty() {
        for body in [
            r#"<ccb_api><request/><messages count="1"><message>No attendance recorded</message></messages></ccb_api>"#,
            "<ccb_api><response/></ccb_api>",
            "<ccb_api><response>  </response></ccb_api>",
            "<html><body><p>Down for maintenance</p></body></html>",
        ] {
            assert_eq!(decode(body), Err(CcbError::EmptyResponse), "{body:?}");
        }
    }

    // Review Focus: an <error> inside a 200 must not decode as an empty answer.
    #[test]
    fn turns_ccb_error_elements_into_remote_errors() {
        let cases = [
            (
                r#"<ccb_api><response><errors count="1"><error number="20" type="Service Permission"> Example permission error </error></errors></response></ccb_api>"#,
                "Example permission error",
            ),
            (
                r#"<ccb_api><response><errors count="2"><error number="1">First example</error><error number="2">Second example</error></errors></response></ccb_api>"#,
                "First example",
            ),
            (
                "<ccb_api><response><error>Lone example error</error></response></ccb_api>",
                "Lone example error",
            ),
            (
                r#"<ccb_api><response><errors count="1"><error number="3"/></errors></response></ccb_api>"#,
                "CCB returned an error",
            ),
        ];
        for (body, message) in cases {
            assert_eq!(
                decode(body),
                Err(CcbError::Remote {
                    message: message.to_owned()
                }),
                "{body:?}"
            );
        }
    }

    #[test]
    fn rejects_bodies_over_1_mib() {
        let frame = "<ccb_api><response><note></note></response></ccb_api>";
        let fill = |extra: usize| {
            let padding = "x".repeat(MAX_XML_BYTES - frame.len() + extra);
            format!("<ccb_api><response><note>{padding}</note></response></ccb_api>")
        };
        assert!(decode(&fill(0)).is_ok());
        assert_eq!(
            decode(&fill(1)),
            Err(CcbError::Decode(
                "XML response too large: 1048577 bytes (max: 1048576)".to_owned()
            ))
        );
    }

    #[test]
    fn reads_non_utf8_bytes_as_replacement_characters_and_drops_a_bom() {
        let mut body = "\u{feff}<ccb_api><response><note>caf".as_bytes().to_vec();
        body.push(0xE9);
        body.extend_from_slice(b"</note></response></ccb_api>");
        assert_eq!(decode_body::<Sample>(&body), Ok(sample("caf\u{fffd}")));
    }

    // A body of `&` with no `;` once cost a scan to the end of the body per `&`: quadratic.
    #[test]
    fn decodes_a_body_of_unterminated_ampersands_in_linear_time() {
        let frame = "<ccb_api><response><note></note></response></ccb_api>";
        let padding = "&".repeat(MAX_XML_BYTES - frame.len());
        let body = format!("<ccb_api><response><note>{padding}</note></response></ccb_api>");
        assert_eq!(body.len(), MAX_XML_BYTES);
        assert!(matches!(decode(&body), Err(CcbError::Decode(_))));
    }

    #[test]
    fn keeps_numeric_references_up_to_the_bound_and_rejects_longer_ones() {
        // The longest accepted reference is `MAX_REFERENCE_BYTES` between `&` and `;`: `#` and
        // 63 digits, or `#x` and 62 hex digits.
        let digits = "1".repeat(MAX_REFERENCE_BYTES - 1);
        let hex = "A".repeat(MAX_REFERENCE_BYTES - 2);
        let note = |reference: &str| {
            format!("<ccb_api><response><note>{reference}</note></response></ccb_api>")
        };
        assert_eq!(
            decode(&note(&format!("&#{digits};"))),
            Ok(sample(&format!("&#{digits};")))
        );
        assert_eq!(
            decode(&note(&format!("&#x{hex};"))),
            Ok(sample(&format!("&#x{hex};")))
        );
        for reference in [format!("&#1{digits};"), format!("&#xA{hex};")] {
            assert!(
                matches!(decode(&note(&reference)), Err(CcbError::Decode(_))),
                "{reference} gave {:?}",
                decode(&note(&reference))
            );
        }
    }

    #[test]
    fn scans_for_the_semicolon_without_splitting_multibyte_characters() {
        // 65 two-byte characters put the end of the 65-byte window inside the 33rd.
        let accented = "é".repeat(65);
        for body in [
            format!("<ccb_api><response><note>&{accented};</note></response></ccb_api>"),
            format!("<ccb_api><response><note>&{accented}</note></response></ccb_api>"),
        ] {
            assert!(matches!(decode(&body), Err(CcbError::Decode(_))));
        }
    }

    // The messages end up in logs, and the body holds names and emails: a decode error describes
    // the problem without quoting any of it.
    fn decode_message<T: DeserializeOwned + std::fmt::Debug>(body: &str) -> String {
        match decode_body::<T>(body.as_bytes()) {
            Err(CcbError::Decode(message)) => message,
            other => panic!("{body:?} gave {other:?}"),
        }
    }

    #[test]
    fn keeps_body_text_out_of_entity_errors() {
        let named =
            |name: &str| format!("<ccb_api><response><name>{name}</name></response></ccb_api>");
        let check = |message: String, private: [&str; 2]| {
            assert!(message.contains("unrecognized entity at "), "{message}");
            for text in private {
                assert!(!message.contains(text), "{message}");
            }
        };
        check(
            decode_message::<Named>(&named("Ada & Grace Example; ada@example.com")),
            ["Grace", "ada@example.com"],
        );
        check(
            decode_message::<Named>(&named("Ada & ada@example.com; Example")),
            ["ada@example.com", "Example"],
        );
        check(
            decode_message::<Sample>(
                r#"<ccb_api><response><item id="a&b ada@example.com;">t</item></response></ccb_api>"#,
            ),
            ["ada@example.com", "b "],
        );
        // A reference past the length bound reaches quick-xml as written.
        let zeros = "0".repeat(70);
        assert_eq!(
            decode_message::<Named>(&named(&format!("&#{zeros}1114112;"))),
            "invalid character reference"
        );
    }

    #[test]
    fn keeps_rejected_values_out_of_serde_errors() {
        #[derive(Debug, Deserialize)]
        struct Count {
            #[allow(dead_code)]
            n: u8,
        }
        #[derive(Debug, Deserialize)]
        enum Kind {
            #[allow(dead_code)]
            Alpha,
        }
        #[derive(Debug, Deserialize)]
        struct Kinded {
            #[allow(dead_code)]
            kind: Kind,
        }
        let message = decode_message::<Count>(
            "<ccb_api><response><n>ada@example.com</n></response></ccb_api>",
        );
        assert!(message.starts_with("invalid type: string"), "{message}");
        assert!(message.ends_with("expected u8"), "{message}");
        assert!(!message.contains("ada@example.com"), "{message}");

        let message = decode_message::<Kinded>(
            "<ccb_api><response><kind>ada@example.com</kind></response></ccb_api>",
        );
        assert!(message.starts_with("unknown variant"), "{message}");
        assert!(!message.contains("ada@example.com"), "{message}");
    }

    #[test]
    fn names_the_field_of_a_missing_or_repeated_value() {
        assert_eq!(
            decode_message::<Named>("<ccb_api><response><other/></response></ccb_api>"),
            "missing field `name`"
        );
        assert_eq!(
            decode_message::<Sample>(
                "<ccb_api><response><note>a</note><note>b</note></response></ccb_api>"
            ),
            "duplicate field `note`"
        );
    }
}
