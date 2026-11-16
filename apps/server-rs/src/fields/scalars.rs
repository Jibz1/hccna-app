//! The custom scalars the TS server registers in `apps/server/src/graphql/builder.ts`
//! (`graphql-scalars`), with the SDL's names, the descriptions `graphql-scalars` gives them and
//! `JSON`'s `@specifiedBy` URL.

use async_graphql::{InputValueError, InputValueResult, Scalar, ScalarType, Value};

/// `JSON` (`JSONResolver`): any JSON value, written as is.
#[derive(Clone, Debug, PartialEq)]
pub struct Json(pub serde_json::Value);

// The doc comment on the impl is the scalar's GraphQL description: graphql-scalars' text, as in
// `schema.graphql`.
/// The `JSON` scalar type represents JSON values as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf).
#[Scalar(
    name = "JSON",
    specified_by_url = "http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf"
)]
impl ScalarType for Json {
    fn parse(value: Value) -> InputValueResult<Self> {
        value.into_json().map(Self).map_err(InputValueError::custom)
    }

    fn to_value(&self) -> Value {
        Value::from_json(self.0.clone()).unwrap_or_default()
    }
}

impl Json {
    /// The JSON form of `value`, `None` when it has none (a map with non-string keys).
    pub fn of<T: serde::Serialize>(value: &T) -> Option<Self> {
        serde_json::to_value(value).ok().map(Self)
    }
}

/// `DateTime` (`DateTimeResolver`): an instant, written as JavaScript's `Date#toISOString`
/// (`2026-10-11T13:00:00.000Z`), which is how graphql-scalars' `Date` output reaches the client.
/// The server only returns it; no argument takes one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JsDate(pub i64);

/// A date-time string at UTC, such as 2007-12-03T10:15:30Z, compliant with the `date-time` format outlined in section 5.6 of the RFC 3339 profile of the ISO 8601 standard for representation of dates and times using the Gregorian calendar.
#[Scalar(name = "DateTime")]
impl ScalarType for JsDate {
    fn parse(_value: Value) -> InputValueResult<Self> {
        Err(InputValueError::custom("DateTime is not accepted as input"))
    }

    fn to_value(&self) -> Value {
        crate::fields::events::luxon::to_iso_string(self.0).map_or(Value::Null, Value::String)
    }
}
