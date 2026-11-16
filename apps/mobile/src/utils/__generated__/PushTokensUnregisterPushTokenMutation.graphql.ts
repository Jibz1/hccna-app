/**
 * @generated SignedSource<<9f1b786c9c2ccc2a6aacad61096c3a9a>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type PushTokensUnregisterPushTokenMutation$variables = {
  legacyUserId?: string | null | undefined;
  logoutKey: string;
  token: string;
};
export type PushTokensUnregisterPushTokenMutation$data = {
  readonly unregisterPushToken: boolean;
};
export type PushTokensUnregisterPushTokenMutation = {
  response: PushTokensUnregisterPushTokenMutation$data;
  variables: PushTokensUnregisterPushTokenMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "legacyUserId"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "logoutKey"
},
v2 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "token"
},
v3 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "legacyUserId",
        "variableName": "legacyUserId"
      },
      {
        "kind": "Variable",
        "name": "logoutKey",
        "variableName": "logoutKey"
      },
      {
        "kind": "Variable",
        "name": "token",
        "variableName": "token"
      }
    ],
    "kind": "ScalarField",
    "name": "unregisterPushToken",
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/),
      (v2/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "PushTokensUnregisterPushTokenMutation",
    "selections": (v3/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v2/*:: as any*/),
      (v1/*:: as any*/),
      (v0/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "PushTokensUnregisterPushTokenMutation",
    "selections": (v3/*:: as any*/)
  },
  "params": {
    "cacheID": "52e1f1580cd8c524dbe30202be910331",
    "id": null,
    "metadata": {},
    "name": "PushTokensUnregisterPushTokenMutation",
    "operationKind": "mutation",
    "text": "mutation PushTokensUnregisterPushTokenMutation(\n  $token: String!\n  $logoutKey: String!\n  $legacyUserId: String\n) {\n  unregisterPushToken(token: $token, logoutKey: $logoutKey, legacyUserId: $legacyUserId)\n}\n"
  }
};
})();

(node as any).hash = "e82362b5fdccb2a5451eccfd7f5646c3";

export default node;
