# Build context is the monorepo root: docker build -f apps/server-rs/Dockerfile .
# Only the crate's manifest and sources are copied, so a local target/ never enters the build.

# cargo-chef builds dependencies in their own layer, which Docker caches until Cargo.toml or
# Cargo.lock change. (Railway only accepts BuildKit cache mounts whose id hard-codes the service
# id, so a plain cached layer is the portable choice.)
FROM lukemathwalker/cargo-chef:0.1.77-rust-1.93-trixie AS chef
WORKDIR /app

FROM chef AS planner
COPY apps/server-rs/Cargo.toml apps/server-rs/Cargo.lock ./
COPY apps/server-rs/src ./src
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --locked --recipe-path recipe.json
COPY apps/server-rs/Cargo.toml apps/server-rs/Cargo.lock ./
COPY apps/server-rs/src ./src
RUN cargo build --release --locked --bin hccna-server-rs

# Debian 13 matches the trixie builder's glibc; distroless adds CA certificates and nothing else
# (no shell, no package manager) and runs as a non-root user.
FROM gcr.io/distroless/cc-debian13:nonroot
COPY --from=builder /app/target/release/hccna-server-rs /usr/local/bin/hccna-server-rs
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/hccna-server-rs"]
