//! `toRichContent` from `packages/strapi-v2/src/richContent.ts`: the rich text document the app
//! renders for `content: JSON`. Tiptap documents pass through without the CMS's preservation
//! snapshot; legacy EditorJS is converted the way the website converts it (its inline HTML parsed
//! by the htmlparser2 port in [`super::html`]); content neither converter can represent becomes
//! plain-text paragraphs. It never fails, and unknown Tiptap nodes are left to the renderer.

use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::html::{self, Element, Node};
use super::{js, rich_text};

/// `RichDocument`: `{ type: "doc", attrs?, content }`. Serializes with the TS key order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RichDocument {
    #[serde(rename = "type")]
    pub kind: DocumentKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attrs: Option<Map<String, Value>>,
    pub content: Vec<RichNode>,
}

/// The literal `"doc"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum DocumentKind {
    #[serde(rename = "doc")]
    Doc,
}

/// `RichNode`: `{ type, text?, attrs?, marks?, content? }`, in that key order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RichNode {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attrs: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marks: Option<Vec<RichMark>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<RichNode>>,
}

/// `RichMark`: `{ type, attrs? }`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RichMark {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attrs: Option<Map<String, Value>>,
}

/// `toRichContent(value)`: `None` when there is nothing to show.
pub fn to_rich_content(value: &Value) -> Option<RichDocument> {
    match value {
        Value::Null => return None,
        Value::String(text) if text.is_empty() => return None,
        _ => {}
    }
    let stored = stored_value(value);
    let document = to_document(stored.as_ref().unwrap_or(value));
    let content: Vec<RichNode> = document.content.into_iter().flat_map(app_nodes).collect();
    if content.iter().all(is_empty_paragraph) {
        return None;
    }
    Some(RichDocument {
        kind: DocumentKind::Doc,
        attrs: app_attrs(document.attrs),
        content,
    })
}

/// `storedValue`: Strapi 4 stored EditorJS as a JSON string. `None` keeps the value as it is.
fn stored_value(value: &Value) -> Option<Value> {
    serde_json::from_str(value.as_str()?).ok()
}

/// A document while converting; legacy values are still unchecked JSON.
struct DraftDocument {
    attrs: Option<Map<String, Value>>,
    content: Vec<RichNode>,
}

fn schema_version() -> Option<Map<String, Value>> {
    let mut attrs = Map::new();
    attrs.insert("schemaVersion".to_owned(), Value::from(1));
    Some(attrs)
}

fn to_document(value: &Value) -> DraftDocument {
    if is_rich_document(value) {
        return DraftDocument {
            attrs: value.get("attrs").and_then(Value::as_object).cloned(),
            content: children(value).iter().map(rich_node).collect(),
        };
    }
    if let Some(blocks) = value.get("blocks").and_then(Value::as_array)
        && value.is_object()
    {
        return DraftDocument {
            attrs: schema_version(),
            content: blocks.iter().map(convert_block).collect(),
        };
    }
    // Unexpected values stay visible as text, never an empty document.
    DraftDocument {
        attrs: schema_version(),
        content: vec![legacy_block(value.clone())],
    }
}

/// `RichDocumentSchema`: `type` is `"doc"`, `attrs` an optional object, `content` an array of
/// rich nodes.
fn is_rich_document(value: &Value) -> bool {
    let Some(document) = value.as_object() else {
        return false;
    };
    document.get("type").and_then(Value::as_str) == Some("doc")
        && rich_text::optional(document, "attrs", Value::is_object)
        && document
            .get("content")
            .and_then(Value::as_array)
            .is_some_and(|nodes| nodes.iter().all(rich_text::is_tiptap_node))
}

fn children(node: &Value) -> &[Value] {
    node.get("content")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

/// A validated rich node as a [`RichNode`].
fn rich_node(value: &Value) -> RichNode {
    RichNode {
        kind: string(value.get("type")),
        text: value.get("text").and_then(Value::as_str).map(str::to_owned),
        attrs: value.get("attrs").and_then(Value::as_object).cloned(),
        marks: value.get("marks").and_then(Value::as_array).map(|marks| {
            marks
                .iter()
                .map(|mark| RichMark {
                    kind: string(mark.get("type")),
                    attrs: mark.get("attrs").and_then(Value::as_object).cloned(),
                })
                .collect()
        }),
        content: value
            .get("content")
            .and_then(Value::as_array)
            .map(|nodes| nodes.iter().map(rich_node).collect()),
    }
}

fn string(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or_default().to_owned()
}

fn node(kind: &str) -> RichNode {
    RichNode {
        kind: kind.to_owned(),
        text: None,
        attrs: None,
        marks: None,
        content: None,
    }
}

fn with_attrs(mut node: RichNode, attrs: Vec<(&str, Value)>) -> RichNode {
    node.attrs = Some(
        attrs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    );
    node
}

fn with_content(mut node: RichNode, content: Vec<RichNode>) -> RichNode {
    node.content = Some(content);
    node
}

fn text_node(text: String, marks: Option<Vec<RichMark>>) -> RichNode {
    RichNode {
        text: Some(text),
        marks,
        ..node("text")
    }
}

fn legacy_block(original: Value) -> RichNode {
    with_attrs(node("legacyBlock"), vec![("original", original)])
}

/// Content a converter cannot represent: the TS code throws and the block is preserved.
struct Unconvertible;

type Converted<T> = Result<T, Unconvertible>;

fn require_text(value: Option<&Value>) -> Converted<String> {
    value
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(Unconvertible)
}

fn text_or_empty(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or_default().to_owned()
}

// ── Inline HTML in legacy text fields ──────────────────────────

fn mark(kind: &str) -> RichMark {
    RichMark {
        kind: kind.to_owned(),
        attrs: None,
    }
}

fn mark_for(element: &Element) -> Converted<RichMark> {
    let simple = match element.name.as_str() {
        "b" | "strong" => Some("bold"),
        "i" | "em" => Some("italic"),
        "u" => Some("underline"),
        "s" | "strike" | "del" => Some("strike"),
        "code" => Some("code"),
        "mark" => Some("highlight"),
        "sup" => Some("superscript"),
        "sub" => Some("subscript"),
        _ => None,
    };
    if let Some(kind) = simple {
        return Ok(mark(kind));
    }
    let class = element.attribute("class");
    match element.name.as_str() {
        "a" => {
            let attribute = |name| element.attribute(name).map_or(Value::Null, Value::from);
            let mut attrs = Map::new();
            attrs.insert(
                "href".to_owned(),
                Value::from(element.attribute("href").unwrap_or_default()),
            );
            attrs.insert("target".to_owned(), attribute("target"));
            attrs.insert("title".to_owned(), attribute("title"));
            Ok(RichMark {
                kind: "link".to_owned(),
                attrs: Some(attrs),
            })
        }
        "span" if class == Some("cdx-marker") => Ok(mark("highlight")),
        "span" if class == Some("inline-code") => Ok(mark("code")),
        _ => Err(Unconvertible),
    }
}

/// `inlineContent`: parses HTML in old text fields without executing it; fails for markup it
/// would have to drop. A depth-first walk with an explicit stack (the TS recursion, unrolled), so
/// stack use does not grow with nesting.
fn inline_content(html: &str) -> Converted<Vec<RichNode>> {
    let tree = html::parse_document(html);
    let mut output = Vec::new();
    // Each frame: the siblings still to visit and the marks open around them.
    let mut frames: Vec<(std::slice::Iter<'_, Node>, Vec<RichMark>)> =
        vec![(tree.iter(), Vec::new())];
    while let Some((siblings, marks)) = frames.last_mut() {
        let Some(parsed) = siblings.next() else {
            frames.pop();
            continue;
        };
        match parsed {
            Node::Text(text) if text.is_empty() => {}
            Node::Text(text) => {
                let marks = (!marks.is_empty()).then(|| marks.clone());
                output.push(text_node(text.clone(), marks));
            }
            Node::Element(element) if element.name == "br" => output.push(node("hardBreak")),
            Node::Element(element) => {
                let mark = mark_for(element)?;
                // Do not silently discard inline styles or data from a legacy plugin.
                let allowed: &[&str] = if element.name == "a" {
                    &["href", "target", "rel", "title"]
                } else {
                    &["class"]
                };
                if element
                    .attribs
                    .iter()
                    .any(|(key, _)| !allowed.contains(&key.as_str()))
                {
                    return Err(Unconvertible);
                }
                // Tiptap's code mark excludes other marks.
                if !marks.is_empty()
                    && (mark.kind == "code" || marks.iter().any(|open| open.kind == "code"))
                {
                    return Err(Unconvertible);
                }
                let mut nested: Vec<RichMark> = marks
                    .iter()
                    .filter(|open| open.kind != mark.kind)
                    .cloned()
                    .collect();
                nested.push(mark);
                frames.push((element.children.iter(), nested));
            }
            Node::Other => {}
        }
    }
    Ok(output)
}

/// `plainText`: the text of the HTML, `<br>` as a newline. Walked with an explicit stack.
fn plain_text(html: &str) -> String {
    let tree = html::parse_document(html);
    let mut output = String::new();
    let mut frames = vec![tree.iter()];
    while let Some(siblings) = frames.last_mut() {
        match siblings.next() {
            None => {
                frames.pop();
            }
            Some(Node::Text(text)) => output.push_str(text),
            Some(Node::Element(element)) if element.name == "br" => output.push('\n'),
            Some(Node::Element(element)) => frames.push(element.children.iter()),
            Some(Node::Other) => {}
        }
    }
    output
}

static HTTP_URL: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"(?i)\Ahttps?://").ok());

/// `safeImageUrl`: an http(s) or root-relative URL; anything else is not rendered as an image.
fn is_safe_image_url(value: &str) -> bool {
    let url = js::trim(value);
    // Control characters and spaces make browsers read a different URL.
    if url.is_empty() || url.chars().any(|c| c <= '\u{20}' || c == '\u{7f}') {
        return false;
    }
    // `/^https?:\/\//iu`: case-insensitive with Unicode case folding (`ſ` matches `s`).
    let http = HTTP_URL.as_ref().is_some_and(|regex| regex.is_match(url));
    // A root-relative path only: `//host` and `/\host` would be another site.
    let root_relative = url
        .strip_prefix('/')
        .is_some_and(|rest| !rest.starts_with(['/', '\\']));
    http || root_relative
}

// ── Legacy EditorJS blocks ─────────────────────────────────────

fn paragraph_of(html: &str) -> Converted<RichNode> {
    Ok(with_content(node("paragraph"), inline_content(html)?))
}

const LIST_STYLES: [&str; 3] = ["ordered", "unordered", "checklist"];

/// `convertList({ style, items, meta })`.
fn convert_list(
    style: Option<&Value>,
    items: Option<&Value>,
    meta: Option<&Value>,
) -> Converted<RichNode> {
    let items = items
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .ok_or(Unconvertible)?;
    if js::truthy(style)
        && !style
            .and_then(Value::as_str)
            .is_some_and(|style| LIST_STYLES.contains(&style))
    {
        return Err(Unconvertible);
    }
    let style_name = style.and_then(Value::as_str);
    let task = style_name == Some("checklist");
    let empty = Map::new();
    let meta = meta.and_then(Value::as_object).unwrap_or(&empty);
    let list_items = items
        .iter()
        .map(|item| {
            let object = item.as_object().unwrap_or(&empty);
            let text = match item.as_str() {
                Some(text) => text.to_owned(),
                None => require_text(js::coalesce(object.get("content"), object.get("text")))?,
            };
            let mut content = vec![paragraph_of(&text)?];
            if let Some(nested) = object
                .get("items")
                .filter(|nested| nested.as_array().is_some_and(|nested| !nested.is_empty()))
            {
                content.push(convert_list(style, Some(nested), None)?);
            }
            if !task {
                return Ok(with_content(node("listItem"), content));
            }
            let item_meta = object
                .get("meta")
                .and_then(Value::as_object)
                .unwrap_or(&empty);
            let checked = js::truthy(js::coalesce(
                item_meta.get("checked"),
                object.get("checked"),
            ));
            Ok(with_content(
                with_attrs(node("taskItem"), vec![("checked", Value::Bool(checked))]),
                content,
            ))
        })
        .collect::<Converted<Vec<_>>>()?;
    if task {
        return Ok(with_content(node("taskList"), list_items));
    }
    if style_name == Some("ordered") {
        let start = js::coalesce(meta.get("start"), None)
            .cloned()
            .unwrap_or(Value::from(1));
        return Ok(with_content(
            with_attrs(node("orderedList"), vec![("start", start)]),
            list_items,
        ));
    }
    Ok(with_content(node("bulletList"), list_items))
}

fn convert_table(data: &Map<String, Value>) -> Converted<Option<RichNode>> {
    let Some(rows) = data
        .get("content")
        .and_then(Value::as_array)
        .filter(|rows| !rows.is_empty())
    else {
        return Ok(None);
    };
    let Some(width) = rows[0].as_array().map(Vec::len).filter(|width| *width > 0) else {
        return Ok(None);
    };
    if rows
        .iter()
        .any(|row| row.as_array().is_none_or(|row| row.len() != width))
    {
        return Ok(None);
    }
    let headings = js::truthy(data.get("withHeadings"));
    let table_rows = rows
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let cells = row
                .as_array()
                .map_or(&[][..], Vec::as_slice)
                .iter()
                .map(|cell| {
                    let kind = if headings && index == 0 {
                        "tableHeader"
                    } else {
                        "tableCell"
                    };
                    Ok(with_content(
                        node(kind),
                        vec![paragraph_of(&require_text(Some(cell))?)?],
                    ))
                })
                .collect::<Converted<Vec<_>>>()?;
            Ok(with_content(node("tableRow"), cells))
        })
        .collect::<Converted<Vec<_>>>()?;
    Ok(Some(with_content(
        with_attrs(
            node("table"),
            vec![("stretched", Value::Bool(js::truthy(data.get("stretched"))))],
        ),
        table_rows,
    )))
}

/// `convertKnownBlock`: the Tiptap node for a known EditorJS tool, `None` when the block must
/// be preserved.
fn convert_known_block(
    block_type: Option<&Value>,
    data: &Map<String, Value>,
) -> Converted<Option<RichNode>> {
    let empty = Map::new();
    let file = data
        .get("file")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let null = Value::Null;
    let or = |value: Option<&Value>, fallback: Value| {
        js::coalesce(value, None).cloned().unwrap_or(fallback)
    };
    Ok(Some(match block_type.and_then(Value::as_str) {
        Some("paragraph") => paragraph_of(&require_text(data.get("text"))?)?,
        Some("header") => {
            let Some(level) = data
                .get("level")
                .and_then(Value::as_f64)
                .filter(|level| level.fract() == 0.0 && (1.0..=6.0).contains(level))
            else {
                return Ok(None);
            };
            // JavaScript has one number type, so a stored `2.0` is the integer 2.
            let level = Value::from(level as i64);
            with_content(
                with_attrs(node("heading"), vec![("level", level)]),
                inline_content(&require_text(data.get("text"))?)?,
            )
        }
        Some("list") => convert_list(data.get("style"), data.get("items"), data.get("meta"))?,
        Some("checklist") => {
            let checklist = Value::from("checklist");
            convert_list(Some(&checklist), data.get("items"), data.get("meta"))?
        }
        Some("quote") => {
            let mut content = vec![paragraph_of(&require_text(data.get("text"))?)?];
            let caption = data.get("caption");
            if js::truthy(caption) {
                let caption = paragraph_of(&require_text(caption)?)?;
                content.push(with_attrs(
                    caption,
                    vec![("quoteCaption", Value::Bool(true))],
                ));
            }
            with_content(
                with_attrs(
                    node("blockquote"),
                    vec![("alignment", or(data.get("alignment"), Value::from("left")))],
                ),
                content,
            )
        }
        Some("delimiter") => node("horizontalRule"),
        Some("image") => {
            let src = require_text(js::coalesce(file.get("url"), data.get("url")))?;
            if !is_safe_image_url(&src) {
                return Ok(None);
            }
            let caption = text_or_empty(data.get("caption"));
            with_content(
                with_attrs(
                    node("mediaFigure"),
                    vec![
                        ("src", Value::from(src)),
                        ("alt", Value::from(plain_text(&caption))),
                        ("title", or(file.get("name"), null.clone())),
                        (
                            "withBorder",
                            Value::Bool(js::truthy(data.get("withBorder"))),
                        ),
                        (
                            "withBackground",
                            Value::Bool(js::truthy(data.get("withBackground"))),
                        ),
                        ("stretched", Value::Bool(js::truthy(data.get("stretched")))),
                    ],
                ),
                inline_content(&caption)?,
            )
        }
        Some("table") => return convert_table(data),
        Some("embed") => {
            let source = require_text(js::coalesce(data.get("source"), data.get("embed")))?;
            with_content(
                with_attrs(
                    node("mediaEmbed"),
                    vec![
                        ("source", Value::from(source)),
                        ("embed", or(data.get("embed"), Value::from(""))),
                        ("service", or(data.get("service"), Value::from(""))),
                        ("width", or(data.get("width"), null.clone())),
                        ("height", or(data.get("height"), null.clone())),
                    ],
                ),
                inline_content(&text_or_empty(data.get("caption")))?,
            )
        }
        Some("code") => {
            let code = data.get("code");
            let content = if js::truthy(code) {
                vec![text_node(require_text(code)?, None)]
            } else {
                Vec::new()
            };
            with_content(node("codeBlock"), content)
        }
        Some("attaches") => with_attrs(
            node("attachment"),
            vec![
                ("url", Value::from(require_text(file.get("url"))?)),
                (
                    "title",
                    or(
                        data.get("title"),
                        or(file.get("name"), Value::from("Download attachment")),
                    ),
                ),
                ("size", or(file.get("size"), null)),
            ],
        ),
        _ => return Ok(None),
    }))
}

fn convert_block(block: &Value) -> RichNode {
    let data = block.get("data").and_then(Value::as_object);
    match (block.as_object(), data) {
        (Some(_), Some(data)) => match convert_known_block(block.get("type"), data) {
            Ok(Some(node)) => node,
            Ok(None) | Err(Unconvertible) => legacy_block(block.clone()),
        },
        _ => legacy_block(block.clone()),
    }
}

// ── Output for the app ─────────────────────────────────────────

const LEGACY_TEXT_FIELDS: [&str; 8] = [
    "title", "text", "content", "caption", "code", "html", "items", "message",
];

fn legacy_strings(value: Option<&Value>, output: &mut Vec<String>) {
    match value {
        Some(Value::String(text)) => output.push(plain_text(text)),
        Some(Value::Array(items)) => {
            for item in items {
                legacy_strings(Some(item), output);
            }
        }
        Some(Value::Object(object)) => {
            for field in LEGACY_TEXT_FIELDS {
                legacy_strings(object.get(field), output);
            }
        }
        _ => {}
    }
}

/// Readable text for content neither converter could represent; never raw HTML.
fn legacy_paragraphs(original: Option<&Value>) -> Vec<RichNode> {
    let data = match original {
        Some(Value::Object(object)) if object.contains_key("data") => object.get("data"),
        other => other,
    };
    let mut strings = Vec::new();
    legacy_strings(data, &mut strings);
    strings
        .into_iter()
        .filter(|text| !text.is_empty())
        .map(|text| with_content(node("paragraph"), vec![text_node(text, None)]))
        .collect()
}

/// The attributes the app reads: without the preservation snapshot (`legacy`, `legacyDocument`).
fn app_attrs(attrs: Option<Map<String, Value>>) -> Option<Map<String, Value>> {
    let kept: Map<String, Value> = attrs?
        .into_iter()
        .filter(|(key, _)| key != "legacy" && key != "legacyDocument")
        .collect();
    (!kept.is_empty()).then_some(kept)
}

fn app_nodes(node: RichNode) -> Vec<RichNode> {
    if node.kind == "legacyBlock" {
        return legacy_paragraphs(node.attrs.as_ref().and_then(|attrs| attrs.get("original")));
    }
    vec![RichNode {
        kind: node.kind,
        text: node.text,
        attrs: app_attrs(node.attrs),
        marks: node.marks.map(|marks| {
            marks
                .into_iter()
                .map(|mark| RichMark {
                    kind: mark.kind,
                    attrs: app_attrs(mark.attrs),
                })
                .collect()
        }),
        content: node
            .content
            .map(|nodes| nodes.into_iter().flat_map(app_nodes).collect()),
    }]
}

fn is_empty_paragraph(node: &RichNode) -> bool {
    node.kind == "paragraph" && node.content.as_ref().is_none_or(Vec::is_empty)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn content_of(value: &Value) -> Value {
        serde_json::to_value(to_rich_content(value).unwrap().content).unwrap()
    }

    fn rich(value: &Value) -> Value {
        serde_json::to_value(to_rich_content(value)).unwrap()
    }

    fn doc(content: Value) -> Value {
        json!({ "type": "doc", "content": content })
    }

    fn text(value: &str) -> Value {
        json!({ "type": "text", "text": value })
    }

    fn marked(value: &str, marks: Value) -> Value {
        json!({ "type": "text", "text": value, "marks": marks })
    }

    fn paragraph(content: Vec<Value>) -> Value {
        json!({ "type": "paragraph", "content": content })
    }

    fn editor_js(blocks: Value) -> Value {
        json!({ "time": 1, "blocks": blocks, "version": "2.31.6" })
    }

    #[test]
    fn returns_none_when_there_is_nothing_to_show() {
        assert_eq!(to_rich_content(&Value::Null), None);
        assert_eq!(to_rich_content(&json!("")), None);
        assert_eq!(to_rich_content(&doc(json!([]))), None);
        assert_eq!(
            to_rich_content(&doc(json!([{ "type": "paragraph" }, paragraph(vec![])]))),
            None
        );
        assert_eq!(to_rich_content(&editor_js(json!([]))), None);
    }

    #[test]
    fn passes_tiptap_documents_through_without_the_preservation_snapshot() {
        let value = json!({
            "type": "doc",
            "attrs": {
                "schemaVersion": 1,
                "legacyDocument": editor_js(json!([{ "id": "a", "type": "paragraph", "data": { "text": "Hi" } }])),
            },
            "content": [
                {
                    "type": "paragraph",
                    "attrs": { "legacy": { "id": "a", "type": "paragraph", "data": { "text": "Hi" } }, "quoteCaption": false },
                    "content": [marked("Hi", json!([{ "type": "bold" }]))],
                },
                { "type": "bulletList", "content": [{ "type": "listItem", "attrs": { "legacy": {} }, "content": [paragraph(vec![text("One")])] }] },
            ],
        });
        assert_eq!(
            rich(&value),
            json!({
                "type": "doc",
                "attrs": { "schemaVersion": 1 },
                "content": [
                    { "type": "paragraph", "attrs": { "quoteCaption": false }, "content": [marked("Hi", json!([{ "type": "bold" }]))] },
                    { "type": "bulletList", "content": [{ "type": "listItem", "content": [paragraph(vec![text("One")])] }] },
                ],
            })
        );
    }

    #[test]
    fn converts_legacy_editorjs_into_the_document_the_website_renders() {
        let value = editor_js(json!([
            { "id": "h", "type": "header", "data": { "text": "Welcome", "level": 2 } },
            {
                "id": "p",
                "type": "paragraph",
                "data": { "text": "<b>Bold</b> &amp; <a href=\"https://example.com\">link</a><br>next&nbsp;line" },
            },
            {
                "id": "l",
                "type": "list",
                "data": {
                    "style": "ordered",
                    "meta": { "start": 3 },
                    "items": [{ "content": "One", "meta": {}, "items": [{ "content": "One.a", "meta": {}, "items": [] }] }],
                },
            },
            { "id": "c", "type": "checklist", "data": { "items": [{ "text": "Done", "checked": true }] } },
        ]));
        assert_eq!(
            rich(&value),
            json!({
                "type": "doc",
                "attrs": { "schemaVersion": 1 },
                "content": [
                    { "type": "heading", "attrs": { "level": 2 }, "content": [text("Welcome")] },
                    paragraph(vec![
                        marked("Bold", json!([{ "type": "bold" }])),
                        text(" & "),
                        marked("link", json!([{ "type": "link", "attrs": { "href": "https://example.com", "target": null, "title": null } }])),
                        json!({ "type": "hardBreak" }),
                        text("next\u{a0}line"),
                    ]),
                    {
                        "type": "orderedList",
                        "attrs": { "start": 3 },
                        "content": [{
                            "type": "listItem",
                            "content": [
                                paragraph(vec![text("One")]),
                                {
                                    "type": "orderedList",
                                    "attrs": { "start": 1 },
                                    "content": [{ "type": "listItem", "content": [paragraph(vec![text("One.a")])] }],
                                },
                            ],
                        }],
                    },
                    { "type": "taskList", "content": [{ "type": "taskItem", "attrs": { "checked": true }, "content": [paragraph(vec![text("Done")])] }] },
                ],
            })
        );
    }

    #[test]
    fn keeps_old_string_list_items() {
        let value = editor_js(json!([
            { "id": "l", "type": "list", "data": { "style": "unordered", "items": ["One", "<i>Two</i>"] } },
        ]));
        assert_eq!(
            content_of(&value),
            json!([{
                "type": "bulletList",
                "content": [
                    { "type": "listItem", "content": [paragraph(vec![text("One")])] },
                    { "type": "listItem", "content": [paragraph(vec![marked("Two", json!([{ "type": "italic" }]))])] },
                ],
            }])
        );
    }

    #[test]
    fn shows_content_it_cannot_convert_as_plain_text_paragraphs() {
        let value = editor_js(json!([
            { "id": "s", "type": "paragraph", "data": { "text": "<span style=\"color:red\">Red</span> text" } },
            { "id": "w", "type": "warning", "data": { "title": "Note", "message": "Be early" } },
            { "id": "m", "type": "mediaLib", "data": { "name": "mediaLibraryStrapi" } },
        ]));
        assert_eq!(
            content_of(&value),
            json!([
                paragraph(vec![text("Red text")]),
                paragraph(vec![text("Note")]),
                paragraph(vec![text("Be early")]),
            ])
        );
    }

    #[test]
    fn shows_the_cms_preserved_legacy_blocks_as_plain_text_paragraphs() {
        let value = doc(json!([
            { "type": "legacyBlock", "attrs": { "original": { "id": "r", "type": "raw", "data": { "html": "<p>Hello <b>there</b></p>" } } } },
            { "type": "legacyBlock", "attrs": { "original": { "id": "e", "type": "mediaLib", "data": { "name": "x" } } } },
        ]));
        assert_eq!(
            content_of(&value),
            json!([paragraph(vec![text("Hello there")])])
        );
    }

    #[test]
    fn converts_legacy_images_to_media_figures_and_drops_unsafe_image_urls() {
        let value = editor_js(json!([
            { "id": "i", "type": "image", "data": { "file": { "url": "https://example.com/a.png" }, "caption": "Choir" } },
            { "id": "j", "type": "image", "data": { "file": { "url": "javascript:alert(1)" }, "caption": "" } },
        ]));
        assert_eq!(
            content_of(&value),
            json!([{
                "type": "mediaFigure",
                "attrs": {
                    "src": "https://example.com/a.png",
                    "alt": "Choir",
                    "title": null,
                    "withBorder": false,
                    "withBackground": false,
                    "stretched": false,
                },
                "content": [text("Choir")],
            }])
        );
    }

    #[test]
    fn reads_strapi_4_editorjs_json_strings() {
        let value = editor_js(json!([
            { "id": "p", "type": "paragraph", "data": { "text": "From Strapi 4" } },
        ]));
        assert_eq!(
            to_rich_content(&json!(value.to_string())),
            to_rich_content(&value)
        );
        assert_eq!(
            content_of(&json!("Not JSON")),
            json!([paragraph(vec![text("Not JSON")])])
        );
    }

    #[test]
    fn never_fails_and_leaves_unknown_tiptap_nodes_for_the_renderer() {
        assert_eq!(to_rich_content(&json!({ "foo": "bar" })), None);
        let unknown =
            doc(json!([{ "type": "mysteryWidget", "content": [paragraph(vec![text("inside")])] }]));
        assert_eq!(rich(&unknown), unknown);
    }

    #[test]
    fn serializes_nodes_in_the_ts_key_order() {
        let value = doc(json!([{
            "content": [{ "marks": [{ "attrs": { "href": "/a" }, "type": "link" }], "text": "x", "type": "text" }],
            "attrs": { "b": 1, "a": 2 },
            "type": "paragraph",
        }]));
        assert_eq!(
            serde_json::to_string(&to_rich_content(&value)).unwrap(),
            r#"{"type":"doc","content":[{"type":"paragraph","attrs":{"b":1,"a":2},"content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"/a"}}]}]}]}"#
        );
    }

    // Security: deeply nested legacy HTML is read within the parser's nesting cap, through both
    // the inline converter and the plain-text fallback, without overflowing a small stack.
    #[test]
    fn reads_deeply_nested_legacy_html_on_a_small_stack() {
        let documents = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(|| {
                let bold = format!("{}deep", "<b>".repeat(100_000));
                let styled = format!("{}deep", "<span style=\"x\">".repeat(100_000));
                [bold, styled].map(|text| {
                    let value =
                        editor_js(json!([{ "type": "paragraph", "data": { "text": text } }]));
                    serde_json::to_value(to_rich_content(&value)).unwrap()
                })
            })
            .unwrap()
            .join()
            .unwrap();

        assert_eq!(
            documents[0]["content"],
            json!([paragraph(vec![marked("deep", json!([{ "type": "bold" }]))])])
        );
        assert_eq!(
            documents[1]["content"],
            json!([paragraph(vec![text("deep")])])
        );
    }

    /// The deepest `open + prefix * n + middle + suffix * n + close` serde_json still parses (its
    /// default 128-level recursion limit is the only bound on the JSON walkers), and that `n`.
    fn deepest(wrap: (&str, &str), repeat: (&str, &str), middle: &str) -> (String, usize) {
        let build = |n: usize| {
            format!(
                "{}{}{middle}{}{}",
                wrap.0,
                repeat.0.repeat(n),
                repeat.1.repeat(n),
                wrap.1
            )
        };
        let n = (1..200)
            .take_while(|n| serde_json::from_str::<Value>(&build(*n)).is_ok())
            .last()
            .unwrap();
        let too_deep = serde_json::from_str::<Value>(&build(n + 1)).unwrap_err();
        assert!(too_deep.to_string().contains("recursion limit exceeded"));
        (build(n), n)
    }

    // Security: every recursive walk over JSON is bounded by serde_json's parse limit, and the
    // deepest accepted documents convert well inside a Tokio worker's 2 MB stack.
    #[test]
    fn converts_the_deepest_json_serde_accepts_on_a_worker_sized_stack() {
        let (tiptap, quotes) = deepest(
            (r#"{"type":"doc","content":["#, "]}"),
            (r#"{"type":"blockquote","content":["#, "]}"),
            r#"{"type":"paragraph","content":[{"type":"text","text":"x"}]}"#,
        );
        let (legacy, lists) = deepest(
            (
                r#"{"blocks":[{"type":"list","data":{"style":"ordered","items":["#,
                "]}}]}",
            ),
            (r#"{"content":"a","items":["#, "]}"),
            r#""b""#,
        );
        assert!(quotes > 20 && lists > 10);
        std::thread::Builder::new()
            .stack_size(2 * 1024 * 1024)
            .spawn(move || {
                for text in [tiptap, legacy] {
                    let value: Value = serde_json::from_str(&text).unwrap();
                    let body = crate::strapi::rich_text::to_editor_js_string(&value).unwrap();
                    let document = to_rich_content(&value).unwrap();
                    assert!(body.is_some());
                    serde_json::to_string(&document).unwrap();
                }
            })
            .unwrap()
            .join()
            .unwrap();
    }
}
