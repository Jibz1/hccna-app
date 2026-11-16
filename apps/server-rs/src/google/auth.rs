//! Google OAuth access tokens for Google APIs (Identity Toolkit now, Firestore later), from the
//! service account in `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_APPLICATION_CREDENTIALS_JSON`
//! (`apps/server/src/platform/googleCredentials.ts`; firebase-admin's application default
//! credentials on the TS server).

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde::Deserialize;

use crate::config::GoogleCredentials;

/// The scope firebase-admin's credential requests, and enough for Identity Toolkit and Firestore.
pub const CLOUD_PLATFORM_SCOPE: &str = "https://www.googleapis.com/auth/cloud-platform";

#[derive(Debug, thiserror::Error)]
pub enum GoogleAuthError {
    /// Never includes the value or a parser message: both could echo the key.
    #[error("GOOGLE_APPLICATION_CREDENTIALS_JSON must be a Google credentials JSON object")]
    InvalidJson,
    #[error("Google credentials of type {0:?} are not supported; use a service_account key")]
    UnsupportedType(String),
    #[error("could not load the Google service account: {0}")]
    Load(String),
    #[error("could not get a Google access token: {0}")]
    Token(String),
}

pub type TokenFuture<'a> =
    Pin<Box<dyn Future<Output = Result<String, GoogleAuthError>> + Send + 'a>>;

/// Something that hands out OAuth access tokens. Tests implement it to avoid real credentials.
pub trait AccessTokenSource: Send + Sync {
    fn token<'a>(&'a self, scopes: &'a [&'a str]) -> TokenFuture<'a>;
}

/// A cheap-to-clone handle on the configured token source.
#[derive(Clone)]
pub struct GoogleAuth {
    source: Arc<dyn AccessTokenSource>,
}

impl std::fmt::Debug for GoogleAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GoogleAuth")
    }
}

impl GoogleAuth {
    /// The configured service account, or `None` without credentials (the server still boots;
    /// calls that need a token then fail as unavailable).
    pub fn from_config(credentials: &GoogleCredentials) -> Result<Option<Self>, GoogleAuthError> {
        let account = match credentials {
            GoogleCredentials::None => return Ok(None),
            GoogleCredentials::Json(json) => {
                ensure_service_account(json.expose())?;
                gcp_auth::CustomServiceAccount::from_json(json.expose())
                    .map_err(|_| GoogleAuthError::InvalidJson)?
            }
            GoogleCredentials::File(path) => {
                let contents = std::fs::read_to_string(path)
                    .map_err(|error| GoogleAuthError::Load(format!("{path}: {error}")))?;
                ensure_service_account(&contents)?;
                gcp_auth::CustomServiceAccount::from_file(path)
                    .map_err(|error| GoogleAuthError::Load(format!("{path}: {error}")))?
            }
        };
        Ok(Some(Self::from_source(ServiceAccount(account))))
    }

    pub fn from_source(source: impl AccessTokenSource + 'static) -> Self {
        Self {
            source: Arc::new(source),
        }
    }

    /// Always hands out `token`. For tests, here and in later modules.
    pub fn fixed(token: impl Into<String>) -> Self {
        Self::from_source(FixedToken(token.into()))
    }

    pub async fn token(&self, scopes: &[&str]) -> Result<String, GoogleAuthError> {
        self.source.token(scopes).await
    }
}

/// `googleCredentials.ts` accepts any JSON object with a string `type`; only service accounts
/// can be used here.
fn ensure_service_account(json: &str) -> Result<(), GoogleAuthError> {
    #[derive(Deserialize)]
    struct Credentials {
        #[serde(rename = "type")]
        kind: String,
    }
    let credentials: Credentials =
        serde_json::from_str(json).map_err(|_| GoogleAuthError::InvalidJson)?;
    if credentials.kind == "service_account" {
        Ok(())
    } else {
        Err(GoogleAuthError::UnsupportedType(credentials.kind))
    }
}

/// A service account key; gcp_auth caches tokens per scope set and refreshes them before expiry.
struct ServiceAccount(gcp_auth::CustomServiceAccount);

impl AccessTokenSource for ServiceAccount {
    fn token<'a>(&'a self, scopes: &'a [&'a str]) -> TokenFuture<'a> {
        Box::pin(async move {
            use gcp_auth::TokenProvider;
            let token = self
                .0
                .token(scopes)
                .await
                .map_err(|error| GoogleAuthError::Token(error.to_string()))?;
            Ok(token.as_str().to_owned())
        })
    }
}

struct FixedToken(String);

impl AccessTokenSource for FixedToken {
    fn token<'a>(&'a self, _scopes: &'a [&'a str]) -> TokenFuture<'a> {
        Box::pin(async move { Ok(self.0.clone()) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Secret;

    #[test]
    fn boots_without_credentials() {
        assert!(
            GoogleAuth::from_config(&GoogleCredentials::None)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn rejects_invalid_json_without_echoing_it() {
        let error = GoogleAuth::from_config(&GoogleCredentials::Json(Secret::new(
            "{\"private_key\": \"example-secret\"",
        )))
        .unwrap_err();
        assert!(matches!(error, GoogleAuthError::InvalidJson));
        assert!(!error.to_string().contains("example-secret"));
    }

    #[test]
    fn rejects_credentials_other_than_service_accounts() {
        let error = GoogleAuth::from_config(&GoogleCredentials::Json(Secret::new(
            r#"{"type":"authorized_user"}"#,
        )))
        .unwrap_err();
        assert!(
            matches!(error, GoogleAuthError::UnsupportedType(kind) if kind == "authorized_user")
        );
    }

    #[test]
    fn loads_a_service_account_key() {
        let json = serde_json::json!({
            "type": "service_account",
            "project_id": "example-project",
            "private_key_id": "example-key-id",
            "private_key": String::from_utf8(
                crate::graphql::auth::testing::signing_key().to_vec()
            )
            .unwrap(),
            "client_email": "bench@example-project.iam.gserviceaccount.com",
            "client_id": "1",
            "token_uri": "http://127.0.0.1:1/token",
        });
        let credentials = GoogleCredentials::Json(Secret::new(json.to_string()));
        assert!(GoogleAuth::from_config(&credentials).unwrap().is_some());
    }

    #[tokio::test]
    async fn fixed_tokens_ignore_scopes() {
        let auth = GoogleAuth::fixed("example-access-token");
        assert_eq!(
            auth.token(&[CLOUD_PLATFORM_SCOPE]).await.unwrap(),
            "example-access-token"
        );
    }
}
