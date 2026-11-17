//! Experimental Rust implementation of the HCCNA GraphQL backend, built to be benchmarked against
//! `apps/server` and now heading to parity with it.

pub mod ccb;
pub mod config;
pub mod fields;
pub mod gateway;
pub mod google;
pub mod graphql;
pub mod http;
pub mod logging;
pub mod metrics;
pub mod reporting;
pub mod state;
pub mod statsig;
pub mod store;
pub mod strapi;
pub mod text;
pub mod upstream;

#[cfg(test)]
mod test_support;
