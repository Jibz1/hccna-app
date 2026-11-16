//! The Firestore documents `User.woa` reads and writes, across the two Firebase projects
//! (`apps/server/src/utils/firebase.ts`): profiles and verses in the primary project (`app-hccnj`),
//! Word of Activation subscriptions in the secondary one (`app-hccnj-17d4f`).

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::google::firestore::{
    Document, DocumentSource, Filter, FilterOp, FirestoreClient, FirestoreError, FirestoreValue,
    QueryDocument,
};

/// `AppCollections.users`.
pub const USERS: &str = "app-users";
/// `AppCollections.wordActivationSub`, in the secondary project.
pub const SUBSCRIPTIONS: &str = "wordActivationSub";
/// `AppCollections.wordActivationScriptures`, in the primary project.
pub const VERSES: &str = "wordActivationScriptures";

pub type StoreFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, FirestoreError>> + Send + 'a>>;

/// Fields to write, by name.
pub type Fields = HashMap<String, FirestoreValue>;

pub trait WoaStore: Send + Sync {
    /// `app-users/{uid}`.
    fn user_profile<'a>(&'a self, uid: &'a str) -> StoreFuture<'a, Option<Document>>;
    /// The first `app-users` document whose `email` is `email`.
    fn user_by_email<'a>(&'a self, email: &'a str) -> StoreFuture<'a, Option<Document>>;
    /// The first subscription whose `email` is `email`, in document-id order.
    fn subscription_by_email<'a>(
        &'a self,
        email: &'a str,
    ) -> StoreFuture<'a, Option<QueryDocument>>;
    /// `wordActivationScriptures/{id}`.
    fn verse<'a>(&'a self, id: &'a str) -> StoreFuture<'a, Option<Document>>;
    /// The first verse whose id is at or after `key` (`at_or_after`), or else before it.
    fn verse_near<'a>(
        &'a self,
        key: &'a str,
        at_or_after: bool,
    ) -> StoreFuture<'a, Option<QueryDocument>>;
    /// `wordActivationSub.add(fields)`.
    fn add_subscription<'a>(&'a self, fields: &'a Fields) -> StoreFuture<'a, ()>;
    /// `wordActivationSub.doc(id).update(fields)`.
    fn update_subscription<'a>(&'a self, id: &'a str, fields: &'a Fields) -> StoreFuture<'a, ()>;
}

/// Firestore's REST API for both projects.
pub struct FirestoreWoaStore {
    primary: Arc<FirestoreClient>,
    secondary: Arc<FirestoreClient>,
}

impl FirestoreWoaStore {
    pub fn new(primary: Arc<FirestoreClient>, secondary: Arc<FirestoreClient>) -> Self {
        Self { primary, secondary }
    }
}

fn email_filter(email: &str) -> Filter<'_> {
    Filter::Field {
        path: "email",
        op: FilterOp::Equal,
        value: email,
    }
}

impl WoaStore for FirestoreWoaStore {
    fn user_profile<'a>(&'a self, uid: &'a str) -> StoreFuture<'a, Option<Document>> {
        self.primary.get_document(USERS, uid)
    }

    fn user_by_email<'a>(&'a self, email: &'a str) -> StoreFuture<'a, Option<Document>> {
        Box::pin(async move {
            let found = self.primary.query(USERS, email_filter(email), None).await?;
            Ok(found.into_iter().next().map(|found| found.document))
        })
    }

    fn subscription_by_email<'a>(
        &'a self,
        email: &'a str,
    ) -> StoreFuture<'a, Option<QueryDocument>> {
        Box::pin(async move {
            let found = self
                .secondary
                .query(SUBSCRIPTIONS, email_filter(email), None)
                .await?;
            Ok(found.into_iter().next())
        })
    }

    fn verse<'a>(&'a self, id: &'a str) -> StoreFuture<'a, Option<Document>> {
        self.primary.get_document(VERSES, id)
    }

    fn verse_near<'a>(
        &'a self,
        key: &'a str,
        at_or_after: bool,
    ) -> StoreFuture<'a, Option<QueryDocument>> {
        Box::pin(async move {
            let op = if at_or_after {
                FilterOp::GreaterThanOrEqual
            } else {
                FilterOp::LessThan
            };
            let found = self
                .primary
                .query(VERSES, Filter::DocumentId { op, id: key }, Some(1))
                .await?;
            Ok(found.into_iter().next())
        })
    }

    fn add_subscription<'a>(&'a self, fields: &'a Fields) -> StoreFuture<'a, ()> {
        Box::pin(async move {
            self.secondary.add(SUBSCRIPTIONS, fields).await?;
            Ok(())
        })
    }

    fn update_subscription<'a>(&'a self, id: &'a str, fields: &'a Fields) -> StoreFuture<'a, ()> {
        Box::pin(self.secondary.update(SUBSCRIPTIONS, id, fields))
    }
}

/// Documents in memory, for the service and resolver tests.
#[cfg(test)]
pub mod testing {
    use std::collections::BTreeMap;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;

    /// Collections by name, each sorted by document id as Firestore orders them.
    #[derive(Default)]
    pub struct FakeWoaStore {
        pub users: Mutex<BTreeMap<String, Document>>,
        pub subscriptions: Mutex<BTreeMap<String, Document>>,
        pub verses: Mutex<BTreeMap<String, Document>>,
        /// Every call fails while set, like an unreachable Firestore.
        pub failing: AtomicBool,
        /// Only the secondary project's calls fail while set.
        pub failing_subscriptions: AtomicBool,
        pub calls: AtomicUsize,
        added: AtomicUsize,
    }

    impl FakeWoaStore {
        pub fn subscriptions(&self) -> BTreeMap<String, Document> {
            self.subscriptions.lock().unwrap().clone()
        }

        pub fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }

        fn secondary<T: Send + 'static>(&self, value: impl FnOnce() -> T) -> StoreFuture<'_, T> {
            if self.failing_subscriptions.load(Ordering::SeqCst) {
                self.calls.fetch_add(1, Ordering::SeqCst);
                return Box::pin(async { Err(FirestoreError::Status(503)) });
            }
            self.answer(value)
        }

        fn answer<T: Send + 'static>(&self, value: impl FnOnce() -> T) -> StoreFuture<'_, T> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let result = if self.failing.load(Ordering::SeqCst) {
                Err(FirestoreError::Status(503))
            } else {
                Ok(value())
            };
            Box::pin(async move { result })
        }
    }

    fn by_email(documents: &BTreeMap<String, Document>, email: &str) -> Option<QueryDocument> {
        documents
            .iter()
            .find(|(_, document)| {
                document.get("email") == Some(&FirestoreValue::String(email.to_owned()))
            })
            .map(|(id, document)| QueryDocument {
                id: id.clone(),
                document: document.clone(),
            })
    }

    impl WoaStore for FakeWoaStore {
        fn user_profile<'a>(&'a self, uid: &'a str) -> StoreFuture<'a, Option<Document>> {
            self.answer(|| self.users.lock().unwrap().get(uid).cloned())
        }

        fn user_by_email<'a>(&'a self, email: &'a str) -> StoreFuture<'a, Option<Document>> {
            self.answer(|| by_email(&self.users.lock().unwrap(), email).map(|found| found.document))
        }

        fn subscription_by_email<'a>(
            &'a self,
            email: &'a str,
        ) -> StoreFuture<'a, Option<QueryDocument>> {
            self.secondary(|| by_email(&self.subscriptions.lock().unwrap(), email))
        }

        fn verse<'a>(&'a self, id: &'a str) -> StoreFuture<'a, Option<Document>> {
            self.answer(|| self.verses.lock().unwrap().get(id).cloned())
        }

        fn verse_near<'a>(
            &'a self,
            key: &'a str,
            at_or_after: bool,
        ) -> StoreFuture<'a, Option<QueryDocument>> {
            self.answer(|| {
                let verses = self.verses.lock().unwrap();
                let mut matching = verses
                    .iter()
                    .filter(|(id, _)| (id.as_str() >= key) == at_or_after);
                matching.next().map(|(id, document)| QueryDocument {
                    id: id.clone(),
                    document: document.clone(),
                })
            })
        }

        fn add_subscription<'a>(&'a self, fields: &'a Fields) -> StoreFuture<'a, ()> {
            self.secondary(|| {
                let id = format!("added-{}", self.added.fetch_add(1, Ordering::SeqCst) + 1);
                self.subscriptions
                    .lock()
                    .unwrap()
                    .insert(id, Document::new(fields.clone()));
            })
        }

        fn update_subscription<'a>(
            &'a self,
            id: &'a str,
            fields: &'a Fields,
        ) -> StoreFuture<'a, ()> {
            self.secondary(|| {
                let mut subscriptions = self.subscriptions.lock().unwrap();
                if let Some(document) = subscriptions.get_mut(id) {
                    let mut merged = document.fields().clone();
                    merged.extend(fields.clone());
                    *document = Document::new(merged);
                }
            })
        }
    }
}
