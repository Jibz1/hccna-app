# apps/server-rs — Agent Guidelines

An experimental Rust implementation of the GraphQL backend. It began as a port built to be
benchmarked against `apps/server` (spec:
`docs/superpowers/specs/2026-10-13-server-rust-benchmark-design.md`) and is now being brought to parity
behind a gateway that answers the queries it has ported and forwards everything else to the TS
server (spec: `docs/superpowers/specs/2026-10-14-server-rs-parity-design.md`). No production client
uses it yet; the TS server still serves production.

## Branches

The crate lives on `main` like the rest of the monorepo: every change is a branch with a PR into
`main`. CI (`.github/workflows/server-rs.yml`) checks the crate and builds its image; nothing deploys
it from this repository.

## Commands (run in `apps/server-rs`)

- `cargo fmt` / `cargo fmt --check`
- `cargo clippy --all-targets --locked -- -D warnings`
- `cargo test --locked`
- Image: `docker build -f apps/server-rs/Dockerfile .` from the repository root.

CI (`.github/workflows/server-rs.yml`) runs all of these. The crate is deliberately not a Bun
workspace: do not add a `package.json`, which would change `bun.lock` and break the TS server's
`--frozen-lockfile` image build.

## Toolchain

Rust 1.93 (`rust-version` in `Cargo.toml`; CI and the Docker builder use 1.93). Pick dependency
versions that support it: `sqlx` 0.9 needs 1.94, so the crate uses 0.8.

## Parity with `apps/server`

- The point of the experiment is that both servers do the same work per request. Port behaviour
  exactly, including quirks the spec lists; name the TS source file in each module's doc comment.
- Any deliberate difference goes in the spec's pipeline table, not just in code.
- The GraphQL schema must match `packages/schema/schema.graphql` for every type and field this crate
  defines (the contract test enforces it). Never rename or "fix" a field (`featureImge` stays).
- Every Redis key goes through `RedisStore::key`, which adds this server's prefix (`rs:`). The TS
  server's caches use different encodings; a shared key would break it.
- Metric names, labels and buckets match the TS server (`src/metrics.rs`). The exceptions are
  Rust-only: the gateway's `gateway_requests_total` and `gateway_request_duration_seconds`,
  labelled by `route` and `status_class` alone, and the `route` label on
  `graphql_envelop_request_total` and `graphql_envelop_request_duration`. A forwarded request's
  duration is TS's time plus the network hop, so dashboards compare Rust with TS on
  `route="local"` only.

## Gateway

The service answers some operations itself and forwards the rest to the TS server (`src/gateway`;
design in `docs/superpowers/specs/2026-10-14-server-rs-parity-design.md`).

- A query is answered here only when every root field is in `gateway::route::LOCAL_FIELDS`, in
  `CCB_FIELDS` while the CCB client is configured, or in `PARTIAL_FIELDS` with only its listed
  subfields selected (`user { woa }`). A PR that ports a field adds it to one of those lists in the
  same PR. Mutations, introspection and every other field are forwarded whole; an operation is
  never split. A partial field's type defines only its listed fields, which the contract test checks.
- Nothing is answered here while the Statsig gate `server_rs_serve_locally` is off, unknown or
  unavailable: the service is then a pass-through.
- `TS_ORIGIN_URL` is required and has no default. Running the binary locally without
  `STATSIG_SERVER_SECRET_KEY` forwards every request, mutations included, to that origin, so
  point it at a local TS server.
- Tests never reach a real TS server: `test_support::config` points `TS_ORIGIN_URL` at a closed
  port, and gateway tests start a `MockOrigin`.

## Code

- Errors: `thiserror` enums in modules, `anyhow` only in `main.rs`. No `unwrap()` outside tests;
  `expect("why this cannot fail")` only for real invariants.
- No `unsafe`.
- Tests sit next to the code (`#[cfg(test)] mod tests`). Upstreams are stubbed with `wiremock`.

## No real data

Fixtures, tests and docs use synthetic values (`Ada Example`, `ada@example.com`, `https://example.com`).
Never commit real CMS records, recorded API responses or benchmark response bodies; the harness writes
those outside the checkout.
