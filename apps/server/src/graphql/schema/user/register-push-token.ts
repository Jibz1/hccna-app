import { CampusPushService } from "@/effect/services/CampusPushService";
import { supportsCampusStreamNotifications } from "@/effect/services/push/streamAudience";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { Effect } from "effect";

const RegisterPushTokenInput = builder.inputType("RegisterPushTokenInput", {
	fields: (t) => ({
		logoutKey: t.string({
			required: false,
			description:
				"Device-generated secret for this registration. Rotate after logout; retained locally for replay-safe cleanup.",
		}),
		followPreferredCampus: t.boolean({
			required: false,
			description:
				"Follow the latest saved campus, or Union for a guest. Campus topics are server-derived in this mode.",
		}),
		token: t.string({
			required: true,
			description: "The device's FCM registration token",
		}),
		platform: t.string({
			required: false,
			description: "Device platform, e.g. ios or android",
		}),
		channels: t.stringList({
			required: false,
			description:
				"The complete desired notification-channel set for this token. Omitted channels, channels: null, and channels: [] all select no client channels: the shared announcement topic remains, and every previously registered non-announcement topic is removed. With followPreferredCampus enabled, the server also adds the latest saved campus topic (Union for guests).",
		}),
	}),
});

const RegisterPushTokenResult = builder
	.objectRef<{
		success: boolean;
		message: string;
		topics: readonly string[];
		campusSlug?: string | null;
		campusPreferenceVersion?: number | null;
		retryable?: boolean;
	}>("RegisterPushTokenResult")
	.implement({
		fields: (t) => ({
			campusSlug: t.exposeString("campusSlug", { nullable: true }),
			campusPreferenceVersion: t.exposeInt("campusPreferenceVersion", { nullable: true }),
			retryable: t.boolean({ nullable: false, resolve: (root) => root.retryable ?? false }),
			success: t.boolean({
				nullable: false,
				description: "Whether the token was registered",
				resolve: (root) => root.success,
			}),
			message: t.string({
				nullable: false,
				description: "Registration result message",
				resolve: (root) => root.message,
			}),
			topics: t.stringList({
				nullable: false,
				description: "The FCM topics the device is now subscribed to",
				resolve: (root) => [...root.topics],
			}),
		}),
	});

builder.mutationFields((t) => ({
	registerPushToken: t.field({
		type: RegisterPushTokenResult,
		description:
			"Replay-safe, idempotent push-token upsert keyed by the FCM token. Repeating the same input for the same authenticated user converges to one registration and the same topic set without duplicate registrations or topic memberships. followPreferredCampus replays reconcile the latest backend preference, which may change between requests.",
		authScopes: authScope.firebaseClient,
		args: {
			input: t.arg({
				type: RegisterPushTokenInput,
				required: true,
				description: "The push token registration input",
			}),
		},
		resolve: (_, { input }, ctx) =>
			ctx.effect.runPromise(
				CampusPushService.use((service) =>
					service.registerToken({
						token: input.token,
						logoutKey: input.logoutKey,
						userId: ctx.authType === "jwt" ? ctx.currentUserUid : null,
						followPreferredCampus: input.followPreferredCampus ?? false,
						campusStreamNotifications:
							input.followPreferredCampus === true &&
							supportsCampusStreamNotifications(
								ctx.request.headers.get("x-hccna-app-version") ??
									ctx.request.headers.get("x-app-version"),
							),
						platform: input.platform ?? null,
						channels: input.channels ?? null,
					}),
				).pipe(
					Effect.map((registered) => ({
						success: true,
						message: "Push token registered successfully",
						topics: registered.topics,
						campusSlug: registered.campusSlug ?? null,
						campusPreferenceVersion: registered.campusPreferenceVersion ?? null,
					})),
					Effect.catch((error) =>
						Effect.succeed({
							success: false,
							message: "Push registration could not complete",
							retryable:
								error._tag === "PushTokenRegistrationError" ? error.retryable !== false : true,
							topics: [] as readonly string[],
						}),
					),
					Effect.withSpan("registerPushToken.resolve"),
				),
			),
	}),
}));

builder.mutationFields((t) => ({
	unregisterPushToken: t.boolean({
		nullable: false,
		authScopes: authScope.firebaseClient,
		description:
			"Retire one device registration using its logout key. May be retried with anonymous Firebase auth after logout. A newer registration is unaffected. Returns false when cleanup could not complete; retry later.",
		args: {
			token: t.arg.string({ required: true }),
			logoutKey: t.arg.string({ required: true }),
			legacyUserId: t.arg.string({
				required: false,
				description:
					"Previous owner for a registration made before logout keys existed. Ignored for keyed registrations.",
			}),
		},
		resolve: (_, input, ctx) =>
			ctx.effect.runPromise(
				CampusPushService.use((service) => service.unregisterToken(input)).pipe(
					Effect.as(true),
					// A result, not a GraphQL error: Sentry's GraphQL plugin attaches the
					// raw variables, logout key included, to every error it captures. The
					// detail is not logged either: Firestore paths in it name the FCM token.
					Effect.catch((error) =>
						Effect.logWarning("Push logout cleanup will retry", {
							errorTag: error._tag,
							retryable: error.retryable !== false,
						}).pipe(Effect.as(false)),
					),
					Effect.withSpan("unregisterPushToken.resolve"),
				),
			),
	}),
}));
