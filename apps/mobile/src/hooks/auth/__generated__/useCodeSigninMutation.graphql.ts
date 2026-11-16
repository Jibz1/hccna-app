/**
 * @generated SignedSource<<58ce0c497dc4cee9f827af5a7fa08888>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type useCodeSigninMutation$variables = {
  email: string;
};
export type useCodeSigninMutation$data = {
  readonly createSignInCode: {
    readonly countDownTime: number | null | undefined;
    readonly message: string | null | undefined;
    readonly success: boolean | null | undefined;
  } | null | undefined;
};
export type useCodeSigninMutation = {
  response: useCodeSigninMutation$data;
  variables: useCodeSigninMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "email"
  }
],
v1 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "email",
        "variableName": "email"
      }
    ],
    "concreteType": "CreateSignInOrDeleteAccountCodeResult",
    "kind": "LinkedField",
    "name": "createSignInCode",
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
        "name": "countDownTime",
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
    "name": "useCodeSigninMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "useCodeSigninMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "3e96b6d01b4432a1d19fdcfaf4cfe8f0",
    "id": null,
    "metadata": {},
    "name": "useCodeSigninMutation",
    "operationKind": "mutation",
    "text": "mutation useCodeSigninMutation(\n  $email: String!\n) {\n  createSignInCode(email: $email) {\n    message\n    success\n    countDownTime\n  }\n}\n"
  }
};
})();

(node as any).hash = "094cbb2526b7913c23900cb673333386";

export default node;
