import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import {
	createPushTokenRepository,
	type PushSendReport,
	type RegisteredPushToken,
	type RegisterPushTokenInput,
	type UnregisterPushTokenInput,
	type SendToUserInput,
} from "@/effect/services/push/firebase";
import { Context, Effect, Layer } from "effect";

import type { PushSendError, PushTokenRegistrationError } from "@/effect/services/push/errors";

interface PushTokenServiceContract {
	registerToken: (
		input: RegisterPushTokenInput,
	) => Effect.Effect<RegisteredPushToken, PushTokenRegistrationError>;
	unregisterToken: (
		input: UnregisterPushTokenInput,
	) => Effect.Effect<void, PushTokenRegistrationError>;
	sendToUser: (input: SendToUserInput) => Effect.Effect<PushSendReport, PushSendError>;
}

/**
 * Owns the device push-token registry, topic subscriptions, and per-user
 * multicast sends. Broadcast-style sends continue to use FCM topics directly.
 */
export class PushTokenService extends Context.Service<PushTokenService, PushTokenServiceContract>()(
	"PushTokenService",
	{
		make: Effect.gen(function* () {
			const firebaseAdmin = yield* FirebaseAdminService;

			// Narrowed deps per the FirebaseAdminService transitional-adapter policy:
			// the repository sees only the ops it uses, not the whole surface.
			const repository = createPushTokenRepository({
				collection: firebaseAdmin.collections.pushTokens,
				serverTimestamp: () => firebaseAdmin.dbFieldValue.serverTimestamp(),
				readDocument: firebaseAdmin.readDocument,
				mergeDocument: firebaseAdmin.mergeDocument,
				deleteDocument: firebaseAdmin.deleteDocument,
				listPushTokenDocsByUserId: firebaseAdmin.listPushTokenDocsByUserId,
				subscribeTokensToTopic: firebaseAdmin.subscribeTokensToTopic,
				unsubscribeTokensFromTopic: firebaseAdmin.unsubscribeTokensFromTopic,
				sendEachForMulticast: firebaseAdmin.sendEachForMulticast,
			});

			return {
				registerToken: repository.registerToken,
				unregisterToken: repository.unregisterToken,
				sendToUser: repository.sendToUser,
			} satisfies PushTokenServiceContract;
		}),
	},
) {}

export const PushTokenServiceLive = Layer.effect(PushTokenService, PushTokenService.make);
