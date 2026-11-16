/**
 * @generated SignedSource<<8d6958f33c31b80e3295dc54113b2ecf>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type ensureUserProfileMutation$variables = Record<PropertyKey, never>;
export type ensureUserProfileMutation$data = {
  readonly ensureUserProfile: {
    readonly created: boolean | null | undefined;
    readonly message: string | null | undefined;
    readonly success: boolean | null | undefined;
  } | null | undefined;
};
export type ensureUserProfileMutation = {
  response: ensureUserProfileMutation$data;
  variables: ensureUserProfileMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "EnsureUserProfileResult",
    "kind": "LinkedField",
    "name": "ensureUserProfile",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "created",
        "storageKey": null
      },
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
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "ensureUserProfileMutation",
    "selections": (v0/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "ensureUserProfileMutation",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "ac1dd0db9e07161fded880f8ed2d2049",
    "id": null,
    "metadata": {},
    "name": "ensureUserProfileMutation",
    "operationKind": "mutation",
    "text": "mutation ensureUserProfileMutation {\n  ensureUserProfile {\n    created\n    message\n    success\n  }\n}\n"
  }
};
})();

(node as any).hash = "cb6a2a65b43a6539b3418d9e746ac66e";

export default node;
