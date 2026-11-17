# System architecture

How the HCCNA app, its backend, and the services around them fit together. Hosting details
describe production at the time of this snapshot; this repository itself deploys nothing.

For code-level structure, see the [server architecture map](../apps/server/docs/architecture-map.md)
and the [mobile data flow](../apps/mobile/docs/architecture/data-flow.md).

## System context

```mermaid
flowchart LR
    subgraph Clients
        App["Mobile app<br/>apps/mobile<br/>Expo, React Native, Relay"]
        Web["Church website"]
    end

    subgraph Edge
        CF["api.hccnj.org<br/>Cloudflare"]
        Stellate["Stellate GraphQL edge cache<br/>hccna.stellate.sh, older app versions"]
    end

    subgraph Hosting["Railway"]
        TS["TS backend<br/>apps/server<br/>Bun, Hono, GraphQL Yoga"]
        RS["Rust gateway, experimental<br/>apps/server-rs<br/>axum, async-graphql"]
        PG[("Postgres")]
        Redis[("Redis")]
        Alloy["Grafana Alloy collector"]
    end

    subgraph Content["Content and church data"]
        CMS["Strapi 5 CMS<br/>cms.hccna.church"]
        CCB["Church Community Builder"]
        Castr["Castr live streaming"]
        YT["YouTube Data API"]
    end

    subgraph Google["Google / Firebase"]
        Auth["Firebase Auth"]
        FS[("Firestore, legacy")]
        FCM["Firebase Cloud Messaging"]
        GCS["Cloud Storage"]
        Sched["Cloud Scheduler"]
    end

    subgraph Ops["Flags and observability"]
        Statsig["Statsig"]
        Sentry["Sentry"]
        Grafana["Grafana Cloud"]
        EAS["EAS Update"]
    end

    App -->|GraphQL| CF
    App -->|GraphQL| Stellate
    Web -->|GraphQL| TS
    CF --> TS
    Stellate -->|cache misses| TS
    RS -->|forwards what it has not ported| TS

    TS --> PG
    TS --> Redis
    RS --> PG
    RS --> Redis

    TS --> CMS
    TS --> CCB
    TS --> Castr
    TS --> YT
    CMS -->|change notices| TS

    App --> Auth
    TS -->|verify ID tokens| Auth
    TS --> FS
    TS -->|topic pushes| FCM
    FCM --> App
    TS -->|attendance exports| GCS
    Sched -->|scheduled jobs, OIDC| TS

    App --> Statsig
    TS --> Statsig
    App --> Sentry
    TS --> Sentry
    TS -->|OTLP metrics and traces| Grafana
    Alloy -->|scrapes Rust metrics| RS
    Alloy --> Grafana
    EAS -->|OTA bundles| App
```

## Components

| Component | Path | Built with | Responsibility |
|---|---|---|---|
| Mobile app | `apps/mobile` | Expo SDK 58, React Native, Relay, Effect, uniwind | The iOS and Android app. Relay is the client-side source of truth for server data, persisted to MMKV per signed-in user. |
| TS backend | `apps/server` | Bun, Hono, GraphQL Yoga, Pothos, Drizzle, Effect | The production API: GraphQL plus a small REST surface (`/v1/attendance-exports`), health checks, and a metrics server. |
| Rust gateway | `apps/server-rs` | axum, async-graphql | An experimental port heading to parity. It answers the queries it has ported and forwards everything else to the TS backend. No production client uses it. |
| GraphQL contract | `packages/schema` | SDL | `schema.graphql`, shared by both servers and the app; each runs its own codegen. |
| Integrations | `packages/castr`, `packages/ccb`, `packages/strapi-v2` | TypeScript, Effect | Clients for Castr, Church Community Builder, and the Strapi 5 CMS, used by the TS backend. |
| Tooling | `packages/config`, `packages/anti-slop`, `packages/mobile-lint` | TypeScript, Oxlint | Shared tsconfig bases and lint rules. |

## A typical request

```mermaid
sequenceDiagram
    participant App as Mobile app
    participant Edge as Cloudflare
    participant TS as TS backend
    participant Redis
    participant Up as CMS / CCB / Castr
    participant PG as Postgres

    App->>App: Get a Firebase ID token
    App->>Edge: POST /graphql with a named operation
    Edge->>TS: Forward
    TS->>TS: Check the ID token, the operation name, depth and complexity, and the rate limit
    TS->>Redis: Look up the response cache
    alt Cache hit
        Redis-->>TS: Cached answer
    else Cache miss
        TS->>Up: Fetch content or church data
        TS->>PG: Read or write app data
        TS->>Redis: Store the answer
    end
    TS-->>App: GraphQL response
    App->>App: Relay updates its store and persists it to MMKV
```

## Data

- **Postgres** (Drizzle, `apps/server/src/db/schema`) holds the app's own data: users and
  their departments and ministries, campus subscription state, giving records and yearly
  summaries, event attendance and attendance exports, saved verses, scriptures, and stored CMS
  snapshots. Migrations are applied by hand, never on deploy.
- **Redis** holds the GraphQL response cache, service caches, and rate-limit counters.
- **Firestore** is legacy. The backend still reads and writes a few collections; new work does
  not add Firestore reads.
- **Strapi 5** is the source of content (campuses, events, sermons, featured cards). When
  editors publish, the CMS notifies the backend so it refreshes stored snapshots and drops
  cached answers ([CMS change notices](cms-change-notices.md)).
- **Church Community Builder** is the source of church records such as groups, attendance,
  and giving.

## Background work

- **Scheduled jobs.** Google Cloud Scheduler calls backend mutations on a timer, authenticated
  with Google-signed OIDC tokens: for example the monthly Word of Activation email and push,
  live-stream status polling, and campus subscription reconciliation.
- **Push notifications.** The backend subscribes registered devices to Firebase Cloud
  Messaging topics and sends to those topics.
- **OTA updates.** JavaScript-only changes reach installed apps through EAS Update when their
  native fingerprint matches ([OTA updates](ota-updates.md)).

## Feature flags and observability

- **Statsig** gates features in the app and the backend, including whether the Rust gateway
  answers anything itself.
- **Sentry** receives errors and traces from the app and both servers.
- **Grafana Cloud** receives the TS backend's metrics and traces over OTLP. A Grafana Alloy
  collector scrapes the Rust gateway's Prometheus metrics and forwards them.
