//! A bracket-nesting bound on the query text, checked before the parser sees it.
//!
//! pest 2.9.3 checks the remaining stack and fails the parse cleanly when it runs low, so the
//! parse itself does not abort. The overflow came from async-graphql's recursive conversion of
//! the accepted document: it builds list and object values (field and directive arguments,
//! variable defaults) with one recursion per level and no depth limit. A value nested about
//! 1,400 levels deep (a 4 KB body) overflowed a 2 MiB worker stack inside `parse_query`, which
//! aborts the whole process. graphql-js throws a catchable `RangeError` instead, so the TS server
//! only fails that request. This linear scan rejects such documents before parsing.

/// The most `(`, `[` and `{` that may be open at once, counted together. Mobile operations open
/// far fewer, and the parser handles values this deep on a small stack; the overflow needs
/// over a thousand levels.
pub const MAX_BRACKET_NESTING: usize = 128;

/// Where the first bracket past the limit opens (1-based line and column, in characters).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TooDeep {
    pub line: usize,
    pub column: usize,
}

/// `Ok` unless more than `MAX_BRACKET_NESTING` brackets are open at some point.
///
/// The scan is a one-sided over-approximation of the parser's own nesting: it may count brackets
/// the parser would not (so it can reject a document the parser would accept), but for every
/// document `async_graphql::parser::parse_query` accepts it counts *at least* as deep as the parsed
/// value nests. That `scanner_depth >= parser_depth` guarantee, not an exact match with the grammar,
/// is what keeps the deep-value recursion out of `parse_query`, where it would overflow the stack.
///
/// Strings, block strings and comments are skipped so brackets inside them do not count. A closing
/// bracket with nothing open leaves the count at zero, so it cannot hide later nesting.
pub fn check(query: &str) -> Result<(), TooDeep> {
    match scan(query).too_deep {
        Some(at) => Err(at),
        None => Ok(()),
    }
}

/// What a scan of the query text found.
struct Scan {
    /// The most `(`/`[`/`{` open at once. Only the differential test reads this; `check` uses
    /// `too_deep`.
    #[cfg_attr(not(test), allow(dead_code))]
    max_depth: usize,
    /// Where the first bracket past `MAX_BRACKET_NESTING` opened (1-based line and column, in
    /// characters), if any did.
    too_deep: Option<TooDeep>,
}

/// One linear pass over the query bytes, counting `(`, `[` and `{` open at once and skipping the
/// three non-token spans the grammar (`async-graphql-parser`'s `graphql.pest`) lexes:
///
/// - `"…"` strings: `\` escapes the next character, and a raw line break ends the string (the
///   parser rejects such a document, so where the scan stops then does not matter);
/// - `"""…"""` block strings, but only when a closing `"""` actually follows. The grammar's
///   `string` rule is an ordered choice; when the block alternative finds no terminator it
///   backtracks and reads the opener as `""` (an empty string), after which the next quote starts
///   a plain string. The scan mirrors that: it skips the whole block string when it is terminated
///   and otherwise consumes only the first two quotes, so the rest (any brackets a bypass hid
///   behind an unterminated `"""`) is scanned exactly as the parser goes on to build it;
/// - `#` comments, up to a `\n` or `\r`.
fn scan(query: &str) -> Scan {
    let bytes = query.as_bytes();
    let mut depth = 0_usize;
    let mut max_depth = 0_usize;
    let mut too_deep = None;
    let mut line = 1;
    let mut column = 1;
    let mut i = 0;
    // Built once, the first time a `"""` needs its terminator, so documents without block strings
    // (every mobile operation) never pay for it.
    let mut terminators: Option<Terminators> = None;
    // Every byte the lexer cares about is ASCII, and UTF-8 continuation bytes never are, so
    // scanning bytes is exact; columns count characters (bytes that start one).
    let advance = |i: &mut usize, line: &mut usize, column: &mut usize| {
        match bytes[*i] {
            b'\n' => {
                *line += 1;
                *column = 1;
            }
            // `\r\n` and a lone `\r` both end a line.
            b'\r' => {
                if bytes.get(*i + 1) != Some(&b'\n') {
                    *line += 1;
                    *column = 1;
                }
            }
            byte if byte & 0xC0 != 0x80 => *column += 1,
            _ => {}
        }
        *i += 1;
    };
    while i < bytes.len() {
        match bytes[i] {
            b'(' | b'[' | b'{' => {
                depth += 1;
                max_depth = max_depth.max(depth);
                if depth > MAX_BRACKET_NESTING && too_deep.is_none() {
                    too_deep = Some(TooDeep { line, column });
                }
            }
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            // A comment runs to the end of the line.
            b'#' => {
                while i < bytes.len() && !matches!(bytes[i], b'\n' | b'\r') {
                    advance(&mut i, &mut line, &mut column);
                }
                continue;
            }
            b'"' if bytes[i..].starts_with(b"\"\"\"") => {
                // A `"""` only opens a block string when a closing `"""` follows (`\"""` is an
                // escaped delimiter, not a terminator). Otherwise the grammar backtracks and reads
                // the opener as `""`, so consume just those two quotes and keep scanning; the third
                // quote then begins a plain string, exactly as the parser reads it.
                let end = if bytes.len() <= Terminators::MAX_LEN {
                    terminators
                        .get_or_insert_with(|| Terminators::build(bytes))
                        .end_from(i + 3)
                } else {
                    block_string_end(bytes, i + 3)
                };
                match end {
                    Some(end) => {
                        while i < end {
                            advance(&mut i, &mut line, &mut column);
                        }
                    }
                    None => {
                        for _ in 0..2 {
                            advance(&mut i, &mut line, &mut column);
                        }
                    }
                }
                continue;
            }
            b'"' => {
                // A string: `\` escapes the next character; it cannot span lines, so a line
                // break ends it (the parser rejects such a document anyway).
                advance(&mut i, &mut line, &mut column);
                while i < bytes.len() {
                    match bytes[i] {
                        b'"' => {
                            advance(&mut i, &mut line, &mut column);
                            break;
                        }
                        b'\\' => {
                            advance(&mut i, &mut line, &mut column);
                            if i < bytes.len() {
                                advance(&mut i, &mut line, &mut column);
                            }
                        }
                        b'\n' | b'\r' => break,
                        _ => advance(&mut i, &mut line, &mut column),
                    }
                }
                continue;
            }
            _ => {}
        }
        advance(&mut i, &mut line, &mut column);
    }
    Scan {
        max_depth,
        too_deep,
    }
}

/// Where block-string content starting at each byte would end, so that every `"""` opener costs
/// O(1) instead of a search to the end of the document. Searching forward from each opener was
/// quadratic: `\"""` + newline repeated over a 2 MiB body opens about 400k block strings that never
/// terminate (each later `\"""` is an escape to the search), and each search ran to the end.
///
/// `table[i]` is the byte index just past the closing `"""` that the grammar's
/// `block_string_content` walk reaches when it starts at `i`, or `NO_TERMINATOR`. One backward
/// pass: a `"""` at `i` ends there; a `\"""` at `i` is an escaped delimiter, so the walk continues
/// at `i + 4`; anything else continues at `i + 1`; past the end there is no terminator. Note that a
/// failed walk from `p` does not imply a failed walk from every `q > p`, because escapes change
/// alignment — which is why each start needs its own entry. Scanning bytes is exact: a `"` or `\`
/// byte is always that ASCII character, never a UTF-8 continuation byte.
///
/// Entries are `u32`: the query arrives inside a body bounded by `http::GRAPHQL_BODY_LIMIT`
/// (2 MiB), and `scan` falls back to the plain walk for any longer text, so the indices fit.
struct Terminators(Vec<u32>);

const NO_TERMINATOR: u32 = u32::MAX;

impl Terminators {
    /// The longest text the table is built for; `scan` only reaches it for texts within the body
    /// limit, so this is a safety bound, not an expected path.
    const MAX_LEN: usize = (u32::MAX - 1) as usize;

    fn build(bytes: &[u8]) -> Self {
        let n = bytes.len();
        let mut table = vec![NO_TERMINATOR; n + 1];
        for i in (0..n).rev() {
            table[i] = if bytes[i..].starts_with(b"\"\"\"") {
                (i + 3) as u32
            } else if bytes[i..].starts_with(b"\\\"\"\"") {
                table[i + 4]
            } else {
                table[i + 1]
            };
        }
        Self(table)
    }

    /// The end of block-string content that starts at `start`, if it terminates.
    fn end_from(&self, start: usize) -> Option<usize> {
        match self.0[start] {
            NO_TERMINATOR => None,
            end => Some(end as usize),
        }
    }
}

/// The walk `Terminators` tabulates, for texts too long for the table.
fn block_string_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut i = start;
    while i < bytes.len() {
        if bytes[i..].starts_with(b"\\\"\"\"") {
            i += 4;
        } else if bytes[i..].starts_with(b"\"\"\"") {
            return Some(i + 3);
        } else {
            i += 1;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nested(levels: usize) -> String {
        format!("{}{}", "[".repeat(levels), "]".repeat(levels))
    }

    #[test]
    fn allows_exactly_the_limit() {
        assert_eq!(check(&nested(MAX_BRACKET_NESTING)), Ok(()));
        assert_eq!(
            check(&nested(MAX_BRACKET_NESTING + 1)),
            Err(TooDeep {
                line: 1,
                column: MAX_BRACKET_NESTING + 1
            })
        );
    }

    #[test]
    fn counts_all_three_bracket_kinds_together() {
        let query = format!("{}{}", "{(".repeat(64), "x");
        assert!(check(&query).is_ok());
        assert!(check(&format!("{query}[")).is_err());
    }

    #[test]
    fn skips_brackets_in_strings() {
        let deep = "[".repeat(500);
        assert_eq!(check(&format!(r#"query Q {{ a(s: "{deep}") }}"#)), Ok(()));
        // An escaped quote does not end the string.
        assert_eq!(check(&format!(r#"query Q {{ a(s: "\"{deep}") }}"#)), Ok(()));
        // An escaped backslash does, and what follows counts.
        assert!(check(&format!(r#"query Q {{ a(s: "\\" t: {deep}) }}"#)).is_err());
        // `""` is an empty string, not the start of a block string.
        assert!(check(&format!(r#"query Q {{ a(s: "" t: {deep}) }}"#)).is_err());
    }

    #[test]
    fn skips_brackets_in_block_strings() {
        let deep = "[".repeat(500);
        assert_eq!(
            check(&format!(r#"query Q {{ a(s: """{deep}""") }}"#)),
            Ok(())
        );
        // `\"""` is an escaped delimiter inside a block string.
        assert_eq!(
            check(&format!(r#"query Q {{ a(s: """ \""" {deep} """) }}"#)),
            Ok(())
        );
        // A single backslash before an escaped delimiter is just a character.
        assert_eq!(
            check(&format!(r#"query Q {{ a(s: """ \\""" {deep} """) }}"#)),
            Ok(())
        );
        // After the block string closes, brackets count again.
        assert!(check(&format!(r#"query Q {{ a(s: """x""" t: {deep}) }}"#)).is_err());
    }

    #[test]
    fn skips_brackets_in_comments() {
        let deep = "[".repeat(500);
        assert_eq!(check(&format!("query Q {{ # {deep}\n a }}")), Ok(()));
        assert_eq!(check(&format!("query Q {{ # {deep}\r a }}")), Ok(()));
        // A quote in a comment does not open a string.
        assert!(check(&format!("query Q {{ # \"\n a(t: {deep}) }}")).is_err());
        // A `#` in a string does not open a comment.
        assert!(check(&format!("query Q {{ a(s: \"#\" t: {deep}) }}")).is_err());
    }

    #[test]
    fn unbalanced_closers_cannot_hide_nesting() {
        let closers = "]".repeat(1000);
        let query = format!("{closers}{}", "[".repeat(MAX_BRACKET_NESTING + 1));
        assert_eq!(
            check(&query),
            Err(TooDeep {
                line: 1,
                column: 1000 + MAX_BRACKET_NESTING + 1
            })
        );
    }

    #[test]
    fn reports_lines_and_columns_in_characters() {
        let query = format!(
            "query Q {{\n  é: a(t: {}) }}",
            "[".repeat(MAX_BRACKET_NESTING)
        );
        // `{` opens level 1 and `(` level 2; the first `[` (column 11, `é` counting as one
        // character) is level 3, so the 127th, at column 137, is level 129.
        assert_eq!(
            check(&query),
            Err(TooDeep {
                line: 2,
                column: 10 + 127
            })
        );
    }

    #[test]
    fn scans_a_large_body_quickly() {
        let query = "[]".repeat(1_000_000);
        let start = std::time::Instant::now();
        assert_eq!(check(&query), Ok(()));
        // Generous for slow CI runners; a quadratic scan of this body takes minutes.
        assert!(start.elapsed() < std::time::Duration::from_secs(10));
    }

    #[test]
    fn scans_repeated_unterminated_openers_in_linear_time() {
        // Every `"""` opener needs to know where its terminator is. Searching forward from each
        // one was quadratic: `\"""` + newline repeated over 2 MiB opens about 400k block strings
        // that never terminate (each later `\"""` is an escape to the search), each search ran to
        // the end, and the request took hours before the cache lookup and auth. A terminator table
        // built once keeps the whole scan linear.
        let size = 2 * 1024 * 1024;
        for (name, unit) in [
            ("escaped opener", "\\\"\"\"\n"),
            ("bare opener", "\"\"\"\n"),
            ("four quotes", "\"\"\"\"\n"),
            ("opener then brackets", "\\\"\"\" [[ \n"),
        ] {
            let query = unit.repeat(size / unit.len());
            let start = std::time::Instant::now();
            let _ = check(&query);
            let elapsed = start.elapsed();
            eprintln!("{name}: {} bytes in {elapsed:?}", query.len());
            // ~0.15 s in a local debug build and minutes when quadratic; the bound leaves room for
            // slow CI runners.
            assert!(
                elapsed < std::time::Duration::from_secs(10),
                "{name} took {elapsed:?}"
            );
        }
    }

    // --- The scan must never under-count what the parser accepts (C2). ---

    use async_graphql::parser::parse_query;
    use async_graphql::parser::types::{
        BaseType, Directive, ExecutableDocument, FragmentDefinition, OperationDefinition,
        Selection, SelectionSet, Type, VariableDefinition,
    };
    use async_graphql::{Name, Positioned};
    // The parser's argument values are `async_graphql_value::Value` (variables allowed), distinct
    // from `async_graphql::Value`, which aliases `ConstValue` (the executor's resolved value).
    use async_graphql_value::{ConstValue, Value};

    /// The deepest bracket nesting a scan of `query` reaches.
    fn max_depth(query: &str) -> usize {
        scan(query).max_depth
    }

    fn value_depth(value: &Value) -> usize {
        match value {
            Value::List(items) => 1 + items.iter().map(value_depth).max().unwrap_or(0),
            Value::Object(fields) => 1 + fields.values().map(value_depth).max().unwrap_or(0),
            _ => 0,
        }
    }

    fn const_value_depth(value: &ConstValue) -> usize {
        match value {
            ConstValue::List(items) => 1 + items.iter().map(const_value_depth).max().unwrap_or(0),
            ConstValue::Object(fields) => {
                1 + fields.values().map(const_value_depth).max().unwrap_or(0)
            }
            _ => 0,
        }
    }

    /// Each `[` in a list type (`[[Int]]`) is a bracket the scan counts.
    fn type_depth(ty: &Type) -> usize {
        match &ty.base {
            BaseType::List(inner) => 1 + type_depth(inner),
            BaseType::Named(_) => 0,
        }
    }

    /// The `(` around an argument list plus the deepest argument value, or 0 with no arguments
    /// (the grammar never emits an empty `()`).
    fn arguments_depth(arguments: &[(Positioned<Name>, Positioned<Value>)]) -> usize {
        if arguments.is_empty() {
            0
        } else {
            1 + arguments
                .iter()
                .map(|(_, value)| value_depth(&value.node))
                .max()
                .unwrap_or(0)
        }
    }

    fn directives_depth(directives: &[Positioned<Directive>]) -> usize {
        directives
            .iter()
            .map(|directive| arguments_depth(&directive.node.arguments))
            .max()
            .unwrap_or(0)
    }

    fn selection_set_depth(set: &SelectionSet) -> usize {
        1 + set
            .items
            .iter()
            .map(|selection| selection_depth(&selection.node))
            .max()
            .unwrap_or(0)
    }

    fn selection_depth(selection: &Selection) -> usize {
        match selection {
            Selection::Field(field) => {
                let field = &field.node;
                let sub = if field.selection_set.node.items.is_empty() {
                    0
                } else {
                    selection_set_depth(&field.selection_set.node)
                };
                arguments_depth(&field.arguments)
                    .max(directives_depth(&field.directives))
                    .max(sub)
            }
            Selection::InlineFragment(fragment) => directives_depth(&fragment.node.directives)
                .max(selection_set_depth(&fragment.node.selection_set.node)),
            Selection::FragmentSpread(spread) => directives_depth(&spread.node.directives),
        }
    }

    fn variable_definitions_depth(definitions: &[Positioned<VariableDefinition>]) -> usize {
        if definitions.is_empty() {
            0
        } else {
            1 + definitions
                .iter()
                .map(|definition| {
                    let definition = &definition.node;
                    let default = definition
                        .default_value
                        .as_ref()
                        .map(|value| const_value_depth(&value.node))
                        .unwrap_or(0);
                    type_depth(&definition.var_type.node)
                        .max(default)
                        .max(directives_depth(&definition.directives))
                })
                .max()
                .unwrap_or(0)
        }
    }

    fn operation_depth(operation: &OperationDefinition) -> usize {
        variable_definitions_depth(&operation.variable_definitions)
            .max(directives_depth(&operation.directives))
            .max(selection_set_depth(&operation.selection_set.node))
    }

    fn fragment_depth(fragment: &FragmentDefinition) -> usize {
        directives_depth(&fragment.directives)
            .max(selection_set_depth(&fragment.selection_set.node))
    }

    /// The deepest `(`/`[`/`{` nesting the parsed document actually has, computed from the AST.
    fn document_depth(document: &ExecutableDocument) -> usize {
        let mut deepest = 0;
        for (_, operation) in document.operations.iter() {
            deepest = deepest.max(operation_depth(&operation.node));
        }
        for fragment in document.fragments.values() {
            deepest = deepest.max(fragment_depth(&fragment.node));
        }
        deepest
    }

    #[test]
    fn parse_accepts_but_scan_rejects_unterminated_block_string_traps() {
        // Each document carries an unterminated `"""` in front of nesting deeper than the limit.
        // The grammar backtracks over the opener and builds the nesting, so `parse_query` accepts
        // it (129..=200 levels parse on any stack); the scan must count that nesting and reject it,
        // never skip it. `ccbFormsV2` taking no argument is irrelevant: `parse_query` never
        // consults the schema.
        let inner = 130;
        let deep = format!("{}1{}", "[".repeat(inner), "]".repeat(inner));
        let traps = [
            // `[""""` then nesting: the opener reads as `""`, the third quote opens `""`.
            format!(r#"query Q {{ ccbFormsV2(a: [""""{deep}]) {{ __typename }} }}"#),
            // `[""" "` then nesting: the opener reads as `""`, then `" "` is a plain string.
            format!(r#"query Q {{ ccbFormsV2(a: [""" "{deep}]) {{ __typename }} }}"#),
        ];
        for trap in traps {
            let document = parse_query(&trap).expect("the parser accepts the trap");
            let real = document_depth(&document);
            assert!(
                real > MAX_BRACKET_NESTING,
                "trap is not deep enough: {real}"
            );
            let scanned = max_depth(&trap);
            assert!(scanned >= real, "scan undercounts: {scanned} < {real}");
            assert!(check(&trap).is_err(), "scan did not reject the trap");
        }
    }

    struct Rng(u64);
    impl Rng {
        fn next_u64(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            self.0 = x;
            x
        }
        fn below(&mut self, n: usize) -> usize {
            (self.next_u64() % n as u64) as usize
        }
    }

    /// A plain string whose content carries brackets and escapes, so that corrupting its closing
    /// quote exposes real nesting.
    fn gen_plain_string(rng: &mut Rng) -> String {
        const ATOMS: [&str; 10] = ["a", " ", "[", "]", "{", "}", r#"\""#, r"\\", "1", "[[1]]"];
        let mut out = String::from("\"");
        for _ in 0..rng.below(4) {
            out.push_str(ATOMS[rng.below(ATOMS.len())]);
        }
        out.push('"');
        out
    }

    /// A block string whose content carries brackets, loose quotes and escaped delimiters. When a
    /// mutation drops a quote from its `"""` terminator the grammar backtracks, and the brackets
    /// inside become real nesting — the C2 under-count class.
    fn gen_block_string(rng: &mut Rng) -> String {
        const ATOMS: [&str; 9] = [
            "a", " ", "[[[1]]]", "]", "\"", "\"\"", r#"\""""#, "\n", "[{",
        ];
        let mut out = String::from("\"\"\"");
        for _ in 0..rng.below(4) {
            out.push_str(ATOMS[rng.below(ATOMS.len())]);
        }
        out.push_str("\"\"\"");
        out
    }

    /// A syntactically valid GraphQL value, nested up to a small depth.
    fn gen_value(rng: &mut Rng, depth: usize) -> String {
        if depth >= 5 || rng.below(3) == 0 {
            return match rng.below(7) {
                0 => "1".to_owned(),
                1 => "a".to_owned(),
                2 => "true".to_owned(),
                3 => "null".to_owned(),
                4 => "$v".to_owned(),
                5 => gen_plain_string(rng),
                _ => gen_block_string(rng),
            };
        }
        match rng.below(2) {
            0 => {
                let mut out = String::from("[");
                for _ in 0..rng.below(4) {
                    out.push_str(&gen_value(rng, depth + 1));
                    out.push(' ');
                }
                out.push(']');
                out
            }
            _ => {
                let mut out = String::from("{");
                for i in 0..rng.below(3) {
                    out.push_str(&format!("f{i}: "));
                    out.push_str(&gen_value(rng, depth + 1));
                    out.push(' ');
                }
                out.push('}');
                out
            }
        }
    }

    /// 1–3 single-character edits over the lexer's tricky bytes; all generated text is ASCII, so a
    /// byte index is always a character boundary. These break and re-form strings, block-string
    /// terminators and comments, so a document that still parses stresses the scan's agreement with
    /// the grammar's backtracking.
    fn mutate(rng: &mut Rng, doc: &mut String) {
        const TRICKY: [u8; 12] = [
            b'[', b']', b'{', b'}', b'(', b')', b'"', b'\\', b'#', b'\n', b'\r', b' ',
        ];
        for _ in 0..1 + rng.below(3) {
            if doc.is_empty() {
                break;
            }
            let pos = rng.below(doc.len());
            let byte = TRICKY[rng.below(TRICKY.len())] as char;
            match rng.below(3) {
                0 => doc.insert(pos, byte),
                1 => {
                    let mut bytes = std::mem::take(doc).into_bytes();
                    bytes[pos] = byte as u8;
                    *doc = String::from_utf8(bytes).expect("ASCII stays valid UTF-8");
                }
                _ => {
                    doc.remove(pos);
                }
            }
        }
    }

    #[test]
    fn scan_never_undercounts_parsed_documents() {
        // A dependency-free differential check against the real parser. A seeded generator emits a
        // valid document, then usually corrupts a few lexer-significant bytes; whenever
        // `parse_query` still accepts it, the scan's maximum bracket depth must be at least the
        // document's real bracket depth. The scan may over-count but must never under-count, or
        // deep nesting would reach `parse_query` and overflow the stack. Documents stay short, so
        // the parser's own recursion stays well within any stack.
        let seeds: [u64; 4] = [
            0x9E37_79B9_7F4A_7C15,
            0xD1B5_4A32_D192_ED03,
            0x2545_F491_4F6C_DD1D,
            0x00A0_761D_6478_BD64,
        ];
        let iterations = 6_000_usize;

        let mut parsed = 0_u64;
        let start = std::time::Instant::now();
        for seed in seeds {
            let mut rng = Rng(seed);
            for _ in 0..iterations {
                let value = gen_value(&mut rng, 0);
                let mut document = format!("query Q {{ f(a: {value} ) {{ __typename }} }}");
                // Corrupt about 70%, leaving some pristine valid documents in the mix.
                if rng.below(10) < 7 {
                    mutate(&mut rng, &mut document);
                }
                if let Ok(parsed_document) = parse_query(&document) {
                    parsed += 1;
                    let real = document_depth(&parsed_document);
                    let scanned = max_depth(&document);
                    assert!(
                        scanned >= real,
                        "scan undercounts for {document:?}: scan {scanned} < real {real}"
                    );
                }
            }
        }
        let elapsed = start.elapsed();
        assert!(
            parsed > 1_000,
            "only {parsed} documents parsed; the test is too weak"
        );
        eprintln!(
            "differential: {} iterations, {parsed} parsed, {elapsed:?}",
            iterations * seeds.len()
        );
    }
}
