//! Per-document memo of the cost verdict and the response-cache TTL. The TS server computes both
//! once per document: `useQueryComplexity` keeps verdicts in a `WeakMap` per document and
//! operation name (`apps/server/src/graphql/queryComplexity.ts`), envelop's response cache
//! memoizes its TTL walk per document (`memoize4`), and yoga's parser cache (1000 entries) hands
//! back the same document for a repeated query string.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use async_graphql::parser::types::ExecutableDocument;
use sha2::{Digest, Sha256};

use crate::graphql::complexity::Verdict;
use crate::graphql::operation;

/// Documents remembered, like yoga's parser cache.
pub const CAPACITY: u64 = 1000;

/// A query string (by SHA-256, so a 2 MiB query does not stay in memory) and operation name.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct Key {
    query: [u8; 32],
    operation_name: Option<String>,
}

/// What is known about one document and operation, each part computed on first use.
#[derive(Debug, Default)]
pub struct DocumentFacts {
    ttl: OnceLock<Duration>,
    verdict: OnceLock<Verdict>,
}

impl DocumentFacts {
    pub fn ttl(&self, compute: impl FnOnce() -> Duration) -> Duration {
        *self.ttl.get_or_init(compute)
    }

    pub fn verdict(&self, compute: impl FnOnce() -> Verdict) -> Verdict {
        *self.verdict.get_or_init(compute)
    }
}

pub struct DocumentMemo {
    entries: moka::sync::Cache<Key, Arc<DocumentFacts>>,
}

impl Default for DocumentMemo {
    fn default() -> Self {
        Self::new()
    }
}

impl DocumentMemo {
    pub fn new() -> Self {
        Self {
            entries: moka::sync::Cache::new(CAPACITY),
        }
    }

    /// The facts for `operation_name` in `query`, or `None` when the name selects no operation:
    /// TS memoizes only names that resolve, so arbitrary names cannot fill the memo.
    pub fn facts(
        &self,
        query: &str,
        operation_name: Option<&str>,
        document: &ExecutableDocument,
    ) -> Option<Arc<DocumentFacts>> {
        operation::select_operation(document, operation_name)?;
        let key = Key {
            query: Sha256::digest(query.as_bytes()).into(),
            operation_name: operation_name.map(str::to_owned),
        };
        Some(
            self.entries
                .get_with(key, || Arc::new(DocumentFacts::default())),
        )
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    fn document(query: &str) -> ExecutableDocument {
        operation::parse_document(query).unwrap()
    }

    const QUERY: &str = "query A { core } query B { sermons }";

    #[test]
    fn remembers_facts_per_query_and_operation() {
        let memo = DocumentMemo::new();
        let parsed = document(QUERY);
        let a = memo.facts(QUERY, Some("A"), &parsed).unwrap();
        let again = memo.facts(QUERY, Some("A"), &document(QUERY)).unwrap();
        assert!(Arc::ptr_eq(&a, &again));
        let b = memo.facts(QUERY, Some("B"), &parsed).unwrap();
        assert!(!Arc::ptr_eq(&a, &b));
    }

    #[test]
    fn skips_names_that_select_no_operation() {
        let memo = DocumentMemo::new();
        let parsed = document(QUERY);
        assert!(memo.facts(QUERY, Some("Missing"), &parsed).is_none());
        // Two operations and no name: graphql-js selects none either.
        assert!(memo.facts(QUERY, None, &parsed).is_none());
    }

    #[test]
    fn computes_each_fact_once() {
        let memo = DocumentMemo::new();
        let parsed = document(QUERY);
        let calls = Cell::new(0);
        let verdict = || {
            calls.set(calls.get() + 1);
            Verdict {
                complexity: 3,
                maximum: 2000,
            }
        };
        for _ in 0..3 {
            let facts = memo.facts(QUERY, Some("A"), &parsed).unwrap();
            assert_eq!(facts.verdict(verdict).complexity, 3);
            assert_eq!(
                facts.ttl(|| Duration::from_secs(600)),
                Duration::from_secs(600)
            );
        }
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn stays_bounded() {
        let memo = DocumentMemo::new();
        for n in 0..1500 {
            let query = format!("query Q{n} {{ core }}");
            memo.facts(&query, None, &document(&query)).unwrap();
        }
        memo.entries.run_pending_tasks();
        assert!(memo.entries.entry_count() <= CAPACITY);
    }
}
