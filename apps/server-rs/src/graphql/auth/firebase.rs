//! Firebase ID token verification with the revocation check: firebase-admin's
//! `verifyIdToken(token, true)` as called by `apps/server/src/effect/services/FirebaseAuthService.ts`
//! (token verifier, `utils/jwt.ts`, `verifyDecodedJWTNotRevokedOrDisabled`), including how
//! firebase-admin's error codes split into invalid credentials and outages in `AuthService.ts`.

use std::collections::HashMap;
use std::sync::{Arc, PoisonError, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use jsonwebtoken::{Algorithm, DecodingKey};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::time::Instant;

use crate::config::FirebaseConfig;
use crate::google::auth::{CLOUD_PLATFORM_SCOPE, GoogleAuth, GoogleAuthError};
use crate::metrics::Metrics;
use crate::upstream;

/// `FIREBASE_TOKEN_VERIFICATION_TIMEOUT_MS`: the whole verification, key fetch and lookup included.
pub const VERIFICATION_TIMEOUT: Duration = Duration::from_secs(5);

/// The claims the server uses from a verified token.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FirebaseToken {
    pub uid: String,
    pub email: Option<String>,
    pub sign_in_provider: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum FirebaseError {
    // firebase-admin `auth/argument-error`, `auth/id-token-expired`, `auth/id-token-revoked`,
    // `auth/user-disabled`, `auth/user-not-found`, `auth/invalid-id-token`: the caller is
    // unauthenticated.
    #[error("the token is not a decodable JWT")]
    Malformed,
    #[error("the token has no kid")]
    NoKid,
    #[error("the token is not RS256")]
    WrongAlgorithm,
    #[error("the token is for another audience")]
    WrongAudience,
    #[error("the token has another issuer")]
    WrongIssuer,
    #[error("the token's sub is missing, empty or longer than 128 characters")]
    InvalidSubject,
    /// firebase-admin maps key fetch failures to `auth/argument-error`, so the TS server treats
    /// them as invalid credentials, not as an outage.
    #[error("fetching Google's signing keys failed: {0}")]
    KeyFetch(String),
    #[error("the token's kid is not a current Google signing key")]
    UnknownKid,
    #[error("the token signature is invalid")]
    BadSignature,
    #[error("the token is not valid yet")]
    NotYetValid,
    #[error("the token has expired")]
    Expired,
    #[error("the token was revoked")]
    Revoked,
    #[error("the account is disabled")]
    Disabled,
    #[error("the account does not exist")]
    UserNotFound,
    #[error("Identity Toolkit rejected the token")]
    InvalidIdToken,

    // Everything else: authentication is unavailable.
    #[error("verification took longer than {0:?}")]
    Timeout(Duration),
    #[error("no Google credentials are configured for the account lookup")]
    NoCredentials,
    #[error(transparent)]
    Credentials(#[from] GoogleAuthError),
    #[error("account lookup failed: {0}")]
    Lookup(String),
}

impl FirebaseError {
    /// Whether the TS server would treat this as invalid credentials (`null`) rather than an
    /// outage (`AuthenticationUnavailableError`).
    pub fn is_invalid_credential(&self) -> bool {
        !matches!(
            self,
            Self::Timeout(_) | Self::NoCredentials | Self::Credentials(_) | Self::Lookup(_)
        )
    }
}

struct KeySet {
    keys: HashMap<String, DecodingKey>,
    expires_at: Instant,
}

pub struct FirebaseVerifier {
    project_id: String,
    issuer: String,
    jwks_url: String,
    lookup_url: String,
    http: reqwest::Client,
    metrics: Metrics,
    google: Option<GoogleAuth>,
    timeout: Duration,
    keys: RwLock<Option<Arc<KeySet>>>,
}

impl FirebaseVerifier {
    pub fn new(
        config: &FirebaseConfig,
        http: reqwest::Client,
        metrics: Metrics,
        google: Option<GoogleAuth>,
    ) -> Self {
        Self {
            issuer: format!("https://securetoken.google.com/{}", config.project_id),
            lookup_url: format!(
                "{}/v1/projects/{}/accounts:lookup",
                config.identity_toolkit_url.trim_end_matches('/'),
                config.project_id
            ),
            project_id: config.project_id.clone(),
            jwks_url: config.jwks_url.clone(),
            http,
            metrics,
            google,
            timeout: VERIFICATION_TIMEOUT,
            keys: RwLock::new(None),
        }
    }

    /// A shorter verification deadline, for tests.
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Verifies `token` and checks that the account is neither disabled nor revoked, within the
    /// verification deadline.
    pub async fn verify(&self, token: &str) -> Result<FirebaseToken, FirebaseError> {
        match tokio::time::timeout(self.timeout, self.verify_unbounded(token)).await {
            Ok(result) => result,
            Err(_) => Err(FirebaseError::Timeout(self.timeout)),
        }
    }

    /// firebase-admin's order: decode, check the claims, fetch keys and check the signature
    /// and expiry, then look the account up.
    async fn verify_unbounded(&self, token: &str) -> Result<FirebaseToken, FirebaseError> {
        let decoded = DecodedJwt::parse(token)?;
        let claims = self.check_content(&decoded)?;

        let keys = self.keys().await?;
        let key = decoded
            .header
            .get("kid")
            .and_then(Value::as_str)
            .and_then(|kid| keys.keys.get(kid))
            .ok_or(FirebaseError::UnknownKid)?;
        let valid = jsonwebtoken::crypto::verify(
            decoded.signature,
            decoded.signing_input.as_bytes(),
            key,
            Algorithm::RS256,
        )
        .unwrap_or(false);
        if !valid {
            return Err(FirebaseError::BadSignature);
        }
        check_time_claims(&decoded.payload, unix_now())?;

        let account = self.lookup(&claims.uid).await?;
        if account.disabled {
            return Err(FirebaseError::Disabled);
        }
        // `auth_time * 1000 < validSince * 1000`; a missing `auth_time` compares as NaN in TS
        // and never counts as revoked.
        if let (Some(valid_since), Some(auth_time)) = (
            account.valid_since,
            decoded.payload.get("auth_time").and_then(Value::as_f64),
        ) && auth_time < valid_since as f64
        {
            return Err(FirebaseError::Revoked);
        }
        Ok(claims)
    }

    /// `verifyContent`: kid, algorithm, audience, issuer and subject, before any key fetch.
    fn check_content(&self, decoded: &DecodedJwt<'_>) -> Result<FirebaseToken, FirebaseError> {
        if decoded.header.get("kid").is_none() {
            return Err(FirebaseError::NoKid);
        }
        if decoded.header.get("alg").and_then(Value::as_str) != Some("RS256") {
            return Err(FirebaseError::WrongAlgorithm);
        }
        let payload = &decoded.payload;
        if payload.get("aud").and_then(Value::as_str) != Some(self.project_id.as_str()) {
            return Err(FirebaseError::WrongAudience);
        }
        if payload.get("iss").and_then(Value::as_str) != Some(self.issuer.as_str()) {
            return Err(FirebaseError::WrongIssuer);
        }
        let uid = match payload.get("sub").and_then(Value::as_str) {
            // JavaScript string length counts UTF-16 code units.
            Some(sub) if !sub.is_empty() && sub.encode_utf16().count() <= 128 => sub,
            _ => return Err(FirebaseError::InvalidSubject),
        };
        Ok(FirebaseToken {
            uid: uid.to_owned(),
            email: payload
                .get("email")
                .and_then(Value::as_str)
                .filter(|email| !email.is_empty())
                .map(str::to_owned),
            sign_in_provider: payload
                .get("firebase")
                .and_then(|firebase| firebase.get("sign_in_provider"))
                .and_then(Value::as_str)
                .map(str::to_owned),
        })
    }

    /// Google's signing keys, cached for the response's `Cache-Control: max-age` (not at all
    /// without one, as firebase-admin does).
    async fn keys(&self) -> Result<Arc<KeySet>, FirebaseError> {
        let cached = self
            .keys
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        if let Some(keys) = cached
            && keys.expires_at > Instant::now()
        {
            return Ok(keys);
        }

        let response = upstream::observe(&self.metrics, "firebase", "verify_id_token", async {
            self.http
                .get(&self.jwks_url)
                .send()
                .await?
                .error_for_status()
        })
        .await
        .map_err(|error| FirebaseError::KeyFetch(error.to_string()))?;
        let max_age = max_age(response.headers());
        let body: Jwks = response
            .json()
            .await
            .map_err(|error| FirebaseError::KeyFetch(error.to_string()))?;
        let keys = body
            .keys
            .into_iter()
            .filter(|key| key.kty == "RSA")
            .filter_map(|key| {
                let decoding = DecodingKey::from_rsa_components(&key.n, &key.e).ok()?;
                Some((key.kid, decoding))
            })
            .collect();
        let keys = Arc::new(KeySet {
            keys,
            expires_at: Instant::now() + max_age.unwrap_or_default(),
        });
        *self.keys.write().unwrap_or_else(PoisonError::into_inner) = Some(keys.clone());
        Ok(keys)
    }

    /// Identity Toolkit `accounts:lookup`, as firebase-admin's `getUser` sends it.
    async fn lookup(&self, uid: &str) -> Result<Account, FirebaseError> {
        let google = self.google.as_ref().ok_or(FirebaseError::NoCredentials)?;
        let access_token = google.token(&[CLOUD_PLATFORM_SCOPE]).await?;
        let response = upstream::observe(&self.metrics, "firebase", "lookup_account", async {
            let response = self
                .http
                .post(&self.lookup_url)
                .bearer_auth(&access_token)
                .json(&json!({ "localId": [uid] }))
                .send()
                .await?;
            if response.status().is_server_error() {
                response.error_for_status()
            } else {
                Ok(response)
            }
        })
        .await
        .map_err(|error| FirebaseError::Lookup(error.to_string()))?;

        let status = response.status();
        let body: Value = response
            .json()
            .await
            .map_err(|error| FirebaseError::Lookup(format!("{status}: {error}")))?;
        if !status.is_success() {
            // firebase-admin maps the server's `error.message` code; unknown codes are internal
            // errors, which the TS server treats as an outage.
            let code = body
                .pointer("/error/message")
                .and_then(Value::as_str)
                .and_then(|message| message.split(':').next())
                .map(str::trim)
                .unwrap_or_default();
            return Err(match code {
                "USER_NOT_FOUND" => FirebaseError::UserNotFound,
                "USER_DISABLED" => FirebaseError::Disabled,
                "INVALID_ID_TOKEN" | "TOKEN_EXPIRED" => FirebaseError::InvalidIdToken,
                _ => FirebaseError::Lookup(format!("{status} {code}")),
            });
        }
        let user = body
            .get("users")
            .and_then(Value::as_array)
            .and_then(|users| users.first())
            .ok_or(FirebaseError::UserNotFound)?;
        Ok(Account {
            disabled: user.get("disabled").and_then(Value::as_bool) == Some(true),
            valid_since: user
                .get("validSince")
                .and_then(Value::as_str)
                .and_then(|seconds| seconds.parse().ok())
                .filter(|seconds| *seconds != 0),
        })
    }
}

struct Account {
    disabled: bool,
    /// Seconds since the epoch before which tokens are revoked.
    valid_since: Option<i64>,
}

#[derive(Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Deserialize)]
struct Jwk {
    #[serde(default)]
    kid: String,
    #[serde(default)]
    kty: String,
    #[serde(default)]
    n: String,
    #[serde(default)]
    e: String,
}

/// The three parts of a compact JWS, with the header and payload decoded.
struct DecodedJwt<'a> {
    header: serde_json::Map<String, Value>,
    payload: serde_json::Map<String, Value>,
    signing_input: &'a str,
    signature: &'a str,
}

/// base64url, with or without padding, as Node's decoder accepts.
const BASE64URL: GeneralPurpose = GeneralPurpose::new(
    &base64::alphabet::URL_SAFE,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

impl<'a> DecodedJwt<'a> {
    /// `jwt.decode(token, { complete: true })`: three dot-separated parts and a JSON object
    /// header. A payload that is not a JSON object fails the audience check in TS, so it is
    /// rejected here as malformed.
    fn parse(token: &'a str) -> Result<Self, FirebaseError> {
        let mut parts = token.split('.');
        let (Some(header), Some(payload), Some(signature), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return Err(FirebaseError::Malformed);
        };
        let decode = |part: &str| -> Option<serde_json::Map<String, Value>> {
            let bytes = BASE64URL.decode(part).ok()?;
            match serde_json::from_slice(&bytes).ok()? {
                Value::Object(map) => Some(map),
                _ => None,
            }
        };
        let header = decode(header).ok_or(FirebaseError::Malformed)?;
        let payload = decode(payload).ok_or(FirebaseError::WrongAudience)?;
        Ok(Self {
            header,
            payload,
            signing_input: &token[..token.len() - signature.len() - 1],
            signature,
        })
    }
}

/// `jsonwebtoken.verify` with no clock tolerance: `nbf` and `exp` are checked only when present,
/// and `iat` is not checked at all.
fn check_time_claims(
    payload: &serde_json::Map<String, Value>,
    now: u64,
) -> Result<(), FirebaseError> {
    let now = now as f64;
    if let Some(nbf) = payload.get("nbf") {
        match nbf.as_f64() {
            Some(nbf) if nbf <= now => {}
            _ => return Err(FirebaseError::NotYetValid),
        }
    }
    if let Some(exp) = payload.get("exp") {
        match exp.as_f64() {
            Some(exp) if now < exp => {}
            _ => return Err(FirebaseError::Expired),
        }
    }
    Ok(())
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

/// `max-age` from `Cache-Control`, read the way firebase-admin's `UrlKeyFetcher` does.
fn max_age(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let cache_control = headers.get(reqwest::header::CACHE_CONTROL)?.to_str().ok()?;
    cache_control.split(',').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        (name == "max-age")
            .then(|| value.parse::<u64>().ok())
            .flatten()
            .map(Duration::from_secs)
    })
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::json;
    use wiremock::ResponseTemplate;

    use super::*;
    use crate::graphql::auth::testing::*;

    fn verifier(mock: &GoogleMock, google: Option<GoogleAuth>) -> FirebaseVerifier {
        FirebaseVerifier::new(
            &mock.config(),
            upstream::http_client().unwrap(),
            Metrics::new(),
            google,
        )
    }

    fn with_credentials(mock: &GoogleMock) -> FirebaseVerifier {
        verifier(mock, Some(GoogleAuth::fixed(ACCESS_TOKEN)))
    }

    #[tokio::test]
    async fn verifies_an_anonymous_token() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_account(1).await;
        let token = with_credentials(&mock)
            .verify(&sign(&anonymous_claims()))
            .await
            .unwrap();
        assert_eq!(
            token,
            FirebaseToken {
                uid: UID.to_owned(),
                email: None,
                sign_in_provider: Some("anonymous".to_owned()),
            }
        );
    }

    #[tokio::test]
    async fn verifies_an_email_token() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_account(1).await;
        let token = with_credentials(&mock)
            .verify(&sign(&email_claims()))
            .await
            .unwrap();
        assert_eq!(token.email.as_deref(), Some("ada@example.com"));
        assert_eq!(token.sign_in_provider.as_deref(), Some("password"));
    }

    /// `claims` signed with the test key must fail as an invalid credential without reaching
    /// the endpoints that have zero expected calls.
    async fn assert_invalid(claims: serde_json::Value, jwks_calls: u64) -> FirebaseError {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(jwks_calls).await;
        mock.mount_account(0).await;
        let error = with_credentials(&mock)
            .verify(&sign(&claims))
            .await
            .unwrap_err();
        assert!(error.is_invalid_credential(), "{error}");
        error
    }

    #[tokio::test]
    async fn rejects_expired_tokens() {
        let mut claims = anonymous_claims();
        claims["exp"] = json!(now() - 1);
        let error = assert_invalid(claims, 1).await;
        assert!(matches!(error, FirebaseError::Expired));
    }

    #[tokio::test]
    async fn rejects_tokens_for_another_project_before_fetching_keys() {
        let mut claims = anonymous_claims();
        claims["aud"] = json!("another-project");
        assert!(matches!(
            assert_invalid(claims, 0).await,
            FirebaseError::WrongAudience
        ));

        let mut claims = anonymous_claims();
        claims["iss"] = json!("https://securetoken.google.com/another-project");
        assert!(matches!(
            assert_invalid(claims, 0).await,
            FirebaseError::WrongIssuer
        ));
    }

    #[tokio::test]
    async fn rejects_algorithms_other_than_rs256_before_fetching_keys() {
        use base64::Engine;
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;

        let mock = GoogleMock::start().await;
        mock.mount_jwks(0).await;
        mock.mount_account(0).await;
        let verifier = with_credentials(&mock);

        let mut header = jsonwebtoken::Header::new(Algorithm::HS256);
        header.kid = Some("test-key-1".to_owned());
        let hs256 = jsonwebtoken::encode(
            &header,
            &anonymous_claims(),
            &jsonwebtoken::EncodingKey::from_secret(b"example-shared-secret"),
        )
        .unwrap();
        assert!(matches!(
            verifier.verify(&hs256).await.unwrap_err(),
            FirebaseError::WrongAlgorithm
        ));

        let segment = |value: serde_json::Value| URL_SAFE_NO_PAD.encode(value.to_string());
        let unsigned = format!(
            "{}.{}.",
            segment(json!({ "alg": "none", "kid": "test-key-1", "typ": "JWT" })),
            segment(anonymous_claims())
        );
        let error = verifier.verify(&unsigned).await.unwrap_err();
        assert!(matches!(error, FirebaseError::WrongAlgorithm), "{error}");
        assert!(error.is_invalid_credential());
    }

    #[tokio::test]
    async fn rejects_tokens_not_valid_yet() {
        let mut claims = anonymous_claims();
        claims["nbf"] = json!(now() + 3600);
        let error = assert_invalid(claims, 1).await;
        assert!(matches!(error, FirebaseError::NotYetValid), "{error}");
    }

    #[tokio::test]
    async fn rejects_empty_or_long_subjects() {
        let mut claims = anonymous_claims();
        claims["sub"] = json!("");
        assert!(matches!(
            assert_invalid(claims, 0).await,
            FirebaseError::InvalidSubject
        ));
        let mut claims = anonymous_claims();
        claims["sub"] = json!("x".repeat(129));
        assert!(matches!(
            assert_invalid(claims, 0).await,
            FirebaseError::InvalidSubject
        ));
    }

    #[tokio::test]
    async fn rejects_unknown_kids_and_bad_signatures() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_account(0).await;
        let verifier = with_credentials(&mock);
        let unknown = sign_with(&anonymous_claims(), Some("rotated-away"), signing_key());
        assert!(matches!(
            verifier.verify(&unknown).await.unwrap_err(),
            FirebaseError::UnknownKid
        ));
        let forged = sign_with(&anonymous_claims(), Some("test-key-1"), other_key());
        assert!(matches!(
            verifier.verify(&forged).await.unwrap_err(),
            FirebaseError::BadSignature
        ));
        let no_kid = sign_with(&anonymous_claims(), None, signing_key());
        assert!(matches!(
            verifier.verify(&no_kid).await.unwrap_err(),
            FirebaseError::NoKid
        ));
        assert!(matches!(
            verifier.verify("not.a-jwt.at-all").await.unwrap_err(),
            FirebaseError::Malformed
        ));
    }

    #[tokio::test]
    async fn rejects_tokens_issued_before_the_account_was_revoked() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        let claims = anonymous_claims();
        let auth_time = claims["auth_time"].as_i64().unwrap();
        mock.mount_lookup(
            ResponseTemplate::new(200).set_body_json(account(false, auth_time + 1)),
            1,
        )
        .await;
        let error = with_credentials(&mock)
            .verify(&sign(&claims))
            .await
            .unwrap_err();
        assert!(matches!(error, FirebaseError::Revoked));
        assert!(error.is_invalid_credential());
    }

    #[tokio::test]
    async fn accepts_tokens_issued_when_the_account_was_revoked() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        let claims = anonymous_claims();
        let auth_time = claims["auth_time"].as_i64().unwrap();
        mock.mount_lookup(
            ResponseTemplate::new(200).set_body_json(account(false, auth_time)),
            1,
        )
        .await;
        assert!(with_credentials(&mock).verify(&sign(&claims)).await.is_ok());
    }

    #[tokio::test]
    async fn rejects_disabled_and_missing_accounts() {
        for (response, expected) in [
            (
                ResponseTemplate::new(200).set_body_json(account(true, now() - 3600)),
                "disabled",
            ),
            (
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "kind": "identitytoolkit#GetAccountInfoResponse" })),
                "missing",
            ),
            (
                ResponseTemplate::new(400).set_body_json(
                    json!({ "error": { "code": 400, "message": "USER_NOT_FOUND" } }),
                ),
                "missing",
            ),
        ] {
            let mock = GoogleMock::start().await;
            mock.mount_jwks(1).await;
            mock.mount_lookup(response, 1).await;
            let error = with_credentials(&mock)
                .verify(&sign(&anonymous_claims()))
                .await
                .unwrap_err();
            match expected {
                "disabled" => assert!(matches!(error, FirebaseError::Disabled)),
                _ => assert!(matches!(error, FirebaseError::UserNotFound), "{error}"),
            }
            assert!(error.is_invalid_credential());
        }
    }

    #[tokio::test]
    async fn treats_lookup_failures_as_unavailable() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_lookup(
            ResponseTemplate::new(500)
                .set_body_json(json!({ "error": { "code": 500, "message": "INTERNAL" } })),
            1,
        )
        .await;
        let verifier = with_credentials(&mock);
        let error = verifier
            .verify(&sign(&anonymous_claims()))
            .await
            .unwrap_err();
        assert!(matches!(error, FirebaseError::Lookup(_)), "{error}");
        assert!(!error.is_invalid_credential());
        let metrics = verifier.metrics.render();
        assert!(
            metrics
                .contains(r#"service_error_total{action="lookup_account",service="firebase"} 1"#)
        );
    }

    #[tokio::test]
    async fn treats_a_slow_lookup_as_unavailable() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_lookup(
            ResponseTemplate::new(200)
                .set_body_json(account(false, now() - 3600))
                .set_delay(Duration::from_secs(2)),
            1,
        )
        .await;
        let error = with_credentials(&mock)
            .with_timeout(Duration::from_millis(200))
            .verify(&sign(&anonymous_claims()))
            .await
            .unwrap_err();
        assert!(matches!(error, FirebaseError::Timeout(_)));
        assert!(!error.is_invalid_credential());
    }

    #[tokio::test]
    async fn needs_credentials_for_the_lookup() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        let error = verifier(&mock, None)
            .verify(&sign(&anonymous_claims()))
            .await
            .unwrap_err();
        assert!(matches!(error, FirebaseError::NoCredentials));
        assert!(!error.is_invalid_credential());
    }

    #[tokio::test]
    async fn caches_keys_for_their_max_age() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_account(2).await;
        let verifier = with_credentials(&mock);
        let token = sign(&anonymous_claims());
        verifier.verify(&token).await.unwrap();
        verifier.verify(&token).await.unwrap();
        let metrics = verifier.metrics.render();
        assert!(
            metrics.contains(
                r#"service_request_total{action="verify_id_token",service="firebase"} 1"#
            )
        );
        assert!(
            metrics
                .contains(r#"service_request_total{action="lookup_account",service="firebase"} 2"#)
        );
    }

    #[tokio::test]
    async fn refetches_keys_without_a_max_age() {
        let mock = GoogleMock::start().await;
        mock.mount_jwks_response(
            ResponseTemplate::new(200).set_body_raw(jwks(), "application/json"),
            2,
        )
        .await;
        mock.mount_account(2).await;
        let verifier = with_credentials(&mock);
        let token = sign(&anonymous_claims());
        verifier.verify(&token).await.unwrap();
        verifier.verify(&token).await.unwrap();
    }

    #[tokio::test]
    async fn treats_key_fetch_failures_as_invalid_credentials() {
        // firebase-admin turns key fetch errors into `auth/argument-error`.
        let mock = GoogleMock::start().await;
        mock.mount_jwks_response(ResponseTemplate::new(503), 1)
            .await;
        mock.mount_account(0).await;
        let error = with_credentials(&mock)
            .verify(&sign(&anonymous_claims()))
            .await
            .unwrap_err();
        assert!(matches!(error, FirebaseError::KeyFetch(_)), "{error}");
        assert!(error.is_invalid_credential());
    }
}
