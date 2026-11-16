import { WordOfActivationService } from "@/effect/services/WordOfActivationService";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { Effect } from "effect";

interface WordOfActivationRunStarted {
	_tag: "WordOfActivationRunStarted";
	message: string;
}

const WordOfActivationRunStartedType = builder
	.objectRef<WordOfActivationRunStarted>("WordOfActivationRunStarted")
	.implement({
		description:
			"A Word of Activation delivery run started in the background. Outcomes go to logs and Sentry.",
		fields: (t) => ({
			message: t.exposeString("message", { description: "Which run started" }),
		}),
	});

// The two types below are no longer returned. They stay in the union so queries written
// against them, like Cloud Scheduler's, keep validating against the deployed API.
interface WordOfActivationMonthlySuccess {
	_tag: "WordOfActivationMonthlySuccess";
	message: string;
	assigned: number;
	emailed: number;
	notified: number;
	skipped: number;
	failed: number;
}

const WordOfActivationMonthlySuccessType = builder
	.objectRef<WordOfActivationMonthlySuccess>("WordOfActivationMonthlySuccess")
	.implement({
		description: "No longer returned; runs now report WordOfActivationRunStarted.",
		fields: (t) => ({
			message: t.exposeString("message", { description: "Success message" }),
			assigned: t.exposeInt("assigned", {
				description: "Subscriptions assigned a new verse this run",
			}),
			emailed: t.exposeInt("emailed", {
				description: "Monthly emails sent this run",
			}),
			notified: t.exposeInt("notified", {
				description: "Subscribers with at least one device accepting a monthly push this run",
			}),
			skipped: t.exposeInt("skipped", {
				description: "Subscriptions already rotated this month",
			}),
			failed: t.exposeInt("failed", {
				description: "Subscriptions that failed to process; see logs",
			}),
		}),
	});

interface WordOfActivationRotationError {
	_tag: "WordOfActivationRotationError";
	message: string;
}

const WordOfActivationRotationErrorType = builder
	.objectRef<WordOfActivationRotationError>("WordOfActivationRotationError")
	.implement({
		description: "No longer returned; run failures are reported to Sentry.",
		fields: (t) => ({
			message: t.exposeString("message", {
				description: "Error message when the monthly rotation fails",
			}),
		}),
	});

const WordOfActivationMonthlyResult = builder.unionType("WordOfActivationMonthlyResult", {
	types: [
		WordOfActivationRunStartedType,
		WordOfActivationMonthlySuccessType,
		WordOfActivationRotationErrorType,
	],
	resolveType: (value) => {
		switch (value._tag) {
			case "WordOfActivationRunStarted": {
				return WordOfActivationRunStartedType;
			}
			case "WordOfActivationMonthlySuccess": {
				return WordOfActivationMonthlySuccessType;
			}
			case "WordOfActivationRotationError": {
				return WordOfActivationRotationErrorType;
			}
		}
	},
});

// Cloud Scheduler only starts these runs; it does not wait for delivery to finish.
builder.mutationField("wordOfActivationMonthly", (t) =>
	t.field({
		type: WordOfActivationMonthlyResult,
		authScopes: authScope.googleInternal,
		description:
			"Start assigning this month's Word of Activation and emailing and pushing monthly subscribers",
		resolve: (_, __, ctx): Promise<WordOfActivationRunStarted> =>
			ctx.effect.runPromise(
				WordOfActivationService.use((service) => service.startMonthlyRotation).pipe(
					Effect.as({
						_tag: "WordOfActivationRunStarted" as const,
						message: "Word of activation monthly rotation started",
					}),
					Effect.withSpan("GraphQL.wordOfActivationMonthly"),
				),
			),
	}),
);

builder.mutationField("wordOfActivationSendPending", (t) =>
	t.field({
		type: WordOfActivationRunStartedType,
		authScopes: authScope.googleInternal,
		description:
			"Start sending this month's still-pending Word of Activation emails and pushes without assigning verses",
		resolve: (_, __, ctx): Promise<WordOfActivationRunStarted> =>
			ctx.effect.runPromise(
				WordOfActivationService.use((service) => service.startPendingDeliveries).pipe(
					Effect.as({
						_tag: "WordOfActivationRunStarted" as const,
						message: "Word of activation pending delivery started",
					}),
					Effect.withSpan("GraphQL.wordOfActivationSendPending"),
				),
			),
	}),
);
