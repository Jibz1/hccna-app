//! `toEditorJsString` from `packages/strapi-v2/src/richText.ts`: every rich text value becomes
//! the EditorJS JSON string installed apps render (`body`). Strapi 5 stores rich text as JSON:
//! untouched entries keep the legacy EditorJS object, entries saved in the new admin hold a
//! Tiptap document. The output is byte-identical to the TS server's `JSON.stringify`, key order
//! and number spelling included (see [`super::js::stringify`]).

use serde_json::{Map, Value};

use super::js;

/// `EDITOR_JS_VERSION`.
pub const EDITOR_JS_VERSION: &str = "2.31.0";

/// `UnsupportedRichTextError`: content the app's EditorJS renderer cannot show. The caller
/// fails the whole read as a decode error, as the TS client does.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("Unsupported rich text node: {node_type}")]
pub struct UnsupportedRichTextError {
    pub node_type: String,
}

impl UnsupportedRichTextError {
    fn new(node_type: impl Into<String>) -> Self {
        Self {
            node_type: node_type.into(),
        }
    }
}

/// `toEditorJsString(value)`. `null` (and a missing value) and `""` are `None`.
pub fn to_editor_js_string(value: &Value) -> Result<Option<String>, UnsupportedRichTextError> {
    match value {
        Value::Null => return Ok(None),
        Value::String(text) if text.is_empty() => return Ok(None),
        Value::String(text) => return Ok(Some(text.clone())),
        _ => {}
    }
    if let Some((document, blocks)) = editor_js_document(value) {
        // `{ ...value, blocks: value.blocks.map(appBlock) }`: `blocks` keeps its position.
        let mut output = document.clone();
        let blocks = blocks
            .iter()
            .enumerate()
            .map(|(index, block)| app_block(block.clone(), index))
            .collect();
        output.insert("blocks".to_owned(), Value::Array(blocks));
        return Ok(Some(js::stringify(&Value::Object(output))));
    }
    if is_tiptap_document(value) {
        let mut blocks = Vec::new();
        for node in children(value) {
            blocks.extend(to_blocks(node)?);
        }
        let blocks = blocks
            .into_iter()
            .enumerate()
            .map(|(index, block)| app_block(block, index))
            .collect();
        let mut output = Map::new();
        output.insert("time".to_owned(), Value::from(0));
        output.insert("blocks".to_owned(), Value::Array(blocks));
        output.insert("version".to_owned(), Value::from(EDITOR_JS_VERSION));
        return Ok(Some(js::stringify(&Value::Object(output))));
    }
    Err(UnsupportedRichTextError::new("document"))
}

// ── Shapes (`Schema.is` checks) ─────────────────────────────────

/// `EditorJsDocument`: an object whose `blocks` is an array.
fn editor_js_document(value: &Value) -> Option<(&Map<String, Value>, &Vec<Value>)> {
    let document = value.as_object()?;
    let blocks = document.get("blocks")?.as_array()?;
    Some((document, blocks))
}

/// `TiptapDocument`: `type` is `"doc"`; `content`, when present, is an array of Tiptap nodes.
fn is_tiptap_document(value: &Value) -> bool {
    let Some(document) = value.as_object() else {
        return false;
    };
    document.get("type").and_then(Value::as_str) == Some("doc")
        && optional(document, "content", |content| {
            content
                .as_array()
                .is_some_and(|nodes| nodes.iter().all(is_tiptap_node))
        })
}

/// `TiptapNodeSchema` (and `RichNodeSchema`, the same shape for JSON): a string `type`; optional
/// string `text`, object `attrs`, `marks` and `content` arrays.
pub(super) fn is_tiptap_node(value: &Value) -> bool {
    let Some(node) = value.as_object() else {
        return false;
    };
    node.get("type").is_some_and(Value::is_string)
        && optional(node, "text", Value::is_string)
        && optional(node, "attrs", Value::is_object)
        && optional(node, "marks", |marks| {
            marks.as_array().is_some_and(|marks| {
                marks.iter().all(|mark| {
                    mark.as_object().is_some_and(|mark| {
                        mark.get("type").is_some_and(Value::is_string)
                            && optional(mark, "attrs", Value::is_object)
                    })
                })
            })
        })
        && optional(node, "content", |content| {
            content
                .as_array()
                .is_some_and(|nodes| nodes.iter().all(is_tiptap_node))
        })
}

/// An optional key: absent, or present and valid.
pub(super) fn optional(
    object: &Map<String, Value>,
    key: &str,
    valid: impl Fn(&Value) -> bool,
) -> bool {
    object.get(key).is_none_or(valid)
}

/// `LegacyBlock`: an object with a string `type` and a `data` key (any value).
fn is_legacy_block(value: &Value) -> bool {
    value.as_object().is_some_and(|block| {
        block.get("type").is_some_and(Value::is_string) && block.contains_key("data")
    })
}

// ── Tiptap → EditorJS ──────────────────────────────────────────

const LIST_TYPES: [&str; 3] = ["bulletList", "orderedList", "taskList"];
const DROPPED_TYPES: [&str; 8] = [
    "image",
    "table",
    "embed",
    "horizontalRule",
    "delimiter",
    "mediaFigure",
    "mediaEmbed",
    "attachment",
];

fn node_type(node: &Value) -> &str {
    node.get("type").and_then(Value::as_str).unwrap_or_default()
}

/// `node.content ?? []` for a validated node.
fn children(node: &Value) -> &[Value] {
    node.get("content")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

fn attr<'a>(node: &'a Value, key: &str) -> Option<&'a Value> {
    node.get("attrs")?.get(key)
}

fn is_list(node: &Value) -> bool {
    LIST_TYPES.contains(&node_type(node))
}

fn is_dropped(node: &Value) -> bool {
    DROPPED_TYPES.contains(&node_type(node))
}

/// `escapeHtml`: `&`, `<` and `>` only.
fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn mark_tags(mark_type: &str) -> Option<(&'static str, &'static str)> {
    Some(match mark_type {
        "bold" => ("<b>", "</b>"),
        "italic" => ("<i>", "</i>"),
        "underline" => ("<u>", "</u>"),
        "strike" => ("<s>", "</s>"),
        "code" => ("<code class=\"inline-code\">", "</code>"),
        "highlight" => ("<mark class=\"cdx-marker\">", "</mark>"),
        "superscript" => ("<sup>", "</sup>"),
        "subscript" => ("<sub>", "</sub>"),
        _ => return None,
    })
}

fn wrap_mark(html: String, mark: &Value) -> Result<String, UnsupportedRichTextError> {
    let mark_type = node_type(mark);
    if mark_type == "link" {
        return Ok(match attr(mark, "href").and_then(Value::as_str) {
            Some(href) => format!(
                "<a href=\"{}\">{html}</a>",
                escape_html(href).replace('"', "&quot;")
            ),
            None => html,
        });
    }
    let (open, close) = mark_tags(mark_type)
        .ok_or_else(|| UnsupportedRichTextError::new(format!("mark:{mark_type}")))?;
    Ok(format!("{open}{html}{close}"))
}

fn inline_html(nodes: &[Value]) -> Result<String, UnsupportedRichTextError> {
    let mut html = String::new();
    for node in nodes {
        match node_type(node) {
            "text" => {
                let mut text =
                    escape_html(node.get("text").and_then(Value::as_str).unwrap_or_default());
                let marks = node.get("marks").and_then(Value::as_array);
                for mark in marks.into_iter().flatten() {
                    text = wrap_mark(text, mark)?;
                }
                html.push_str(&text);
            }
            "hardBreak" => html.push_str("<br>"),
            _ if is_dropped(node) => {}
            other => return Err(UnsupportedRichTextError::new(other)),
        }
    }
    Ok(html)
}

/// A code block's text children, escaped; other children are skipped.
fn code_text(node: &Value) -> String {
    children(node)
        .iter()
        .filter(|child| node_type(child) == "text")
        .map(|child| {
            escape_html(
                child
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
        })
        .collect()
}

fn non_empty(text: String) -> Vec<String> {
    if text.is_empty() {
        Vec::new()
    } else {
        vec![text]
    }
}

fn block_to_segments(node: &Value) -> Result<Vec<String>, UnsupportedRichTextError> {
    if is_dropped(node) {
        return Ok(Vec::new());
    }
    match node_type(node) {
        "paragraph" | "heading" => Ok(non_empty(inline_html(children(node))?)),
        "codeBlock" => Ok(non_empty(code_text(node))),
        "bulletList" | "orderedList" | "taskList" => flat_list_items(node),
        "blockquote" => flat_blockquote_segments(node),
        "legacyBlock" => Ok(Vec::new()),
        other => Err(UnsupportedRichTextError::new(other)),
    }
}

fn flat_blockquote_segments(blockquote: &Value) -> Result<Vec<String>, UnsupportedRichTextError> {
    let mut segments = Vec::new();
    for child in children(blockquote) {
        segments.extend(block_to_segments(child)?);
    }
    Ok(segments)
}

fn flat_list_items(list: &Value) -> Result<Vec<String>, UnsupportedRichTextError> {
    let mut items = Vec::new();
    let container = if is_list(list) { children(list) } else { &[] };
    for item in container {
        let mut own = Vec::new();
        let mut nested = Vec::new();
        for child in children(item) {
            if is_list(child) {
                nested.extend(flat_list_items(child)?);
            } else {
                own.extend(block_to_segments(child)?);
            }
        }
        // `.replace(/(<br>)+$/, "").replace(/^(<br>)+/, "")`
        let joined = own.join("<br>");
        let mut own_text = joined.as_str();
        while let Some(rest) = own_text.strip_suffix("<br>") {
            own_text = rest;
        }
        while let Some(rest) = own_text.strip_prefix("<br>") {
            own_text = rest;
        }
        if !own_text.is_empty() {
            items.push(own_text.to_owned());
        }
        items.extend(nested);
    }
    Ok(items)
}

fn block(block_type: &str, data: Map<String, Value>) -> Value {
    let mut block = Map::new();
    block.insert("type".to_owned(), Value::from(block_type));
    block.insert("data".to_owned(), Value::Object(data));
    Value::Object(block)
}

fn paragraph_block(html: String) -> Vec<Value> {
    if html.is_empty() {
        return Vec::new();
    }
    let mut data = Map::new();
    data.insert("text".to_owned(), Value::String(html));
    vec![block("paragraph", data)]
}

fn list_block(style: &str, items: Vec<String>) -> Vec<Value> {
    let mut data = Map::new();
    data.insert("style".to_owned(), Value::from(style));
    data.insert(
        "items".to_owned(),
        Value::Array(items.into_iter().map(Value::String).collect()),
    );
    vec![block("list", data)]
}

fn to_blocks(node: &Value) -> Result<Vec<Value>, UnsupportedRichTextError> {
    Ok(match node_type(node) {
        "paragraph" => paragraph_block(inline_html(children(node))?),
        "heading" => {
            let mut data = Map::new();
            data.insert(
                "text".to_owned(),
                Value::String(inline_html(children(node))?),
            );
            let level = attr(node, "level").filter(|level| level.is_number());
            data.insert("level".to_owned(), level.cloned().unwrap_or(Value::from(2)));
            vec![block("header", data)]
        }
        "bulletList" | "taskList" => list_block("unordered", flat_list_items(node)?),
        "orderedList" => list_block("ordered", flat_list_items(node)?),
        "blockquote" => paragraph_block(flat_blockquote_segments(node)?.join("<br>")),
        "codeBlock" => paragraph_block(code_text(node)),
        "legacyBlock" => attr(node, "original")
            .filter(|original| is_legacy_block(original))
            .cloned()
            .into_iter()
            .collect(),
        _ if is_dropped(node) => Vec::new(),
        other => return Err(UnsupportedRichTextError::new(other)),
    })
}

// ── Output for installed apps ──────────────────────────────────

/// `appBlock`: editorjs-viewer-native keys blocks by `id`, and the app's list renderer reads
/// every item as a string.
fn app_block(block: Value, index: usize) -> Value {
    if !is_legacy_block(&block) {
        return block;
    }
    let Value::Object(fields) = block else {
        return block;
    };
    // `{ id: …, ...block }`: a block's own `id`, whatever its type, overwrites the default in place.
    let mut with_id = Map::new();
    with_id.insert("id".to_owned(), Value::String(format!("block-{index}")));
    with_id.extend(fields);
    let flattened = match with_id.get("data") {
        Some(data) if with_id.get("type").and_then(Value::as_str) == Some("list") => {
            list_data(data)
        }
        _ => None,
    };
    if let Some(data) = flattened {
        with_id.insert("data".to_owned(), Value::Object(data));
    }
    Value::Object(with_id)
}

/// The flattened `{ style, items }` of a list block whose items are not all strings, if the data
/// has the `ListData` shape.
fn list_data(data: &Value) -> Option<Map<String, Value>> {
    let data = data.as_object()?;
    if !optional(data, "style", Value::is_string) {
        return None;
    }
    let items = data.get("items")?.as_array()?;
    if items.iter().all(Value::is_string) {
        return None;
    }
    let style = if data.get("style").and_then(Value::as_str) == Some("ordered") {
        "ordered"
    } else {
        "unordered"
    };
    let mut flattened = Map::new();
    flattened.insert("style".to_owned(), Value::from(style));
    flattened.insert(
        "items".to_owned(),
        Value::Array(
            flat_list_strings(items)
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );
    Some(flattened)
}

/// `ListItemObject`: optional string `content` and `text`, optional array `items`.
fn is_list_item_object(item: &Map<String, Value>) -> bool {
    optional(item, "content", Value::is_string)
        && optional(item, "text", Value::is_string)
        && optional(item, "items", Value::is_array)
}

/// `flatListStrings`: the newer EditorJS list tool saves `{ content, items }` objects.
fn flat_list_strings(items: &[Value]) -> Vec<String> {
    let mut strings = Vec::new();
    for item in items {
        if let Some(text) = item.as_str() {
            strings.push(text.to_owned());
            continue;
        }
        let Some(object) = item
            .as_object()
            .filter(|object| is_list_item_object(object))
        else {
            continue;
        };
        // `item.content ?? item.text ?? ""`: a present empty `content` wins over `text`.
        let own = object
            .get("content")
            .or_else(|| object.get("text"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !own.is_empty() {
            strings.push(own.to_owned());
        }
        if let Some(nested) = object.get("items").and_then(Value::as_array) {
            strings.extend(flat_list_strings(nested));
        }
    }
    strings
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn convert(value: &Value) -> Option<String> {
        to_editor_js_string(value).unwrap()
    }

    fn parsed_blocks(value: &Value) -> Vec<Value> {
        let text = convert(value).unwrap();
        let parsed: Value = serde_json::from_str(&text).unwrap();
        parsed["blocks"].as_array().unwrap().clone()
    }

    /// Block content without ids; the "block ids" tests cover them.
    fn blocks_of(value: &Value) -> Vec<Value> {
        parsed_blocks(value)
            .into_iter()
            .map(|mut block| {
                block.as_object_mut().unwrap().shift_remove("id");
                block
            })
            .collect()
    }

    fn doc(content: Vec<Value>) -> Value {
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

    fn item(content: Vec<Value>) -> Value {
        json!({ "type": "listItem", "content": content })
    }

    fn rejected(value: &Value) -> String {
        to_editor_js_string(value).unwrap_err().node_type
    }

    #[test]
    fn returns_none_for_empty_values() {
        assert_eq!(convert(&Value::Null), None);
        assert_eq!(convert(&json!("")), None);
    }

    #[test]
    fn passes_legacy_editorjs_objects_through_unchanged() {
        let legacy = r#"{"time":1757537055329,"blocks":[{"id":"a","type":"image","data":{}}],"version":"2.28.2"}"#;
        let value: Value = serde_json::from_str(legacy).unwrap();
        assert_eq!(convert(&value).as_deref(), Some(legacy));
    }

    #[test]
    fn passes_an_editorjs_string_through_unchanged() {
        let value = r#"{"time":1,"blocks":[],"version":"2.28.2"}"#;
        assert_eq!(convert(&json!(value)).as_deref(), Some(value));
    }

    #[test]
    fn converts_paragraphs_marks_links_and_hard_breaks() {
        let value = doc(vec![paragraph(vec![
            marked("Hello ", json!([{ "type": "bold" }])),
            marked(
                "world",
                json!([{ "type": "italic" }, { "type": "link", "attrs": { "href": "https://example.com/?a=1&b=2" } }]),
            ),
            json!({ "type": "hardBreak" }),
            text("5 < 6 & 7"),
        ])]);
        assert_eq!(
            convert(&value).unwrap(),
            r#"{"time":0,"blocks":[{"id":"block-0","type":"paragraph","data":{"text":"<b>Hello </b><a href=\"https://example.com/?a=1&amp;b=2\"><i>world</i></a><br>5 &lt; 6 &amp; 7"}}],"version":"2.31.0"}"#
        );
    }

    #[test]
    fn converts_headings_and_skips_empty_paragraphs() {
        let value = doc(vec![
            json!({ "type": "heading", "attrs": { "level": 3 }, "content": [text("Title")] }),
            paragraph(vec![]),
        ]);
        assert_eq!(
            blocks_of(&value),
            [json!({ "type": "header", "data": { "text": "Title", "level": 3 } })]
        );
    }

    #[test]
    fn converts_lists_and_flattens_nested_items() {
        let value = doc(vec![
            json!({ "type": "bulletList", "content": [
                item(vec![
                    paragraph(vec![text("One")]),
                    json!({ "type": "orderedList", "content": [item(vec![paragraph(vec![text("One.a")])])] }),
                ]),
                item(vec![paragraph(vec![text("Two")])]),
            ] }),
            json!({ "type": "orderedList", "content": [item(vec![paragraph(vec![text("First")])])] }),
        ]);
        assert_eq!(
            blocks_of(&value),
            [
                json!({ "type": "list", "data": { "style": "unordered", "items": ["One", "One.a", "Two"] } }),
                json!({ "type": "list", "data": { "style": "ordered", "items": ["First"] } }),
            ]
        );
    }

    #[test]
    fn turns_blockquotes_into_paragraphs_and_keeps_preserved_legacy_blocks() {
        let legacy_block = json!({ "id": "x", "type": "paragraph", "data": { "text": "kept" } });
        let value = doc(vec![
            json!({ "type": "blockquote", "content": [paragraph(vec![text("Quoted")]), paragraph(vec![text("Twice")])] }),
            json!({ "type": "legacyBlock", "attrs": { "original": legacy_block } }),
        ]);
        assert_eq!(
            blocks_of(&value),
            [
                json!({ "type": "paragraph", "data": { "text": "Quoted<br>Twice" } }),
                json!({ "type": "paragraph", "data": { "text": "kept" } }),
            ]
        );
    }

    #[test]
    fn drops_images_tables_embeds_and_rules_the_app_cannot_render() {
        let value = doc(vec![
            json!({ "type": "image", "attrs": { "src": "https://example.com/a.png" } }),
            json!({ "type": "table", "content": [] }),
            json!({ "type": "embed", "attrs": {} }),
            json!({ "type": "horizontalRule" }),
            paragraph(vec![text("Visible")]),
        ]);
        assert_eq!(
            blocks_of(&value),
            [json!({ "type": "paragraph", "data": { "text": "Visible" } })]
        );
    }

    #[test]
    fn rejects_values_that_are_neither_editorjs_nor_tiptap() {
        assert_eq!(rejected(&json!({ "foo": "bar" })), "document");
        assert_eq!(rejected(&json!(false)), "document");
        assert_eq!(rejected(&json!(5)), "document");
        assert_eq!(rejected(&json!([])), "document");
        // A Tiptap node whose `text` is not a string fails the Tiptap shape.
        assert_eq!(
            rejected(&doc(vec![json!({ "type": "text", "text": null })])),
            "document"
        );
        assert_eq!(
            rejected(&doc(vec![json!({ "type": "paragraph", "attrs": [] })])),
            "document"
        );
    }

    #[test]
    fn drops_top_level_media_attachment_and_table_nodes() {
        let value = doc(vec![
            json!({ "type": "mediaFigure", "attrs": { "src": "https://example.com/a.png" } }),
            paragraph(vec![text("First")]),
            json!({ "type": "mediaEmbed", "attrs": { "src": "https://example.com/embed" } }),
            paragraph(vec![text("Second")]),
            json!({ "type": "attachment", "attrs": { "id": "123" } }),
            json!({ "type": "table", "content": [] }),
            paragraph(vec![text("Third")]),
        ]);
        assert_eq!(
            blocks_of(&value),
            [
                json!({ "type": "paragraph", "data": { "text": "First" } }),
                json!({ "type": "paragraph", "data": { "text": "Second" } }),
                json!({ "type": "paragraph", "data": { "text": "Third" } }),
            ]
        );
    }

    #[test]
    fn drops_media_nodes_inside_blockquotes_and_flattens_content() {
        let value = doc(vec![json!({ "type": "blockquote", "content": [
            paragraph(vec![text("Quoted")]),
            { "type": "mediaFigure", "attrs": { "src": "https://example.com/a.png" } },
            { "type": "horizontalRule" },
            paragraph(vec![text("Again")]),
        ] })]);
        assert_eq!(
            blocks_of(&value),
            [json!({ "type": "paragraph", "data": { "text": "Quoted<br>Again" } })]
        );
    }

    #[test]
    fn converts_a_blockquote_containing_a_heading_and_a_paragraph() {
        let value = doc(vec![json!({ "type": "blockquote", "content": [
            { "type": "heading", "attrs": { "level": 2 }, "content": [text("Title")] },
            paragraph(vec![text("Body")]),
        ] })]);
        assert_eq!(
            blocks_of(&value),
            [json!({ "type": "paragraph", "data": { "text": "Title<br>Body" } })]
        );
    }

    #[test]
    fn drops_media_from_list_items_while_keeping_text() {
        let value = doc(vec![json!({ "type": "bulletList", "content": [
            item(vec![paragraph(vec![text("One")]), json!({ "type": "mediaFigure", "attrs": { "src": "https://example.com/a.png" } })]),
            item(vec![paragraph(vec![text("Two")])]),
        ] })]);
        assert_eq!(
            blocks_of(&value),
            [json!({ "type": "list", "data": { "style": "unordered", "items": ["One", "Two"] } })]
        );
    }

    #[test]
    fn converts_task_lists() {
        let task = |label: &str| json!({ "type": "taskItem", "content": [paragraph(vec![text(label)])], "attrs": { "checked": false } });
        let value = doc(vec![
            json!({ "type": "taskList", "content": [task("Buy"), task("Sell")] }),
        ]);
        assert_eq!(
            blocks_of(&value),
            [json!({ "type": "list", "data": { "style": "unordered", "items": ["Buy", "Sell"] } })]
        );
    }

    #[test]
    fn converts_a_top_level_code_block_with_escaped_content() {
        let value = doc(vec![
            json!({ "type": "codeBlock", "content": [text("const x = 1 < 2;")] }),
        ]);
        assert_eq!(
            blocks_of(&value),
            [json!({ "type": "paragraph", "data": { "text": "const x = 1 &lt; 2;" } })]
        );
    }

    #[test]
    fn rejects_unknown_nodes_and_marks_anywhere() {
        let mystery = json!({ "type": "mystery" });
        assert_eq!(rejected(&doc(vec![mystery.clone()])), "mystery");
        assert_eq!(
            rejected(&doc(vec![
                json!({ "type": "blockquote", "content": [mystery.clone()] })
            ])),
            "mystery"
        );
        assert_eq!(
            rejected(&doc(vec![
                json!({ "type": "bulletList", "content": [item(vec![mystery.clone()])] })
            ])),
            "mystery"
        );
        assert_eq!(
            rejected(&doc(vec![paragraph(vec![mystery.clone()])])),
            "mystery"
        );
        assert_eq!(
            rejected(&doc(vec![paragraph(vec![marked(
                "x",
                json!([{ "type": "glow" }])
            )])])),
            "mark:glow"
        );
        assert_eq!(
            UnsupportedRichTextError::new("mystery").to_string(),
            "Unsupported rich text node: mystery"
        );
    }

    #[test]
    fn gives_every_converted_block_an_id_and_keeps_preserved_ids() {
        let legacy_block = json!({ "id": "x", "type": "paragraph", "data": { "text": "kept" } });
        let value = doc(vec![
            paragraph(vec![text("One")]),
            json!({ "type": "legacyBlock", "attrs": { "original": legacy_block } }),
            paragraph(vec![text("Two")]),
        ]);
        let ids: Vec<_> = parsed_blocks(&value)
            .into_iter()
            .map(|block| block["id"].clone())
            .collect();
        assert_eq!(ids, [json!("block-0"), json!("x"), json!("block-2")]);
    }

    #[test]
    fn gives_legacy_editorjs_blocks_without_an_id_one() {
        let legacy = json!({ "time": 1, "blocks": [
            { "type": "paragraph", "data": { "text": "a" } },
            { "id": "b", "type": "paragraph", "data": { "text": "b" } },
        ], "version": "2.31.6" });
        let ids: Vec<_> = parsed_blocks(&legacy)
            .into_iter()
            .map(|block| block["id"].clone())
            .collect();
        assert_eq!(ids, [json!("block-0"), json!("b")]);
    }

    #[test]
    fn flattens_the_newer_list_tools_item_objects_into_strings() {
        let legacy = json!({ "time": 1, "version": "2.31.6", "blocks": [{ "id": "l", "type": "list", "data": {
            "style": "unordered",
            "meta": {},
            "items": [
                { "content": "Sunday", "meta": {}, "items": [{ "content": "9am", "meta": {}, "items": [] }] },
                { "content": "Wednesday", "meta": {}, "items": [] },
            ],
        } }] });
        assert_eq!(
            parsed_blocks(&legacy),
            [
                json!({ "id": "l", "type": "list", "data": { "style": "unordered", "items": ["Sunday", "9am", "Wednesday"] } })
            ]
        );
    }

    #[test]
    fn turns_checklist_items_into_unordered_list_items() {
        let legacy = json!({ "time": 1, "version": "2.31.6", "blocks": [{ "id": "c", "type": "list", "data": {
            "style": "checklist",
            "meta": {},
            "items": [{ "content": "Bring a Bible", "meta": { "checked": true }, "items": [] }],
        } }] });
        assert_eq!(
            parsed_blocks(&legacy),
            [
                json!({ "id": "c", "type": "list", "data": { "style": "unordered", "items": ["Bring a Bible"] } })
            ]
        );
    }

    #[test]
    fn leaves_string_list_items_as_they_are() {
        let legacy = r#"{"time":1,"version":"2.28.2","blocks":[{"id":"s","type":"list","data":{"style":"ordered","items":["One","Two"]}}]}"#;
        let value: Value = serde_json::from_str(legacy).unwrap();
        assert_eq!(convert(&value).as_deref(), Some(legacy));
    }

    /// Inputs (as the JSON text Strapi would send) and the exact strings the TS
    /// `toEditorJsString` returned for them, run in Bun.
    const GOLDEN: [(&str, &str, &str); 9] = [
        (
            "legacy key order",
            r#"{"version":"2.28.2","blocks":[{"data":{"text":"Hi"},"type":"paragraph"}],"time":1757537055329,"extra":{"b":1,"a":2}}"#,
            r#"{"version":"2.28.2","blocks":[{"id":"block-0","data":{"text":"Hi"},"type":"paragraph"}],"time":1757537055329,"extra":{"b":1,"a":2}}"#,
        ),
        (
            "integer keys",
            r#"{"time":1,"blocks":[{"type":"paragraph","data":{"text":"x","10":"ten","2":"two","b":"b","01":"z"}}],"version":"2.28.2"}"#,
            r#"{"time":1,"blocks":[{"id":"block-0","type":"paragraph","data":{"2":"two","10":"ten","text":"x","b":"b","01":"z"}}],"version":"2.28.2"}"#,
        ),
        (
            "numbers",
            r#"{"time":1.0,"blocks":[{"type":"header","data":{"text":"T","level":2.0,"big":1e21,"small":1.5e-7,"neg":-0.0,"f":0.1,"g":123456789012345678901234,"h":100,"i":1e-6,"j":12345678901234567890}}],"version":"2.28.2"}"#,
            r#"{"time":1,"blocks":[{"id":"block-0","type":"header","data":{"text":"T","level":2,"big":1e+21,"small":1.5e-7,"neg":0,"f":0.1,"g":1.2345678901234569e+23,"h":100,"i":0.000001,"j":12345678901234567000}}],"version":"2.28.2"}"#,
        ),
        (
            "duplicate keys",
            r#"{"time":1,"blocks":[{"type":"paragraph","data":{"text":"a"},"type":"header"}],"version":"x","time":2}"#,
            r#"{"time":2,"blocks":[{"id":"block-0","type":"header","data":{"text":"a"}}],"version":"x"}"#,
        ),
        (
            "id types",
            r#"{"time":1,"blocks":[{"id":5,"type":"paragraph","data":{}},{"type":"x","data":null,"id":"keep"},{"data":{},"type":"y"},{"type":"no-data"},"str",{"type":7,"data":{}}],"version":"2.28.2"}"#,
            r#"{"time":1,"blocks":[{"id":5,"type":"paragraph","data":{}},{"id":"keep","type":"x","data":null},{"id":"block-2","data":{},"type":"y"},{"type":"no-data"},"str",{"type":7,"data":{}}],"version":"2.28.2"}"#,
        ),
        (
            "list objects",
            r#"{"time":1,"blocks":[{"id":"l","type":"list","data":{"meta":{},"style":"checklist","items":[{"content":"A","items":[{"text":"A.1"},{"content":"","text":"skip-own","items":["A.2"]}]},{"content":null},5,"B",{"items":[{"content":"C.1"}]}]}},{"type":"list","data":{"style":"ordered","items":[{"content":"x"}]}},{"type":"list","data":{"style":5,"items":[{"content":"x"}]}},{"type":"list","data":{"items":["a","b"]}}],"version":"2.31.6"}"#,
            r#"{"time":1,"blocks":[{"id":"l","type":"list","data":{"style":"unordered","items":["A","A.1","A.2","B","C.1"]}},{"id":"block-1","type":"list","data":{"style":"ordered","items":["x"]}},{"id":"block-2","type":"list","data":{"style":5,"items":[{"content":"x"}]}},{"id":"block-3","type":"list","data":{"items":["a","b"]}}],"version":"2.31.6"}"#,
        ),
        (
            "tiptap, every node kind",
            r#"{"type":"doc","content":[{"type":"heading","attrs":{"level":4},"content":[{"type":"text","text":"H"}]},{"type":"heading","content":[]},{"type":"heading","attrs":{"level":"3"},"content":[{"type":"text","text":"S"}]},{"type":"paragraph","content":[{"type":"text","text":"a&<b>\"'","marks":[{"type":"bold"},{"type":"italic"},{"type":"underline"},{"type":"strike"},{"type":"code"},{"type":"highlight"},{"type":"superscript"},{"type":"subscript"},{"type":"link","attrs":{"href":"https://example.com/?q=\"x\"&y=<z>"}},{"type":"link","attrs":{"href":5}},{"type":"link"}]},{"type":"hardBreak"},{"type":"image"},{"type":"text"}]},{"type":"paragraph"},{"type":"codeBlock","content":[{"type":"text","text":"a<b"},{"type":"hardBreak"},{"type":"text"}]},{"type":"codeBlock"},{"type":"blockquote","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"q1"}]}]}]},{"type":"codeBlock","content":[{"type":"text","text":"c"}]},{"type":"legacyBlock"},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"deep"}]}]}]},{"type":"blockquote","content":[]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"hardBreak"},{"type":"text","text":"lead"},{"type":"hardBreak"}]},{"type":"paragraph","content":[]},{"type":"paragraph","content":[{"type":"text","text":"second"},{"type":"hardBreak"},{"type":"hardBreak"}]}]},{"type":"listItem","content":[{"type":"taskList","content":[{"type":"taskItem","content":[{"type":"paragraph","content":[{"type":"text","text":"nested task"}]}]}]},{"type":"paragraph","content":[{"type":"text","text":"after nested"}]}]},{"type":"listItem"},{"type":"whatever","content":[{"type":"codeBlock","content":[{"type":"text","text":"code item"}]},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"quote item"}]}]}]}]},{"type":"orderedList","content":[]},{"type":"legacyBlock","attrs":{"original":{"type":"list","data":{"style":"unordered","items":[{"content":"L1","items":[]}]}}}},{"type":"legacyBlock","attrs":{"original":{"type":"paragraph"}}},{"type":"legacyBlock","attrs":{"original":{"id":3,"data":{"text":"n"},"type":"paragraph"}}},{"type":"horizontalRule"},{"type":"table","content":[]},{"type":"paragraph","content":[{"type":"text","text":"end"}]}]}"#,
            r#"{"time":0,"blocks":[{"id":"block-0","type":"header","data":{"text":"H","level":4}},{"id":"block-1","type":"header","data":{"text":"","level":2}},{"id":"block-2","type":"header","data":{"text":"S","level":2}},{"id":"block-3","type":"paragraph","data":{"text":"<a href=\"https://example.com/?q=&quot;x&quot;&amp;y=&lt;z&gt;\"><sub><sup><mark class=\"cdx-marker\"><code class=\"inline-code\"><s><u><i><b>a&amp;&lt;b&gt;\"'</b></i></u></s></code></mark></sup></sub></a><br>"}},{"id":"block-4","type":"paragraph","data":{"text":"a&lt;b"}},{"id":"block-5","type":"paragraph","data":{"text":"q1<br>c<br>deep"}},{"id":"block-6","type":"list","data":{"style":"unordered","items":["lead<br><br>second","after nested","nested task","code item<br>quote item"]}},{"id":"block-7","type":"list","data":{"style":"ordered","items":[]}},{"id":"block-8","type":"list","data":{"style":"unordered","items":["L1"]}},{"id":3,"data":{"text":"n"},"type":"paragraph"},{"id":"block-10","type":"paragraph","data":{"text":"end"}}],"version":"2.31.0"}"#,
        ),
        (
            "tiptap without content",
            r#"{"type":"doc"}"#,
            r#"{"time":0,"blocks":[],"version":"2.31.0"}"#,
        ),
        (
            "editorjs wins over tiptap",
            r#"{"type":"doc","blocks":[]}"#,
            r#"{"type":"doc","blocks":[]}"#,
        ),
    ];

    #[test]
    fn matches_the_ts_output_byte_for_byte() {
        for (name, input, expected) in GOLDEN {
            let value: Value = serde_json::from_str(input).unwrap();
            assert_eq!(convert(&value).as_deref(), Some(expected), "{name}");
        }
        // Escapes: JSON.stringify leaves DEL, U+2028 and non-ASCII unescaped.
        let value: Value = serde_json::from_str(
            r#"{"time":1,"blocks":[{"type":"paragraph","data":{"text":"Tab\tQuote\" Slash\/ Back\\ \u0001 \u007f é   😀"}}],"version":"2.28.2"}"#,
        )
        .unwrap();
        assert_eq!(
            convert(&value).unwrap(),
            "{\"time\":1,\"blocks\":[{\"id\":\"block-0\",\"type\":\"paragraph\",\"data\":{\"text\":\"Tab\\tQuote\\\" Slash/ Back\\\\ \\u0001 \u{7f} é \u{2028} 😀\"}}],\"version\":\"2.28.2\"}"
        );
    }
}
