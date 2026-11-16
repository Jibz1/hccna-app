//! `createStrapiV2Client` (`packages/strapi-v2/src/client.ts`) for the four reads the phase 1
//! fields need: each runs its operation through the [`Transport`], decodes `data` and maps it to
//! records. Content a mapper cannot represent (unsupported rich text) is a Decode failure of the
//! operation, not a defect.

use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use super::queries::{
    self, CAMPUSES_DOCUMENT, CAMPUSES_OPERATION, EVENTS_DOCUMENT, EVENTS_OPERATION,
    SERMONS_DOCUMENT, SERMONS_OPERATION, TOG_DOCUMENT, TOG_OPERATION,
};
use super::records::{
    CampusRecord, EventQuery, EventRecord, SermonPage, SermonQuery, ThoughtOfGodRecord,
};
use super::rich_text::UnsupportedRichTextError;
use super::{StrapiError, Transport};

pub struct StrapiClient {
    transport: Transport,
}

impl StrapiClient {
    pub fn new(transport: Transport) -> Self {
        Self { transport }
    }

    pub async fn campuses(&self) -> Result<Vec<CampusRecord>, StrapiError> {
        self.mapped(
            CAMPUSES_OPERATION,
            CAMPUSES_DOCUMENT,
            &json!({}),
            queries::campuses::to_records,
        )
        .await
    }

    pub async fn events(&self, filter: &EventQuery) -> Result<Vec<EventRecord>, StrapiError> {
        self.mapped(
            EVENTS_OPERATION,
            EVENTS_DOCUMENT,
            &queries::events::variables(filter),
            queries::events::to_records,
        )
        .await
    }

    pub async fn sermons(&self, query: &SermonQuery) -> Result<SermonPage, StrapiError> {
        self.mapped(
            SERMONS_OPERATION,
            SERMONS_DOCUMENT,
            &queries::sermons::variables(query),
            queries::sermons::to_records,
        )
        .await
    }

    pub async fn thought_of_god(&self) -> Result<Option<ThoughtOfGodRecord>, StrapiError> {
        self.mapped(TOG_OPERATION, TOG_DOCUMENT, &json!({}), |data| {
            Ok(queries::thought_of_god::to_record(data))
        })
        .await
    }

    /// `mapped`: query, then map; a mapping failure is a Decode error of `operation`.
    async fn mapped<D: DeserializeOwned, A>(
        &self,
        operation: &'static str,
        document: &str,
        variables: &Value,
        to_records: impl FnOnce(D) -> Result<A, UnsupportedRichTextError>,
    ) -> Result<A, StrapiError> {
        let data = self.transport.query(operation, document, variables).await?;
        to_records(data).map_err(|error| StrapiError::Decode {
            operation,
            detail: error.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{CmsConfig, Secret};
    use crate::metrics::Metrics;
    use crate::strapi::StrapiErrorReason;
    use std::sync::{Arc, Mutex};
    use wiremock::{Mock, MockServer, Request, ResponseTemplate};

    /// Answers each operation with `{"data": <its data>}` and records what was requested.
    async fn fake_strapi(
        data_by_operation: Value,
    ) -> (StrapiClient, Arc<Mutex<Vec<Value>>>, MockServer) {
        let server = MockServer::start().await;
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = requests.clone();
        Mock::given(wiremock::matchers::method("POST"))
            .respond_with(move |request: &Request| {
                let body: Value = serde_json::from_slice(&request.body).unwrap();
                let operation = body["operationName"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned();
                seen.lock().unwrap().push(body);
                let data = data_by_operation
                    .get(&operation)
                    .cloned()
                    .unwrap_or(Value::Null);
                ResponseTemplate::new(200).set_body_string(json!({ "data": data }).to_string())
            })
            .mount(&server)
            .await;
        let config = CmsConfig {
            endpoint: format!("{}/graphql", server.uri()),
            token: Secret::new("example-cms-token"),
        };
        let transport = Transport::new(
            &config,
            crate::upstream::http_client().unwrap(),
            Metrics::new(),
        );
        (StrapiClient::new(transport), requests, server)
    }

    fn campus(body: Value) -> Value {
        json!({
            "slug": "x", "CampusName": null, "Phone": null, "Address": null, "CityState": null,
            "FacebookChannelLink": null, "InstagramChannelLink": null, "LiveStreamChannelLink": null,
            "Header": null, "Stream": null, "GivingPlatforms": null, "leaderships": [], "body": body,
        })
    }

    #[tokio::test]
    async fn reports_unsupported_rich_text_as_a_decode_error() {
        let body = json!({ "type": "doc", "content": [{ "type": "mysteryWidget" }] });
        let (client, _, _server) =
            fake_strapi(json!({ "StrapiV2Campuses": { "campuses": [campus(body)] } })).await;

        let error = client.campuses().await.unwrap_err();

        assert_eq!(error.reason(), StrapiErrorReason::Decode);
        assert_eq!(error.operation(), "StrapiV2Campuses");
        assert!(error.detail().contains("mysteryWidget"));
    }

    #[tokio::test]
    async fn reports_an_unknown_enum_value_as_a_decode_error() {
        let mut bad = campus(Value::Null);
        bad["GivingPlatforms"] = json!([{ "Platform": "Venmo", "link": null }]);
        let (client, _, _server) =
            fake_strapi(json!({ "StrapiV2Campuses": { "campuses": [bad] } })).await;

        let error = client.campuses().await.unwrap_err();

        assert_eq!(error.reason(), StrapiErrorReason::Decode);
        assert!(error.detail().contains("Venmo"));
    }

    #[tokio::test]
    async fn sends_event_filter_variables() {
        let (client, requests, _server) =
            fake_strapi(json!({ "StrapiV2Events": { "events": [] } })).await;

        let events = client
            .events(&EventQuery {
                campus_slug: "light-house".to_owned(),
                slug: Some("summit-conference".to_owned()),
                ..EventQuery::default()
            })
            .await
            .unwrap();

        assert!(events.is_empty());
        let requests = requests.lock().unwrap();
        assert_eq!(requests[0]["operationName"], "StrapiV2Events");
        assert_eq!(requests[0]["query"], EVENTS_DOCUMENT);
        assert_eq!(
            requests[0]["variables"],
            json!({
                "filters": { "and": [{ "campuses": { "slug": { "eq": "light-house" } } }, { "slug": { "eq": "summit-conference" } }] },
                "sort": [],
            })
        );
    }

    #[tokio::test]
    async fn reads_sermons_and_thought_of_god_with_their_documents() {
        let (client, requests, _server) = fake_strapi(json!({
            "StrapiV2Sermons": { "sermons": [], "sermonPage": null },
            "StrapiV2ThoughtOfGod": { "tog": null },
        }))
        .await;

        let page = client
            .sermons(&SermonQuery::Slugs(vec!["a".to_owned()]))
            .await
            .unwrap();
        let tog = client.thought_of_god().await.unwrap();

        assert!(page.items.is_empty());
        assert_eq!(tog, None);
        let requests = requests.lock().unwrap();
        assert_eq!(requests[0]["query"], SERMONS_DOCUMENT);
        assert_eq!(
            requests[0]["variables"],
            json!({ "filters": { "slug": { "in": ["a"] } }, "sort": ["date:desc"], "pageSize": 100 })
        );
        assert_eq!(requests[1]["query"], TOG_DOCUMENT);
        assert_eq!(requests[1]["variables"], json!({}));
    }
}
