# Rust metrics in Grafana

The Grafana Alloy collector service scrapes the Rust
backend over the private network every 60 seconds and exports metrics through the
same Grafana OTLP gateway as the TypeScript backend. It has no public domain. Its `PORT`
(12345 unless Railway sets another value) serves Alloy's health and diagnostic endpoints; the
Rust metrics port remains private.

The backend platforms dashboard includes the Rust backend. Its source is
`../grafana/dashboards/backend-platforms.json`. Gateway panels separate Rust's `local` and
`forward` routes. Rates need at least two scrapes; old time ranges have no Rust data before
the collector was deployed.

The Backend filter limits queries to these backend jobs. Legends use Cloud Run, Railway
TypeScript, and Railway Rust, preserving operation and route names. HTTP success rate is based
on observed responses, not synthetic uptime: idle windows show **No traffic**. Forwarded
GraphQL requests are counted by both Rust and TypeScript, so do not sum the two services to
estimate client traffic. Rust's collection-health row shows scrape status, sample age, process
memory, and CPU. These process metrics are not Railway container metrics. Scrape status shows
**No recent data** when Grafana has received nothing for five minutes, meaning the collector is
stopped or cannot export; sample age keeps rising for a day after the last sample.

## Query and mutation timing

The **Backend-calltype** section groups GraphQL durations by backend, operation name, and
query/mutation type. Labels such as `railway-rs-UserWoaQuery` and `railway-ts-UserWoaQuery`
identify the backend and operation; the **Call type** column distinguishes queries, mutations,
and unknown operations. **Operation** and **Call type** filters apply to both operation sections;
**Backend** continues to filter the whole dashboard.

The table shows average duration, estimated p95 duration, and estimated calls over the selected
time range. It lists operations with observed counter increases, including earlier deployments
within that range. Counts are extrapolated by Prometheus and can be fractional before display
rounding. The charts use rolling five-minute windows and omit windows without observed calls.
These are aggregate request durations, not individual request traces. Rust durations include
upstream time when a request is forwarded to TypeScript; both backends can record the same call.

## Compare the same operation across backends

The **Rust vs TypeScript — same operation** table matches operation name and query/mutation
type within the selected time range. It puts Rust and TypeScript average duration, p95, and
estimated call counts on one row. **Avg Δ %** is `100 × (Rust average / TypeScript average − 1)`:
negative values mean lower observed Rust latency, positive values mean higher. The difference
is omitted unless both backends have observed calls and the TypeScript average is positive.
An operation seen on only one backend keeps its available measurements; the other side shows
**No samples**. Select **Backend → All** or both Railway jobs for a two-backend comparison.

This is an aggregate comparison, not a paired benchmark. Matching operation names can have
different variables, users, cache states, deployment revisions, or request mixes. Rust can
forward a request to TypeScript, so its duration can include the TypeScript execution and
network overhead. Use the call counts to judge coverage and traces or controlled read-only
benchmarks to investigate individual differences.

## Dashboard

`observability/grafana/dashboards/backend-platforms.json` is the dashboard definition. This
repository has no command that publishes it; it is kept for reference.

## Railway variables

Use these references on the collector; do not copy secret values into files:

| Variable | Value |
| --- | --- |
| `RUST_METRICS_ADDRESS` | The Rust service's private domain, port `9184` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | A reference to the TS backend's `OTEL_EXPORTER_OTLP_ENDPOINT` |
| `OTEL_EXPORTER_OTLP_HEADERS` | A reference to the TS backend's `OTEL_EXPORTER_OTLP_HEADERS` |

The header variable must contain one `Authorization=Basic%20<base64 instance:token>` entry,
matching the current TypeScript service. Alloy decodes it into basic-auth credentials so the
token stays redacted in Alloy's UI and API; a malformed value fails configuration loading and
the health check. Redeploy the collector after rotating the referenced credential. Alloy
listens on `PORT`, which the image sets to 12345; no Railway variable is needed.

Run exactly one collector replica. The current scrape target represents one Rust replica;
scaling Rust to multiple replicas requires per-replica discovery to avoid mixing counters.
Alloy's instance label identifies the private scrape endpoint, not a Railway replica UUID.
The exporter buffers up to 100 batches in memory and retries transient failures; it has no
persistent queue, so collector restarts can lose buffered samples.

## Build

The build context is this directory. This repository has no deploy step for the collector;
publishing the dashboard does not deploy anything either. Keep the
Alloy version and image digest pinned together when upgrading. Validate configuration with
`alloy validate config.alloy` using synthetic values for the three environment variables.

The service must have one replica, no public domain, and the `/-/ready` health check on
`PORT`.

Check that the Rust scrape job's `up` series is 1 in Grafana, then verify increasing
`http_server_request_duration_seconds_count` and the dashboard's five-minute rates. For export
failures, inspect the collector's Railway logs. `/-/ready` confirms the configuration is valid;
it does not establish that scraping or exporting succeeds.
