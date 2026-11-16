/**
 * @generated SignedSource<<8da6bab2ca7e06753ea5b0c59db4bb8e>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type BroadcastingStatus = "offline" | "online" | "%future added value";
export type UpdateCastrStreamInput = {
  campusSlug: string;
  description: string;
  platforms: ReadonlyArray<UpdateCastrStreamPlatform>;
  streamId: string;
  title: string;
};
export type UpdateCastrStreamPlatform = {
  broadcasting_status: BroadcastingStatus;
  description?: string | null | undefined;
  id: string;
  key?: string | null | undefined;
  title?: string | null | undefined;
};
export type useUpdateCastrStreamMutation$variables = {
  input: UpdateCastrStreamInput;
};
export type useUpdateCastrStreamMutation$data = {
  readonly updateCastrStream: {
    readonly message: string | null | undefined;
    readonly skippedPlatformIds: ReadonlyArray<string> | null | undefined;
  } | null | undefined;
};
export type useUpdateCastrStreamMutation = {
  response: useUpdateCastrStreamMutation$data;
  variables: useUpdateCastrStreamMutation$variables;
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
    "concreteType": "PingCastrStreamResponse",
    "kind": "LinkedField",
    "name": "updateCastrStream",
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
        "name": "skippedPlatformIds",
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
    "name": "useUpdateCastrStreamMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "useUpdateCastrStreamMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "7d68786710e736f5c49e5365e1424e46",
    "id": null,
    "metadata": {},
    "name": "useUpdateCastrStreamMutation",
    "operationKind": "mutation",
    "text": "mutation useUpdateCastrStreamMutation(\n  $input: UpdateCastrStreamInput!\n) {\n  updateCastrStream(input: $input) {\n    message\n    skippedPlatformIds\n  }\n}\n"
  }
};
})();

(node as any).hash = "3776829329a00dbea3d372c1bb1422a2";

export default node;
