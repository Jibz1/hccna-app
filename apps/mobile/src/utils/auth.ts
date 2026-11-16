import { getAuth } from "@react-native-firebase/auth";
import { Effect, Schema } from "effect";

import { runLiveAppEffect } from "@/effect/appRuntimeLive";
import type {
  SignInProvider,
  SocialProvider,
  SocialProviderType,
} from "@/effect/authService";
import {
  deleteUserFromProvider,
  signInFromProvider,
  signOutFromProvider,
  waitForUserDocument as waitForUserDocumentEffect,
} from "@/effect/authService";
import { completeSignIn } from "@/effect/authSessionService";
import { AuthUserNotFoundError } from "@/effect/errors";
import { resumePushRegistration } from "@/effect/pushRegistrationService";
import { FirebaseUid } from "@/effect/schema";
import type { UserDocType } from "@/types/userdoc";
import { retirePushRegistration, syncPushLogout } from "@/utils/pushLogout";
import { cancelAndClearPushRegistration } from "@/utils/pushRegistration";
import { pushTokenRegistrationStore } from "@/utils/pushTokenRegistrationStore";
import { captureException } from "@/utils/sentry";
import { clearUserScopedPersistence } from "@/utils/storageRegistry";

import { clearUserData } from "./userData";

export type { SignInProvider, SocialProvider, SocialProviderType };

const decodeFirebaseUid = Schema.decodeUnknownSync(FirebaseUid);

export async function waitForUserDocument(uid: string): Promise<UserDocType> {
  return await runLiveAppEffect(
    waitForUserDocumentEffect(decodeFirebaseUid(uid)),
  );
}

export class Auth {
  static signInFromProvider(provider: SignInProvider): Promise<string> {
    return runLiveAppEffect(
      signInFromProvider(provider).pipe(Effect.tap(completeSignIn)),
    );
  }

  static async signOutFromProvider(
    provider: SocialProvider,
    uid: string,
  ): Promise<void> {
    if (getAuth().currentUser?.uid !== uid) {
      throw new Error("Your sign-in session changed. Please try again.");
    }
    try {
      await cancelAndClearPushRegistration();
      retirePushRegistration(uid);
      await syncPushLogout().catch(captureException);
      await runLiveAppEffect(signOutFromProvider(provider, uid));
    } catch (error) {
      if (getAuth().currentUser?.uid === uid) {
        await runLiveAppEffect(resumePushRegistration());
        pushTokenRegistrationStore.clear();
      }
      throw error;
    }
    const current = getAuth().currentUser;
    if (!current || current.isAnonymous) {
      await clearUserScopedPersistence();
    }
  }

  static async deleteUserFromProvider(providerId: string): Promise<void> {
    try {
      await cancelAndClearPushRegistration().catch(() => undefined);
      await runLiveAppEffect(deleteUserFromProvider(providerId));
      await clearUserScopedPersistence();
    } catch (error) {
      if (Schema.is(AuthUserNotFoundError)(error)) {
        await clearUserData().catch(() => undefined);
      }

      throw error;
    }
  }
}
