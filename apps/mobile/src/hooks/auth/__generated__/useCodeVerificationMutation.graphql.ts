/**
 * @generated SignedSource<<01297333fe7904ba17b10db1eb8e33b8>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type useCodeVerificationMutation$variables = {
  code: string;
  email: string;
};
export type useCodeVerificationMutation$data = {
  readonly verifySignInCode: {
    readonly message: string | null | undefined;
    readonly success: boolean | null | undefined;
    readonly token: string | null | undefined;
  } | null | undefined;
};
export type useCodeVerificationMutation = {
  response: useCodeVerificationMutation$data;
  variables: useCodeVerificationMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "code"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "email"
},
v2 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "code",
        "variableName": "code"
      },
      {
        "kind": "Variable",
        "name": "email",
        "variableName": "email"
      }
    ],
    "concreteType": "VerifySignInCodeResult",
    "kind": "LinkedField",
    "name": "verifySignInCode",
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
        "name": "token",
        "storageKey": null
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "useCodeVerificationMutation",
    "selections": (v2/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v1/*:: as any*/),
      (v0/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "useCodeVerificationMutation",
    "selections": (v2/*:: as any*/)
  },
  "params": {
    "cacheID": "5c5f20a01d322a0a443a024abfd5825f",
    "id": null,
    "metadata": {},
    "name": "useCodeVerificationMutation",
    "operationKind": "mutation",
    "text": "mutation useCodeVerificationMutation(\n  $email: String!\n  $code: String!\n) {\n  verifySignInCode(email: $email, code: $code) {\n    message\n    success\n    token\n  }\n}\n"
  }
};
})();

(node as any).hash = "78bad7f8515bbe52665f052b86f5cf81";

export default node;
