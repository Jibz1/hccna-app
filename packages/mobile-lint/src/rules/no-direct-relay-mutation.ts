import { restrictedImportRule } from "../shared/restricted-import.ts";

/** Ban Relay's raw mutation entry points in favour of the checked wrappers. */
export const noDirectRelayMutationRule = restrictedImportRule({
  description: "Disallow importing useMutation and commitMutation from Relay.",
  message:
    "Use `useCheckedMutation` or `commitCheckedMutation` from `@/relay/mutations`; they reject unless the payload reports success.",
  sources: ["react-relay", "react-relay/", "relay-runtime", "relay-runtime/"],
  names: ["useMutation", "commitMutation"],
});
