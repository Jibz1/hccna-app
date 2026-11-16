/**
 * @generated SignedSource<<3f817deab9844b55ad984d48e1f9e08d>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type useDeleteAccountConfirmationMutation$variables = {
  code: string;
};
export type useDeleteAccountConfirmationMutation$data = {
  readonly verifyDeleteAccountCode: {
    readonly message: string | null | undefined;
    readonly success: boolean | null | undefined;
  } | null | undefined;
};
export type useDeleteAccountConfirmationMutation = {
  response: useDeleteAccountConfirmationMutation$data;
  variables: useDeleteAccountConfirmationMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "code"
  }
],
v1 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "code",
        "variableName": "code"
      }
    ],
    "concreteType": "UpdateUserProfile",
    "kind": "LinkedField",
    "name": "verifyDeleteAccountCode",
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
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "useDeleteAccountConfirmationMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "useDeleteAccountConfirmationMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "b442a8f5f4ae886c9a8a91f5a0c93905",
    "id": null,
    "metadata": {},
    "name": "useDeleteAccountConfirmationMutation",
    "operationKind": "mutation",
    "text": "mutation useDeleteAccountConfirmationMutation(\n  $code: String!\n) {\n  verifyDeleteAccountCode(code: $code) {\n    message\n    success\n  }\n}\n"
  }
};
})();

(node as any).hash = "6039a1b06d5508ce204fbd6586450f68";

export default node;
