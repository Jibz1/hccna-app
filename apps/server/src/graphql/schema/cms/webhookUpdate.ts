import {
	CMS_WEBHOOK_SECRET_HEADER,
	planStrapiWebhook,
	runStrapiWebhookAction,
	secretMatches,
	strapiWebhookWorkName,
} from "@/effect/services/cms/strapiWebhook";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { ForbiddenError } from "@pothos/plugin-scope-auth";
import { Cause, Config, Effect, Option, Redacted } from "effect";

// ═══════════════════════════════════════════════════════════════
// GRAPHQL SCHEMA
// ═══════════════════════════════════════════════════════════════

// V4 stays in the enum so the deployed contract keeps every value it has published.
const CmsVersionEnum = builder.enumType("CmsVersion", {
	description: "Which CMS sent the change notice: V5 = Strapi 5. Strapi 4 is retired.",
	values: {
		V4: { deprecationReason: "Strapi 4 is retired; its notices are ignored." },
		V5: {},
	} as const,
});

const StrapiWebHookUpdateSchema = builder.inputType("StrapiWebHookUpdateInput", {
	fields: (t) => ({
		createdAt: t.string({ required: true }),
		event: t.string({ required: true }),
		model: t.string({ required: true }),
		uid: t.string({ required: true }),
		slug: t.string({ required: false }),
		cmsVersion: t.field({
			type: CmsVersionEnum,
			required: false,
			description: `V5 for Strapi 5 notices, which must carry the ${CMS_WEBHOOK_SECRET_HEADER} header. Notices without cmsVersion V5 come from the retired Strapi 4 and are ignored.`,
		}),
	}),
});

type StrapiWebHookUpdate = typeof StrapiWebHookUpdateSchema.$inferInput;

const StrapiWebHookUpdateResult = builder
	.objectRef<{ success: boolean; message: string }>("StrapiWebHookUpdateResult")
	.implement({
		fields: (t) => ({
			success: t.exposeBoolean("success"),
			message: t.exposeString("message"),
		}),
	});

// ═══════════════════════════════════════════════════════════════
// STRAPI 4 NOTICES
// ═══════════════════════════════════════════════════════════════

/** Strapi 4 is retired: a notice without `cmsVersion: V5` changes nothing. */
const ignoreStrapi4Notice = (input: StrapiWebHookUpdate) =>
	Effect.logWarning("CMS webhook ignored: Strapi 4 notice").pipe(
		Effect.annotateLogs({
			event: input.event,
			uid: input.uid,
			action: "none",
			outcome: "ignored",
			cmsVersion: input.cmsVersion ?? "V4",
		}),
		Effect.as({ success: true, message: "Ignored: Strapi 4 notice" }),
	);

// ═══════════════════════════════════════════════════════════════
// STRAPI 5 NOTICES
// ═══════════════════════════════════════════════════════════════

// The error the auth scope raises, so a caller cannot tell which check failed.
const notAuthorized = () =>
	new ForbiddenError("Not authorized to resolve Mutation.cmsWebhookUpdate");

const failureMessage = <E>(cause: Cause.Cause<E>): string => {
	const error = Cause.squash(cause);
	return error instanceof Error ? error.message : String(error);
};

/**
 * The Strapi 5 CMS sends a notice from its event hub once a publish, unpublish or delete commits.
 * The notice is only a signal: the work re-reads published content. Logs carry the event, uid,
 * action and outcome, never the secret or its header.
 */
const handleStrapi5Notice = Effect.fn("CMSWebhook.strapi5Notice")(function* (
	input: StrapiWebHookUpdate,
	presentedSecret: string | undefined,
) {
	const notice = { event: input.event, uid: input.uid };
	const configured = yield* Config.option(Config.Redacted("CMS_WEBHOOK_SECRET"));
	// Fetch trims header values, so stray whitespace around the configured secret must not turn
	// every notice into a Forbidden: compare with the trimmed secret.
	const secret = configured.pipe(
		Option.map((value) => Redacted.make(Redacted.value(value).trim())),
		Option.filter((value) => Redacted.value(value) !== ""),
	);
	if (Option.isNone(secret)) {
		yield* Effect.logError("Strapi 5 webhook dropped: CMS_WEBHOOK_SECRET is not set").pipe(
			Effect.annotateLogs({ ...notice, action: "none", outcome: "notConfigured" }),
		);
		return { success: false, message: "Strapi 5 notices are not configured" };
	}
	if (!secretMatches(presentedSecret, Redacted.value(secret.value))) {
		yield* Effect.logWarning("Strapi 5 webhook rejected: wrong or missing secret header").pipe(
			Effect.annotateLogs({ ...notice, action: "none", outcome: "unauthorized" }),
		);
		return yield* Effect.fail(notAuthorized());
	}

	const plan = planStrapiWebhook({
		event: input.event,
		uid: input.uid,
		model: input.model,
		entry: { slug: input.slug ?? null },
	});
	if (plan.kind === "ignored") {
		yield* Effect.logInfo("Strapi 5 webhook ignored").pipe(
			Effect.annotateLogs({
				...notice,
				action: "ignored",
				outcome: "ignored",
				reason: plan.reason,
			}),
		);
		return { success: true, message: `Ignored: ${plan.reason}` };
	}

	// Answer after the work: Strapi does not retry, and core settings change only through these
	// notices. The work and its log line are uninterruptible, so a client hang-up cannot abort a
	// half-done refresh.
	const action = strapiWebhookWorkName(plan);
	return yield* runStrapiWebhookAction(plan).pipe(
		Effect.matchCauseEffect({
			onFailure: (cause) =>
				Effect.logError("Strapi 5 webhook failed").pipe(
					Effect.annotateLogs({ outcome: "failed", error: failureMessage(cause) }),
					Effect.as({ success: false, message: action }),
				),
			onSuccess: () =>
				Effect.logInfo("Strapi 5 webhook handled").pipe(
					Effect.annotateLogs({ outcome: "ok" }),
					Effect.as({ success: true, message: action }),
				),
		}),
		Effect.annotateLogs({ ...notice, action }),
		Effect.uninterruptible,
	);
});

// ═══════════════════════════════════════════════════════════════
// MUTATION
// ═══════════════════════════════════════════════════════════════

builder.mutationFields((t) => ({
	cmsWebhookUpdate: t.field({
		type: StrapiWebHookUpdateResult,
		description: "Update CMS data from Strapi Webhook",
		authScopes: authScope.authorized,
		args: {
			input: t.arg({
				type: StrapiWebHookUpdateSchema,
				required: true,
				description: "Strapi webhook payload",
			}),
		},
		resolve: (_, { input }, ctx) =>
			ctx.effect.runPromise(
				Effect.gen(function* () {
					if (input.cmsVersion !== "V5") {
						return yield* ignoreStrapi4Notice(input);
					}
					return yield* handleStrapi5Notice(
						input,
						ctx.request.headers.get(CMS_WEBHOOK_SECRET_HEADER) ?? undefined,
					);
				}),
			),
	}),
}));
