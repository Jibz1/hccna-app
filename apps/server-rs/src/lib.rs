//! Experimental Rust implementation of the HCCNA GraphQL backend. It exists to be benchmarked
//! against `apps/server`; see `docs/superpowers/specs/2026-10-13-server-rust-benchmark-design.md`.

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
