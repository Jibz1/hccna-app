//! JavaScript semantics the ported TS code depends on: `JSON.stringify` output (key order and
//! number spelling), `String.prototype.trim` whitespace, truthiness and `??`. `serde_json` keeps
//! object keys in insertion order (`preserve_order`), the order `JSON.parse` gives them.

use serde_json::Value;

/// `JSON.stringify(value)` for a parsed JSON value.
pub fn stringify(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value);
    out
}

fn write_value(out: &mut String, value: &Value) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        // JavaScript holds every number as a double, so a large integer prints rounded.
        Value::Number(number) => match number.as_f64() {
            Some(x) if x.is_finite() => out.push_str(&number_to_string(x)),
            _ => out.push_str("null"),
        },
        Value::String(text) => write_string(out, text),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_value(out, item);
            }
            out.push(']');
        }
        Value::Object(map) => {
            // A JavaScript object lists its array-index keys first, in ascending order, then the
            // rest in insertion order.
            let mut indexed: Vec<(u32, &String, &Value)> = map
                .iter()
                .filter_map(|(key, value)| array_index(key).map(|index| (index, key, value)))
                .collect();
            indexed.sort_unstable_by_key(|(index, _, _)| *index);
            let named = map.iter().filter(|(key, _)| array_index(key).is_none());
            out.push('{');
            let entries = indexed
                .into_iter()
                .map(|(_, key, value)| (key, value))
                .chain(named);
            for (position, (key, value)) in entries.enumerate() {
                if position > 0 {
                    out.push(',');
                }
                write_string(out, key);
                out.push(':');
                write_value(out, value);
            }
            out.push('}');
        }
    }
}

/// `JSON.stringify` escapes `"`, `\\` and control characters exactly as `serde_json` does.
fn write_string(out: &mut String, text: &str) {
    match serde_json::to_string(text) {
        Ok(quoted) => out.push_str(&quoted),
        // Serializing a `str` cannot fail; keep the output well-formed regardless.
        Err(_) => out.push_str("\"\""),
    }
}

/// The key as an array index (a canonical integer below 2^32 - 1), if it is one.
fn array_index(key: &str) -> Option<u32> {
    let canonical = key == "0" || (!key.starts_with('0') && !key.is_empty());
    if !canonical || !key.bytes().all(|byte| byte.is_ascii_digit()) || key.len() > 10 {
        return None;
    }
    key.parse::<u32>().ok().filter(|index| *index < u32::MAX)
}

/// `Number.prototype.toString()` (radix 10) for a finite number.
pub fn number_to_string(x: f64) -> String {
    if x == 0.0 {
        return "0".to_owned();
    }
    if x < 0.0 {
        return format!("-{}", number_to_string(-x));
    }
    // Rust's `{:e}` prints the shortest digits that round-trip, as ECMAScript requires: `d.ddde±x`.
    let scientific = format!("{x:e}");
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let k = digits.len() as i64;
    // x = digits × 10^(n - k)
    let n = exponent.parse::<i64>().unwrap_or(0) + 1;
    if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        let (whole, fraction) = digits.split_at(n as usize);
        format!("{whole}.{fraction}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let sign = if n > 0 { '+' } else { '-' };
        let (first, rest) = digits.split_at(1);
        let point = if rest.is_empty() { "" } else { "." };
        format!("{first}{point}{rest}e{sign}{}", (n - 1).abs())
    }
}

/// `String.prototype.trim`'s whitespace: ECMAScript WhiteSpace and LineTerminator.
pub fn is_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// `String.prototype.trim()`.
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_whitespace)
}

/// `Boolean(value)` for a JSON value, where a missing key is `undefined`.
pub fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

/// `value ?? fallback` for a JSON value, where a missing key is `undefined`.
pub fn coalesce<'a>(value: Option<&'a Value>, fallback: Option<&'a Value>) -> Option<&'a Value> {
    match value {
        None | Some(Value::Null) => fallback,
        present => present,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse(text: &str) -> Value {
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn stringifies_like_json_stringify() {
        // Expected strings come from running JSON.stringify(JSON.parse(input)) in Bun.
        let cases = [
            (
                r#"{"b":1,"a":[true,false,null],"c":{}}"#,
                r#"{"b":1,"a":[true,false,null],"c":{}}"#,
            ),
            (
                r#"{"x":1,"10":"ten","2":"two","01":"z","4294967294":"max","4294967295":"over"}"#,
                r#"{"2":"two","10":"ten","4294967294":"max","x":1,"01":"z","4294967295":"over"}"#,
            ),
            (r#"{"a":1,"b":2,"a":3}"#, r#"{"a":3,"b":2}"#),
            (r#"[]"#, r#"[]"#),
            (
                r#""Tab\tQuote\" Slash\/ Back\\ \u0001 \u001f \u007f é   😀""#,
                "\"Tab\\tQuote\\\" Slash/ Back\\\\ \\u0001 \\u001f \u{7f} é \u{2028} 😀\"",
            ),
            ("\"\\b\\f\\n\\r\"", "\"\\b\\f\\n\\r\""),
        ];
        for (input, expected) in cases {
            assert_eq!(stringify(&parse(input)), expected, "{input}");
        }
    }

    #[test]
    fn spells_numbers_like_javascript() {
        let cases = [
            ("0", "0"),
            ("-0.0", "0"),
            ("1.0", "1"),
            ("100", "100"),
            ("-7", "-7"),
            ("0.1", "0.1"),
            ("1.5e-7", "1.5e-7"),
            ("1e-6", "0.000001"),
            ("1e-7", "1e-7"),
            ("123e-20", "1.23e-18"),
            ("1e21", "1e+21"),
            ("1e20", "100000000000000000000"),
            ("123456789012345678901234", "1.2345678901234569e+23"),
            ("12345678901234567890", "12345678901234567000"),
            ("9007199254740993", "9007199254740992"),
            ("1757537055329", "1757537055329"),
            ("0.000123", "0.000123"),
            ("123.456", "123.456"),
            ("5e-324", "5e-324"),
            ("1.7976931348623157e308", "1.7976931348623157e+308"),
            ("-2.5e+30", "-2.5e+30"),
        ];
        for (input, expected) in cases {
            assert_eq!(stringify(&parse(input)), expected, "{input}");
        }
        assert_eq!(number_to_string(2.0), "2");
    }

    #[test]
    fn trims_javascript_whitespace_only() {
        assert_eq!(trim("\u{feff}\u{a0}\t x \u{2028}\u{3000}\n"), "x");
        // U+0085 is Unicode White_Space but not ECMAScript whitespace.
        assert_eq!(trim("\u{85}x\u{85}"), "\u{85}x\u{85}");
        assert!(is_whitespace('\u{b}') && is_whitespace('\u{c}') && is_whitespace('\u{1680}'));
        assert!(!is_whitespace('\u{180e}') && !is_whitespace('\u{200b}'));
    }

    #[test]
    fn follows_javascript_truthiness() {
        let falsy = [json!(null), json!(false), json!(0), json!(0.0), json!("")];
        let truthy_values = [json!(true), json!(-1), json!("0"), json!([]), json!({})];
        assert!(!truthy(None));
        for value in &falsy {
            assert!(!truthy(Some(value)), "{value}");
        }
        for value in &truthy_values {
            assert!(truthy(Some(value)), "{value}");
        }
    }

    #[test]
    fn coalesces_null_and_missing() {
        let fallback = json!("f");
        assert_eq!(coalesce(None, Some(&fallback)), Some(&fallback));
        assert_eq!(
            coalesce(Some(&json!(null)), Some(&fallback)),
            Some(&fallback)
        );
        let zero = json!(0);
        assert_eq!(coalesce(Some(&zero), Some(&fallback)), Some(&zero));
    }
}
