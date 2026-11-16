//! GraphQL error shapes, matching what graphql-yoga writes for the TS server
//! (`apps/server/src/routes/graphql.ts`, yoga's request parser and result processor).

use axum::body::Body;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::Response;
use serde_json::{Value, json};

/// Yoga's content type for `application/json` (and `*/*`) clients.
pub const JSON_CONTENT_TYPE: &str = "application/json; charset=utf-8";

/// `{"errors":[{"message": …, "extensions": …}]}` with no `locations` or `path`.
pub fn error_body(message: &str, extensions: Option<Value>) -> Value {
    let mut error = serde_json::Map::new();
    error.insert("message".to_owned(), Value::from(message));
    if let Some(extensions) = extensions {
        error.insert("extensions".to_owned(), extensions);
    }
    json!({ "errors": [Value::Object(error)] })
}

/// A JSON response with yoga's content type.
pub fn json_response(status: StatusCode, body: &Value) -> Response {
    bytes_response(status, body.to_string().into_bytes())
}

pub fn bytes_response(status: StatusCode, body: Vec<u8>) -> Response {
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(JSON_CONTENT_TYPE),
    );
    response
}

/// A request-level error with `extensions.code = BAD_REQUEST`.
pub fn bad_request(status: StatusCode, message: &str) -> Response {
    json_response(
        status,
        &error_body(message, Some(json!({ "code": "BAD_REQUEST" }))),
    )
}

/// Marks an error the client should see as written. The TS server's resolvers throw
/// `GraphQLError`s for these, which yoga's masking passes through; anything else is masked.
#[derive(Clone, Copy, Debug)]
pub struct Expected;

/// An error that reaches the client unmasked, with `extensions.code`.
pub fn expected_error(message: impl Into<String>, code: &str) -> async_graphql::Error {
    let mut extensions = async_graphql::ErrorExtensionValues::default();
    extensions.set("code", code);
    async_graphql::Error {
        message: message.into(),
        source: Some(std::sync::Arc::new(Expected)),
        extensions: Some(extensions),
    }
}

/// Pothos' `ForbiddenError`: unmasked and without extensions (its `FORBIDDEN` code is a JS
/// property that never reaches the response).
pub fn forbidden(message: impl Into<String>) -> async_graphql::Error {
    async_graphql::Error {
        message: message.into(),
        source: Some(std::sync::Arc::new(Expected)),
        extensions: None,
    }
}

/// Whether `error` came from `expected_error` or `forbidden`.
pub fn is_expected(error: &async_graphql::ServerError) -> bool {
    error
        .source
        .as_ref()
        .is_some_and(|source| source.is::<Expected>())
}

/// `authenticator.ts`'s error when Google cannot be reached: HTTP 503.
pub fn authentication_unavailable() -> Response {
    json_response(
        StatusCode::SERVICE_UNAVAILABLE,
        &error_body(
            "Authentication temporarily unavailable. Please retry.",
            Some(json!({ "code": "SERVICE_UNAVAILABLE" })),
        ),
    )
}

/// Sets `extensions.code` on `error`, keeping any other extensions.
pub fn set_code(error: &mut async_graphql::ServerError, code: &str) {
    error
        .extensions
        .get_or_insert_with(Default::default)
        .set("code", code);
}

/// graphql-js `validate`'s default `maxErrors`.
pub const MAX_VALIDATION_ERRORS: usize = 100;

/// graphql-js's error after `MAX_VALIDATION_ERRORS`.
pub const TOO_MANY_VALIDATION_ERRORS: &str =
    "Too many validation errors, error limit reached. Validation aborted.";

/// yoga's `error.extensions.code ||= code`.
fn set_code_if_absent(error: &mut async_graphql::ServerError, code: &str) {
    let has_code = error
        .extensions
        .as_ref()
        .is_some_and(|extensions| extensions.get("code").is_some());
    if !has_code {
        set_code(error, code);
    }
}

/// Tags validation errors with `GRAPHQL_VALIDATION_FAILED`, as graphql-yoga does, after capping
/// them at graphql-js's limit. That includes
/// the document checks async-graphql runs while preparing a pre-parsed document (its recursion
/// limit; the handler's `depth::check` normally rejects those documents first, with the same
/// error); graphql-js reports those cases as validation errors.
pub struct ValidationErrorCode;

impl async_graphql::extensions::ExtensionFactory for ValidationErrorCode {
    fn create(&self) -> std::sync::Arc<dyn async_graphql::extensions::Extension> {
        std::sync::Arc::new(ValidationErrorCodeExtension)
    }
}

struct ValidationErrorCodeExtension;

#[async_graphql::async_trait::async_trait]
impl async_graphql::extensions::Extension for ValidationErrorCodeExtension {
    async fn parse_query(
        &self,
        ctx: &async_graphql::extensions::ExtensionContext<'_>,
        query: &str,
        variables: &async_graphql::Variables,
        next: async_graphql::extensions::NextParseQuery<'_>,
    ) -> async_graphql::ServerResult<async_graphql::parser::types::ExecutableDocument> {
        next.run(ctx, query, variables).await.map_err(|mut error| {
            set_code_if_absent(&mut error, "GRAPHQL_VALIDATION_FAILED");
            error
        })
    }

    async fn validation(
        &self,
        ctx: &async_graphql::extensions::ExtensionContext<'_>,
        next: async_graphql::extensions::NextValidation<'_>,
    ) -> Result<async_graphql::ValidationResult, Vec<async_graphql::ServerError>> {
        next.run(ctx).await.map_err(|mut errors| {
            // graphql-js stops after 100 errors and appends its abort error.
            if errors.len() > MAX_VALIDATION_ERRORS {
                errors.truncate(MAX_VALIDATION_ERRORS);
                errors.push(async_graphql::ServerError::new(
                    TOO_MANY_VALIDATION_ERRORS,
                    None,
                ));
            }
            for error in &mut errors {
                set_code_if_absent(error, "GRAPHQL_VALIDATION_FAILED");
            }
            errors
        })
    }
}

/// Brings an executed response in line with graphql-js and yoga before it is written (after
/// `nulls::propagate`): unexpected resolver errors are masked.
pub fn finish(response: &mut async_graphql::Response) {
    // async-graphql reports an execution that selected nothing (every field skipped) as
    // `data: null`; graphql-js returns an empty object.
    if response.errors.is_empty() && response.data == async_graphql::Value::Null {
        response.data = async_graphql::Value::Object(Default::default());
    }
    mask_unexpected(response);
}

/// yoga's `maskError`: a resolver error the server did not mean to show (anything but
/// `expected_error`, `forbidden` or an error carrying a `code`) becomes `Unexpected error.` with
/// `INTERNAL_SERVER_ERROR`, keeping its `path` and `locations`. Errors without a path (validation)
/// pass through. The original is logged.
fn mask_unexpected(response: &mut async_graphql::Response) {
    for error in &mut response.errors {
        let has_code = error
            .extensions
            .as_ref()
            .is_some_and(|extensions| extensions.get("code").is_some());
        if error.path.is_empty() || is_expected(error) || has_code {
            continue;
        }
        let path = error
            .path
            .iter()
            .map(|segment| match segment {
                async_graphql::PathSegment::Field(name) => name.clone(),
                async_graphql::PathSegment::Index(index) => index.to_string(),
            })
            .collect::<Vec<_>>()
            .join(".");
        tracing::error!(gql_path = %path, error = %error.message, "GraphQL resolver error");
        error.message = "Unexpected error.".to_owned();
        error.source = None;
        error.extensions = None;
        set_code(error, "INTERNAL_SERVER_ERROR");
    }
}

#[cfg(test)]
mod tests {
    use async_graphql::{ServerError, Value};
    use serde_json::json;

    use super::*;

    fn data(response: &async_graphql::Response) -> serde_json::Value {
        response.data.clone().into_json().unwrap()
    }

    mod masking {
        use async_graphql::{EmptyMutation, EmptySubscription, ErrorExtensions, Object, Schema};
        use serde_json::json;

        use crate::graphql::errors::{ValidationErrorCode, expected_error};
        use crate::graphql::guards::Authorized;
        use crate::test_support::execute_like_handler;

        struct MaskQuery;

        #[Object]
        impl MaskQuery {
            async fn boom(&self) -> async_graphql::Result<Option<String>> {
                Err("connection to example-db refused".into())
            }

            async fn expected(&self) -> async_graphql::Result<Option<String>> {
                Err(expected_error("Campus not found", "NOT_FOUND"))
            }

            async fn coded(&self) -> async_graphql::Result<Option<String>> {
                Err(async_graphql::Error::new("Bad slug")
                    .extend_with(|_, extensions| extensions.set("code", "BAD_USER_INPUT")))
            }

            #[graphql(guard = "Authorized")]
            async fn guarded(&self) -> Option<String> {
                Some("Example".to_owned())
            }

            async fn ok(&self) -> Option<String> {
                Some("Example".to_owned())
            }
        }

        async fn run(query: &str) -> serde_json::Value {
            let schema = Schema::build(MaskQuery, EmptyMutation, EmptySubscription)
                .extension(ValidationErrorCode)
                .finish();
            execute_like_handler(&schema, query, None).await
        }

        #[tokio::test]
        async fn masks_unexpected_resolver_errors() {
            assert_eq!(
                run("query M { boom ok }").await,
                json!({
                    "errors": [{
                        "message": "Unexpected error.",
                        "locations": [{ "line": 1, "column": 11 }],
                        "path": ["boom"],
                        "extensions": { "code": "INTERNAL_SERVER_ERROR" },
                    }],
                    "data": { "ok": "Example", "boom": null },
                })
            );
        }

        #[tokio::test]
        async fn passes_expected_and_coded_errors() {
            let body = run("query M { expected coded guarded }").await;
            let messages: Vec<&str> = body["errors"]
                .as_array()
                .unwrap()
                .iter()
                .map(|error| error["message"].as_str().unwrap())
                .collect();
            assert!(messages.contains(&"Campus not found"));
            assert!(messages.contains(&"Bad slug"));
            assert!(messages.contains(&"Not authorized to resolve Query.guarded"));
            assert_eq!(
                body["data"],
                json!({ "expected": null, "coded": null, "guarded": null })
            );
            let not_found = body["errors"]
                .as_array()
                .unwrap()
                .iter()
                .find(|error| error["message"] == "Campus not found")
                .unwrap();
            assert_eq!(not_found["extensions"], json!({ "code": "NOT_FOUND" }));
        }

        #[tokio::test]
        async fn passes_validation_errors() {
            let body = run("query M { missing }").await;
            assert_eq!(
                body["errors"][0]["extensions"]["code"],
                "GRAPHQL_VALIDATION_FAILED"
            );
            assert_ne!(body["errors"][0]["message"], "Unexpected error.");
            assert!(body.get("data").is_none());
        }
    }

    #[test]
    fn writes_an_empty_object_when_every_field_was_skipped() {
        let mut response = async_graphql::Response::new(Value::Null);
        finish(&mut response);
        assert_eq!(data(&response), json!({}));
    }

    #[test]
    fn leaves_validation_failures_without_data() {
        let mut response =
            async_graphql::Response::from_errors(vec![ServerError::new("invalid", None)]);
        finish(&mut response);
        assert_eq!(response.data, Value::Null);
    }
}
