//! The `userProfile` request loader (`apps/server/src/graphql/loaders/firebaseDataLoader.ts`, schemas
//! in `apps/server/src/types/userProfile.ts`): the caller's `app-users/{uid}` document, when it decodes
//! as a profile and carries a first and last name, an image and a provider. Anything else is no
//! profile, with a warning naming the uid. A failed read is retried once (TS falls back from the
//! batch read to a single read) and is then no profile, logged as an error.

use crate::google::firestore::{Document, FirestoreValue};

use super::store::WoaStore;

/// The normalized profile (`UserProfileData`), as far as this server reads it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserProfile {
    pub uid: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub img: String,
    pub provider: String,
}

/// The department fields `UserDepartmentSchema` requires, all strings beside the numeric `id`.
const DEPARTMENT_STRINGS: [&str; 7] = [
    "slug",
    "ccbId",
    "name",
    "image",
    "description",
    "link",
    "fullName",
];

/// A field that must be a string when present (`Schema.optional(Schema.String)`).
fn optional_string<'a>(document: &'a Document, field: &str) -> Result<Option<&'a str>, ()> {
    match document.get(field) {
        None => Ok(None),
        Some(FirestoreValue::String(text)) => Ok(Some(text)),
        Some(_) => Err(()),
    }
}

/// `Schema.optional(Schema.NullOr(Schema.String))`.
fn optional_nullable_string<'a>(
    document: &'a Document,
    field: &str,
) -> Result<Option<&'a str>, ()> {
    match document.get(field) {
        None | Some(FirestoreValue::Null) => Ok(None),
        Some(FirestoreValue::String(text)) => Ok(Some(text)),
        Some(_) => Err(()),
    }
}

/// `Schema.optional(Schema.Array(UserDepartmentSchema))`.
fn departments_decode(document: &Document) -> bool {
    let Some(value) = document.get("departments") else {
        return true;
    };
    let FirestoreValue::Array(departments) = value else {
        return false;
    };
    departments.iter().all(|department| {
        let FirestoreValue::Map(fields) = department else {
            return false;
        };
        matches!(fields.get("id"), Some(FirestoreValue::Number(_)))
            && DEPARTMENT_STRINGS
                .iter()
                .all(|name| matches!(fields.get(*name), Some(FirestoreValue::String(_))))
    })
}

/// The fields `UserProfileDocSchema` decodes, or `Err` where it rejects the document.
struct ProfileDoc<'a> {
    uid: &'a str,
    email: &'a str,
    first_name: Option<&'a str>,
    last_name: Option<&'a str>,
    img: Option<&'a str>,
    provider: Option<&'a str>,
}

fn decode_doc(document: &Document) -> Result<ProfileDoc<'_>, ()> {
    let required = |field: &str| match document.get(field) {
        Some(FirestoreValue::String(text)) => Ok(text.as_str()),
        _ => Err(()),
    };
    let email = required("email")?;
    let uid = required("uid")?;
    if !matches!(document.get("isVerified"), Some(FirestoreValue::Boolean(_))) {
        return Err(());
    }
    for field in ["ccbId", "ccbFamilyId"] {
        optional_string(document, field)?;
    }
    for field in ["phone", "createdAt"] {
        optional_nullable_string(document, field)?;
    }
    if !departments_decode(document) {
        return Err(());
    }
    Ok(ProfileDoc {
        uid,
        email,
        first_name: optional_string(document, "firstName")?,
        last_name: optional_string(document, "lastName")?,
        img: optional_nullable_string(document, "img")?,
        provider: optional_nullable_string(document, "provider")?,
    })
}

/// `toUserProfile` for an existing document.
pub fn decode(document: &Document) -> Option<UserProfile> {
    let Ok(doc) = decode_doc(document) else {
        let uid = match document.get("uid") {
            Some(FirestoreValue::String(uid)) => Some(uid.as_str()),
            _ => None,
        };
        tracing::warn!(uid, "Invalid user profile payload from Firestore");
        return None;
    };
    let non_empty =
        |value: Option<&str>| value.filter(|value| !value.is_empty()).map(str::to_owned);
    let (Some(first_name), Some(last_name), Some(img), Some(provider)) = (
        non_empty(doc.first_name),
        non_empty(doc.last_name),
        non_empty(doc.img),
        non_empty(doc.provider),
    ) else {
        let missing: Vec<&str> = [
            ("firstName", doc.first_name),
            ("lastName", doc.last_name),
            ("img", doc.img),
            ("provider", doc.provider),
        ]
        .into_iter()
        .filter(|(_, value)| value.is_none_or(str::is_empty))
        .map(|(name, _)| name)
        .collect();
        tracing::warn!(
            uid = doc.uid,
            missingRequiredFields = %missing.join(","),
            "User profile missing required fields"
        );
        return None;
    };
    Some(UserProfile {
        uid: doc.uid.to_owned(),
        email: doc.email.to_owned(),
        first_name,
        last_name,
        img,
        provider,
    })
}

/// `ctx.loaders.userProfile.load(uid)`.
pub async fn load(store: &dyn WoaStore, uid: &str) -> Option<UserProfile> {
    let document = match store.user_profile(uid).await {
        Ok(document) => document,
        Err(error) => {
            tracing::error!(
                error = %error,
                "Error fetching user profiles in batch, falling back to per-user fetch"
            );
            match store.user_profile(uid).await {
                Ok(document) => document,
                Err(error) => {
                    tracing::error!(error = %error, uid, "Error fetching user profile for UID");
                    return None;
                }
            }
        }
    };
    decode(&document?)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn string(text: &str) -> FirestoreValue {
        FirestoreValue::String(text.to_owned())
    }

    pub(crate) fn profile_document() -> Vec<(&'static str, FirestoreValue)> {
        vec![
            ("uid", string("ada-example-uid")),
            ("email", string("ada@example.com")),
            ("firstName", string("Ada")),
            ("lastName", string("Example")),
            ("img", string("https://example.com/ada.png")),
            ("provider", string("google.com")),
            ("isVerified", FirestoreValue::Boolean(true)),
        ]
    }

    fn document(fields: Vec<(&str, FirestoreValue)>) -> Document {
        Document::new(
            fields
                .into_iter()
                .map(|(name, value)| (name.to_owned(), value)),
        )
    }

    fn with(field: &str, value: Option<FirestoreValue>) -> Document {
        let mut fields: Vec<(&str, FirestoreValue)> = profile_document()
            .into_iter()
            .filter(|(name, _)| *name != field)
            .collect();
        if let Some(value) = value {
            fields.push((field, value));
        }
        document(fields)
    }

    #[test]
    fn decodes_a_complete_profile() {
        assert_eq!(
            decode(&document(profile_document())),
            Some(UserProfile {
                uid: "ada-example-uid".to_owned(),
                email: "ada@example.com".to_owned(),
                first_name: "Ada".to_owned(),
                last_name: "Example".to_owned(),
                img: "https://example.com/ada.png".to_owned(),
                provider: "google.com".to_owned(),
            })
        );
        // Nullable and optional fields, and well-formed departments, still decode.
        let department = FirestoreValue::Map(HashMap::from(
            [
                ("id".to_owned(), FirestoreValue::Number(7.0)),
                ("slug".to_owned(), string("media")),
                ("ccbId".to_owned(), string("12")),
                ("name".to_owned(), string("Media")),
                ("image".to_owned(), string("https://example.com/media.png")),
                ("description".to_owned(), string("Media team")),
                ("link".to_owned(), string("https://example.com/media")),
                ("fullName".to_owned(), string("Media Ministry")),
            ]
            .map(|(name, value)| (name, value)),
        ));
        let mut fields = profile_document();
        fields.push(("phone", FirestoreValue::Null));
        fields.push(("createdAt", string("2026-01-01T00:00:00.000Z")));
        fields.push(("userMetadata", FirestoreValue::Other));
        fields.push(("departments", FirestoreValue::Array(vec![department])));
        assert!(decode(&document(fields)).is_some());
    }

    #[test]
    fn rejects_what_the_profile_schemas_reject() {
        let rejected = [
            with("email", None),
            with("uid", Some(FirestoreValue::Number(1.0))),
            with("isVerified", None),
            with("isVerified", Some(string("true"))),
            with("firstName", Some(FirestoreValue::Null)),
            with("ccbId", Some(FirestoreValue::Number(12.0))),
            with("createdAt", Some(FirestoreValue::Other)),
            with(
                "departments",
                Some(FirestoreValue::Array(vec![FirestoreValue::Map(
                    HashMap::new(),
                )])),
            ),
            // Decodes, but lacks a required field once normalized.
            with("firstName", None),
            with("lastName", Some(string(""))),
            with("img", Some(FirestoreValue::Null)),
            with("provider", None),
        ];
        for document in rejected {
            assert_eq!(decode(&document), None, "{document:?}");
        }
    }
}
