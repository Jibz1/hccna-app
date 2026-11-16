//! Text helpers shared by field resolvers.

/// `capitalizeText` (`apps/server/src/utils/capitalizeText.ts`): splits on single spaces, upper-
/// cases each word's first character and lower-cases the rest, and joins with single spaces.
///
/// JavaScript's `charAt(0)` is a UTF-16 code unit, so a word starting outside the Basic
/// Multilingual Plane keeps its first character unchanged; that is preserved here.
pub fn capitalize_text(text: &str) -> String {
    text.split(' ')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) if first.len_utf16() == 1 => {
                    let mut out: String = first.to_uppercase().collect();
                    out.push_str(&chars.as_str().to_lowercase());
                    out
                }
                Some(first) => {
                    let mut out = first.to_string();
                    out.push_str(&chars.as_str().to_lowercase());
                    out
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::capitalize_text;

    #[test]
    fn capitalizes_each_word() {
        assert_eq!(capitalize_text("youth GROUP signup"), "Youth Group Signup");
        assert_eq!(capitalize_text("ADA EXAMPLE"), "Ada Example");
        assert_eq!(capitalize_text("a"), "A");
        assert_eq!(capitalize_text(""), "");
    }

    #[test]
    fn keeps_every_space() {
        assert_eq!(capitalize_text("  two  spaces "), "  Two  Spaces ");
        // Only spaces separate words, as in `split(" ")`.
        assert_eq!(capitalize_text("tab\tSEPARATED"), "Tab\tseparated");
    }

    #[test]
    fn follows_javascript_case_mapping() {
        assert_eq!(capitalize_text("éLAN vital"), "Élan Vital");
        assert_eq!(capitalize_text("ßtraße"), "SStraße");
        assert_eq!(capitalize_text("ΟΔΟΣ"), "Οδος");
        assert_eq!(capitalize_text("1st PLACE"), "1st Place");
        // A first character outside the BMP is left as is; the rest is lower-cased.
        assert_eq!(capitalize_text("\u{10428}BC"), "\u{10428}bc");
    }
}
