import { Effect, Schema } from "effect";

import { runLiveAppEffect } from "@/effect/appRuntimeLive";
import { completeSignIn as completeSignInEffect } from "@/effect/authSessionService";
import { FirebaseUid } from "@/effect/schema";

export function completeSignIn(uid: string): Promise<void> {
  return runLiveAppEffect(
    Schema.decodeUnknownEffect(FirebaseUid)(uid).pipe(
      Effect.flatMap(completeSignInEffect),
    ),
  );
}
