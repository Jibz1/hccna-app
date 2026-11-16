//! `parseDocument` from htmlparser2 12 (HTML mode, entities decoded with the `entities` 8
//! rules) and the tree domhandler 6 builds from it, for the inline HTML in legacy EditorJS text
//! fields that `richContent.ts` reads. The tokenizer, the parser's implied-close and foreign-
//! content rules and the tree builder's text merging are ported state by state, so malformed
//! markup produces the same tree as on the TS server.

/// The deepest element nesting the tree keeps: a deliberate difference from htmlparser2, whose
/// tree is as deep as the markup. Past it, start tags are ignored (their text goes to the deepest
/// kept element) and so are their matching end tags, so hostile CMS HTML cannot build a tree deep
/// enough to overflow the stack in a recursive reader or in `Drop`, which would abort the
/// process. Real content never comes close; the spec lists this in its pipeline table.
pub const MAX_HTML_DEPTH: usize = 256;

/// A node of the parsed tree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Node {
    Text(String),
    Element(Element),
    /// A comment, an HTML-mode CDATA section or a doctype; every reader skips it.
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Element {
    /// Lowercased, with htmlparser2's SVG and `image` adjustments.
    pub name: String,
    /// Lowercased names in source order; a repeated attribute keeps its first value.
    pub attribs: Vec<(String, String)>,
    pub children: Vec<Node>,
}

impl Element {
    pub fn attribute(&self, name: &str) -> Option<&str> {
        self.attribs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

/// `parseDocument(html).children`.
pub fn parse_document(html: &str) -> Vec<Node> {
    let mut parser = Parser::new(html);
    parser.run();
    parser.finish()
}

// ── Tokenizer (htmlparser2 `Tokenizer.ts`, HTML mode) ──────────

/// Tokenizer states. `InEntity` is gone: an entity is decoded in one step where it starts, which
/// gives the same tokens because the whole document is written at once.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    Text,
    BeforeTagName,
    InTagName,
    InSelfClosingTag,
    BeforeClosingTagName,
    InClosingTagName,
    AfterClosingTagName,
    BeforeAttributeName,
    InAttributeName,
    AfterAttributeName,
    BeforeAttributeValue,
    InAttributeValueDq,
    InAttributeValueSq,
    InAttributeValueNq,
    BeforeDeclaration,
    InDeclaration,
    BeforeComment,
    CdataSequence,
    DeclarationSequence,
    InSpecialComment,
    InCommentLike,
    SpecialStartSequence,
    InSpecialTag,
    InPlainText,
}

const EMPTY: &[u8] = b"";
const CDATA: &[u8] = b"CDATA[";
const CDATA_END: &[u8] = b"]]>";
const COMMENT_END: &[u8] = b"--!>";
const DOCTYPE: &[u8] = b"doctype";
const IFRAME_END: &[u8] = b"</iframe";
const NOEMBED_END: &[u8] = b"</noembed";
const NOFRAMES_END: &[u8] = b"</noframes";
const PLAINTEXT: &[u8] = b"</plaintext";
const SCRIPT_END: &[u8] = b"</script";
const STYLE_END: &[u8] = b"</style";
const TITLE_END: &[u8] = b"</title";
const TEXTAREA_END: &[u8] = b"</textarea";
const XMP_END: &[u8] = b"</xmp";

/// `specialStartSequences`: text-only tags by the first letter of their name.
fn special_start_sequence(c: u8) -> Option<&'static [u8]> {
    match c | 0x20 {
        b'i' => Some(IFRAME_END),
        b'n' => Some(NOEMBED_END),
        b'p' => Some(PLAINTEXT),
        b's' => Some(SCRIPT_END),
        b't' => Some(TITLE_END),
        b'x' => Some(XMP_END),
        _ => None,
    }
}

fn is_whitespace(c: u8) -> bool {
    matches!(c, b' ' | b'\n' | b'\t' | 0x0c | b'\r')
}

fn is_end_of_tag_section(c: u8) -> bool {
    c == b'/' || c == b'>' || is_whitespace(c)
}

// ── Parser (htmlparser2 `Parser.ts`, HTML mode) ────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Foreign {
    None,
    Svg,
    MathMl,
}

const FORM_TAGS: &[&str] = &[
    "input", "option", "optgroup", "select", "button", "datalist", "textarea",
];
const P_TAG: &[&str] = &["p"];
const HEADING_TAGS: &[&str] = &["h1", "h2", "h3", "h4", "h5", "h6", "p"];
const TABLE_SECTION_TAGS: &[&str] = &["thead", "tbody"];
const DDT_TAGS: &[&str] = &["dd", "dt"];
const RTP_TAGS: &[&str] = &["rt", "rp"];

/// `openImpliesClose`: opening the key closes open elements in its set.
fn implies_close(name: &str) -> Option<&'static [&'static str]> {
    Some(match name {
        "tr" => &["tr", "th", "td"],
        "th" => &["th"],
        "td" => &["thead", "th", "td"],
        "body" => &["head", "link", "script"],
        "a" => &["a"],
        "li" => &["li"],
        "p" => P_TAG,
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => HEADING_TAGS,
        "select" | "input" | "output" | "button" | "datalist" | "textarea" => FORM_TAGS,
        "option" => &["option"],
        "optgroup" => &["optgroup", "option"],
        "dd" | "dt" => DDT_TAGS,
        "address" | "article" | "aside" | "blockquote" | "details" | "div" | "dl" | "fieldset"
        | "figcaption" | "figure" | "footer" | "form" | "header" | "hr" | "main" | "nav" | "ol"
        | "pre" | "section" | "table" | "ul" => P_TAG,
        "rt" | "rp" => RTP_TAGS,
        "tbody" | "tfoot" => TABLE_SECTION_TAGS,
        _ => return None,
    })
}

fn is_void(name: &str) -> bool {
    matches!(
        name,
        "area"
            | "base"
            | "basefont"
            | "br"
            | "col"
            | "command"
            | "embed"
            | "frame"
            | "hr"
            | "img"
            | "input"
            | "isindex"
            | "keygen"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

fn is_foreign_context_element(name: &str) -> bool {
    matches!(name, "math" | "svg")
}

/// `htmlIntegrationElements`, in SVG-adjusted casing.
fn is_html_integration_element(name: &str) -> bool {
    matches!(
        name,
        "mi" | "mo" | "mn" | "ms" | "mtext" | "annotation-xml" | "foreignObject" | "desc" | "title"
    )
}

fn svg_tag_name_adjustment(name: &str) -> Option<&'static str> {
    Some(match name {
        "altglyph" => "altGlyph",
        "altglyphdef" => "altGlyphDef",
        "altglyphitem" => "altGlyphItem",
        "animatecolor" => "animateColor",
        "animatemotion" => "animateMotion",
        "animatetransform" => "animateTransform",
        "clippath" => "clipPath",
        "feblend" => "feBlend",
        "fecolormatrix" => "feColorMatrix",
        "fecomponenttransfer" => "feComponentTransfer",
        "fecomposite" => "feComposite",
        "feconvolvematrix" => "feConvolveMatrix",
        "fediffuselighting" => "feDiffuseLighting",
        "fedisplacementmap" => "feDisplacementMap",
        "fedistantlight" => "feDistantLight",
        "fedropshadow" => "feDropShadow",
        "feflood" => "feFlood",
        "fefunca" => "feFuncA",
        "fefuncb" => "feFuncB",
        "fefuncg" => "feFuncG",
        "fefuncr" => "feFuncR",
        "fegaussianblur" => "feGaussianBlur",
        "feimage" => "feImage",
        "femerge" => "feMerge",
        "femergenode" => "feMergeNode",
        "femorphology" => "feMorphology",
        "feoffset" => "feOffset",
        "fepointlight" => "fePointLight",
        "fespecularlighting" => "feSpecularLighting",
        "fespotlight" => "feSpotLight",
        "fetile" => "feTile",
        "feturbulence" => "feTurbulence",
        "foreignobject" => "foreignObject",
        "glyphref" => "glyphRef",
        "lineargradient" => "linearGradient",
        "radialgradient" => "radialGradient",
        "textpath" => "textPath",
        _ => return None,
    })
}

// ── Tree (domhandler `DomHandler`) ─────────────────────────────

#[derive(Default)]
struct Dom {
    root: Vec<Node>,
    /// The open elements, innermost last. An element joins its parent when it closes, which
    /// keeps document order because nothing else is added to the parent meanwhile.
    open: Vec<Element>,
    /// Elements opened past `MAX_HTML_DEPTH` and not yet closed. Opens and closes nest, so the
    /// next closes belong to them.
    ignored: usize,
    /// domhandler's `lastNode` is a text node, so the next text merges into it.
    last_is_text: bool,
}

impl Dom {
    fn children(&mut self) -> &mut Vec<Node> {
        match self.open.last_mut() {
            Some(element) => &mut element.children,
            None => &mut self.root,
        }
    }

    fn add(&mut self, node: Node) {
        self.children().push(node);
        self.last_is_text = false;
    }

    fn text(&mut self, data: &str) {
        if self.last_is_text
            && let Some(Node::Text(text)) = self.children().last_mut()
        {
            text.push_str(data);
            return;
        }
        self.add(Node::Text(data.to_owned()));
        self.last_is_text = true;
    }

    fn open_tag(&mut self, name: String, attribs: Vec<(String, String)>) {
        self.last_is_text = false;
        if self.open.len() >= MAX_HTML_DEPTH {
            self.ignored += 1;
            return;
        }
        self.open.push(Element {
            name,
            attribs,
            children: Vec::new(),
        });
    }

    /// `onclosetag` pops the innermost element. Once only the root is left (possible only at the
    /// end, for a tag the input cut off before its `>`), domhandler pops the root, which changes
    /// nothing here.
    fn close_tag(&mut self) {
        self.last_is_text = false;
        if self.ignored > 0 {
            self.ignored -= 1;
            return;
        }
        if let Some(element) = self.open.pop() {
            self.children().push(Node::Element(element));
        }
    }

    fn finish(mut self) -> Vec<Node> {
        while !self.open.is_empty() {
            self.close_tag();
        }
        self.root
    }
}

struct Parser<'a> {
    input: &'a str,
    bytes: &'a [u8],
    // Tokenizer state.
    state: State,
    /// The start of the section being read; -1 after a tag or attribute name ends, where
    /// htmlparser2's `slice(-1)` then reads the last character.
    section_start: isize,
    index: usize,
    base_state: State,
    is_special: bool,
    current_sequence: &'static [u8],
    sequence_index: usize,
    // Parser state.
    tag_name: String,
    attrib_name: String,
    attrib_value: String,
    attribs: Option<Vec<(String, String)>>,
    /// Open element names, innermost last.
    stack: Vec<String>,
    /// Foreign-content contexts, innermost last.
    foreign: Vec<Foreign>,
    dom: Dom,
}

impl<'a> Parser<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            input,
            bytes: input.as_bytes(),
            state: State::Text,
            section_start: 0,
            index: 0,
            base_state: State::Text,
            is_special: false,
            current_sequence: EMPTY,
            sequence_index: 0,
            tag_name: String::new(),
            attrib_name: String::new(),
            attrib_value: String::new(),
            attribs: None,
            stack: Vec::new(),
            foreign: vec![Foreign::None],
            dom: Dom::default(),
        }
    }

    fn run(&mut self) {
        while self.index < self.bytes.len() {
            let c = self.bytes[self.index];
            match self.state {
                State::Text => self.state_text(c),
                // Everything to the end is text; `finish` emits it.
                State::InPlainText => self.index = self.bytes.len() - 1,
                State::SpecialStartSequence => self.state_special_start_sequence(c),
                State::InSpecialTag => self.state_in_special_tag(c),
                State::CdataSequence => self.state_cdata_sequence(c),
                State::DeclarationSequence => self.state_declaration_sequence(c),
                State::InAttributeValueDq => self.handle_in_attribute_value(c, b'"'),
                State::InAttributeName => self.state_in_attribute_name(c),
                State::InCommentLike => self.state_in_comment_like(c),
                State::InSpecialComment => self.state_in_special_comment(c),
                State::BeforeAttributeName => self.state_before_attribute_name(c),
                State::InTagName => self.state_in_tag_name(c),
                State::InClosingTagName => self.state_in_closing_tag_name(c),
                State::BeforeTagName => self.state_before_tag_name(c),
                State::AfterAttributeName => self.state_after_attribute_name(c),
                State::InAttributeValueSq => self.handle_in_attribute_value(c, b'\''),
                State::BeforeAttributeValue => self.state_before_attribute_value(c),
                State::BeforeClosingTagName => self.state_before_closing_tag_name(c),
                State::AfterClosingTagName => self.state_after_closing_tag_name(c),
                State::InAttributeValueNq => self.state_in_attribute_value_no_quotes(c),
                State::InSelfClosingTag => self.state_in_self_closing_tag(c),
                State::InDeclaration => self.state_in_declaration(c),
                State::BeforeDeclaration => self.state_before_declaration(c),
                State::BeforeComment => self.state_before_comment(c),
            }
            self.index += 1;
        }
    }

    fn finish(mut self) -> Vec<Node> {
        self.handle_trailing_data();
        self.on_end();
        self.dom.finish()
    }

    /// `getSlice`: section bounds always fall on ASCII bytes or the ends, so they are character
    /// boundaries. A negative start reads the last character, as JavaScript's `slice` does.
    fn slice(&self, start: isize, end: usize) -> &'a str {
        let input = self.input;
        let start = match usize::try_from(start) {
            Ok(start) => start,
            Err(_) => input.char_indices().next_back().map_or(0, |(at, _)| at),
        };
        input.get(start..end).unwrap_or_default()
    }

    fn at(&self, position: usize) -> isize {
        isize::try_from(position).unwrap_or(isize::MAX)
    }

    fn state_text(&mut self, c: u8) {
        if c == b'<' {
            if self.at(self.index) > self.section_start {
                self.on_text(self.section_start, self.index);
            }
            self.state = State::BeforeTagName;
            self.section_start = self.at(self.index);
        } else if c == b'&' {
            self.start_entity();
        }
    }

    fn enter_tag_body(&mut self) {
        if self.current_sequence == PLAINTEXT {
            self.current_sequence = EMPTY;
            self.state = State::InPlainText;
        } else if self.is_special {
            self.state = State::InSpecialTag;
            self.sequence_index = 0;
        } else {
            self.state = State::Text;
        }
    }

    fn state_special_start_sequence(&mut self, c: u8) {
        let lower = c | 0x20;
        if self.sequence_index < self.current_sequence.len() {
            if lower == self.current_sequence[self.sequence_index] {
                self.sequence_index += 1;
                return;
            }
            if self.sequence_index == 3 {
                if self.current_sequence == SCRIPT_END && lower == STYLE_END[3] {
                    self.current_sequence = STYLE_END;
                    self.sequence_index = 4;
                    return;
                }
                if self.current_sequence == TITLE_END && lower == TEXTAREA_END[3] {
                    self.current_sequence = TEXTAREA_END;
                    self.sequence_index = 4;
                    return;
                }
            } else if self.sequence_index == 4
                && self.current_sequence == NOEMBED_END
                && lower == NOFRAMES_END[4]
            {
                self.current_sequence = NOFRAMES_END;
                self.sequence_index = 5;
                return;
            }
        } else if is_end_of_tag_section(c) {
            self.sequence_index = 0;
            self.state = State::InTagName;
            self.state_in_tag_name(c);
            return;
        }
        self.is_special = false;
        self.current_sequence = EMPTY;
        self.sequence_index = 0;
        self.state = State::InTagName;
        self.state_in_tag_name(c);
    }

    fn state_cdata_sequence(&mut self, c: u8) {
        if c == CDATA[self.sequence_index] {
            self.sequence_index += 1;
            if self.sequence_index == CDATA.len() {
                self.state = State::InCommentLike;
                self.current_sequence = CDATA_END;
                self.sequence_index = 0;
                self.section_start = self.at(self.index + 1);
            }
        } else {
            self.sequence_index = 0;
            self.state = State::InSpecialComment;
            self.state_in_special_comment(c);
        }
    }

    /// Skips to the next `c`; at the end, leaves the index on the last byte.
    fn fast_forward_to(&mut self, c: u8) -> bool {
        loop {
            self.index += 1;
            if self.index >= self.bytes.len() {
                break;
            }
            if self.bytes[self.index] == c {
                return true;
            }
        }
        self.index = self.bytes.len() - 1;
        false
    }

    fn emit_comment(&mut self) {
        self.on_comment();
        self.sequence_index = 0;
        self.section_start = self.at(self.index + 1);
        self.state = State::Text;
    }

    fn state_in_comment_like(&mut self, c: u8) {
        let comment = self.current_sequence == COMMENT_END;
        if comment
            && self.sequence_index <= 1
            && self.at(self.index) == self.section_start + self.at(self.sequence_index)
            && c == b'>'
        {
            // `<!-->` or `<!--->`: an abruptly closed empty comment.
            self.emit_comment();
        } else if comment && self.sequence_index == 2 && c == b'>' {
            // `!` is optional, so the same sequence accepts `-->`.
            self.emit_comment();
        } else if comment && self.sequence_index == COMMENT_END.len() - 1 && c != b'>' {
            self.sequence_index = usize::from(c == b'-');
        } else if c == self.current_sequence[self.sequence_index] {
            self.sequence_index += 1;
            if self.sequence_index == self.current_sequence.len() {
                if self.current_sequence == CDATA_END {
                    self.on_cdata(self.section_start, self.index - 2);
                } else {
                    self.on_comment();
                }
                self.sequence_index = 0;
                self.section_start = self.at(self.index + 1);
                self.state = State::Text;
            }
        } else if self.sequence_index == 0 {
            if self.fast_forward_to(self.current_sequence[0]) {
                self.sequence_index = 1;
            }
        } else if c != self.current_sequence[self.sequence_index - 1] {
            // Allow long sequences, e.g. `--->` and `]]]>`.
            self.sequence_index = 0;
        }
    }

    fn state_in_special_tag(&mut self, c: u8) {
        if self.sequence_index == self.current_sequence.len() {
            if is_end_of_tag_section(c) {
                let end_of_text = self.index - self.current_sequence.len();
                if self.section_start < self.at(end_of_text) {
                    self.on_text(self.section_start, end_of_text);
                }
                self.is_special = false;
                // Skip over the `</`.
                self.section_start = self.at(end_of_text + 2);
                self.state_in_closing_tag_name(c);
                return;
            }
            self.sequence_index = 0;
        }
        if c | 0x20 == self.current_sequence[self.sequence_index] {
            self.sequence_index += 1;
        } else if self.sequence_index == 0 {
            if self.current_sequence == TITLE_END || self.current_sequence == TEXTAREA_END {
                // RCDATA tags decode entities while looking for their end tag.
                if c == b'&' {
                    self.start_entity();
                }
            } else if self.fast_forward_to(b'<') {
                self.sequence_index = 1;
            }
        } else {
            // A `<` restarts the match, e.g. `<</script>`.
            self.sequence_index = usize::from(c == b'<');
        }
    }

    fn state_before_tag_name(&mut self, c: u8) {
        if c == b'!' {
            self.state = State::BeforeDeclaration;
            self.section_start = self.at(self.index + 1);
        } else if c == b'?' {
            self.state = State::InSpecialComment;
            self.section_start = self.at(self.index);
        } else if c.is_ascii_alphabetic() {
            self.section_start = self.at(self.index);
            let special = if self.is_in_foreign_context() {
                None
            } else {
                special_start_sequence(c)
            };
            match special {
                None => self.state = State::InTagName,
                Some(sequence) => {
                    self.is_special = true;
                    self.current_sequence = sequence;
                    self.sequence_index = 3;
                    self.state = State::SpecialStartSequence;
                }
            }
        } else if c == b'/' {
            self.state = State::BeforeClosingTagName;
        } else {
            self.state = State::Text;
            self.state_text(c);
        }
    }

    fn state_in_tag_name(&mut self, c: u8) {
        if is_end_of_tag_section(c) {
            self.on_open_tag_name(self.section_start, self.index);
            self.section_start = -1;
            self.state = State::BeforeAttributeName;
            self.state_before_attribute_name(c);
        }
    }

    fn state_before_closing_tag_name(&mut self, c: u8) {
        if is_whitespace(c) {
            self.state = State::InSpecialComment;
            self.section_start = self.at(self.index);
        } else if c == b'>' {
            self.state = State::Text;
            self.section_start = self.at(self.index + 1);
        } else {
            self.state = if c.is_ascii_alphabetic() {
                State::InClosingTagName
            } else {
                State::InSpecialComment
            };
            self.section_start = self.at(self.index);
        }
    }

    fn state_in_closing_tag_name(&mut self, c: u8) {
        if is_end_of_tag_section(c) {
            self.on_close_tag(self.section_start, self.index);
            self.section_start = -1;
            self.state = State::AfterClosingTagName;
            self.state_after_closing_tag_name(c);
        }
    }

    fn state_after_closing_tag_name(&mut self, c: u8) {
        if c == b'>' || self.fast_forward_to(b'>') {
            self.state = State::Text;
            self.section_start = self.at(self.index + 1);
        }
    }

    fn state_before_attribute_name(&mut self, c: u8) {
        if c == b'>' {
            self.on_open_tag_end();
            self.enter_tag_body();
            self.section_start = self.at(self.index + 1);
        } else if c == b'/' {
            self.state = State::InSelfClosingTag;
        } else if !is_whitespace(c) {
            self.state = State::InAttributeName;
            self.section_start = self.at(self.index);
        }
    }

    fn state_in_self_closing_tag(&mut self, c: u8) {
        if c == b'>' {
            self.on_self_closing_tag();
            self.section_start = self.at(self.index + 1);
            // HTML mode does not recognize self-closing tags.
            self.enter_tag_body();
        } else if !is_whitespace(c) {
            self.state = State::BeforeAttributeName;
            self.state_before_attribute_name(c);
        }
    }

    fn state_in_attribute_name(&mut self, c: u8) {
        if c == b'=' || is_end_of_tag_section(c) {
            self.on_attrib_name(self.section_start, self.index);
            self.section_start = self.at(self.index);
            self.state = State::AfterAttributeName;
            self.state_after_attribute_name(c);
        }
    }

    fn state_after_attribute_name(&mut self, c: u8) {
        if c == b'=' {
            self.state = State::BeforeAttributeValue;
        } else if c == b'/' || c == b'>' {
            self.on_attrib_end();
            self.section_start = -1;
            self.state = State::BeforeAttributeName;
            self.state_before_attribute_name(c);
        } else if !is_whitespace(c) {
            self.on_attrib_end();
            self.state = State::InAttributeName;
            self.section_start = self.at(self.index);
        }
    }

    fn state_before_attribute_value(&mut self, c: u8) {
        if c == b'"' {
            self.state = State::InAttributeValueDq;
            self.section_start = self.at(self.index + 1);
        } else if c == b'\'' {
            self.state = State::InAttributeValueSq;
            self.section_start = self.at(self.index + 1);
        } else if !is_whitespace(c) {
            self.section_start = self.at(self.index);
            self.state = State::InAttributeValueNq;
            self.state_in_attribute_value_no_quotes(c);
        }
    }

    fn handle_in_attribute_value(&mut self, c: u8, quote: u8) {
        if c == quote {
            self.on_attrib_data(self.section_start, self.index);
            self.section_start = -1;
            self.on_attrib_end();
            self.state = State::BeforeAttributeName;
        } else if c == b'&' {
            self.start_entity();
        }
    }

    fn state_in_attribute_value_no_quotes(&mut self, c: u8) {
        if is_whitespace(c) || c == b'>' {
            self.on_attrib_data(self.section_start, self.index);
            self.section_start = -1;
            self.on_attrib_end();
            self.state = State::BeforeAttributeName;
            self.state_before_attribute_name(c);
        } else if c == b'&' {
            self.start_entity();
        }
    }

    fn state_before_declaration(&mut self, c: u8) {
        if c == b'[' {
            self.state = State::CdataSequence;
            self.sequence_index = 0;
        } else if c | 0x20 == DOCTYPE[0] {
            self.state = State::DeclarationSequence;
            self.current_sequence = DOCTYPE;
            self.sequence_index = 1;
        } else if c == b'>' {
            self.on_comment();
            self.state = State::Text;
            self.section_start = self.at(self.index + 1);
        } else if c == b'-' {
            self.state = State::BeforeComment;
        } else {
            self.state = State::InSpecialComment;
        }
    }

    fn state_declaration_sequence(&mut self, c: u8) {
        if self.sequence_index == self.current_sequence.len() {
            self.state = State::InDeclaration;
            self.state_in_declaration(c);
        } else if c | 0x20 == self.current_sequence[self.sequence_index] {
            self.sequence_index += 1;
        } else if c == b'>' {
            self.on_comment();
            self.state = State::Text;
            self.section_start = self.at(self.index + 1);
        } else {
            self.state = State::InSpecialComment;
        }
    }

    fn state_in_declaration(&mut self, c: u8) {
        if c == b'>' || self.fast_forward_to(b'>') {
            self.dom.add(Node::Other);
            self.state = State::Text;
            self.section_start = self.at(self.index + 1);
        }
    }

    fn state_before_comment(&mut self, c: u8) {
        if c == b'-' {
            self.state = State::InCommentLike;
            self.current_sequence = COMMENT_END;
            self.sequence_index = 0;
            self.section_start = self.at(self.index + 1);
        } else if c == b'>' {
            self.on_comment();
            self.state = State::Text;
            self.section_start = self.at(self.index + 1);
        } else {
            self.state = State::InSpecialComment;
        }
    }

    fn state_in_special_comment(&mut self, c: u8) {
        if c == b'>' || self.fast_forward_to(b'>') {
            self.on_comment();
            self.state = State::Text;
            self.section_start = self.at(self.index + 1);
        }
    }

    /// `startEntity` and `emitCodePoint`: text and RCDATA decode in legacy mode, attribute
    /// values in attribute mode. An unknown reference leaves the `&` as text.
    fn start_entity(&mut self) {
        self.base_state = self.state;
        let entity_start = self.index;
        let in_attribute = !matches!(self.base_state, State::Text | State::InSpecialTag);
        let Some((consumed, decoded)) = decode_entity(self.bytes, entity_start + 1, in_attribute)
        else {
            return;
        };
        let entity_end = entity_start + 1 + consumed;
        if in_attribute {
            if self.section_start < self.at(entity_start) {
                self.on_attrib_data(self.section_start, entity_start);
            }
            self.attrib_value.push_str(&decoded);
        } else {
            if self.section_start < self.at(entity_start) {
                self.on_text(self.section_start, entity_start);
            }
            self.dom.text(&decoded);
        }
        self.section_start = self.at(entity_end);
        self.index = entity_end - 1;
    }

    /// `handleTrailingData`: what is left when the input ends.
    fn handle_trailing_data(&mut self) {
        let end = self.bytes.len();
        match self.state {
            // Unclosed comments, CDATA (a bogus comment in HTML mode) and declarations.
            State::InCommentLike
            | State::BeforeDeclaration
            | State::InSpecialComment
            | State::BeforeComment
            | State::CdataSequence => {
                self.on_comment();
                return;
            }
            State::DeclarationSequence => {
                if self.sequence_index != DOCTYPE.len() {
                    self.on_comment();
                }
                return;
            }
            State::InDeclaration => return,
            _ => {}
        }
        if self.section_start >= self.at(end) {
            return;
        }
        match self.state {
            // An unfinished tag is dropped.
            State::InTagName
            | State::BeforeAttributeName
            | State::BeforeAttributeValue
            | State::AfterAttributeName
            | State::InAttributeName
            | State::InAttributeValueSq
            | State::InAttributeValueDq
            | State::InAttributeValueNq
            | State::InClosingTagName => {}
            _ => self.on_text(self.section_start, end),
        }
    }

    // ── Parser callbacks ──

    fn on_text(&mut self, start: isize, end: usize) {
        let data = self.slice(start, end);
        self.dom.text(data);
    }

    fn on_comment(&mut self) {
        self.dom.add(Node::Other);
    }

    /// `oncdata`: text inside SVG or MathML, otherwise a comment.
    fn on_cdata(&mut self, start: isize, end: usize) {
        if self.is_in_foreign_context() {
            self.on_text(start, end);
        } else {
            self.on_comment();
        }
    }

    fn is_in_foreign_context(&self) -> bool {
        self.foreign.last() != Some(&Foreign::None)
    }

    fn read_tag_name(&self, start: isize, end: usize) -> String {
        let name = self.slice(start, end).to_lowercase();
        if self.foreign.last() == Some(&Foreign::Svg) {
            return svg_tag_name_adjustment(&name).map_or(name, str::to_owned);
        }
        // A closing tag for an SVG element inside an HTML integration point.
        if self.foreign.len() > 1
            && let Some(adjusted) = svg_tag_name_adjustment(&name)
            && self.stack.iter().any(|open| open == adjusted)
        {
            return adjusted.to_owned();
        }
        if !self.is_in_foreign_context() && name == "image" {
            return "img".to_owned();
        }
        name
    }

    fn on_open_tag_name(&mut self, start: isize, end: usize) {
        let name = self.read_tag_name(start, end);
        self.emit_open_tag(name);
    }

    fn emit_open_tag(&mut self, name: String) {
        // The spec ignores a second <form> while one is open.
        if name == "form" && self.stack.iter().any(|open| open == "form") {
            self.tag_name = String::new();
            return;
        }
        if let Some(closes) = implies_close(&name) {
            while self
                .stack
                .last()
                .is_some_and(|open| closes.contains(&open.as_str()))
            {
                self.pop_element();
            }
        }
        if !is_void(&name) {
            if name == "svg" {
                self.foreign.push(Foreign::Svg);
            } else if name == "math" {
                self.foreign.push(Foreign::MathMl);
            } else if is_html_integration_element(&name) {
                self.foreign.push(Foreign::None);
            }
            self.stack.push(name.clone());
        }
        self.tag_name = name;
        self.attribs = Some(Vec::new());
    }

    fn end_open_tag(&mut self) {
        let name = std::mem::take(&mut self.tag_name);
        if let Some(attribs) = self.attribs.take() {
            self.dom.open_tag(name.clone(), attribs);
        }
        if is_void(&name) {
            self.dom.close_tag();
        }
    }

    fn on_open_tag_end(&mut self) {
        self.end_open_tag();
    }

    fn on_close_tag(&mut self, start: isize, end: usize) {
        let name = self.read_tag_name(start, end);
        if !is_void(&name) {
            if let Some(position) = self.stack.iter().rposition(|open| *open == name) {
                for _ in position..self.stack.len() {
                    self.pop_element();
                }
            } else if name == "p" {
                // `</p>` with no open p is an empty paragraph.
                self.emit_open_tag(name);
                self.close_current_tag();
            }
        } else if name == "br" {
            // `</br>` is a `<br>`.
            self.dom.open_tag(name, Vec::new());
            self.dom.close_tag();
        }
    }

    fn on_self_closing_tag(&mut self) {
        if self.is_in_foreign_context() {
            self.close_current_tag();
        } else {
            self.on_open_tag_end();
        }
    }

    fn close_current_tag(&mut self) {
        let name = self.tag_name.clone();
        self.end_open_tag();
        if self.stack.last() == Some(&name) {
            self.pop_element();
        }
    }

    fn pop_element(&mut self) {
        let Some(element) = self.stack.pop() else {
            return;
        };
        if is_foreign_context_element(&element) || is_html_integration_element(&element) {
            self.foreign.pop();
        }
        self.dom.close_tag();
    }

    fn on_attrib_name(&mut self, start: isize, end: usize) {
        self.attrib_name = self.slice(start, end).to_lowercase();
    }

    fn on_attrib_data(&mut self, start: isize, end: usize) {
        let data = self.slice(start, end);
        self.attrib_value.push_str(data);
    }

    fn on_attrib_end(&mut self) {
        let value = std::mem::take(&mut self.attrib_value);
        let name = &self.attrib_name;
        if let Some(attribs) = &mut self.attribs
            // `attribs` is a plain object: a repeated name keeps its first value, and assigning a
            // string to `__proto__` does nothing.
            && name != "__proto__"
            && !attribs.iter().any(|(key, _)| key == name)
        {
            attribs.push((name.clone(), value));
        }
    }

    /// `onend`: every element still open closes.
    fn on_end(&mut self) {
        for _ in 0..self.stack.len() {
            self.dom.close_tag();
        }
    }
}

// ── Character references (entities 8 `EntityDecoder`) ──────────

/// Decodes the reference after the `&` at `start - 1`: the number of bytes it spans after the
/// `&` and its text, or `None` when the `&` is literal. Text uses the legacy rules (a name from
/// the legacy list needs no `;`); attribute values reject an unterminated name followed by `=` or
/// an alphanumeric character, as `DecodingMode.Attribute` does.
fn decode_entity(bytes: &[u8], start: usize, in_attribute: bool) -> Option<(usize, String)> {
    let rest = bytes.get(start..)?;
    if rest.first() == Some(&b'#') {
        return decode_numeric(rest);
    }
    let run = rest
        .iter()
        .take_while(|byte| byte.is_ascii_alphanumeric())
        .count();
    let name = &rest[..run];
    let next = rest.get(run).copied();
    // Any entity directly followed by `;`.
    if run > 0
        && next == Some(b';')
        && let Some(value) = named_entity(name, true)
    {
        return Some((run + 1, value));
    }
    // Otherwise the longest name that is valid without `;`.
    let (length, value) = (1..=run.min(htmlize::BARE_ENTITY_MAX_LENGTH))
        .rev()
        .find_map(|length| named_entity(&name[..length], false).map(|value| (length, value)))?;
    if in_attribute && (length != run || next == Some(b'=')) {
        return None;
    }
    Some((length, value))
}

fn named_entity(name: &[u8], with_semicolon: bool) -> Option<String> {
    let mut key = Vec::with_capacity(name.len() + 2);
    key.push(b'&');
    key.extend_from_slice(name);
    if with_semicolon {
        key.push(b';');
    }
    let value = htmlize::ENTITIES.get(key.as_slice())?;
    std::str::from_utf8(value).ok().map(str::to_owned)
}

/// `&#…`: decimal, or hexadecimal after `x`, with an optional `;`; no digits means no reference.
fn decode_numeric(rest: &[u8]) -> Option<(usize, String)> {
    let hex = rest.get(1).is_some_and(|byte| byte | 0x20 == b'x');
    let digits_start = if hex { 2 } else { 1 };
    let radix = if hex { 16 } else { 10 };
    let mut code_point: u32 = 0;
    let mut end = digits_start;
    while let Some(digit) = rest
        .get(end)
        .and_then(|byte| char::from(*byte).to_digit(radix))
    {
        code_point = code_point.saturating_mul(radix).saturating_add(digit);
        end += 1;
    }
    if end == digits_start {
        return None;
    }
    if rest.get(end) == Some(&b';') {
        end += 1;
    }
    let decoded = char::from_u32(replace_code_point(code_point)).unwrap_or('\u{fffd}');
    Some((end, decoded.to_string()))
}

/// Windows-1252 replacements for the C1 controls (code points 128–159); 0 means none.
const C1_REPLACEMENTS: [u32; 32] = [
    8364, 0, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 0, 381, 0, 0, 8216,
    8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 0, 382, 376,
];

/// `replaceCodePoint`: NUL, surrogates and values past U+10FFFF become U+FFFD; C1 controls map
/// to Windows-1252.
fn replace_code_point(code_point: u32) -> u32 {
    match code_point {
        0 | 0xd800..=0xdfff | 0x110000.. => 0xfffd,
        128..=159 => match C1_REPLACEMENTS[(code_point - 128) as usize] {
            0 => code_point,
            replacement => replacement,
        },
        _ => code_point,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tree in the compact form the expectations were printed in from htmlparser2:
    /// `T("text")`, `name[["attr","value"]][children]`, `O` for anything else.
    fn show(nodes: &[Node]) -> String {
        nodes
            .iter()
            .map(|node| match node {
                Node::Text(text) => format!("T({})", serde_json::to_string(text).unwrap()),
                Node::Element(element) => {
                    let attribs = if element.attribs.is_empty() {
                        String::new()
                    } else {
                        serde_json::to_string(&element.attribs).unwrap()
                    };
                    format!("{}{attribs}[{}]", element.name, show(&element.children))
                }
                Node::Other => "O".to_owned(),
            })
            .collect::<Vec<_>>()
            .join(",")
    }

    #[test]
    fn parses_like_htmlparser2() {
        // Each expectation was produced by htmlparser2 12's parseDocument in Bun.
        let cases = [
            (
                r#"<b>Bold</b> &amp; <a href="https://example.com/?a=1&amp;b=2">link</a><br>next&nbsp;line"#,
                "b[T(\"Bold\")],T(\" & \"),a[[\"href\",\"https://example.com/?a=1&b=2\"]][T(\"link\")],br[],T(\"next\u{a0}line\")",
            ),
            (
                "a&ampx b&notit; c&notin; d&#38 e&#x26; f&#128; g&#0; h&unknown;",
                "T(\"a&x b¬it; c∉ d& e& f€ g\u{fffd} h&unknown;\")",
            ),
            (
                r#"<a href="&notit;" title="&amp" target=&copy=>x</a>"#,
                r#"a[["href","&notit;"],["title","&"],["target","&copy="]][T("x")]"#,
            ),
            (
                "<b class=x class=y data-z>t</b>",
                r#"b[["class","x"],["data-z",""]][T("t")]"#,
            ),
            (
                "x<!-- c -->y<![CDATA[z]]>w<!doctype html>v",
                r#"T("x"),O,T("y"),O,T("w"),O,T("v")"#,
            ),
            ("<p>a<p>b</p></p>c", r#"p[T("a")],p[T("b")],p[],T("c")"#),
            (
                "<li>1<li>2</br></x>3",
                r#"li[T("1")],li[T("2"),br[],T("3")]"#,
            ),
            (
                "<script>a<b>c</script>d<title>&amp;<i></title>",
                r#"script[T("a<b>c")],T("d"),title[T("&<i>")]"#,
            ),
            (
                "<svg><b/>x<clippath/></svg>y",
                r#"svg[b[],T("x"),clipPath[]],T("y")"#,
            ),
            ("x<b/", r#"T("x/")"#),
            ("a<scr", r#"T("ascr")"#),
            ("</b y", r#"T("y")"#),
            (r#"<B CLASS="Up">u</B>"#, r#"b[["class","Up"]][T("u")]"#),
            (
                r#"<b __proto__="x" class="y">p</b>"#,
                r#"b[["class","y"]][T("p")]"#,
            ),
            ("<plaintext><b>&amp;", r#"plaintext[T("<b>&amp;")]"#),
        ];
        for (html, expected) in cases {
            assert_eq!(show(&parse_document(html)), expected, "{html}");
        }
    }

    #[test]
    fn parses_empty_and_plain_text() {
        assert_eq!(parse_document(""), []);
        assert_eq!(
            parse_document("Ada Example"),
            [Node::Text("Ada Example".to_owned())]
        );
    }

    /// The deepest element nesting in `nodes`, walked without recursion.
    fn depth(nodes: &[Node]) -> usize {
        let mut deepest = 0;
        let mut pending: Vec<(&Node, usize)> = nodes.iter().map(|node| (node, 1)).collect();
        while let Some((node, level)) = pending.pop() {
            if let Node::Element(element) = node {
                deepest = deepest.max(level);
                pending.extend(element.children.iter().map(|child| (child, level + 1)));
            }
        }
        deepest
    }

    /// The text of the innermost first-child chain, walked without recursion.
    fn innermost_text(nodes: &[Node]) -> Option<String> {
        let mut current = nodes;
        loop {
            match current.first()? {
                Node::Element(element) => current = &element.children,
                Node::Text(text) => return Some(text.clone()),
                Node::Other => return None,
            }
        }
    }

    // Security: hostile CMS HTML must not build a tree deep enough to overflow the stack in a
    // recursive reader or in `Drop`, which would abort the process.
    #[test]
    fn caps_element_nesting_so_deep_html_cannot_overflow_the_stack() {
        let nested = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(|| {
                let html = format!(
                    "{}deep{}tail",
                    "<b>".repeat(100_000),
                    "</b>".repeat(100_000)
                );
                let tree = parse_document(&html);
                let result = (depth(&tree), innermost_text(&tree), tree.len());
                drop(tree);
                result
            })
            .unwrap()
            .join()
            .unwrap();

        // Start tags past the cap are ignored, so their text joins the deepest element, and
        // their end tags are ignored too: the outer `</b>`s still close the kept elements.
        assert_eq!(nested.0, MAX_HTML_DEPTH);
        assert_eq!(nested.1.as_deref(), Some("deep"));
        assert_eq!(
            nested.2, 2,
            "the trailing text follows the outermost element"
        );
    }

    #[test]
    fn leaves_ordinary_nesting_alone() {
        let html = format!(
            "{}x{}",
            "<i>".repeat(MAX_HTML_DEPTH),
            "</i>".repeat(MAX_HTML_DEPTH)
        );
        assert_eq!(depth(&parse_document(&html)), MAX_HTML_DEPTH);
        // One past the cap: the extra tag is dropped, its text kept in the deepest element.
        let html = format!(
            "{}<br>x{}y",
            "<i>".repeat(MAX_HTML_DEPTH + 1),
            "</i>".repeat(MAX_HTML_DEPTH + 1)
        );
        let tree = parse_document(&html);
        assert_eq!(depth(&tree), MAX_HTML_DEPTH);
        assert_eq!(innermost_text(&tree).as_deref(), Some("x"));
        assert_eq!(tree.len(), 2);
    }
}
