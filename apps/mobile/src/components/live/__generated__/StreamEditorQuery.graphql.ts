/**
 * @generated SignedSource<<a5acb96805c2855b761a68b6324e7b37>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type StreamEditorQuery$variables = {
  campusSlug: string;
};
export type StreamEditorQuery$data = {
  readonly castrStream: {
    readonly id: string | null | undefined;
    readonly name: string | null | undefined;
    readonly platforms: ReadonlyArray<{
      readonly broadcasting_status: string | null | undefined;
      readonly id: string | null | undefined;
      readonly template: string | null | undefined;
    }> | null | undefined;
    readonly title: string | null | undefined;
  } | null | undefined;
};
export type StreamEditorQuery = {
  response: StreamEditorQuery$data;
  variables: StreamEditorQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "campusSlug"
  }
],
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v2 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "campusSlug",
        "variableName": "campusSlug"
      }
    ],
    "concreteType": "CastrStream",
    "kind": "LinkedField",
    "name": "castrStream",
    "plural": false,
    "selections": [
      (v1/*:: as any*/),
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "name",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "title",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "CastrPlatform",
        "kind": "LinkedField",
        "name": "platforms",
        "plural": true,
        "selections": [
          (v1/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "template",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "broadcasting_status",
            "storageKey": null
          }
        ],
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
    "name": "StreamEditorQuery",
    "selections": (v2/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "StreamEditorQuery",
    "selections": (v2/*:: as any*/)
  },
  "params": {
    "cacheID": "ddce0cab4638b6aeadbb014bb0b6879a",
    "id": null,
    "metadata": {},
    "name": "StreamEditorQuery",
    "operationKind": "query",
    "text": "query StreamEditorQuery(\n  $campusSlug: String!\n) {\n  castrStream(campusSlug: $campusSlug) {\n    id\n    name\n    title\n    platforms {\n      id\n      template\n      broadcasting_status\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "933f5c9d7f6d0c2c2296e869f2b0079e";

export default node;
