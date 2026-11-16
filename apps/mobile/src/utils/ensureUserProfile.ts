import { commitMutation, graphql } from "react-relay";

import { checkLiveStatsigGate } from "@/effect/statsigServiceLive";
import { FEATURE_GATES } from "@/featureGates/names";
import {
  createEnsureUserProfile,
  type EnsureUserProfileOutcome,
} from "@/utils/ensureUserProfileCore";
import { getEnvironment } from "@/utils/getDefaultRelayStore";

import type { ensureUserProfileMutation } from "./__generated__/ensureUserProfileMutation.graphql";

const EnsureUserProfileMutation = graphql`
  mutation ensureUserProfileMutation {
    ensureUserProfile {
      created
      message
      success
    }
  }
`;

export class EnsureUserProfileDisabledError extends Error {
  override readonly name = "EnsureUserProfileDisabledError";
}

function isEnsureUserProfileEnabled(): boolean {
  try {
    return checkLiveStatsigGate(FEATURE_GATES.ensureUserProfile);
  } catch {
    return false;
  }
}

function commitEnsureUserProfile(): Promise<EnsureUserProfileOutcome> {
  return new Promise((resolve, reject) => {
    commitMutation<ensureUserProfileMutation>(getEnvironment(), {
      mutation: EnsureUserProfileMutation,
      variables: {},
      onCompleted: (response) => {
        resolve({
          success: response?.ensureUserProfile?.success === true,
          created: response?.ensureUserProfile?.created === true,
          message: response?.ensureUserProfile?.message ?? "",
        });
      },
      onError: reject,
    });
  });
}

const runEnsureUserProfile = createEnsureUserProfile(commitEnsureUserProfile);

/**
 * Idempotently provisions the signed-in user's profile on the backend.
 * Remotely gated (default off) and retried once. Callers treat any throw as a
 * signal to use the legacy fallback.
 */
export async function ensureUserProfile(): Promise<EnsureUserProfileOutcome> {
  if (!isEnsureUserProfileEnabled()) {
    throw new EnsureUserProfileDisabledError(
      "ensure_user_profile_enabled gate is off",
    );
  }
  return await runEnsureUserProfile();
}

export type { EnsureUserProfileOutcome };
