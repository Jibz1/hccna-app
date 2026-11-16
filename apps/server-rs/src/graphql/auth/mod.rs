//! Request authentication: `authenticateRequest` in
//! `apps/server/src/effect/services/AuthService.ts` and its use in `graphql/authenticator.ts`.
//! Only the Firebase method is ported; Google identity tokens and the shared client token
//! (`googleInternal`, `googleIam`, `token`) leave the request unauthenticated.

pub mod firebase;
#[cfg(test)]
pub mod testing;

use axum::http::HeaderMap;
use axum::http::header::AUTHORIZATION;

use crate::config::FirebaseConfig;
use crate::google::GoogleAuth;
use crate::metrics::Metrics;

pub use firebase::{FirebaseError, FirebaseToken, FirebaseVerifier};

/// `GRAPHQL_AUTH_TYPES` values a Firebase token can produce.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthKind {
    /// A full (non-anonymous) Firebase sign-in.
    Jwt,
    FirebaseAnonymous,
}

/// The authenticated caller, available to resolvers as request data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Viewer {
    pub uid: String,
    pub email: Option<String>,
    pub kind: AuthKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthOutcome {
    Unauthenticated,
    Authenticated(Viewer),
    /// Google could not be reached; the request fails with 503.
    Unavailable,
}

pub struct Authenticator {
    firebase: FirebaseVerifier,
}

impl Authenticator {
    pub fn new(
        config: &FirebaseConfig,
        http: reqwest::Client,
        metrics: Metrics,
        google: Option<GoogleAuth>,
    ) -> Self {
        Self::from_verifier(FirebaseVerifier::new(config, http, metrics, google))
    }

    pub fn from_verifier(firebase: FirebaseVerifier) -> Self {
        Self { firebase }
    }

    /// The `Authorization` bearer token, tried with the method `X-Auth-Method` names or, by
    /// default, with Firebase when it looks like a JWT.
    pub async fn authenticate(&self, headers: &HeaderMap) -> AuthOutcome {
        let authorization = headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok());
        let Some(token) = extract_token(authorization) else {
            return AuthOutcome::Unauthenticated;
        };
        let hint = headers
            .get("x-auth-method")
            .and_then(|value| value.to_str().ok());
        let firebase = match hint {
            Some("firebase") => true,
            Some("googleIam" | "googleInternal" | "token") => false,
            _ => token.split('.').count() == 3,
        };
        if !firebase {
            return AuthOutcome::Unauthenticated;
        }
        match self.firebase.verify(token).await {
            Ok(token) => AuthOutcome::Authenticated(Viewer {
                kind: if token.sign_in_provider.as_deref() == Some("anonymous") {
                    AuthKind::FirebaseAnonymous
                } else {
                    AuthKind::Jwt
                },
                uid: token.uid,
                email: token.email,
            }),
            Err(error) if error.is_invalid_credential() => AuthOutcome::Unauthenticated,
            Err(error) => {
                tracing::warn!(
                    cause = %error,
                    "Firebase authentication temporarily unavailable"
                );
                AuthOutcome::Unavailable
            }
        }
    }
}

/// `extractToken`: the second space-separated part of a `Bearer` header (scheme
/// case-insensitive), if non-empty.
pub fn extract_token(authorization: Option<&str>) -> Option<&str> {
    let mut parts = authorization?.split(' ');
    let scheme = parts.next()?;
    let token = parts.next()?;
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty()).then_some(token)
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;
    use wiremock::ResponseTemplate;

    use super::testing::*;
    use super::*;
    use crate::upstream;

    fn authenticator(mock: &GoogleMock) -> Authenticator {
        Authenticator::new(
            &mock.config(),
            upstream::http_client().unwrap(),
            Metrics::new(),
            Some(GoogleAuth::fixed(ACCESS_TOKEN)),
        )
    }

    fn bearer(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
        );
        headers
    }

    #[test]
    fn extracts_bearer_tokens_like_the_ts_server() {
        assert_eq!(extract_token(Some("Bearer abc")), Some("abc"));
        assert_eq!(extract_token(Some("bearer abc")), Some("abc"));
        assert_eq!(extract_token(Some("Bearer abc def")), Some("abc"));
        assert_eq!(extract_token(Some("Bearer  abc")), None);
        assert_eq!(extract_token(Some("Bearer")), None);
        assert_eq!(extract_token(Some("Basic abc")), None);
        assert_eq!(extract_token(None), None);
    }

    #[tokio::test]
    async fn anonymous_tokens_become_firebase_anonymous() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_account(1).await;
        let outcome = authenticator(&mock)
            .authenticate(&bearer(&sign(&anonymous_claims())))
            .await;
        assert_eq!(
            outcome,
            AuthOutcome::Authenticated(Viewer {
                uid: UID.to_owned(),
                email: None,
                kind: AuthKind::FirebaseAnonymous,
            })
        );
    }

    #[tokio::test]
    async fn other_providers_become_jwt() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_account(1).await;
        let outcome = authenticator(&mock)
            .authenticate(&bearer(&sign(&email_claims())))
            .await;
        assert_eq!(
            outcome,
            AuthOutcome::Authenticated(Viewer {
                uid: UID.to_owned(),
                email: Some("ada@example.com".to_owned()),
                kind: AuthKind::Jwt,
            })
        );
    }

    #[tokio::test]
    async fn invalid_or_missing_tokens_are_unauthenticated() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_account(0).await;
        let authenticator = authenticator(&mock);
        assert_eq!(
            authenticator.authenticate(&HeaderMap::new()).await,
            AuthOutcome::Unauthenticated
        );
        // Not JWT-shaped: only the shared-token method (not ported) would apply.
        assert_eq!(
            authenticator.authenticate(&bearer("opaque-token")).await,
            AuthOutcome::Unauthenticated
        );
        let mut expired = anonymous_claims();
        expired["exp"] = serde_json::json!(now() - 1);
        assert_eq!(
            authenticator.authenticate(&bearer(&sign(&expired))).await,
            AuthOutcome::Unauthenticated
        );
    }

    #[tokio::test]
    async fn honours_the_auth_method_hint() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(0).await;
        let mut headers = bearer(&sign(&anonymous_claims()));
        headers.insert("x-auth-method", HeaderValue::from_static("googleIam"));
        assert_eq!(
            authenticator(&mock).authenticate(&headers).await,
            AuthOutcome::Unauthenticated
        );
    }

    #[tokio::test]
    async fn outages_are_unavailable() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_lookup(ResponseTemplate::new(503), 1).await;
        assert_eq!(
            authenticator(&mock)
                .authenticate(&bearer(&sign(&anonymous_claims())))
                .await,
            AuthOutcome::Unavailable
        );
    }
}
