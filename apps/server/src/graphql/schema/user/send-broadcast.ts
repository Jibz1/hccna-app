import { CampusPushService } from "@/effect/services/CampusPushService";
import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import { isValidTopic } from "@/effect/services/push/topics";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { NotificationTopic } from "@/utils/messages";
import { Effect } from "effect";

import type { Message } from "firebase-admin/messaging";

// SendBroadcastInput/SendBroadcast are frozen because distributed app versions
// call sendBroadcast with this exact shape. New clients use registerPushToken.
const SendBroadcastInput = builder.inputType("SendBroadcastInput", {
	fields: (t) => ({
		token: t.string({
			required: true,
			description: "The token to send the broadcast to",
		}),
		expoToken: t.string({
			required: true,
			description:
				"Deprecated: accepted for backward compatibility but no longer stored. Use registerPushToken for new clients.",
		}),
		userId: t.string({
			required: false,
			description:
				"Deprecated: accepted for backward compatibility but ignored; token ownership derives from the authenticated caller.",
		}),
		channels: t.stringList({
			required: false,
			description: "The channels to send the broadcast to",
		}),
	}),
});

const SendBroadcastResult = builder
	.objectRef<{
		success: boolean;
		message: string;
	}>("SendBroadcast")
	.implement({
		fields: (t) => ({
			success: t.boolean({
				description: "Update result success",
				resolve: (root) => root.success,
			}),
			message: t.string({
				description: "Update result message",
				resolve: (root) => root.message,
			}),
		}),
	});

const SendAnnouncementInput = builder.inputType("SendAnnouncementInput", {
	fields: (t) => ({
		title: t.string({
			required: true,
			description: "The title to send the announcement to",
		}),
		subtitle: t.string({
			required: true,
			description: "The subtitle to send the announcement to",
		}),
		message: t.string({
			required: true,
			description: "The message to send the announcement to",
		}),
		image: t.string({
			required: false,
			description: "The image to send the announcement to",
		}),
		channel: t.string({
			required: false,
			description:
				"The channel (FCM topic) to publish to; defaults to the shared announcement topic",
		}),
	}),
});

const SendAnnouncementResult = builder
	.objectRef<{
		success: boolean;
		message: string;
	}>("SendAnnouncementResult")
	.implement({
		fields: (t) => ({
			success: t.boolean({
				description: "Send announcement result success",
				resolve: (root) => root.success,
			}),
			message: t.string({
				description: "Send announcement result message",
				resolve: (root) => root.message,
			}),
		}),
	});

// Push mutations either register a recipient token or publish to a topic.
builder.mutationFields((t) => ({
	sendBroadcast: t.field({
		type: SendBroadcastResult,
		authScopes: authScope.authorized,
		args: {
			input: t.arg({
				type: SendBroadcastInput,
				required: true,
				description: "The input to send the broadcast to",
			}),
		},
		resolve: (_, { input }, ctx) =>
			ctx.effect.runPromise(
				CampusPushService.use((service) =>
					service.registerToken({
						token: input.token,
						// Never trust the client-supplied userId — an authorized caller
						// could bind a token to someone else's uid and receive their
						// targeted pushes. Ownership derives from the auth context only.
						userId: ctx.currentUserUid ?? null,
						channels: input.channels ?? null,
					}),
				).pipe(
					Effect.map(() => ({
						success: true,
						message: "Anonymous push token added successfully",
					})),
					Effect.catch((error) =>
						Effect.succeed({
							success: false,
							message: error.message ?? "Push registration failed",
						}),
					),
					Effect.withSpan("sendBroadcast.resolve"),
				),
			),
	}),
	sendAnnouncement: t.field({
		type: SendAnnouncementResult,
		// Publishes to every device. `authorized` would admit the client token shipped in the app.
		authScopes: authScope.googleInternal,
		args: {
			input: t.arg({
				type: SendAnnouncementInput,
				required: true,
				description: "The input to send the announcement to",
			}),
		},
		resolve: (_, { input }, ctx) =>
			ctx.effect.runPromise(
				Effect.gen(function* () {
					if (input.channel && !isValidTopic(input.channel)) {
						return {
							success: false,
							message: `Invalid channel name: ${input.channel}`,
						};
					}

					const message: Message = {
						topic: input.channel ?? NotificationTopic,
						notification: {
							title: input.title,
							body: input.message,
							...(input.image && { imageUrl: input.image }),
						},
					};

					const firebaseAdmin = yield* FirebaseAdminService;
					yield* firebaseAdmin.sendMessage(message);

					return {
						success: true,
						message: "Announcement sent successfully",
					};
				}).pipe(
					Effect.catchTag("FirebaseMessagingError", (_error) =>
						Effect.succeed({
							success: false,
							message: "Failed to send announcement",
						}),
					),
					Effect.withSpan("sendAnnouncement.resolve"),
				),
			),
	}),
}));
