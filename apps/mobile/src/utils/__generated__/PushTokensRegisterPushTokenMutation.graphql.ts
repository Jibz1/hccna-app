/**
 * @generated SignedSource<<f2b700dec7f9a3fbe8f041236644c924>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type RegisterPushTokenInput = {
  channels?: ReadonlyArray<string> | null | undefined;
  followPreferredCampus?: boolean | null | undefined;
  logoutKey?: string | null | undefined;
  platform?: string | null | undefined;
  token: string;
};
export type PushTokensRegisterPushTokenMutation$variables = {
  input: RegisterPushTokenInput;
};
export type PushTokensRegisterPushTokenMutation$data = {
  readonly registerPushToken: {
    readonly campusPreferenceVersion: number | null | undefined;
    readonly campusSlug: string | null | undefined;
    readonly message: string;
    readonly retryable: boolean;
    readonly success: boolean;
    readonly topics: ReadonlyArray<string>;
  } | null | undefined;
};
export type PushTokensRegisterPushTokenMutation = {
  response: PushTokensRegisterPushTokenMutation$data;
  variables: PushTokensRegisterPushTokenMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "input"
  }
],
v1 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "input",
        "variableName": "input"
      }
    ],
    "concreteType": "RegisterPushTokenResult",
    "kind": "LinkedField",
    "name": "registerPushToken",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "message",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "success",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "topics",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "campusSlug",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "campusPreferenceVersion",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "retryable",
        "storageKey": null
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "PushTokensRegisterPushTokenMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "PushTokensRegisterPushTokenMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "b8dde8af507af7a94df23bddc985bd73",
    "id": null,
    "metadata": {},
    "name": "PushTokensRegisterPushTokenMutation",
    "operationKind": "mutation",
    "text": "mutation PushTokensRegisterPushTokenMutation(\n  $input: RegisterPushTokenInput!\n) {\n  registerPushToken(input: $input) {\n    message\n    success\n    topics\n    campusSlug\n    campusPreferenceVersion\n    retryable\n  }\n}\n"
  }
};
})();

(node as any).hash = "90373f6dbbc7e5b9f4c5d7126c0f2dec";

export default node;
