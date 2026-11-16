# Routing Stellate Through a Custom Subdomain

## Summary

Serving Stellate (or any edge reverse proxy) through a subdomain we own is a standard, supported pattern — and the recommended way to run it in production. Traffic hits Stellate's edge first, cache hits are served from the edge, and cache misses are forwarded to our origin. The repo already carries a Stellate config ([stellate.ts](../stellate.ts)) with `originUrl: https://api.hccnj.org/graphql`, so this doc records how a custom domain would be wired and what it changes for our infrastructure.

```text
Client → custom subdomain (CNAME → Stellate edge)
       → Stellate edge (cache hit? serve from edge)
       → cache miss → origin (api.hccnj.org / Cloud Run)
```

## Provider status note (checked 2026-08-09)

Stellate was acquired in September 2024: the product went to The Guild (GraphQL Hive team), the engineering team went to Shopify. The CDN continues to operate under The Guild, but the Developer Portal and rate-limiting products were sunset and Metrics was folded into GraphQL Hive. Before committing, verify current custom-domain support and roadmap directly (or evaluate Hive Gateway, where The Guild has been consolidating).

- https://stellate.co/blog/stellate-has-been-acquired
- https://the-guild.dev/graphql/hive/blog/stellate-acquisition

## How custom-domain routing works

The steps are the same for virtually every edge proxy provider:

1. **Add the custom domain in the provider's dashboard** before touching live DNS.
2. **Create a CNAME record** on the subdomain pointing at the exact target shown in the provider dashboard — for Stellate this is currently a Fastly hostname (`stellate.map.fastly.net`); always copy the value from the dashboard rather than guessing.
3. **TLS provisioning** happens automatically via ACME/Let's Encrypt; some providers require one extra DNS validation record (TXT or CNAME) to prove ownership, while others can only complete issuance once the CNAME points at their edge. Register the domain with the provider _first_ and follow their validation flow — and on a hostname with live traffic, verify the certificate is actually serving before treating the switch as done.
4. **Configure the origin** to point at our real backend; the backend itself does not move.

DNS constraints:

- Subdomains (`api.`, `gql.`, …) can hold a CNAME freely. Only apex/root domains (`hccna.church` itself) cannot, per DNS spec — those need ALIAS/ANAME flattening.
- Our DNS is managed in Cloudflare: the CNAME to the provider's edge **must be gray-clouded (DNS-only)**. Orange-cloud proxying puts Cloudflare's edge in front of Stellate's edge, breaks ACME validation, and double-proxies every request. Same rule we learned with the SendGrid envelope-domain CNAMEs.

## Option A — new domain: `api.hccna.church`

Straightforward CNAME to Stellate's edge on a domain that carries no existing traffic. Zero risk to `api.hccnj.org`; clients opt in by calling the new hostname.

## Option B — new subdomain on hccnj.org (recommended trial path)

Add e.g. `gql.hccnj.org` or `cache.hccnj.org`, CNAME (gray-cloud) to Stellate. The existing `api.hccnj.org → Firebase Hosting → Cloud Run` chain is untouched. Low-risk way to validate cache behavior and latency against real traffic before committing.

## Option C — take over `api.hccnj.org` itself

Putting Stellate in front of the existing API hostname means **migrating that hostname off Firebase Hosting**. The hostname's DNS can only point at one edge first, and Firebase Hosting rewrites can only target Cloud Run/Cloud Functions, never an arbitrary external origin — so Firebase Hosting cannot forward to Stellate. Chaining in the other direction (Stellate → Firebase Hosting) is technically possible but stacks a third proxy layer, adds latency, and adds another timeout point (cf. the Castr timeout trap). Practically it is Firebase Hosting _or_ Stellate on this hostname.

Cutover sequence:

1. **Update [stellate.ts](../stellate.ts) first.** Both `schema` and `originUrl` currently point at `https://api.hccnj.org/graphql`. If DNS flips while these still reference the custom domain, Stellate's origin resolves back to Stellate itself — a request loop. Change both to the raw Cloud Run hostname for `hccna-backend` (keeping the `/graphql` path) and deploy the config before touching DNS.
2. Add `api.hccnj.org` as a custom domain in the Stellate dashboard and complete any DNS ownership-validation records it requests while live DNS still points at Firebase Hosting.
3. Lower the record's TTL (e.g. to 300s) ahead of the change, and have a rollback plan: the previous Firebase Hosting record values, ready to restore.
4. Flip the `api.hccnj.org` record to Stellate's CNAME target (gray-cloud). Firebase Hosting drops out of the chain entirely.
5. **Confirm certificate provisioning after the flip** — depending on the provider's validation method, the certificate for the custom domain may only finish issuing once DNS points at their edge. Verify TLS from multiple resolvers before considering the cutover done, and expect a propagation window up to the old TTL during which some clients still resolve the previous records.
6. Remove the custom domain from Firebase Hosting afterward so the two don't fight over certificate renewal.

## Infrastructure implications (any option that fronts real traffic)

- **Rate limiting / client IP.** Behind Stellate, `remoteIp` becomes Stellate's edge IPs (today it is Google CDN IPs via Firebase Hosting). `getClientIp` in `src/routes/graphql.ts` must trust only the documented client-IP header of the authenticated proxy in front of it — not an arbitrary `X-Forwarded-For` value, which callers can spoof — or the entire edge gets bucketed as one caller. Which header is trustworthy, and the parsing rule, must be re-derived for the new proxy chain and covered by tests as part of any migration (implementation work, tracked separately from this doc).
- **Origin lockdown.** The raw Cloud Run URL becomes a bypass route around the cache. Standard fix: configure Stellate to inject a shared-secret header on origin requests (its config supports origin header injection in [stellate.ts](../stellate.ts)); backend middleware rejects requests missing or mismatching it, and this check must run _before_ rate limiting so unauthenticated direct traffic never influences rate-limit state.
- **WS/SSE (Option C only).** Firebase Hosting blocks WebSockets/SSE on `api.hccnj.org` — the constraint behind the July 2026 decision to keep mobile Firestore listeners. Leaving Firebase Hosting removes _that_ blocker, but does not by itself provide realtime transport: Stellate supports incremental delivery for GraphQL `@defer`/`@stream` via multipart HTTP (`useDeferStream()`), not GraphQL over WebSockets or SSE. Treat SSE availability through any new edge as unknown until an end-to-end test proves it.

## Recommendation

Start with **Option B** (new subdomain on `hccnj.org`) and validate against real traffic before considering Option C. Trial acceptance criteria — beyond cache hit rate and latency:

- Authenticated and private queries are never served from a shared cache entry (the `AUTHENTICATED` scope and `nonCacheable` rules in [stellate.ts](../stellate.ts) behave as configured).
- Mutations pass through uncached and trigger the expected invalidations (`mutationPolicy: "List"`).
- `getClientIp` extracts the real client address behind the new proxy chain, verified against rate-limit behavior.
- Direct requests to the origin without the shared-secret header are rejected.

Only when those hold is promoting Stellate to `api.hccnj.org` (Option C) worth evaluating.
