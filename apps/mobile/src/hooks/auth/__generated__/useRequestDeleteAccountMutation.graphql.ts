/**
 * @generated SignedSource<<d265ccff6baa30163143cd289fdf82ed>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type useRequestDeleteAccountMutation$variables = Record<PropertyKey, never>;
export type useRequestDeleteAccountMutation$data = {
  readonly requestDeleteAccount: {
    readonly message: string | null | undefined;
    readonly success: boolean | null | undefined;
  } | null | undefined;
};
export type useRequestDeleteAccountMutation = {
  response: useRequestDeleteAccountMutation$data;
  variables: useRequestDeleteAccountMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "CreateSignInOrDeleteAccountCodeResult",
    "kind": "LinkedField",
    "name": "requestDeleteAccount",
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
    "name": "useRequestDeleteAccountMutation",
    "selections": (v0/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "useRequestDeleteAccountMutation",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "27e1510318f05a3e9757ac000eb16896",
    "id": null,
    "metadata": {},
    "name": "useRequestDeleteAccountMutation",
    "operationKind": "mutation",
    "text": "mutation useRequestDeleteAccountMutation {\n  requestDeleteAccount {\n    message\n    success\n  }\n}\n"
  }
};
})();

(node as any).hash = "0c9caed61205b193144279668e1449b0";

export default node;
