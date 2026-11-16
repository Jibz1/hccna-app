//! `POST /graphql`: the request pipeline of `apps/server/src/routes/graphql.ts` and graphql-yoga's
//! request parsing.

use std::net::SocketAddr;

use async_graphql::parser::types::ExecutableDocument;
use async_graphql::{ServerError, Variables};
use axum::body::Bytes;
use axum::extract::{ConnectInfo, FromRequest, Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use serde_json::{Value, json};

use crate::fields::RequestLoaders;
use crate::gateway::{RequestDeadline, Route, route};
use crate::graphql::auth::AuthOutcome;
use crate::graphql::complexity::{self, ComplexityConfig};
use crate::graphql::errors::{self, bad_request, bytes_response, error_body, json_response};
use crate::graphql::response_cache::{CachePlan, CachedResult};
use crate::graphql::{depth, nulls, operation, rate_limit};
use crate::state::AppState;

/// The parameters of a GraphQL request body.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphqlParams {
    pub query: String,
    pub operation_name: Option<String>,
    /// The `variables` object, or `Value::Null` when absent.
    pub variables: Value,
}

/// Rate limiting runs first, before the body is read, as Hono's middleware does; its headers go
/// on every response, forwarded ones included. Every response carries its [`Route`].
pub async fn graphql(State(state): State<AppState>, request: Request) -> Response {
    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(peer)| *peer);
    let client = rate_limit::client_key(request.headers(), peer);
    let limit = state.rate_limiter.hit(&client).await;
    let mut response = if limit.limited() {
        rate_limit::too_many_requests()
    } else {
        let headers = request.headers().clone();
        // Stamped by `gateway::stamp_deadline` before the router's timeout layer started; a
        // request that skipped that layer gets the same budget from now.
        let deadline = request
            .extensions()
            .get::<RequestDeadline>()
            .copied()
            .unwrap_or_else(|| RequestDeadline::starting_now(state.config.request_timeout))
            .0;
        match Bytes::from_request(request, &state).await {
            Ok(body) => {
                let forward = Forward {
                    headers: &headers,
                    client_address: rate_limit::client_address(&headers, peer),
                    deadline,
                };
                handle(&state, forward, body).await
            }
            Err(rejection) => rejection.into_response(),
        }
    };
    if response.extensions().get::<Route>().is_none() {
        response.extensions_mut().insert(Route::Local);
    }
    for (name, value) in rate_limit::headers(&limit) {
        response.headers_mut().insert(name, value);
    }
    response
}

/// What forwarding a request needs besides its body.
struct Forward<'a> {
    headers: &'a HeaderMap,
    /// `X-Forwarded-For` for TS: the rate limiter's client address.
    client_address: Option<String>,
    /// When the forwarded exchange must end.
    deadline: tokio::time::Instant,
}

impl Forward<'_> {
    async fn send(self, state: &AppState, body: Bytes) -> Response {
        state
            .forwarder
            .forward(
                self.headers,
                self.client_address.as_deref(),
                body,
                self.deadline,
            )
            .await
    }
}

/// The kill switch first: while it is off, the request goes to TS unread. Otherwise the request is
/// parsed and depth-checked here, and the operation is answered locally or forwarded whole.
async fn handle(state: &AppState, forward: Forward<'_>, body: Bytes) -> Response {
    if !route::serve_locally(state.kill_switch.as_ref()) {
        return forward.send(state, body).await;
    }
    let headers = forward.headers;
    let params = match parse_params(headers, &body) {
        Ok(params) => params,
        Err(error) => return error.into_response(),
    };
    let document = match operation::parse_document(&params.query) {
        Ok(document) => document,
        Err(error) => return parse_failure(&error),
    };
    // Recursion bounds, each covering one thing:
    // - `parse_document`'s pre-scan: at most `nesting::MAX_BRACKET_NESTING` (128) `(`/`[`/`{`
    //   open at once in the query text, so the parser's recursive value building (arguments,
    //   directive arguments, variable defaults) stays shallow;
    // - the parser: selection sets nest at most 64 levels within one definition;
    // - this check: selection depth through fragment spreads at most `MAX_RECURSIVE_DEPTH` (32),
    //   for every walk below (root fields, cache policy, cost model, null propagation, and
    //   async-graphql's own checks and rules);
    // - serde_json: the `variables` JSON nests at most 128 levels (a 400 above that).
    if let Err(exceeded) = depth::check(&document) {
        return depth_failure(exceeded);
    }
    let info = operation::operation_info(&document, params.operation_name.as_deref());
    let route = route::route_operation(
        &document,
        params.operation_name.as_deref(),
        state.ccb.is_some(),
    );
    let mut response = match route {
        Route::Local => run(state, headers, params, document).await,
        Route::Forward => {
            drop(document);
            forward.send(state, body).await
        }
    };
    if let Some(info) = info {
        response.extensions_mut().insert(info);
    }
    response
}

/// Everything after parsing.
async fn run(
    state: &AppState,
    headers: &HeaderMap,
    params: GraphqlParams,
    document: ExecutableDocument,
) -> Response {
    if let Err(message) = operation::check_operation_names(&document) {
        return json_response(StatusCode::OK, &error_body(message, None));
    }

    let authorization = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let facts = state
        .documents
        .facts(&params.query, params.operation_name.as_deref(), &document);
    let plan = CachePlan::new(&document, &params, authorization, facts.as_deref());
    if let Some(plan) = &plan
        && let Some(hit) = state.response_cache.get(&plan.key).await
    {
        return cache_hit(&hit);
    }

    let viewer = match state.auth.authenticate(headers).await {
        AuthOutcome::Authenticated(viewer) => Some(viewer),
        AuthOutcome::Unauthenticated => None,
        AuthOutcome::Unavailable => return errors::authentication_unavailable(),
    };

    let compute = || {
        complexity::verdict(
            &state.complexity,
            &ComplexityConfig::TS,
            &document,
            params.operation_name.as_deref(),
        )
    };
    let verdict = match &facts {
        Some(facts) => facts.verdict(compute),
        None => compute(),
    };
    if verdict.too_complex() {
        return json_response(StatusCode::OK, &verdict.error_body());
    }

    // Kept to re-parse the document in the rare case an execution error needs null propagation;
    // async-graphql takes ownership of the parsed one.
    let query = params.query.clone();
    let operation_name = params.operation_name.clone();
    let mut request =
        async_graphql::Request::new(params.query).variables(Variables::from_json(params.variables));
    if let Some(name) = params.operation_name {
        request = request.operation_name(name);
    }
    if let Some(viewer) = viewer {
        request = request.data(viewer);
    }
    request = request.data(RequestLoaders::default());
    request.set_parsed_query(document);

    // The envelop plugin looks the key up again when execution starts.
    if let Some(plan) = &plan
        && let Some(hit) = state.response_cache.get(&plan.key).await
    {
        return cache_hit(&hit);
    }

    let mut response = state.schema.execute(request).await;
    if response.errors.iter().any(|error| !error.path.is_empty())
        && let Ok(document) = operation::parse_document(&query)
    {
        nulls::propagate(
            &state.complexity,
            &document,
            operation_name.as_deref(),
            &mut response,
        );
    }
    errors::finish(&mut response);
    let mut http_response = bytes_response(StatusCode::OK, render(&response));
    if let Some(plan) = plan {
        cache_result(state, &plan, response, &mut http_response).await;
    }
    http_response
}

/// A cached result with the `ETag` and `Last-Modified` it was stored with.
fn cache_hit(hit: &CachedResult) -> Response {
    let mut response = bytes_response(StatusCode::OK, hit.body());
    set_validators(&mut response, hit.etag(), hit.last_modified());
    response
}

/// yoga's `shouldCacheResult`: an error-free result allowed by the scope rule gets `ETag` and
/// `Last-Modified`, and is stored when its TTL is positive.
async fn cache_result(
    state: &AppState,
    plan: &CachePlan,
    response: async_graphql::Response,
    http_response: &mut Response,
) {
    if !response.errors.is_empty() {
        return;
    }
    let Ok(data) = response.data.into_json() else {
        return;
    };
    if !plan.allows(&data) {
        return;
    }
    let last_modified = httpdate::fmt_http_date(std::time::SystemTime::now());
    set_validators(http_response, Some(&plan.key), Some(&last_modified));
    if !plan.ttl.is_zero() {
        state
            .response_cache
            .store(&plan.key, data, &last_modified, plan.ttl)
            .await;
    }
}

fn set_validators(response: &mut Response, etag: Option<&str>, last_modified: Option<&str>) {
    for (name, value) in [(header::ETAG, etag), (header::LAST_MODIFIED, last_modified)] {
        if let Some(value) = value.and_then(|value| HeaderValue::from_str(value).ok()) {
            response.headers_mut().insert(name, value);
        }
    }
}

/// The response body in graphql-js order (`errors` before `data`). `data` is left out when
/// execution never started (every error is a request or validation error, without a path), as
/// graphql-js does; a `null` produced by execution is written.
pub fn render(response: &async_graphql::Response) -> Vec<u8> {
    #[derive(Serialize)]
    struct Body<'a> {
        #[serde(skip_serializing_if = "<[ServerError]>::is_empty")]
        errors: &'a [ServerError],
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<&'a async_graphql::Value>,
    }
    let executed = response.data != async_graphql::Value::Null
        || response.errors.is_empty()
        || response.errors.iter().any(|error| !error.path.is_empty());
    let body = Body {
        errors: &response.errors,
        data: executed.then_some(&response.data),
    };
    serde_json::to_vec(&body).expect("a GraphQL response serializes")
}

/// graphql-js reports syntax errors as `GRAPHQL_PARSE_FAILED` with HTTP 200; the bracket
/// pre-scan's error has the same shape.
fn parse_failure(error: &operation::ParseError) -> Response {
    let server_error = ServerError::new(error.to_string(), error.pos());
    let mut errors = vec![server_error];
    errors::set_code(&mut errors[0], "GRAPHQL_PARSE_FAILED");
    let response = async_graphql::Response::from_errors(errors);
    bytes_response(StatusCode::OK, render(&response))
}

/// Why a request body is not a GraphQL request, with yoga's messages.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ParamsError {
    /// Yoga has no parser for the content type and answers 415 with an empty body.
    #[error("unsupported media type")]
    UnsupportedMediaType,
    #[error("POST body sent invalid JSON.")]
    InvalidJson(String),
    /// A `BAD_REQUEST` error answered with `status`.
    #[error("{message}")]
    BadRequest { status: StatusCode, message: String },
}

impl ParamsError {
    fn bad_request(message: String) -> Self {
        Self::BadRequest {
            status: StatusCode::BAD_REQUEST,
            message,
        }
    }
}

impl IntoResponse for ParamsError {
    fn into_response(self) -> Response {
        match self {
            Self::UnsupportedMediaType => StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response(),
            Self::InvalidJson(detail) => json_response(
                StatusCode::BAD_REQUEST,
                &error_body(
                    "POST body sent invalid JSON.",
                    Some(json!({
                        "code": "BAD_REQUEST",
                        "originalError": { "name": "SyntaxError", "message": detail },
                    })),
                ),
            ),
            Self::BadRequest { status, message } => bad_request(status, &message),
        }
    }
}

/// async-graphql's own recursion-limit error, which it would return later for the same document.
fn depth_failure(exceeded: depth::DepthExceeded) -> Response {
    let mut error = ServerError::new(depth::depth_error_message(), exceeded.pos);
    errors::set_code(&mut error, "GRAPHQL_VALIDATION_FAILED");
    let response = async_graphql::Response::from_errors(vec![error]);
    bytes_response(StatusCode::OK, render(&response))
}

/// Parses a JSON body the way yoga's `parsePOSTJsonRequest` and `checkGraphQLQueryParams` do.
pub fn parse_params(headers: &HeaderMap, body: &[u8]) -> Result<GraphqlParams, ParamsError> {
    if !is_json_request(headers) {
        return Err(ParamsError::UnsupportedMediaType);
    }
    let value: Value = serde_json::from_slice(body)
        .map_err(|error| ParamsError::InvalidJson(error.to_string()))?;
    let mut params = match value {
        Value::Object(params) => params,
        Value::Array(_) => {
            return Err(ParamsError::bad_request(
                "Batching is not supported.".to_owned(),
            ));
        }
        Value::Null => {
            return Err(ParamsError::bad_request(
                "POST body is expected to be object but received null".to_owned(),
            ));
        }
        other => {
            return Err(ParamsError::bad_request(format!(
                "POST body is expected to be object but received {}",
                js_typeof(&other)
            )));
        }
    };

    if let Some(key) = params.iter().find_map(|(key, value)| {
        let expected = matches!(
            key.as_str(),
            "query" | "variables" | "operationName" | "extensions"
        );
        (!value.is_null() && !expected).then_some(key)
    }) {
        return Err(ParamsError::bad_request(format!(
            "Unexpected parameter \"{key}\" in the request body."
        )));
    }

    let query = match params.remove("query") {
        None | Some(Value::Null) => {
            // A spec error: yoga answers `application/json` clients with 200.
            return Err(ParamsError::BadRequest {
                status: StatusCode::OK,
                message: "Must provide query string.".to_owned(),
            });
        }
        Some(Value::String(query)) => query,
        Some(other) => {
            return Err(ParamsError::bad_request(format!(
                "Expected \"query\" param to be a string, but given {}.",
                extended_typeof(&other)
            )));
        }
    };
    let variables = params.remove("variables").unwrap_or(Value::Null);
    if !matches!(variables, Value::Object(_) | Value::Null) {
        return Err(ParamsError::bad_request(format!(
            "Expected \"variables\" param to be empty or an object, but given {}.",
            extended_typeof(&variables)
        )));
    }
    if let Some(extensions) = params.get("extensions")
        && !matches!(extensions, Value::Object(_) | Value::Null)
    {
        return Err(ParamsError::bad_request(format!(
            "Expected \"extensions\" param to be empty or an object, but given {}.",
            extended_typeof(extensions)
        )));
    }
    let operation_name = match params.remove("operationName") {
        Some(Value::String(name)) => Some(name),
        _ => None,
    };

    Ok(GraphqlParams {
        query,
        operation_name,
        variables,
    })
}

/// yoga's `isPOSTJsonRequest`: the first content type is `application/json` or
/// `application/graphql+json`, optionally with parameters.
fn is_json_request(headers: &HeaderMap) -> bool {
    let Some(content_type) = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let first = content_type.split(',').next().unwrap_or_default();
    ["application/json", "application/graphql+json"]
        .iter()
        .any(|expected| {
            first == *expected
                || first
                    .strip_prefix(expected)
                    .is_some_and(|rest| rest.starts_with(';'))
        })
}

fn js_typeof(value: &Value) -> &'static str {
    match value {
        Value::Null | Value::Array(_) | Value::Object(_) => "object",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
    }
}

/// `extendedTypeof` in graphql-yoga: `typeof`, but `null` and `array` are their own kinds.
fn extended_typeof(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Array(_) => "array",
        other => js_typeof(other),
    }
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use serde_json::{Value, json};

    use wiremock::ResponseTemplate;

    use super::{
        CachePlan, HeaderMap, HeaderValue, ServerError, bytes_response, cache_result, header,
        operation, parse_params, render,
    };
    use crate::google::GoogleAuth;
    use crate::graphql::auth::testing::*;
    use crate::test_support::{TestApp, post_graphql, post_graphql_as};

    const FORMS_QUERY: &str = "query CCBFormsV2Query { ccbFormsV2 { __typename } }";

    fn unavailable() -> Value {
        json!({ "errors": [{
            "message": "Authentication temporarily unavailable. Please retry.",
            "extensions": { "code": "SERVICE_UNAVAILABLE" },
        }] })
    }

    #[tokio::test]
    async fn runs_requests_with_valid_tokens() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_account(1).await;
        let app = TestApp::with_google(&mock, Some(GoogleAuth::fixed(ACCESS_TOKEN)));
        let response = app
            .send(post_graphql_as(
                json!({ "query": FORMS_QUERY }),
                &sign(&anonymous_claims()),
            ))
            .await;
        assert_eq!(response.status, StatusCode::OK);
        assert_eq!(
            response.json(),
            json!({ "data": { "ccbFormsV2": { "__typename": "CCBFormsSuccess" } } })
        );
    }

    #[tokio::test]
    async fn answers_503_when_the_account_lookup_fails() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_lookup(ResponseTemplate::new(500), 1).await;
        let app = TestApp::with_google(&mock, Some(GoogleAuth::fixed(ACCESS_TOKEN)));
        let response = app
            .send(post_graphql_as(
                json!({ "query": FORMS_QUERY }),
                &sign(&anonymous_claims()),
            ))
            .await;
        assert_eq!(response.status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response.headers["content-type"],
            "application/json; charset=utf-8"
        );
        assert_eq!(response.json(), unavailable());
    }

    #[tokio::test]
    async fn answers_503_for_valid_tokens_without_google_credentials() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        let app = TestApp::with_google(&mock, None);
        let response = app
            .send(post_graphql_as(
                json!({ "query": FORMS_QUERY }),
                &sign(&anonymous_claims()),
            ))
            .await;
        assert_eq!(response.status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.json(), unavailable());
    }

    #[tokio::test]
    async fn rejects_operations_over_the_complexity_limit() {
        let app = TestApp::new();
        // Each alias costs 22: ccbFormsV2 1 + forms (1 + 10 + title 1 × 10).
        let fields: String = (0..91)
            .map(|n| {
                format!("f{n}: ccbFormsV2 {{ ... on CCBFormsSuccess {{ forms {{ title }} }} }} ")
            })
            .collect();
        let response = app
            .send(post_graphql(
                json!({ "query": format!("query Heavy {{ {fields} }}") }),
            ))
            .await;
        assert_eq!(response.status, StatusCode::OK);
        assert_eq!(
            response.json(),
            json!({ "errors": [{
                "message": "Query is too complex: 2002. Maximum allowed complexity: 2000",
                "extensions": { "code": "QUERY_TOO_COMPLEX", "complexity": 2002, "maximumComplexity": 2000 },
            }] })
        );
        assert!(!response.headers.contains_key("etag"));

        let fields: String = (0..90)
            .map(|n| {
                format!("f{n}: ccbFormsV2 {{ ... on CCBFormsSuccess {{ forms {{ title }} }} }} ")
            })
            .collect();
        let response = app
            .send(post_graphql(
                json!({ "query": format!("query Heavy {{ {fields} }}") }),
            ))
            .await;
        assert!(response.json().get("data").is_some());
    }

    #[tokio::test]
    async fn does_not_cache_partial_results() {
        // An executed result with data and a resolver error on a nullable field.
        let app = TestApp::new();
        let params = parse_params(
            &{
                let mut headers = HeaderMap::new();
                headers.insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/json"),
                );
                headers
            },
            json!({ "query": FORMS_QUERY }).to_string().as_bytes(),
        )
        .unwrap();
        let document = operation::parse_document(FORMS_QUERY).unwrap();
        let plan = CachePlan::new(&document, &params, None, None).unwrap();
        let mut response = async_graphql::Response::new(
            async_graphql::Value::from_json(json!({ "ccbFormsV2": null })).unwrap(),
        );
        let mut error = ServerError::new("Unexpected error.", None);
        error.path = vec![async_graphql::PathSegment::Field("ccbFormsV2".to_owned())];
        response.errors = vec![error];

        let mut http_response = bytes_response(StatusCode::OK, render(&response));
        cache_result(&app.state, &plan, response, &mut http_response).await;

        assert!(!http_response.headers().contains_key(header::ETAG));
        assert!(!http_response.headers().contains_key(header::LAST_MODIFIED));
        assert!(app.state.response_cache.get(&plan.key).await.is_none());
        for _ in 0..20 {
            tokio::task::yield_now().await;
        }
        assert!(
            app.store
                .keys()
                .iter()
                .all(|key| !key.starts_with("rs:graphql:response-cache:"))
        );
    }

    #[tokio::test]
    async fn memoizes_the_verdict_and_ttl_per_document() {
        let app = TestApp::new();
        let response = app
            .send(post_graphql(json!({ "query": FORMS_QUERY })))
            .await;
        assert!(response.json().get("data").is_some());
        let document = crate::graphql::operation::parse_document(FORMS_QUERY).unwrap();
        let facts = app
            .state
            .documents
            .facts(FORMS_QUERY, None, &document)
            .unwrap();
        // Both were computed by the request; recomputing would panic.
        assert_eq!(
            facts
                .verdict(|| panic!("the verdict was not memoized"))
                .maximum,
            2000
        );
        assert_eq!(
            facts.ttl(|| panic!("the TTL was not memoized")),
            std::time::Duration::from_secs(600)
        );
    }

    fn depth_error() -> Value {
        json!({ "errors": [{
            "message": "The recursion depth of the query cannot be greater than `32`",
            "extensions": { "code": "GRAPHQL_VALIDATION_FAILED" },
        }] })
    }

    /// What async-graphql itself answers for `query`, which it rejects before any resolver runs.
    async fn async_graphql_answer(app: &TestApp, query: &str) -> Value {
        let response = app.state.schema.execute(query).await;
        serde_json::from_slice(&render(&response)).unwrap()
    }

    #[tokio::test]
    async fn rejects_fragment_cycles_by_the_depth_limit() {
        let app = TestApp::new();
        let fields: String = (0..100)
            .map(|n| {
                format!("f{n}: ccbFormsV2 {{ ... on CCBFormsSuccess {{ forms {{ ...A }} }} }} ")
            })
            .collect();
        let query = format!(
            "query Cycle {{ {fields} }} fragment A on CCBForm {{ title ...B }} fragment B on CCBForm {{ id ...A }}"
        );
        let response = app.send(post_graphql(json!({ "query": query }))).await;
        assert_eq!(response.status, StatusCode::OK);
        // The same error, location included, that async-graphql returned for it before.
        let body = response.json();
        assert_eq!(body, async_graphql_answer(&app, &query).await);
        assert_eq!(
            body["errors"][0]["message"],
            depth_error()["errors"][0]["message"]
        );
    }

    /// The operation spreads `F1`; each `Fi` spreads `F(i+1)`; `F{depth}` selects `__typename`.
    fn fragment_chain(depth: usize) -> String {
        let mut document = "query Chain { ...F1 }".to_owned();
        for i in 1..depth {
            document += &format!(" fragment F{i} on Query {{ ...F{} }}", i + 1);
        }
        document += &format!(" fragment F{depth} on Query {{ __typename }}");
        document
    }

    #[tokio::test]
    async fn accepts_documents_at_the_depth_limit() {
        let app = TestApp::new();
        let at_limit = app
            .send(post_graphql(json!({ "query": fragment_chain(32) })))
            .await;
        assert_eq!(
            at_limit.json(),
            json!({ "data": { "__typename": "Query" } })
        );
        let over = app
            .send(post_graphql(json!({ "query": fragment_chain(33) })))
            .await;
        let body = over.json();
        assert_eq!(body, async_graphql_answer(&app, &fragment_chain(33)).await);
        assert_eq!(
            body["errors"][0]["extensions"],
            depth_error()["errors"][0]["extensions"]
        );
    }

    /// Deeply nested values in every place the parser builds them recursively.
    fn deep_values(levels: usize) -> Vec<(&'static str, String)> {
        let list = format!("{}1{}", "[".repeat(levels), "]".repeat(levels));
        let object = format!("{}1{}", "{a: ".repeat(levels), "}".repeat(levels));
        vec![
            (
                "list argument",
                format!("query Q {{ ccbFormsV2(a: {list}) {{ __typename }} }}"),
            ),
            (
                "object argument",
                format!("query Q {{ ccbFormsV2(a: {object}) {{ __typename }} }}"),
            ),
            (
                "directive argument",
                format!("query Q {{ ccbFormsV2 @include(if: {list}) {{ __typename }} }}"),
            ),
            (
                "variable default",
                format!("query Q($v: [Int] = {list}) {{ __typename }}"),
            ),
            (
                "fragment directive",
                format!(
                    "query Q {{ ...F }} fragment F on Query @include(if: {object}) {{ __typename }}"
                ),
            ),
            (
                "unused operation",
                format!(
                    "query Q {{ __typename }} query R {{ ccbFormsV2(a: {list}) {{ __typename }} }}"
                ),
            ),
        ]
    }

    #[test]
    fn survives_deeply_nested_values_on_a_small_stack() {
        // The whole pipeline on a 256 KiB stack. async-graphql's conversion of the parsed document
        // recursed once per list or object level and overflowed a 2 MiB worker stack at about
        // 1,400 levels (pest 2.9.3 itself checks the remaining stack and fails the parse cleanly).
        let handle = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(|| {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                runtime.block_on(async {
                    let app = TestApp::new();
                    // 500 levels is inside the overflow window for this stack: pest's own
                    // guard lets it through and the AST builder then overflows.
                    for levels in [500, 2_000, 100_000] {
                        for (case, query) in deep_values(levels) {
                            let body = json!({ "query": query, "operationName": "Q" });
                            let response = app.send(post_graphql(body)).await;
                            assert_eq!(response.status, StatusCode::OK, "{case} at {levels}");
                            let body = response.json();
                            assert_eq!(
                                body["errors"][0]["extensions"]["code"], "GRAPHQL_PARSE_FAILED",
                                "{case} at {levels}: {body}"
                            );
                            assert_eq!(
                                body["errors"][0]["message"],
                                "Syntax Error: brackets are nested deeper than 128 levels."
                            );
                        }
                    }
                });
            })
            .unwrap();
        handle.join().unwrap();
    }

    #[test]
    fn rejects_unterminated_block_string_bypasses_on_a_small_stack() {
        // The C2 bypass: an unterminated `"""` in front of deep nesting. The grammar's `string`
        // rule backtracks over the opener (reading `""`, an empty string) and then builds the
        // value recursively, which overflowed a worker stack and aborted the process. The pre-scan
        // now counts the brackets the opener used to hide and rejects the document before
        // `parse_query` runs, so the whole pipeline survives a 256 KiB stack.
        let handle = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(|| {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                runtime.block_on(async {
                    let app = TestApp::new();
                    let deep = format!("{}1{}", "[".repeat(2_000), "]".repeat(2_000));
                    let cases = [
                        (
                            "list argument",
                            format!(r#"query Q {{ ccbFormsV2(a: [""""{deep}]) {{ __typename }} }}"#),
                        ),
                        (
                            "directive argument",
                            format!(
                                r#"query Q {{ ccbFormsV2 @include(if: [""""{deep}]) {{ __typename }} }}"#
                            ),
                        ),
                        (
                            "variable default",
                            format!(r#"query Q($v: [Int] = [""""{deep}]) {{ __typename }}"#),
                        ),
                    ];
                    for (case, query) in cases {
                        let body = json!({ "query": query, "operationName": "Q" });
                        let response = app.send(post_graphql(body)).await;
                        assert_eq!(response.status, StatusCode::OK, "{case}");
                        let body = response.json();
                        assert_eq!(
                            body["errors"][0]["extensions"]["code"], "GRAPHQL_PARSE_FAILED",
                            "{case}: {body}"
                        );
                        assert_eq!(
                            body["errors"][0]["message"],
                            "Syntax Error: brackets are nested deeper than 128 levels."
                        );
                    }
                });
            })
            .unwrap();
        handle.join().unwrap();
    }

    #[tokio::test]
    async fn parses_documents_nested_up_to_128_brackets() {
        let app = TestApp::new();
        // `{` and `(` are two levels, so 126 list levels make 128 in all.
        let query = |lists: usize| {
            format!(
                "query Q {{ ccbFormsV2(a: {}1{}) {{ __typename }} }}",
                "[".repeat(lists),
                "]".repeat(lists)
            )
        };
        let at_limit = app
            .send(post_graphql(json!({ "query": query(126) })))
            .await
            .json();
        // Parsed and then rejected by validation (`ccbFormsV2` takes no argument).
        assert_eq!(
            at_limit["errors"][0]["extensions"]["code"],
            "GRAPHQL_VALIDATION_FAILED"
        );
        let over = app
            .send(post_graphql(json!({ "query": query(127) })))
            .await
            .json();
        assert_eq!(
            over["errors"][0]["extensions"]["code"],
            "GRAPHQL_PARSE_FAILED"
        );
        assert_eq!(
            over["errors"][0]["locations"],
            json!([{ "line": 1, "column": 25 + 126 }])
        );

        let in_string = format!(
            r#"query Q {{ ccbFormsV2(a: "{}") {{ __typename }} }}"#,
            "[".repeat(500)
        );
        let body = app
            .send(post_graphql(json!({ "query": in_string })))
            .await
            .json();
        assert_eq!(
            body["errors"][0]["extensions"]["code"],
            "GRAPHQL_VALIDATION_FAILED"
        );
    }

    #[test]
    fn survives_long_fragment_chains_on_a_small_stack() {
        // The whole pipeline on a 256 KiB stack: recursing once per spread overflowed a worker's
        // much larger stack at about 15k spreads and aborted the process.
        let handle = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(|| {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                runtime.block_on(async {
                    let app = TestApp::new();
                    for nested in [false, true] {
                        let query = crate::graphql::depth::tests::long_chain(15_000, nested);
                        let response = app.send(post_graphql(json!({ "query": query }))).await;
                        assert_eq!(response.status, StatusCode::OK);
                        let body = response.json();
                        assert_eq!(
                            body["errors"][0]["message"],
                            depth_error()["errors"][0]["message"]
                        );
                        assert_eq!(
                            body["errors"][0]["extensions"],
                            depth_error()["errors"][0]["extensions"]
                        );
                        assert!(body["errors"][0]["locations"].is_array());
                    }
                });
            })
            .unwrap();
        handle.join().unwrap();
    }

    #[tokio::test]
    async fn runs_unauthenticated_requests_for_invalid_tokens() {
        let mock = GoogleMock::start().await;
        let mut claims = anonymous_claims();
        claims["aud"] = json!("another-project");
        let app = TestApp::with_google(&mock, Some(GoogleAuth::fixed(ACCESS_TOKEN)));
        let response = app
            .send(post_graphql_as(
                json!({ "query": FORMS_QUERY }),
                &sign(&claims),
            ))
            .await;
        assert_eq!(response.status, StatusCode::OK);
    }

    #[tokio::test]
    async fn executes_a_named_query() {
        let app = TestApp::new();
        let response = app
            .send(post_graphql(json!({ "query": "query X { __typename }" })))
            .await;
        assert_eq!(response.status, StatusCode::OK);
        assert_eq!(
            response.headers["content-type"],
            "application/json; charset=utf-8"
        );
        assert_eq!(
            response.json(),
            json!({ "data": { "__typename": "Query" } })
        );
    }

    #[tokio::test]
    async fn rejects_malformed_json() {
        let app = TestApp::new();
        let request = Request::post("/graphql")
            .header("content-type", "application/json")
            .body(Body::from("{not json"))
            .unwrap();
        let response = app.send(request).await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        let body = response.json();
        assert_eq!(body["errors"][0]["message"], "POST body sent invalid JSON.");
        assert_eq!(body["errors"][0]["extensions"]["code"], "BAD_REQUEST");
        assert_eq!(
            body["errors"][0]["extensions"]["originalError"]["name"],
            "SyntaxError"
        );
    }

    #[tokio::test]
    async fn validates_request_params_like_yoga() {
        let app = TestApp::new();
        let cases: [(Value, StatusCode, &str); 6] = [
            (
                json!([]),
                StatusCode::BAD_REQUEST,
                "Batching is not supported.",
            ),
            (
                json!("query"),
                StatusCode::BAD_REQUEST,
                "POST body is expected to be object but received string",
            ),
            (
                json!({ "query": "query X { __typename }", "extra": 1 }),
                StatusCode::BAD_REQUEST,
                "Unexpected parameter \"extra\" in the request body.",
            ),
            // A spec error: application/json clients get 200, as yoga answers them.
            (json!({}), StatusCode::OK, "Must provide query string."),
            (
                json!({ "query": 1 }),
                StatusCode::BAD_REQUEST,
                "Expected \"query\" param to be a string, but given number.",
            ),
            (
                json!({ "query": "query X { __typename }", "variables": [] }),
                StatusCode::BAD_REQUEST,
                "Expected \"variables\" param to be empty or an object, but given array.",
            ),
        ];
        for (body, status, message) in cases {
            let response = app.send(post_graphql(body)).await;
            assert_eq!(response.status, status, "{message}");
            assert_eq!(
                response.json(),
                json!({ "errors": [{ "message": message, "extensions": { "code": "BAD_REQUEST" } }] })
            );
        }
    }

    #[tokio::test]
    async fn serves_post_only() {
        let app = TestApp::new();
        let request = Request::get("/graphql?query=query%20X%20%7B%20__typename%20%7D")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.send(request).await.status,
            StatusCode::METHOD_NOT_ALLOWED
        );
    }

    #[tokio::test]
    async fn answers_unsupported_media_types_with_415() {
        let app = TestApp::new();
        let request = Request::post("/graphql")
            .header("content-type", "text/plain")
            .body(Body::from(r#"{"query":"query X { __typename }"}"#))
            .unwrap();
        let response = app.send(request).await;
        assert_eq!(response.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
        assert_eq!(response.body, "");
    }

    #[tokio::test]
    async fn rejects_anonymous_operations_with_200() {
        let app = TestApp::new();
        let response = app
            .send(post_graphql(
                json!({ "query": "{ ccbFormsV2 { __typename } }" }),
            ))
            .await;
        assert_eq!(response.status, StatusCode::OK);
        assert_eq!(
            response.json(),
            json!({ "errors": [{ "message": "All operations must have a name. Please add a name to your query/mutation." }] })
        );
    }

    #[tokio::test]
    async fn reports_syntax_errors_as_parse_failures() {
        let app = TestApp::new();
        let response = app
            .send(post_graphql(json!({ "query": "query X { __typename" })))
            .await;
        assert_eq!(response.status, StatusCode::OK);
        let body = response.json();
        assert_eq!(
            body["errors"][0]["extensions"]["code"],
            "GRAPHQL_PARSE_FAILED"
        );
        assert!(body.get("data").is_none());
    }

    #[tokio::test]
    async fn reports_validation_errors_without_data() {
        // The unknown field sits under a local root field: an unknown root field is forwarded.
        let app = TestApp::new();
        let response = app
            .send(post_graphql(
                json!({ "query": "query X { core { nope } }" }),
            ))
            .await;
        assert_eq!(response.status, StatusCode::OK);
        let body = response.json();
        assert_eq!(
            body["errors"][0]["extensions"]["code"],
            "GRAPHQL_VALIDATION_FAILED"
        );
        assert!(body.get("data").is_none());
    }

    #[tokio::test]
    async fn caps_validation_errors_like_graphql_js() {
        let app = TestApp::new();
        // Under a local root field, so the operation is answered here rather than forwarded.
        let unknown = |count: usize| -> String {
            let fields: String = (0..count).map(|n| format!("unknown{n} ")).collect();
            format!("query X {{ core {{ {fields} }} }}")
        };

        let body = app
            .send(post_graphql(json!({ "query": unknown(100) })))
            .await
            .json();
        let errors = body["errors"].as_array().unwrap();
        assert_eq!(errors.len(), 100);

        let body = app
            .send(post_graphql(json!({ "query": unknown(150) })))
            .await
            .json();
        let errors = body["errors"].as_array().unwrap();
        assert_eq!(errors.len(), 101);
        assert_eq!(
            errors[100],
            json!({
                "message": "Too many validation errors, error limit reached. Validation aborted.",
                "extensions": { "code": "GRAPHQL_VALIDATION_FAILED" },
            })
        );
        assert!(
            errors
                .iter()
                .all(|error| error["extensions"]["code"] == "GRAPHQL_VALIDATION_FAILED")
        );
        assert!(body.get("data").is_none());
    }

    #[tokio::test]
    async fn passes_variables_and_operation_name() {
        let app = TestApp::new();
        let response = app
            .send(post_graphql(json!({
                // (async-graphql does not see variables in directives on `__typename`, so the skipped
                // field is a real one.)
                "query": "query A { a: __typename } query B($skip: Boolean!) { b: ccbFormsV2 @skip(if: $skip) { __typename } c: __typename }",
                "operationName": "B",
                "variables": { "skip": true },
            })))
            .await;
        assert_eq!(response.json(), json!({ "data": { "c": "Query" } }));
    }

    #[tokio::test]
    async fn labels_metrics_with_bounded_operation_names() {
        let app = TestApp::new();
        let unknown = app
            .send(post_graphql(
                json!({ "query": "query Bench { __typename }" }),
            ))
            .await;
        // The log line keeps the TS formatting; the metric label does not carry the raw name.
        assert_eq!(unknown.graphql.unwrap().operation_name, "Bench-untagged");
        app.send(post_graphql(
            json!({ "query": "query CCBFormsV2Query { ccbFormsV2 { __typename } }" }),
        ))
        .await;
        let metrics = app.state.metrics.render();
        assert!(metrics.contains(
            r#"graphql_envelop_request_total{operationName="untagged",operationType="query",route="local"} 1"#
        ));
        assert!(metrics.contains(
            r#"graphql_envelop_request_total{operationName="CCBFormsV2Query",operationType="query",route="local"} 1"#
        ));
        assert!(!metrics.contains("Bench"));
    }

    #[tokio::test]
    async fn rejects_bodies_over_two_megabytes() {
        let app = TestApp::new();
        let padding = " ".repeat(2 * 1024 * 1024);
        let request = Request::post("/graphql")
            .header("content-type", "application/json")
            .body(Body::from(format!(
                r#"{{"query":"query X {{ __typename }}"}}{padding}"#
            )))
            .unwrap();
        assert_eq!(
            app.send(request).await.status,
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }
}
