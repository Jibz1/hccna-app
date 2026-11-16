//! The `authorized` and `signedIn` auth scopes (`apps/server/src/graphql/builder.ts`,
//! `auth-scopes.ts`) as async-graphql guards.

use async_graphql::{Context, Guard};

use crate::graphql::auth::{AuthKind, Viewer};
use crate::graphql::errors;

/// Pothos scope-auth's refusal: the field resolves to `null` with
/// `Not authorized to resolve Query.<field>`. Every guarded field is a `Query` field.
fn refuse(ctx: &Context<'_>) -> async_graphql::Error {
    errors::forbidden(format!(
        "Not authorized to resolve Query.{}",
        ctx.field().name()
    ))
}

/// Allows any authenticated caller.
pub struct Authorized;

impl Guard for Authorized {
    async fn check(&self, ctx: &Context<'_>) -> async_graphql::Result<()> {
        if ctx.data_opt::<Viewer>().is_some() {
            Ok(())
        } else {
            Err(refuse(ctx))
        }
    }
}

/// Allows a full (non-anonymous) Firebase sign-in that carries a uid and an email:
/// `authType === "jwt" && Boolean(currentUserUid) && Boolean(currentUserEmail)`.
pub struct SignedIn;

impl Guard for SignedIn {
    async fn check(&self, ctx: &Context<'_>) -> async_graphql::Result<()> {
        let signed_in = ctx.data_opt::<Viewer>().is_some_and(|viewer| {
            viewer.kind == AuthKind::Jwt
                && !viewer.uid.is_empty()
                && viewer
                    .email
                    .as_deref()
                    .is_some_and(|email| !email.is_empty())
        });
        if signed_in { Ok(()) } else { Err(refuse(ctx)) }
    }
}

#[cfg(test)]
mod tests {
    use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema};
    use serde_json::json;

    use super::*;
    use crate::test_support::execute_like_handler;

    struct GuardedQuery;

    #[Object]
    impl GuardedQuery {
        #[graphql(guard = "Authorized")]
        async fn core(&self) -> Option<String> {
            Some("Example".to_owned())
        }

        #[graphql(guard = "SignedIn")]
        async fn profile(&self) -> Option<String> {
            Some("Example".to_owned())
        }
    }

    async fn run(viewer: Option<Viewer>) -> serde_json::Value {
        let schema = Schema::new(GuardedQuery, EmptyMutation, EmptySubscription);
        execute_like_handler(&schema, "query CoreDataQuery { core }", viewer).await
    }

    #[tokio::test]
    async fn allows_authenticated_callers() {
        let viewer = Viewer {
            uid: "ada-example-uid".to_owned(),
            email: None,
            kind: AuthKind::FirebaseAnonymous,
        };
        assert_eq!(
            run(Some(viewer)).await,
            json!({ "data": { "core": "Example" } })
        );
    }

    #[tokio::test]
    async fn forbids_unauthenticated_callers_like_pothos() {
        // Pothos' ForbiddenError carries its code as a JS property, not an extension, so the
        // TS response has no `extensions`.
        assert_eq!(
            run(None).await,
            json!({
                "errors": [{
                    "message": "Not authorized to resolve Query.core",
                    "locations": [{ "line": 1, "column": 23 }],
                    "path": ["core"],
                }],
                "data": { "core": null },
            })
        );
    }

    async fn run_signed_in(viewer: Option<Viewer>) -> serde_json::Value {
        let schema = Schema::new(GuardedQuery, EmptyMutation, EmptySubscription);
        execute_like_handler(&schema, "query ProfileQuery { profile }", viewer).await
    }

    #[tokio::test]
    async fn signed_in_needs_a_full_sign_in_with_uid_and_email() {
        let viewer = |kind, uid: &str, email: Option<&str>| Viewer {
            uid: uid.to_owned(),
            email: email.map(str::to_owned),
            kind,
        };
        assert_eq!(
            run_signed_in(Some(viewer(
                AuthKind::Jwt,
                "ada-example-uid",
                Some("ada@example.com")
            )))
            .await,
            json!({ "data": { "profile": "Example" } })
        );
        let refused = json!({
            "errors": [{
                "message": "Not authorized to resolve Query.profile",
                "locations": [{ "line": 1, "column": 22 }],
                "path": ["profile"],
            }],
            "data": { "profile": null },
        });
        for caller in [
            None,
            Some(viewer(
                AuthKind::FirebaseAnonymous,
                "ada-example-uid",
                Some("ada@example.com"),
            )),
            Some(viewer(AuthKind::Jwt, "ada-example-uid", None)),
            Some(viewer(AuthKind::Jwt, "ada-example-uid", Some(""))),
            Some(viewer(AuthKind::Jwt, "", Some("ada@example.com"))),
        ] {
            assert_eq!(run_signed_in(caller.clone()).await, refused, "{caller:?}");
        }
    }
}
