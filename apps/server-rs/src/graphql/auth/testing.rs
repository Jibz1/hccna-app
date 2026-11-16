//! Synthetic tokens and a Google stand-in. The RSA keys are generated once per test run, so
//! no key material is committed: `signing_key` signs test tokens and `jwks` publishes its
//! public half as kid `test-key-1`; `other_key` is in no key set.

use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use rsa::RsaPrivateKey;
use rsa::pkcs8::{EncodePrivateKey, LineEnding};
use rsa::traits::PublicKeyParts;
use serde_json::{Value, json};
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::config::FirebaseConfig;

pub const PROJECT: &str = "example-project";
pub const ACCESS_TOKEN: &str = "example-access-token";
pub const UID: &str = "ada-example-uid";

struct TestKeys {
    signing: String,
    other: String,
    jwks: String,
}

static KEYS: LazyLock<TestKeys> = LazyLock::new(|| {
    let generate = || RsaPrivateKey::new(&mut rand::thread_rng(), 2048).unwrap();
    let pem = |key: &RsaPrivateKey| key.to_pkcs8_pem(LineEnding::LF).unwrap().to_string();
    let signing = generate();
    let jwks = json!({ "keys": [{
        "kty": "RSA",
        "alg": "RS256",
        "use": "sig",
        "kid": "test-key-1",
        "n": URL_SAFE_NO_PAD.encode(signing.n().to_bytes_be()),
        "e": URL_SAFE_NO_PAD.encode(signing.e().to_bytes_be()),
    }] });
    TestKeys {
        signing: pem(&signing),
        other: pem(&generate()),
        jwks: jwks.to_string(),
    }
});

/// PKCS#8 PEM of the key behind kid `test-key-1`.
pub fn signing_key() -> &'static [u8] {
    KEYS.signing.as_bytes()
}

/// PKCS#8 PEM of a key in no key set.
pub fn other_key() -> &'static [u8] {
    KEYS.other.as_bytes()
}

pub fn jwks() -> &'static str {
    &KEYS.jwks
}

pub fn now() -> i64 {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    )
    .unwrap()
}

/// Valid claims for an anonymous sign-in.
pub fn anonymous_claims() -> Value {
    let now = now();
    json!({
        "iss": format!("https://securetoken.google.com/{PROJECT}"),
        "aud": PROJECT,
        "auth_time": now - 60,
        "user_id": UID,
        "sub": UID,
        "iat": now - 60,
        "exp": now + 3600,
        "firebase": { "identities": {}, "sign_in_provider": "anonymous" },
    })
}

/// Valid claims for an email sign-in.
pub fn email_claims() -> Value {
    let mut claims = anonymous_claims();
    claims["email"] = json!("ada@example.com");
    claims["firebase"]["sign_in_provider"] = json!("password");
    claims
}

pub fn sign(claims: &Value) -> String {
    sign_with(claims, Some("test-key-1"), signing_key())
}

pub fn sign_with(claims: &Value, kid: Option<&str>, key: &[u8]) -> String {
    let mut header = Header::new(Algorithm::RS256);
    header.kid = kid.map(str::to_owned);
    jsonwebtoken::encode(&header, claims, &EncodingKey::from_rsa_pem(key).unwrap()).unwrap()
}

pub fn account(disabled: bool, valid_since: i64) -> Value {
    json!({
        "kind": "identitytoolkit#GetAccountInfoResponse",
        "users": [{
            "localId": UID,
            "disabled": disabled,
            "validSince": valid_since.to_string(),
        }],
    })
}

/// The JWKS endpoint and Identity Toolkit, on one mock server.
pub struct GoogleMock {
    pub server: MockServer,
}

impl GoogleMock {
    pub async fn start() -> Self {
        Self {
            server: MockServer::start().await,
        }
    }

    pub fn config(&self) -> FirebaseConfig {
        FirebaseConfig {
            project_id: PROJECT.to_owned(),
            secondary_project_id: "example-secondary-project".to_owned(),
            jwks_url: format!("{}/jwks", self.server.uri()),
            identity_toolkit_url: self.server.uri(),
        }
    }

    pub fn env(&self) -> Vec<(&'static str, String)> {
        let config = self.config();
        vec![
            ("FIREBASE_PROJECT_ID", config.project_id),
            ("GOOGLE_JWKS_URL", config.jwks_url),
            ("IDENTITY_TOOLKIT_URL", config.identity_toolkit_url),
        ]
    }

    /// Serves the test key set, cacheable for an hour.
    pub async fn mount_jwks(&self, expected_calls: u64) {
        self.mount_jwks_response(
            ResponseTemplate::new(200)
                .insert_header("cache-control", "public, max-age=3600, must-revalidate")
                .set_body_raw(jwks(), "application/json"),
            expected_calls,
        )
        .await;
    }

    pub async fn mount_jwks_response(&self, response: ResponseTemplate, expected_calls: u64) {
        Mock::given(method("GET"))
            .and(path("/jwks"))
            .respond_with(response)
            .expect(expected_calls)
            .mount(&self.server)
            .await;
    }

    /// Answers the account lookup for `UID`, which must carry the test access token.
    pub async fn mount_lookup(&self, response: ResponseTemplate, expected_calls: u64) {
        Mock::given(method("POST"))
            .and(path(format!("/v1/projects/{PROJECT}/accounts:lookup")))
            .and(header("authorization", format!("Bearer {ACCESS_TOKEN}")))
            .and(body_json(json!({ "localId": [UID] })))
            .respond_with(response)
            .expect(expected_calls)
            .mount(&self.server)
            .await;
    }

    /// A lookup that finds an enabled account whose tokens are valid since an hour ago.
    pub async fn mount_account(&self, expected_calls: u64) {
        self.mount_lookup(
            ResponseTemplate::new(200).set_body_json(account(false, now() - 3600)),
            expected_calls,
        )
        .await;
    }
}
