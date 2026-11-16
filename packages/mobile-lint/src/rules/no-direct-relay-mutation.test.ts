import { RuleTester } from "oxlint/plugins-dev";

import { noDirectRelayMutationRule } from "./no-direct-relay-mutation.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const error = { messageId: "restricted" };

tester.run("mobile/no-direct-relay-mutation", noDirectRelayMutationRule, {
  valid: [
    'import { graphql, useLazyLoadQuery, usePaginationFragment } from "react-relay";',
    'export * from "react-relay";',
  ],
  invalid: [
    {
      name: "hook",
      code: 'import { useMutation, graphql } from "react-relay";',
      errors: [error],
    },
    {
      name: "imperative",
      code: 'import { commitMutation } from "react-relay";',
      errors: [error],
    },
    {
      name: "runtime",
      code: 'import { commitMutation } from "relay-runtime";',
      errors: [error],
    },
    {
      name: "alias",
      code: 'import { useMutation as useRelayMutation } from "react-relay";',
      errors: [error],
    },
    {
      name: "re-export",
      code: 'export { useMutation } from "react-relay";',
      errors: [error],
    },
    {
      name: "react-relay subpath",
      code: 'import { useMutation } from "react-relay/hooks";',
      errors: [error],
    },
    {
      name: "relay-runtime subpath",
      code: 'import { commitMutation } from "relay-runtime/lib/mutations/commitMutation";',
      errors: [error],
    },
    {
      name: "namespace import",
      code: 'import * as Relay from "react-relay";',
      errors: [error],
    },
    {
      name: "default import",
      code: 'import Relay from "react-relay";',
      errors: [error],
    },
    {
      name: "both names",
      code: 'import { useMutation, commitMutation } from "react-relay";',
      errors: [error, error],
    },
  ],
});
