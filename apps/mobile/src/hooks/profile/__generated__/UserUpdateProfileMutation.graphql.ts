/**
 * @generated SignedSource<<23d26f3dac9a26b27f6626f520588750>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type UpdateUserProfileInput = {
  firstName?: string | null | undefined;
  img?: string | null | undefined;
  lastName?: string | null | undefined;
  phone?: string | null | undefined;
};
export type UserUpdateProfileMutation$variables = {
  input: UpdateUserProfileInput;
};
export type UserUpdateProfileMutation$data = {
  readonly updateUserProfile: {
    readonly message: string | null | undefined;
    readonly success: boolean | null | undefined;
  } | null | undefined;
};
export type UserUpdateProfileMutation = {
  response: UserUpdateProfileMutation$data;
  variables: UserUpdateProfileMutation$variables;
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
    "concreteType": "UpdateUserProfile",
    "kind": "LinkedField",
    "name": "updateUserProfile",
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
    "name": "UserUpdateProfileMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "UserUpdateProfileMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "1f03bb96f9f62680e023e7c104f6bcad",
    "id": null,
    "metadata": {},
    "name": "UserUpdateProfileMutation",
    "operationKind": "mutation",
    "text": "mutation UserUpdateProfileMutation(\n  $input: UpdateUserProfileInput!\n) {\n  updateUserProfile(input: $input) {\n    message\n    success\n  }\n}\n"
  }
};
})();

(node as any).hash = "6d67a1f5c0022109820120be7399d56e";

export default node;
