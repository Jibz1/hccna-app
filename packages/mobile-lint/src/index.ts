import { eslintCompatPlugin } from "@oxlint/plugins";

import { noDirectAuthListenerRule } from "./rules/no-direct-auth-listener.ts";
import { noDirectEffectRule } from "./rules/no-direct-effect.ts";
import { noDirectFeatureGateRule } from "./rules/no-direct-feature-gate.ts";
import { noDirectRelayMutationRule } from "./rules/no-direct-relay-mutation.ts";
import { noExtraStateLibraryRule } from "./rules/no-extra-state-library.ts";
import { noRawTimersRule } from "./rules/no-raw-timers.ts";

/** Oxlint rules that enforce the HCCNA mobile app's React conventions. */
const mobilePlugin = eslintCompatPlugin({
  meta: { name: "mobile" },
  rules: {
    "no-direct-auth-listener": noDirectAuthListenerRule,
    "no-direct-effect": noDirectEffectRule,
    "no-direct-feature-gate": noDirectFeatureGateRule,
    "no-direct-relay-mutation": noDirectRelayMutationRule,
    "no-extra-state-library": noExtraStateLibraryRule,
    "no-raw-timers": noRawTimersRule,
  },
});

export default mobilePlugin;
