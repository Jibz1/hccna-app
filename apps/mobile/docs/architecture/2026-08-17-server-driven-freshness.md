# Server-Driven Freshness (Future Direction)

2026-08-17. Status: **not planned** — this documents the end-state
architecture so future freshness work builds toward it instead of adding
more client-side polling. The implemented baseline is the foreground
revalidator (see [Persistence and freshness operations](data-flow.md#persistence-and-freshness-operations)).

## Context

The app's freshness model is client-driven: the persisted Relay cache
renders instantly, and a foreground revalidator refetches allowlisted
queries past a staleness window (Statsig-tunable, 5-minute fallback), with a
Statsig `cacheGeneration` counter as a remote "refresh everyone" lever.

This bounds staleness at roughly _staleness window + Statsig refresh
cadence_, which is enough for routine CMS edits. It cannot deliver:

- **Publish-to-device latency under a minute** without shrinking windows and
  paying for constant refetches nobody needed.
- **Synchronized reveals** ("everyone sees the event at 7:00 pm") — client
  clocks and polling cadences cannot be synchronized from the client side.
- **Bandwidth-proportional-to-change** — today every revalidation refetches
  the full payload even when nothing changed.

Each capability below is server work layered _on top of_ the revalidator,
which remains the client substrate: every option ultimately reduces to
"tell the revalidator to sweep now" or "make sweeps cheaper."

## Option 1: Publish-triggered invalidation via silent push

CMS publish (Strapi webhook) → backend → silent push
(`content-available` on APNs, data message on FCM) carrying a cache
generation. The client push handler feeds the generation to the
revalidator, which sweeps exactly as if Statsig had bumped it.

- Latency: seconds for devices the push reaches; everyone else heals via the
  normal foreground sweep. Silent pushes are best-effort by design (iOS
  throttles them aggressively), so this _tightens_ the freshness bound but
  never replaces the polling fallback.
- Prerequisites: Strapi webhook → backend fan-out, reuse of the existing
  push registration infrastructure, and a debounce so an editing session
  doesn't emit ten pushes.
- This is the highest-value option: it reuses the exact generation semantics
  already shipped, changing only the delivery channel.

## Option 2: Conditional requests (ETag / 304)

The backend computes an entity tag per operation response; the client sends
`If-None-Match` on revalidation fetches and treats 304 as
"stamp `lastFetchedAt`, publish nothing."

- Makes sweeps nearly free, enabling much shorter windows.
- Prerequisites: deterministic response hashing per GraphQL operation on the
  backend, CDN/proxy transparency for conditional POSTs, and a client
  change: `graphqlNetworkService` currently rejects 304 responses by design
  (`GraphQLNotModifiedWithoutPayloadError` — "conditional GraphQL requests
  are unsupported"). That guard is the marker for where support goes.
- Only worth building once sweep frequency (Option 1 or aggressive windows)
  makes payload redundancy a measurable cost. Bandwidth optimization, not a
  freshness feature.

## Option 3: Server-side gating for timed content

The correct mechanism for synchronized reveals. The CMS entry carries
`activeFrom` / `activeUntil`; the GraphQL layer excludes entries outside
their live range, so the payload is correct _whenever_ it is fetched — no
cache invalidation required for the reveal itself.

- The reveal moment is enforced by the server clock, not by cache expiry:
  a device that fetches at 6:59 does not get the event; one that fetches at
  7:01 does. Combined with Option 1 (push at `activeFrom`), active devices
  converge within seconds of the reveal.
- Prerequisites: schema fields on the relevant Strapi collections and
  filtering in the backend resolvers. Purely additive for the client — the
  revalidator just fetches what the server says is live.
- Anti-pattern to avoid: shipping the event early and hiding it client-side
  behind a timestamp check. The payload is inspectable, client clocks drift,
  and cached hidden entries become stale the moment the event edits.

## Sequencing

1. **Option 3** whenever timed events become a real product need — smallest
   scope, no new infrastructure, and it removes the temptation to abuse the
   generation counter for reveals.
2. **Option 1** when publish-to-device latency starts to matter — it
   upgrades the existing generation counter from polled to pushed.
3. **Option 2** last, if ever — measure sweep bandwidth first.

## Explicitly rejected

- **Client-clock reveals** — see Option 3 anti-pattern.
- **WebSocket / SSE live invalidation channel** — a persistent connection
  for a church content app is operational cost far beyond the freshness it
  buys over silent push + foreground sweeps.
- **Boolean remote clear-cache flag** — wipes cold-start rendering while
  set and requires manual reset; superseded by the generation counter, with
  the `relay_persistence_killswitch` as the poisoned-cache emergency.
