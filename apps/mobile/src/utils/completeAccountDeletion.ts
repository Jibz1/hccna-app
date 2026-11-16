import { Effect, Schema } from "effect";

import { runLiveAppEffect } from "@/effect/appRuntimeLive";
import { completeAccountDeletion as completeAccountDeletionEffect } from "@/effect/authSessionService";
import { FirebaseUid } from "@/effect/schema";

export function completeAccountDeletion(uid: string): Promise<void> {
  return runLiveAppEffect(
    Schema.decodeUnknownEffect(FirebaseUid)(uid).pipe(
      Effect.flatMap(completeAccountDeletionEffect),
    ),
  );
}
