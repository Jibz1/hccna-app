//! The nesting limit, checked right after parsing and without recursion.
//!
//! async-graphql rejects documents nested deeper than `MAX_RECURSIVE_DEPTH` (32), counting
//! fragment spreads and inline fragments as levels, but only inside `schema.execute`. Before that,
//! the handler walks the document recursively (root fields, the cache policy, the cost model, null
//! propagation), and the parser bounds nesting only within one definition. A chain of a few
//! thousand fragments, each spreading the next, therefore overflowed the stack, which aborts the
//! whole process (a JavaScript `RangeError` would only fail the request). This check applies the
//! same limit first, with explicit stacks, to every operation and every fragment definition. A
//! fragment cycle has unbounded depth and fails it too, with the same error async-graphql gives.

use std::collections::HashMap;

use async_graphql::parser::types::{ExecutableDocument, Selection, SelectionSet};
use async_graphql::{Pos, Positioned};

use crate::graphql::MAX_RECURSIVE_DEPTH;

/// async-graphql's message for the limit.
pub fn depth_error_message() -> String {
    format!("The recursion depth of the query cannot be greater than `{MAX_RECURSIVE_DEPTH}`")
}

/// A document over the limit. For an operation, `pos` is the selection set async-graphql would
/// report: the first one past the limit in its pre-order walk.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DepthExceeded {
    pub pos: Option<Pos>,
}

/// Depths are counted up to one past the limit; a cycle counts as that.
const OVER: usize = MAX_RECURSIVE_DEPTH + 1;

/// `Ok` when every operation and every fragment definition nests at most `MAX_RECURSIVE_DEPTH`
/// levels, counting nested selection sets, fragment spreads and inline fragments as
/// async-graphql's `check_recursive_depth` does. Fragment definitions are checked even when no
/// operation uses them, because async-graphql's `NoFragmentCycles` rule also follows every spread
/// from every fragment.
///
/// The walk is linear: each fragment's depth is computed once (an explicit stack over the
/// fragment graph). Recursion happens only inside one definition, which the parser limits to
/// 64 levels.
pub fn check(document: &ExecutableDocument) -> Result<(), DepthExceeded> {
    let fragments = fragment_depths(document);
    for (_, operation) in document.operations.iter() {
        let set = &operation.node.selection_set;
        if set_depth(&fragments, &set.node) > MAX_RECURSIVE_DEPTH {
            return Err(DepthExceeded {
                pos: first_too_deep(document, &fragments, set),
            });
        }
    }
    if fragments.values().any(|depth| *depth > MAX_RECURSIVE_DEPTH) {
        return Err(DepthExceeded { pos: None });
    }
    Ok(())
}

/// The depth below `set` (0 for a set without nested sets), saturating at `OVER`.
fn set_depth(fragments: &HashMap<&str, usize>, set: &SelectionSet) -> usize {
    let mut deepest = 0;
    for selection in &set.items {
        let below = match &selection.node {
            Selection::Field(field) if field.node.selection_set.node.items.is_empty() => continue,
            Selection::Field(field) => set_depth(fragments, &field.node.selection_set.node),
            Selection::InlineFragment(fragment) => {
                set_depth(fragments, &fragment.node.selection_set.node)
            }
            Selection::FragmentSpread(spread) => {
                match fragments.get(spread.node.fragment_name.node.as_str()) {
                    Some(depth) => *depth,
                    // Unknown fragments are skipped, as by async-graphql (validation reports them).
                    None => continue,
                }
            }
        };
        deepest = deepest.max(below.saturating_add(1));
        if deepest >= OVER {
            return OVER;
        }
    }
    deepest
}

/// The spreads directly in one definition, each with the depth of the set that holds it.
fn spreads_of<'a>(set: &'a SelectionSet, depth: usize, out: &mut Vec<(usize, &'a str)>) {
    for selection in &set.items {
        match &selection.node {
            Selection::Field(field) => spreads_of(&field.node.selection_set.node, depth + 1, out),
            Selection::InlineFragment(fragment) => {
                spreads_of(&fragment.node.selection_set.node, depth + 1, out);
            }
            Selection::FragmentSpread(spread) => {
                out.push((depth, spread.node.fragment_name.node.as_str()));
            }
        }
    }
}

/// The deepest nesting inside one definition, spreads not followed.
fn local_depth(set: &SelectionSet) -> usize {
    set.items
        .iter()
        .filter_map(|selection| match &selection.node {
            Selection::Field(field) if field.node.selection_set.node.items.is_empty() => None,
            Selection::Field(field) => Some(local_depth(&field.node.selection_set.node) + 1),
            Selection::InlineFragment(fragment) => {
                Some(local_depth(&fragment.node.selection_set.node) + 1)
            }
            Selection::FragmentSpread(_) => None,
        })
        .max()
        .unwrap_or(0)
}

/// Every fragment's depth, depth-first over the spread graph with an explicit stack. A fragment
/// that reaches itself is `OVER`.
fn fragment_depths(document: &ExecutableDocument) -> HashMap<&str, usize> {
    struct Frame<'a> {
        name: &'a str,
        spreads: Vec<(usize, &'a str)>,
        next: usize,
        deepest: usize,
        /// The depth of the set holding the spread being followed.
        pending: usize,
    }

    fn frame<'a>(document: &'a ExecutableDocument, name: &'a str) -> Option<Frame<'a>> {
        let fragment = document.fragments.get(name)?;
        let set = &fragment.node.selection_set.node;
        let mut spreads = Vec::new();
        spreads_of(set, 0, &mut spreads);
        Some(Frame {
            name,
            spreads,
            next: 0,
            deepest: local_depth(set).min(OVER),
            pending: 0,
        })
    }

    let mut done: HashMap<&str, usize> = HashMap::new();
    let mut active: HashMap<&str, ()> = HashMap::new();
    for root in document.fragments.keys() {
        let root = root.as_str();
        if done.contains_key(root) {
            continue;
        }
        let Some(first) = frame(document, root) else {
            continue;
        };
        active.insert(root, ());
        let mut stack = vec![first];
        while let Some(top) = stack.last_mut() {
            if let Some(&(depth, child)) = top.spreads.get(top.next) {
                top.next += 1;
                let through =
                    |below: usize| depth.saturating_add(1).saturating_add(below).min(OVER);
                if let Some(below) = done.get(child) {
                    top.deepest = top.deepest.max(through(*below));
                } else if active.contains_key(child) {
                    top.deepest = OVER;
                } else if let Some(next) = frame(document, child) {
                    top.pending = depth;
                    active.insert(child, ());
                    stack.push(next);
                }
                continue;
            }
            let Some(finished) = stack.pop() else { break };
            active.remove(finished.name);
            done.insert(finished.name, finished.deepest);
            if let Some(parent) = stack.last_mut() {
                let through = parent
                    .pending
                    .saturating_add(1)
                    .saturating_add(finished.deepest)
                    .min(OVER);
                parent.deepest = parent.deepest.max(through);
            }
        }
    }
    done
}

/// The first selection set past the limit in async-graphql's pre-order walk: from the root,
/// always into the first child whose subtree goes past the limit (one exists while the depth is
/// over), until a set itself is past it.
fn first_too_deep(
    document: &ExecutableDocument,
    fragments: &HashMap<&str, usize>,
    root: &Positioned<SelectionSet>,
) -> Option<Pos> {
    let mut set = root;
    let mut current = 0;
    loop {
        if current > MAX_RECURSIVE_DEPTH {
            return Some(set.pos);
        }
        let next = set.node.items.iter().find_map(|selection| {
            let (child, below) = match &selection.node {
                Selection::Field(field) if field.node.selection_set.node.items.is_empty() => {
                    return None;
                }
                Selection::Field(field) => (
                    &field.node.selection_set,
                    set_depth(fragments, &field.node.selection_set.node),
                ),
                Selection::InlineFragment(fragment) => (
                    &fragment.node.selection_set,
                    set_depth(fragments, &fragment.node.selection_set.node),
                ),
                Selection::FragmentSpread(spread) => {
                    let name = spread.node.fragment_name.node.as_str();
                    let fragment = document.fragments.get(name)?;
                    (&fragment.node.selection_set, *fragments.get(name)?)
                }
            };
            (current + 1 + below > MAX_RECURSIVE_DEPTH).then_some(child)
        })?;
        set = next;
        current += 1;
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::graphql::operation;

    /// An operation whose selections reach depth `depth` through a chain of fragments on `Query`:
    /// the operation spreads `F1` (level 1), each `Fi` spreads `F(i+1)`.
    fn chain(depth: usize) -> String {
        let mut document = "query Chain { ...F1 }".to_owned();
        for i in 1..depth {
            document += &format!(" fragment F{i} on Query {{ ...F{} }}", i + 1);
        }
        document += &format!(" fragment F{depth} on Query {{ __typename }}");
        document
    }

    fn depth_ok(query: &str) -> bool {
        check(&operation::parse_document(query).unwrap()).is_ok()
    }

    #[test]
    fn accepts_exactly_the_limit() {
        assert!(depth_ok(&chain(MAX_RECURSIVE_DEPTH)));
        assert!(!depth_ok(&chain(MAX_RECURSIVE_DEPTH + 1)));
    }

    #[test]
    fn counts_fields_and_inline_fragments_like_async_graphql() {
        let nested = |levels: usize| {
            let mut query = "query Q { ".to_owned();
            for _ in 0..levels {
                query += "ccbFormsV2 { ... on CCBFormsSuccess { forms { ";
            }
            query += "title";
            for _ in 0..levels {
                query += " } } }";
            }
            query + " }"
        };
        // Each repetition adds three levels: the field, the inline fragment and `forms`.
        assert!(depth_ok(&nested(10)));
        assert!(!depth_ok(&nested(11)));
    }

    #[test]
    fn rejects_cycles_and_deep_unused_fragments() {
        assert!(!depth_ok(
            "query C { ...A } fragment A on Query { ...B } fragment B on Query { ...A }"
        ));
        assert!(!depth_ok(
            "query C { __typename } fragment A on Query { ...A }"
        ));
        // Unused fragments count too; in `chain(34)` the fragments alone reach 33.
        let unused = |depth: usize| {
            chain(depth).replace("query Chain { ...F1 }", "query Chain { __typename }")
        };
        assert!(depth_ok(&unused(MAX_RECURSIVE_DEPTH + 1)));
        assert!(!depth_ok(&unused(MAX_RECURSIVE_DEPTH + 2)));
    }

    #[test]
    fn handles_repeated_spreads_without_rewalking() {
        // Each fragment spreads the next twice; the check visits each fragment once.
        let mut document = "query Q { ...F0 }".to_owned();
        for i in 0..30 {
            document += &format!(" fragment F{i} on Query {{ ...F{} ...F{} }}", i + 1, i + 1);
        }
        document += " fragment F30 on Query { __typename }";
        let start = std::time::Instant::now();
        assert!(depth_ok(&document));
        assert!(start.elapsed() < std::time::Duration::from_secs(1));
    }

    #[test]
    fn ignores_spreads_of_unknown_fragments() {
        // Validation reports the unknown fragment; async-graphql's depth check skips it too.
        assert!(depth_ok("query Q { ...Missing }"));
    }

    /// A chain of `length` fragments, at the root or under `ccbFormsV2`.
    pub(crate) fn long_chain(length: usize, nested: bool) -> String {
        let mut document = if nested {
            "query Deep { ccbFormsV2 { ... on CCBFormsSuccess { forms { ...a0 } } } }".to_owned()
        } else {
            "query Deep { ...a0 }".to_owned()
        };
        let on = if nested { "CCBForm" } else { "Query" };
        for i in 0..length - 1 {
            document += &format!(" fragment a{i} on {on} {{ ...a{} }}", i + 1);
        }
        document += &format!(" fragment a{} on {on} {{ __typename }}", length - 1);
        document
    }

    #[test]
    fn rejects_a_long_chain_on_a_small_stack() {
        // 256 KiB is far less than a server worker's stack; recursing once per spread would
        // overflow it long before 15k levels.
        let handle = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(|| {
                for nested in [false, true] {
                    let document = operation::parse_document(&long_chain(15_000, nested)).unwrap();
                    assert!(check(&document).is_err());
                }
            })
            .unwrap();
        handle.join().unwrap();
    }
}
