# CMS change notices

When editors publish, unpublish or delete content, the Strapi 5 CMS (`cms.hccna.church`, HCCNJ/site
`apps/cms`) tells the backend so it can refresh the snapshots it stores (core settings, featured
cards) and drop cached answers. An event-hub subscriber in the CMS's own code calls the GraphQL
mutation `cmsWebhookUpdate` (`apps/server/src/graphql/schema/cms/webhookUpdate.ts`) with
`cmsVersion: V5` and the `x-cms-webhook-secret` header.

## Strapi 4 notices (retired)

Strapi 4 (`cms.hccnj.org`) is retired and the backend no longer reads it. Its lifecycle hook sent
no `cmsVersion`. The schema keeps the deprecated `V4` value so the deployed contract stays
compatible. A notice without `cmsVersion: V5` does nothing, answers
`{ success: true, message: "Ignored: Strapi 4 notice" }`, and logs the warning
`CMS webhook ignored: Strapi 4 notice`.

## Strapi 5

### Request

`POST https://hccna-backend-production.up.railway.app/graphql` with these headers:

- `Content-Type: application/json`
- `Authorization: Bearer <credential>`. The mutation keeps its auth scope
  (`authScope.authorized`), so the CMS authenticates with the shared
  app token (Firestore `app-config/newuser-config`, field `token`) or a Google identity token
  whose audience is the host's `CLOUD_RUN_SERVICE_URL`.
- `x-cms-webhook-secret: <CMS_WEBHOOK_SECRET>`. This is the raw secret, without `Bearer`, and it
  never goes in `Authorization`. The backend compares it in constant time with its trimmed
  `CMS_WEBHOOK_SECRET` (`secretMatches` in `strapiWebhook.ts`).

The operation must be named. Any name works, but it must go on the known-operation allowlist
before that is enforced (see [Integration rules](#integration-rules)).

```graphql
mutation Strapi5ChangeNoticeMutation($input: StrapiWebHookUpdateInput!) {
  cmsWebhookUpdate(input: $input) {
    success
    message
  }
}
```

```json
{
  "input": {
    "event": "entry.publish",
    "model": "campus",
    "uid": "api::campus.campus",
    "slug": "new-breed",
    "createdAt": "2026-10-04T12:00:00.000Z",
    "cmsVersion": "V5"
  }
}
```

| Field | Value |
|---|---|
| `event` | The event hub's event: `entry.publish`, `entry.unpublish` or `entry.delete` |
| `uid` | The event's `uid`: the content type UID |
| `model` | Required but unused: the event's `model`, the content type's singular name |
| `slug` | Optional: the entry's slug (`entry.slug`). Only campus notices read it |
| `createdAt` | Required but unused: when the CMS sent the notice (ISO 8601) |
| `cmsVersion` | `V5` |

### What the backend does

`planStrapiWebhook` and `runStrapiWebhookAction` (`apps/server/src/effect/services/cms/strapiWebhook.ts`)
act only on `entry.publish`, `entry.unpublish` and `entry.delete`. Any other event, including the
`entry.create` and `entry.update` that every draft save raises, answers `Ignored: event <event>`.
The notice is only a signal: the backend re-reads published content from Strapi 5, past the
CMS's [response cache](#the-cmss-response-cache).

| `uid` | Action (`message`) | Work | Cached answers dropped |
|---|---|---|---|
| `api::app-config.app-config` | `coreSettings` | Re-read the core sections into `core_settings` and clear the core cache | `Core` |
| `api::home.home` | `homeFeatured` | Re-read the home featured cards (stored upcoming events are kept) and clear the home cache | `Home`, `FeaturedEvents*` |
| `api::campus.campus` | `campusFeatured` | Re-read the featured cards of that campus if its slug is in `CAMPUS_SLUGS`, or of every app campus if the slug is missing; clear the campuses and events caches | `Campus`, `Campuses`, `FeaturedEvents*`, `Event`, `UpcomingEventsByMonthSuccess` |
| `api::leader-ship.leader-ship` | `clear:campuses` | Clear the campuses cache | `Campus`, `Campuses` |
| `api::event.event` | `clear:events` | Clear the events cache | `Event`, `UpcomingEventsByMonthSuccess` |
| `api::sermon.sermon`, `api::sermon-page.sermon-page` | `clear:sermons` | Clear the sermons cache and purge Stellate's sermon operations | `Sermon` |
| `api::tog.tog` | `clear:thoughtOfGod` | Clear the Thought of God cache | `ThoughtOfGodPage` |
| `api::check-in-permission.check-in-permission`, `api::kids-checkin.kids-checkin` | `clear:checkInPermissions` | Clear the check-in permissions cache | none |
| `api::department.department` | `clear:departments` | Clear the departments cache | none |
| `api::ministry.ministry` | `clear:ministries` | Clear the ministries cache | none |
| Anything else, including `api::stream.stream` | none | Nothing: `Ignored: content type <uid>` (stream access always reads fresh) | none |

`FeaturedEvents*` stands for `FeaturedEventsSuccess`, `FeaturedEventsFetchError` and
`FeaturedEventsNotFoundError`. The work runs uninterruptibly, so a caller that hangs up cannot
leave it half done, and repeating a notice is safe.

All twelve content types have Draft & Publish enabled: `options.draftAndPublish` is `true` in each
of their `apps/cms/src/api/<name>/content-types/<name>/schema.json` files in HCCNJ/site (checked
on 4 Oct 2026). Keep it on. Without it a type has no publish step: saving an entry raises only
`entry.create` or `entry.update`, which the backend ignores. The recorded GraphQL schema doesn't
show the setting, because Strapi gives every root query a `status` argument either way.

### The CMS's response cache

HCCNJ/site runs the `strapi-cache` plugin (1.12.2) on `/graphql`, and by default it caches
answers to authorized requests too, for 60 s (`CACHE_AUTHORIZED_REQUESTS` and `CACHE_TTL` in
`apps/cms/config/plugins.ts`). A re-read right after a publish could get the answer from before
it, which the backend would then store or cache. So the backend sends `Cache-Control: no-cache` on
every Strapi 5 request (`packages/strapi-v2/src/transport.ts`). With that header the plugin
neither reads nor writes its cache (`server/src/middlewares/graphql.ts` in `TupiC/strapi-cache`
v1.12.2), which leaves the backend's own record cache, cleared by these notices. The website's CMS
client sends the same header when it refills its shared cache (HCCNJ/site
`apps/web/src/lib/cms/client.ts`).

**Known CMS-side issue, for HCCNJ/site to fix.** The plugin purges cached GraphQL answers from
database lifecycle hooks (`server/src/bootstrap.ts`), which run before the change commits, so a
read in between can cache the old answer again. It also purges only answers whose root fields
include the changed type's `singularName` or `pluralName` (`server/src/utils/invalidateCache.ts`).
Those names are kebab-case and root fields camelCase, so answers for `appConfig`, `leaderShips`,
`sermonPage`, `checkInPermission` and `kidsCheckins` are never purged, nor is an answer that
embeds a changed type through a relation (such as `campuses { leaderships }`). Such answers last
until `CACHE_TTL` runs out for clients that don't send `no-cache`, including the website when its
shared Redis cache is off. strapi-cache 1.12.3 adds a `graphqlDependencies` option that maps root
fields to the content types whose changes purge them.

### Responses

| Answer | Meaning |
|---|---|
| `success: true`, `message`: the action | The work ran |
| `success: true`, `message: "Ignored: …"` | Nothing to do. `Ignored: Strapi 4 notice` means the request had no `cmsVersion: V5` |
| `success: false`, `message`: the action | The work failed and the backend logged why. Publishing again is safe |
| `success: false`, `message: "Strapi 5 notices are not configured"` | `CMS_WEBHOOK_SECRET` is unset or blank on the host |
| GraphQL error `Not authorized to resolve Mutation.cmsWebhookUpdate` | Bad credentials, a missing or wrong secret, or the backend couldn't read the shared app token from Firestore. The answer is deliberately the same; only a wrong or missing secret logs an outcome line ([Logs](#logs)) |
| GraphQL error `All operations must have a name…` | The operation is anonymous |
| GraphQL error `Unknown operation name.` | Known operations are enforced and the operation name isn't on the allowlist |
| Other GraphQL errors, such as `Variable "$input" has invalid value …` | The input doesn't match `StrapiWebHookUpdateInput`, for example a missing `model` or an unknown `cmsVersion` |
| HTTP 429 (`TOO_MANY_REQUESTS`) | Over the rate limit |
| HTTP 401 or 403 (`APP_CHECK_UNAUTHORIZED`, `APP_CHECK_FORBIDDEN`) | App Check is enforced on the host |
| HTTP 504 after 20 s, with the GraphQL error `Internal Server Error` | The app timeout ended the request; the work still finishes and logs its outcome |

### Integration rules

- **Send `cmsVersion: V5`.** Without it the backend treats the notice as a retired Strapi 4 one,
  answers `Ignored: Strapi 4 notice` and does nothing.
- **Name the operation.** `/graphql` rejects anonymous operations
  (`apps/server/src/graphql/useRequireOperationName.ts`).
- **Pace bulk publishes.** `/graphql` allows each client IP `GRAPHQL_RATE_LIMIT_RPS` requests
  (default 20) per 1 s window and answers 429 beyond that (`apps/server/src/routes/graphql.ts`). A
  bulk action raises one event per document, and a delete one per stored version (draft and
  published), so queue the notices.
- **App Check must be `off` or `monitor` on Railway.** `APP_CHECK_ENFORCEMENT=enforce` rejects any
  request without a Firebase App Check token, and there is no server-to-server bypass.
- **Allowlist the CMS operation name before enforcing known operations.** The known-operation
  guard (`apps/server/src/graphql/knownOperationGuard.ts`) only logs
  `Unknown GraphQL operation observed (log-only)` today. Before setting
  `GRAPHQL_REQUIRE_KNOWN_OPERATIONS=true`, add the Strapi 5 module's operation name,
  `Strapi5ChangeNoticeMutation`, to `apps/server/src/graphql/known-operation-names.ts`.
- **A timeout is not a failure.** The backend ends every request after 20 s (`APP_TIMEOUT_MS` in
  `apps/server/src/server/constants.ts`), but the work keeps running and logs its outcome.
- **Credential and secret go in separate headers.** The credential goes in `Authorization` and the
  secret in `x-cms-webhook-secret`. [Responses](#responses) lists what each GraphQL error means.
- **Send from Strapi's event hub, after the commit.** Subscribe with `strapi.eventHub.subscribe`,
  act on `entry.publish`, `entry.unpublish` and `entry.delete` for the twelve content types, and
  send in the background: the subscriber must return at once and never throw.
  [Sending from HCCNJ/site](#sending-from-hccnjsite) has the module and the reasons.

### Logs

Railway's backend logs one outcome line per notice, as pino JSON with `event`, `uid`, `action`
and `outcome` fields. Neither the secret nor its header is ever logged: `x-cms-webhook-secret` is
removed from request logs, Effect HTTP spans and Sentry events
(`apps/server/src/platform/observability/redaction.ts`).

| Message | Level | `outcome` | Meaning |
|---|---|---|---|
| `Strapi 5 webhook handled` | info | `ok` | The work ran |
| `Strapi 5 webhook ignored` | info | `ignored` | Event or content type not acted on; `reason` says which |
| `Strapi 5 webhook failed` | error | `failed` | The work failed; `error` says why |
| `Strapi 5 webhook rejected: wrong or missing secret header` | warn | `unauthorized` | Missing or wrong secret. The shared resolver error logger also logs the authorization error at error level, without the secret |
| `Strapi 5 webhook dropped: CMS_WEBHOOK_SECRET is not set` | error | `notConfigured` | The host has no secret |
| `CMS webhook ignored: Strapi 4 notice` | warn | `ignored` | A notice without `cmsVersion: V5`; `cmsVersion` shows what it sent (`V4` when omitted) |

Bad credentials, or a shared app token the backend couldn't read from Firestore, log no outcome
line: the auth scope rejects the request before the resolver runs.

Other lines to look for:

- `Strapi 5 read failed` (error, with `operation`, `reason` and `detail`): a read from Strapi 5
  failed (`apps/server/src/effect/services/cms/content/v5Layer.ts`). When a refresh can't read the
  CMS, this line comes just before `Strapi 5 webhook failed`. A `Decode` detail names the failing
  Schema path.
- `Response cache invalidation failed after a CMS webhook` (warn): the work ran, but cached
  answers stay until they expire.
- `Failed to clear campus cache` or `Failed to clear events cache` (warn, with `cmsOperation`,
  `detail` and `cause`): a campus notice did its refresh and still answers success, but Railway's
  cached campuses or events stay in Redis until they expire (up to 70 minutes).
- `GraphQL transport error` (error, with `statusCode` 504) and a Sentry event: the 20 s app timeout
  ended the request (`app.onError` in `apps/server/src/app.ts`). The work still finishes and logs
  its outcome line.
- `All fibers interrupted without error` (error, from the resolver error logger): the CMS hung up,
  or the 20 s timeout ended the request, while the work ran. The work still completed and logged
  its outcome line.

### Setup and rotation

1. Generate a secret: `openssl rand -hex 32`.
2. Set it as `CMS_WEBHOOK_SECRET` in Railway's backend variables and redeploy.
3. Give the Strapi 5 CMS's environment the same secret, the shared app token and Railway's
   `/graphql` URL (`CMS_WEBHOOK_SECRET`, `BACKEND_APP_TOKEN` and `BACKEND_GRAPHQL_URL`, read by
   the module below), then deploy the module.
4. Publish a change to any content type in the table and check Railway's logs for
   `Strapi 5 webhook handled` with that `uid`.

To rotate the secret, change it in both places. Notices sent in between fail with a GraphQL error
(logged as rejected), so publish those changes again.

Rotating the shared app token (Firestore `app-config/newuser-config`, field `token`) also stops
notices until the CMS's `BACKEND_APP_TOKEN` has the new value. The backend accepts the new token
at once, and the old one for at most 60 s more, because it caches the configured token for 60 s
(`SHARED_TOKEN_CONFIG_TTL_MS` in `apps/server/src/effect/services/AuthService.ts`). Notices refused
in between answer `Not authorized…` and log no outcome line on the backend, but the CMS logs them,
so publish those changes again.

### Sending from HCCNJ/site

> **Sketch for the CMS repository (HCCNJ/site `apps/cms`), not code from this one.** Adapt it,
> test it against Railway, and keep `CONTENT_TYPES` in step with the table above.

Add a module next to `apps/cms/src/utils/content-cache.ts`, which already subscribes to the event
hub to clear the website's cache:

```ts
// HCCNJ/site apps/cms/src/utils/backend-change-notices.ts
import type { Core } from '@strapi/strapi';

// The events that change published content. Strapi emits them after the transaction commits.
const EVENTS = new Set(['entry.publish', 'entry.unpublish', 'entry.delete']);

// The content types the backend acts on (docs/cms-change-notices.md in HCCNJ/HCCNA-V2).
const CONTENT_TYPES = new Set([
  'api::app-config.app-config',
  'api::home.home',
  'api::campus.campus',
  'api::leader-ship.leader-ship',
  'api::event.event',
  'api::sermon.sermon',
  'api::sermon-page.sermon-page',
  'api::tog.tog',
  'api::check-in-permission.check-in-permission',
  'api::kids-checkin.kids-checkin',
  'api::department.department',
  'api::ministry.ministry',
]);

const MUTATION = `mutation Strapi5ChangeNoticeMutation($input: StrapiWebHookUpdateInput!) {
  cmsWebhookUpdate(input: $input) { success message }
}`;

/** What the document service emits with an entry.* event. */
interface EntryEvent {
  uid?: string;
  model?: string;
  entry?: { slug?: unknown } | null;
}

interface Notice {
  event: string;
  uid: string;
  model: string;
  slug?: string;
}

/** The part of the backend's GraphQL answer the module reads. */
interface BackendAnswer {
  data?: { cmsWebhookUpdate?: { success: boolean; message: string } | null } | null;
  errors?: ReadonlyArray<{ message?: string }>;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tells the HCCNA backend on Railway when published content changes. */
export function registerBackendChangeNotices(strapi: Core.Strapi) {
  // A pasted value can end in a line break, which fetch rejects in a header.
  const endpoint = process.env.BACKEND_GRAPHQL_URL?.trim(); // Railway's /graphql
  const token = process.env.BACKEND_APP_TOKEN?.trim();
  const secret = process.env.CMS_WEBHOOK_SECRET?.trim();
  if (!endpoint || !token || !secret) {
    strapi.log.warn(
      '[backend-notices] Off: BACKEND_GRAPHQL_URL, BACKEND_APP_TOKEN or CMS_WEBHOOK_SECRET is unset'
    );
    return;
  }

  // Logs only the notice, the HTTP status and the backend's messages, or an error's name and
  // cause code: fetch's own messages can quote the header value it rejects.
  const send = async (notice: Notice) => {
    const label = `${notice.event} ${notice.uid}`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'x-cms-webhook-secret': secret,
        },
        body: JSON.stringify({
          query: MUTATION,
          variables: {
            input: { ...notice, createdAt: new Date().toISOString(), cmsVersion: 'V5' },
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await response.json().catch(() => null)) as BackendAnswer | null;
      const result = body?.data?.cmsWebhookUpdate;
      // "Ignored: …" means the backend did nothing for this notice.
      if (!result?.success || result.message.startsWith('Ignored:')) {
        const answer = result
          ? `success ${result.success}: ${result.message}`
          : (body?.errors?.map((error) => error.message).join('; ') ?? 'no GraphQL answer');
        strapi.log.error(`[backend-notices] ${label}: HTTP ${response.status}, ${answer}`);
      }
    } catch (error) {
      const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
      const name = error instanceof Error ? error.name : 'Error';
      const reason = typeof code === 'string' ? `${name} (${code})` : name;
      strapi.log.error(`[backend-notices] ${label} failed: ${reason}`);
    }
  };

  // One notice at a time, at most 10 a second, under the backend's per-IP rate limit. A notice
  // that matches one still waiting is dropped: the waiting one goes out after both changes.
  let queue = Promise.resolve();
  const waiting = new Set<string>();
  const enqueue = (notice: Notice) => {
    const key = JSON.stringify(notice);
    if (waiting.has(key)) return;
    waiting.add(key);
    queue = queue.then(async () => {
      waiting.delete(key);
      await send(notice);
      await pause(100);
    });
  };

  strapi.eventHub.subscribe(async (event: string, info?: EntryEvent) => {
    // Return at once and never throw: the event hub runs its subscribers one after another.
    if (!EVENTS.has(event) || !info?.uid || !CONTENT_TYPES.has(info.uid)) return;
    const slug = info.entry?.slug;
    // Only campus notices use the slug; leaving it off the rest lets a bulk action's notices merge.
    const campusSlug =
      info.uid === 'api::campus.campus' && typeof slug === 'string' && slug.trim() !== ''
        ? { slug }
        : {};
    enqueue({ event, uid: info.uid, model: info.model ?? info.uid, ...campusSlug });
  });
}
```

Then call it from the existing `bootstrap` in `apps/cms/src/index.ts`, next to
`registerContentCache`:

```diff
 import type { Core } from '@strapi/strapi';
+import { registerBackendChangeNotices } from './utils/backend-change-notices';
 import { registerContentCache } from './utils/content-cache';
@@
   async bootstrap({ strapi }: { strapi: Core.Strapi }) {
     stopContentCache = registerContentCache(strapi);
+    registerBackendChangeNotices(strapi);
     const contentTypes = strapi.plugin('content-manager').service('content-types');
```

Nothing else in that file changes: `register`, the rest of `bootstrap` and `destroy` stay as they
are. Strapi drops event-hub subscribers when it shuts down (`Strapi.destroy` calls
`eventHub.destroy()`), so the module needs no stop function.

Waiting notices live in memory, so a CMS restart drops them; publish again if a change doesn't
show up. The CMS logs a failed or timed-out notice as a `[backend-notices]` error, without the
token or the secret; check the backend's outcome line before publishing again. Keep the logging
that narrow when adapting the module: never log `String(error)`, an error's message or the request
headers, because Node's fetch rejects a header value containing a line break with a message that
quotes the value (`Headers.append: "…" is an invalid header value.`).

#### Why the event hub

Checked in the Strapi source at tag `v5.56.0`, the version HCCNJ/site's lockfile pins:

- **The events come after the commit.** The document service emits `entry.*` events from an
  `onCommit` callback (`packages/core/core/src/services/document-service/events.ts`), so they
  fire once the outermost transaction commits, and never for a rolled-back change. Commit
  callbacks aren't awaited, so subscribers don't hold up the editor's request
  (`packages/core/database/src/transaction-context.ts`). Strapi's built-in webhooks send these
  same events (`packages/core/core/src/services/webhook-runner.ts`).
- **Every way of publishing raises them.** The content manager, content releases
  (`packages/core/content-releases/server/src/services/release.ts`) and the Content API all go
  through the document service, whose `publish`, `unpublish` and `delete` emit `entry.publish`,
  `entry.unpublish` and `entry.delete` for each version they write or remove; a delete removes both
  the draft and the published version
  (`packages/core/core/src/services/document-service/repository.ts`). `create` and `update` with
  `status: 'published'` publish through the same function, so they emit `entry.publish` too, and
  Content API writes use that status unless they ask for a draft
  (`packages/core/core/src/core-api/service/core-service.ts`, and the GraphQL plugin's `status`
  argument in `packages/plugins/graphql/server/src/services/internals/args/publication-status.ts`).
- **Each event carries `{ model, uid, entry }`.** `model` is the content type's singular name, and
  `entry` the sanitized entry: re-read with its relations after a publish, and the removed row
  after an unpublish or delete, so a campus's `slug` is there for all three events.
- **Subscribers run one at a time.** `strapi.eventHub.emit` awaits each subscriber in turn
  (`packages/core/core/src/services/event-hub.ts`), so a slow subscriber delays the others and one
  that throws stops them. The module's subscriber only queues.

A document-service middleware (`strapi.documents.use`) would miss some of this. The content
manager runs publish, unpublish and its bulk actions inside an outer `strapi.db.transaction`
(`packages/core/content-manager/server/src/controllers/collection-types.ts` and
`single-types.ts`, `services/document-manager.ts`), and so do content releases, so a middleware's
`await next()` returns before the commit, and a notice sent then can make the backend re-read the
old version. A middleware also sees a Content API publish as a `create` or `update` action, and
Strapi's documentation registers middlewares in `register()`, not `bootstrap()`. Database
lifecycle hooks (`strapi.db.lifecycles.subscribe`) run inside the transaction as well, once per
row, and on every draft save.
