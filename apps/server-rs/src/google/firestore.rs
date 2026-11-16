//! Firestore over REST, for the calls the TS server makes through firebase-admin, with a Google
//! OAuth token for the service account:
//!
//! - document reads (`FirebaseAdminService.readDocument` in
//!   `apps/server/src/effect/services/FirebaseAdminService.ts`: `db.collection(collection).doc(id)
//!   .get()`, then `snapshot.exists ? snapshot.data() : undefined`):
//!   `GET {FIRESTORE_URL}/v1/projects/<project>/databases/(default)/documents/<collection>/<id>`,
//!   where a 404 is a missing document;
//! - single-filter queries (`collection.where(field, op, value).limit(n).get()`): `POST …/documents:runQuery`;
//! - `collection.add(data)`: `POST …/documents/<collection>`, the id assigned by Firestore;
//! - `doc(id).update(data)`: `PATCH …/documents/<collection>/<id>` with an update mask of the
//!   written fields and the document required to exist.
//!
//! Values keep only what callers distinguish: strings, booleans, numbers, `null`, arrays, maps,
//! and everything else (timestamps, references, bytes, geo points), which the TS callers' schemas
//! reject wherever they ask for one of the others. serde_json's 128-level limit bounds the
//! recursion.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use serde::Deserialize;

use crate::google::auth::CLOUD_PLATFORM_SCOPE;
use crate::google::{GoogleAuth, GoogleAuthError};

/// firebase-admin sets no deadline shorter than the whole request's (`APP_TIMEOUT_MS`, 20 s),
/// which bounds the read on both servers.
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(20);

/// A Firestore field value, as far as the callers tell values apart.
#[derive(Clone, Debug, PartialEq)]
pub enum FirestoreValue {
    String(String),
    Boolean(bool),
    Array(Vec<FirestoreValue>),
    /// A map value's fields.
    Map(HashMap<String, FirestoreValue>),
    /// An integer or double, as the JavaScript number firebase-admin reads it.
    Number(f64),
    Null,
    /// Any other type: a `Timestamp`, reference, bytes, geo point, …
    Other,
}

impl FirestoreValue {
    /// The REST encoding of one value: an object whose single key names the type.
    fn from_rest(value: &serde_json::Value) -> Self {
        if let Some(text) = value.get("stringValue").and_then(serde_json::Value::as_str) {
            return Self::String(text.to_owned());
        }
        if let Some(flag) = value
            .get("booleanValue")
            .and_then(serde_json::Value::as_bool)
        {
            return Self::Boolean(flag);
        }
        if let Some(array) = value.get("arrayValue") {
            // An empty array has no `values` key.
            return Self::Array(
                array
                    .get("values")
                    .and_then(serde_json::Value::as_array)
                    .map(|values| values.iter().map(Self::from_rest).collect())
                    .unwrap_or_default(),
            );
        }
        if let Some(integer) = value
            .get("integerValue")
            .and_then(serde_json::Value::as_str)
            .and_then(|text| text.parse::<i64>().ok())
        {
            return Self::Number(integer as f64);
        }
        if let Some(double) = value.get("doubleValue").and_then(serde_json::Value::as_f64) {
            return Self::Number(double);
        }
        if value.get("nullValue").is_some() {
            return Self::Null;
        }
        if let Some(map) = value.get("mapValue") {
            // An empty map has no `fields` key.
            return Self::Map(
                map.get("fields")
                    .and_then(serde_json::Value::as_object)
                    .map(|fields| {
                        fields
                            .iter()
                            .map(|(name, value)| (name.clone(), Self::from_rest(value)))
                            .collect()
                    })
                    .unwrap_or_default(),
            );
        }
        Self::Other
    }

    /// The REST encoding of a value this server writes; `None` for [`Self::Other`], which it never
    /// writes.
    fn to_rest(&self) -> Option<serde_json::Value> {
        use serde_json::json;
        Some(match self {
            Self::String(text) => json!({ "stringValue": text }),
            Self::Boolean(flag) => json!({ "booleanValue": flag }),
            Self::Number(number) if number.fract() == 0.0 && number.abs() < 9.0e15 => {
                json!({ "integerValue": (*number as i64).to_string() })
            }
            Self::Number(number) => json!({ "doubleValue": number }),
            Self::Null => json!({ "nullValue": null }),
            Self::Array(values) => json!({ "arrayValue": {
                "values": values.iter().map(Self::to_rest).collect::<Option<Vec<_>>>()?,
            } }),
            Self::Map(fields) => json!({ "mapValue": { "fields": rest_fields(fields.iter())? } }),
            Self::Other => return None,
        })
    }
}

/// Fields in their REST encoding; `None` if one cannot be written.
fn rest_fields<'a>(
    fields: impl Iterator<Item = (&'a String, &'a FirestoreValue)>,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    fields
        .map(|(name, value)| Some((name.clone(), value.to_rest()?)))
        .collect()
}

/// An existing document's fields (`snapshot.data()`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Document {
    fields: HashMap<String, FirestoreValue>,
}

impl Document {
    pub fn new(fields: impl IntoIterator<Item = (String, FirestoreValue)>) -> Self {
        Self {
            fields: fields.into_iter().collect(),
        }
    }

    pub fn get(&self, field: &str) -> Option<&FirestoreValue> {
        self.fields.get(field)
    }

    pub fn fields(&self) -> &HashMap<String, FirestoreValue> {
        &self.fields
    }

    fn from_rest(fields: &HashMap<String, serde_json::Value>) -> Self {
        Self::new(
            fields
                .iter()
                .map(|(name, value)| (name.clone(), FirestoreValue::from_rest(value))),
        )
    }
}

/// A document with its id, as a query or `add` answers it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct QueryDocument {
    pub id: String,
    pub document: Document,
}

/// A single-filter query's comparison.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilterOp {
    Equal,
    LessThan,
    GreaterThanOrEqual,
}

impl FilterOp {
    fn rest(self) -> &'static str {
        match self {
            Self::Equal => "EQUAL",
            Self::LessThan => "LESS_THAN",
            Self::GreaterThanOrEqual => "GREATER_THAN_OR_EQUAL",
        }
    }
}

/// What a query compares: a field with a string, or the document id (`FieldPath.documentId()`)
/// with another id.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Filter<'a> {
    Field {
        path: &'a str,
        op: FilterOp,
        value: &'a str,
    },
    DocumentId {
        op: FilterOp,
        id: &'a str,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum FirestoreError {
    #[error("no Google credentials are configured")]
    NoCredentials,
    #[error(transparent)]
    Token(#[from] GoogleAuthError),
    #[error("Firestore request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Firestore answered HTTP {0}")]
    Status(u16),
    #[error("Firestore answered a document that is not valid JSON: {0}")]
    Decode(#[from] serde_json::Error),
    /// A document `name` without a final id segment.
    #[error("Firestore answered a document without an id")]
    MissingId,
    /// A write of a value this server does not encode ([`FirestoreValue::Other`]).
    #[error("a Firestore value of an unwritable type")]
    Unwritable,
}

pub type DocumentFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Option<Document>, FirestoreError>> + Send + 'a>>;

/// Where documents come from: Firestore, or a fake in tests.
pub trait DocumentSource: Send + Sync {
    /// `readDocument(collection, id)`: the document's fields, or `None` when it does not exist.
    fn get_document<'a>(&'a self, collection: &'a str, id: &'a str) -> DocumentFuture<'a>;
}

/// The REST document body; `fields` is absent for a document without fields.
#[derive(Deserialize)]
struct RestDocument {
    #[serde(default)]
    name: String,
    #[serde(default)]
    fields: HashMap<String, serde_json::Value>,
}

impl RestDocument {
    fn into_query_document(self) -> Result<QueryDocument, FirestoreError> {
        let id = self
            .name
            .rsplit('/')
            .next()
            .filter(|id| !id.is_empty())
            .ok_or(FirestoreError::MissingId)?;
        Ok(QueryDocument {
            id: id.to_owned(),
            document: Document::from_rest(&self.fields),
        })
    }
}

/// One `runQuery` result; an empty answer is a single result without a document.
#[derive(Deserialize)]
struct RunQueryResult {
    document: Option<RestDocument>,
}

/// Firestore's REST API for one project's default database.
pub struct FirestoreClient {
    http: reqwest::Client,
    google: Option<GoogleAuth>,
    base_url: String,
    project_id: String,
}

impl FirestoreClient {
    pub fn new(
        http: reqwest::Client,
        google: Option<GoogleAuth>,
        base_url: &str,
        project_id: &str,
    ) -> Self {
        Self {
            http,
            google,
            base_url: base_url.trim_end_matches('/').to_owned(),
            project_id: project_id.to_owned(),
        }
    }

    /// `projects/<project>/databases/(default)/documents`.
    fn database_path(&self) -> String {
        format!("projects/{}/databases/(default)/documents", self.project_id)
    }

    fn url(&self, path: &str) -> String {
        format!("{}/v1/{}{path}", self.base_url, self.database_path())
    }

    async fn token(&self) -> Result<String, FirestoreError> {
        let google = self.google.as_ref().ok_or(FirestoreError::NoCredentials)?;
        Ok(google.token(&[CLOUD_PLATFORM_SCOPE]).await?)
    }

    /// `collection.where(…).limit(limit).get()`: the matching documents in document-id order.
    /// A document-id filter orders by document id, as firebase-admin adds for an inequality.
    pub async fn query(
        &self,
        collection: &str,
        filter: Filter<'_>,
        limit: Option<u32>,
    ) -> Result<Vec<QueryDocument>, FirestoreError> {
        use serde_json::json;
        let field_filter = match filter {
            Filter::Field { path, op, value } => json!({
                "field": { "fieldPath": path },
                "op": op.rest(),
                "value": { "stringValue": value },
            }),
            Filter::DocumentId { op, id } => json!({
                "field": { "fieldPath": "__name__" },
                "op": op.rest(),
                "value": {
                    "referenceValue": format!("{}/{collection}/{id}", self.database_path()),
                },
            }),
        };
        let mut query = json!({
            "from": [{ "collectionId": collection }],
            "where": { "fieldFilter": field_filter },
        });
        if matches!(filter, Filter::DocumentId { .. }) {
            query["orderBy"] =
                json!([{ "field": { "fieldPath": "__name__" }, "direction": "ASCENDING" }]);
        }
        if let Some(limit) = limit {
            query["limit"] = json!(limit);
        }
        let token = self.token().await?;
        let response = self
            .http
            .post(self.url(":runQuery"))
            .bearer_auth(token)
            .timeout(FETCH_TIMEOUT)
            .json(&json!({ "structuredQuery": query }))
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(FirestoreError::Status(status.as_u16()));
        }
        let results: Vec<RunQueryResult> = serde_json::from_slice(&response.bytes().await?)?;
        results
            .into_iter()
            .filter_map(|result| result.document)
            .map(RestDocument::into_query_document)
            .collect()
    }

    /// `collection.add(fields)`: a new document with an id Firestore assigns.
    pub async fn add(
        &self,
        collection: &str,
        fields: &HashMap<String, FirestoreValue>,
    ) -> Result<QueryDocument, FirestoreError> {
        let body = serde_json::json!({
            "fields": rest_fields(fields.iter()).ok_or(FirestoreError::Unwritable)?,
        });
        let token = self.token().await?;
        let response = self
            .http
            .post(self.url(&format!("/{collection}")))
            .bearer_auth(token)
            .timeout(FETCH_TIMEOUT)
            .json(&body)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(FirestoreError::Status(status.as_u16()));
        }
        let document: RestDocument = serde_json::from_slice(&response.bytes().await?)?;
        document.into_query_document()
    }

    /// `doc(id).update(fields)`: only `fields` change, and a missing document fails (HTTP 404).
    pub async fn update(
        &self,
        collection: &str,
        id: &str,
        fields: &HashMap<String, FirestoreValue>,
    ) -> Result<(), FirestoreError> {
        let body = serde_json::json!({
            "fields": rest_fields(fields.iter()).ok_or(FirestoreError::Unwritable)?,
        });
        let mut mask: Vec<(&str, &str)> = fields
            .keys()
            .map(|name| ("updateMask.fieldPaths", name.as_str()))
            .collect();
        mask.push(("currentDocument.exists", "true"));
        let token = self.token().await?;
        let response = self
            .http
            .patch(self.url(&format!("/{collection}/{id}")))
            .query(&mask)
            .bearer_auth(token)
            .timeout(FETCH_TIMEOUT)
            .json(&body)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(FirestoreError::Status(status.as_u16()));
        }
        Ok(())
    }

    async fn read(&self, collection: &str, id: &str) -> Result<Option<Document>, FirestoreError> {
        let token = self.token().await?;
        let response = self
            .http
            .get(self.url(&format!("/{collection}/{id}")))
            .bearer_auth(token)
            .timeout(FETCH_TIMEOUT)
            .send()
            .await?;
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(FirestoreError::Status(status.as_u16()));
        }
        let body = response.bytes().await?;
        let document: RestDocument = serde_json::from_slice(&body)?;
        Ok(Some(Document::from_rest(&document.fields)))
    }
}

impl DocumentSource for FirestoreClient {
    fn get_document<'a>(&'a self, collection: &'a str, id: &'a str) -> DocumentFuture<'a> {
        Box::pin(self.read(collection, id))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    const DOCUMENT_PATH: &str =
        "/v1/projects/example-project/databases/(default)/documents/dailyVerse/verseOfTheDay";

    fn client(server: &MockServer, google: Option<GoogleAuth>) -> FirestoreClient {
        FirestoreClient::new(
            crate::upstream::http_client().unwrap(),
            google,
            &format!("{}/", server.uri()),
            "example-project",
        )
    }

    async fn read(server: &MockServer) -> Result<Option<Document>, FirestoreError> {
        client(server, Some(GoogleAuth::fixed("example-access-token")))
            .get_document("dailyVerse", "verseOfTheDay")
            .await
    }

    #[tokio::test]
    async fn reads_a_document_with_the_service_account_token() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(DOCUMENT_PATH))
            .and(header("authorization", "Bearer example-access-token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "name": "projects/example-project/databases/(default)/documents/dailyVerse/verseOfTheDay",
                "fields": {
                    "book": { "stringValue": "Example 1:1" },
                    "image": { "arrayValue": { "values": [
                        { "stringValue": "https://example.com/verse.jpg" },
                        { "timestampValue": "2026-10-13T00:00:00Z" }
                    ] } },
                    "tags": { "arrayValue": {} },
                    "count": { "integerValue": "3" },
                    "missing": { "nullValue": null },
                    "nested": { "mapValue": { "fields": { "a": { "stringValue": "b" } } } },
                    "when": { "timestampValue": "2026-10-13T00:00:00Z" }
                },
                "createTime": "2026-10-13T00:00:00Z",
                "updateTime": "2026-10-13T00:00:00Z"
            })))
            .expect(1)
            .mount(&server)
            .await;

        let document = read(&server).await.unwrap().unwrap();
        assert_eq!(
            document.get("book"),
            Some(&FirestoreValue::String("Example 1:1".to_owned()))
        );
        assert_eq!(
            document.get("image"),
            Some(&FirestoreValue::Array(vec![
                FirestoreValue::String("https://example.com/verse.jpg".to_owned()),
                FirestoreValue::Other,
            ]))
        );
        assert_eq!(document.get("tags"), Some(&FirestoreValue::Array(vec![])));
        assert_eq!(
            document.get("nested"),
            Some(&FirestoreValue::Map(HashMap::from([(
                "a".to_owned(),
                FirestoreValue::String("b".to_owned())
            )])))
        );
        assert_eq!(document.get("count"), Some(&FirestoreValue::Number(3.0)));
        assert_eq!(document.get("missing"), Some(&FirestoreValue::Null));
        assert_eq!(document.get("when"), Some(&FirestoreValue::Other));
        assert_eq!(document.get("absent"), None);
    }

    #[tokio::test]
    async fn reads_booleans_and_maps() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(DOCUMENT_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "name": "projects/example-project/databases/(default)/documents/dailyVerse/verseOfTheDay",
                "fields": {
                    "live": { "booleanValue": true },
                    "streams": { "arrayValue": { "values": [
                        { "mapValue": { "fields": {
                            "id": { "stringValue": "stream-1" },
                            "isLive": { "booleanValue": false },
                            "tags": { "mapValue": {} }
                        } } }
                    ] } },
                    "empty": { "mapValue": {} }
                }
            })))
            .mount(&server)
            .await;

        let document = read(&server).await.unwrap().unwrap();
        assert_eq!(document.get("live"), Some(&FirestoreValue::Boolean(true)));
        // An empty map has no `fields` key.
        assert_eq!(
            document.get("empty"),
            Some(&FirestoreValue::Map(HashMap::new()))
        );
        let entry = FirestoreValue::Map(HashMap::from([
            (
                "id".to_owned(),
                FirestoreValue::String("stream-1".to_owned()),
            ),
            ("isLive".to_owned(), FirestoreValue::Boolean(false)),
            ("tags".to_owned(), FirestoreValue::Map(HashMap::new())),
        ]));
        assert_eq!(
            document.get("streams"),
            Some(&FirestoreValue::Array(vec![entry]))
        );
    }

    #[tokio::test]
    async fn reads_a_document_without_fields_as_empty() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(DOCUMENT_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "name": "x" })))
            .mount(&server)
            .await;
        assert_eq!(read(&server).await.unwrap(), Some(Document::default()));
    }

    #[tokio::test]
    async fn answers_none_for_a_missing_document() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(DOCUMENT_PATH))
            .respond_with(ResponseTemplate::new(404).set_body_json(json!({
                "error": { "code": 404, "message": "Document not found", "status": "NOT_FOUND" }
            })))
            .mount(&server)
            .await;
        assert_eq!(read(&server).await.unwrap(), None);
    }

    #[tokio::test]
    async fn fails_on_other_statuses_and_bad_bodies() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(DOCUMENT_PATH))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;
        assert!(matches!(
            read(&server).await,
            Err(FirestoreError::Status(503))
        ));

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(DOCUMENT_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
            .mount(&server)
            .await;
        assert!(matches!(
            read(&server).await,
            Err(FirestoreError::Decode(_))
        ));
    }

    #[tokio::test]
    async fn fails_without_credentials_and_sends_nothing() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;
        let result = client(&server, None)
            .get_document("dailyVerse", "verseOfTheDay")
            .await;
        assert!(matches!(result, Err(FirestoreError::NoCredentials)));
    }

    #[tokio::test]
    async fn fails_on_an_unreachable_host() {
        let client = FirestoreClient::new(
            crate::upstream::http_client().unwrap(),
            Some(GoogleAuth::fixed("example-access-token")),
            "http://127.0.0.1:1",
            "example-project",
        );
        assert!(matches!(
            client.get_document("dailyVerse", "verseOfTheDay").await,
            Err(FirestoreError::Http(_))
        ));
    }

    const DATABASE: &str = "/v1/projects/example-project/databases/(default)/documents";

    fn rest_document(id: &str, email: &str) -> serde_json::Value {
        json!({
            "name": format!("projects/example-project/databases/(default)/documents/wordActivationSub/{id}"),
            "fields": {
                "email": { "stringValue": email },
                "monthlySub": { "booleanValue": true },
                "lastUpdate": { "integerValue": "1792152000000" },
                "ratio": { "doubleValue": 0.5 },
            },
        })
    }

    #[tokio::test]
    async fn queries_by_field_and_answers_documents_with_their_ids() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(format!("{DATABASE}:runQuery")))
            .and(header("authorization", "Bearer example-access-token"))
            .and(wiremock::matchers::body_json(json!({ "structuredQuery": {
                "from": [{ "collectionId": "wordActivationSub" }],
                "where": { "fieldFilter": {
                    "field": { "fieldPath": "email" },
                    "op": "EQUAL",
                    "value": { "stringValue": "ada@example.com" },
                } },
            } })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                { "document": rest_document("sub-1", "ada@example.com"), "readTime": "2026-10-16T00:00:00Z" },
            ])))
            .expect(1)
            .mount(&server)
            .await;
        let client = client(&server, Some(GoogleAuth::fixed("example-access-token")));

        let found = client
            .query(
                "wordActivationSub",
                Filter::Field {
                    path: "email",
                    op: FilterOp::Equal,
                    value: "ada@example.com",
                },
                None,
            )
            .await
            .unwrap();

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "sub-1");
        let document = &found[0].document;
        assert_eq!(
            document.get("lastUpdate"),
            Some(&FirestoreValue::Number(1_792_152_000_000.0))
        );
        assert_eq!(document.get("ratio"), Some(&FirestoreValue::Number(0.5)));
        assert_eq!(
            document.get("monthlySub"),
            Some(&FirestoreValue::Boolean(true))
        );
    }

    #[tokio::test]
    async fn queries_by_document_id_in_id_order_and_reads_an_empty_answer() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(format!("{DATABASE}:runQuery")))
            .and(wiremock::matchers::body_json(json!({ "structuredQuery": {
                "from": [{ "collectionId": "wordActivationScriptures" }],
                "where": { "fieldFilter": {
                    "field": { "fieldPath": "__name__" },
                    "op": "GREATER_THAN_OR_EQUAL",
                    "value": { "referenceValue": "projects/example-project/databases/(default)/documents/wordActivationScriptures/key-1" },
                } },
                "orderBy": [{ "field": { "fieldPath": "__name__" }, "direction": "ASCENDING" }],
                "limit": 1,
            } })))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!([{ "readTime": "2026-10-16T00:00:00Z" }])),
            )
            .expect(1)
            .mount(&server)
            .await;
        let client = client(&server, Some(GoogleAuth::fixed("example-access-token")));

        let found = client
            .query(
                "wordActivationScriptures",
                Filter::DocumentId {
                    op: FilterOp::GreaterThanOrEqual,
                    id: "key-1",
                },
                Some(1),
            )
            .await
            .unwrap();
        assert_eq!(found, vec![]);
    }

    #[tokio::test]
    async fn adds_a_document_and_answers_its_assigned_id() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(format!("{DATABASE}/wordActivationSub")))
            .and(wiremock::matchers::body_json(json!({ "fields": {
                "email": { "stringValue": "ada@example.com" },
                "monthlySub": { "booleanValue": true },
            } })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(rest_document("assigned-id", "ada@example.com")),
            )
            .expect(1)
            .mount(&server)
            .await;
        let client = client(&server, Some(GoogleAuth::fixed("example-access-token")));

        let added = client
            .add(
                "wordActivationSub",
                &HashMap::from([
                    (
                        "email".to_owned(),
                        FirestoreValue::String("ada@example.com".to_owned()),
                    ),
                    ("monthlySub".to_owned(), FirestoreValue::Boolean(true)),
                ]),
            )
            .await
            .unwrap();
        assert_eq!(added.id, "assigned-id");
    }

    #[tokio::test]
    async fn updates_only_the_given_fields_of_an_existing_document() {
        let server = MockServer::start().await;
        Mock::given(method("PATCH"))
            .and(path(format!("{DATABASE}/wordActivationSub/sub-1")))
            .and(wiremock::matchers::query_param(
                "updateMask.fieldPaths",
                "monthlySub",
            ))
            .and(wiremock::matchers::query_param(
                "currentDocument.exists",
                "true",
            ))
            .and(wiremock::matchers::body_json(json!({ "fields": {
                "monthlySub": { "booleanValue": true },
            } })))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(rest_document("sub-1", "ada@example.com")),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("PATCH"))
            .and(path(format!("{DATABASE}/wordActivationSub/gone")))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let client = client(&server, Some(GoogleAuth::fixed("example-access-token")));
        let fields = HashMap::from([("monthlySub".to_owned(), FirestoreValue::Boolean(true))]);

        client
            .update("wordActivationSub", "sub-1", &fields)
            .await
            .unwrap();
        assert!(matches!(
            client.update("wordActivationSub", "gone", &fields).await,
            Err(FirestoreError::Status(404))
        ));
        assert!(matches!(
            client
                .update(
                    "wordActivationSub",
                    "sub-1",
                    &HashMap::from([("when".to_owned(), FirestoreValue::Other)]),
                )
                .await,
            Err(FirestoreError::Unwritable)
        ));
    }
}
