/**
 * @generated SignedSource<<81ebfc631c81acc4486631dc56765a59>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type CastrChannelEditorQuery$variables = {
  campusSlug: string;
};
export type CastrChannelEditorQuery$data = {
  readonly castrStream: {
    readonly broadcasting_status: string | null | undefined;
    readonly castrPlayerUrl: string | null | undefined;
    readonly description: string | null | undefined;
    readonly enabled: boolean | null | undefined;
    readonly id: string | null | undefined;
    readonly name: string | null | undefined;
    readonly platforms: ReadonlyArray<{
      readonly broadcasting_status: string | null | undefined;
      readonly channel_name: string | null | undefined;
      readonly description: string | null | undefined;
      readonly enabled: boolean | null | undefined;
      readonly id: string | null | undefined;
      readonly name: string | null | undefined;
      readonly requiresNewStreamKey: boolean | null | undefined;
      readonly stream_key: string | null | undefined;
      readonly template: string | null | undefined;
      readonly title: string | null | undefined;
    }> | null | undefined;
    readonly title: string | null | undefined;
  } | null | undefined;
};
export type CastrChannelEditorQuery = {
  response: CastrChannelEditorQuery$data;
  variables: CastrChannelEditorQuery$variables;
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
  "name": "name",
  "storageKey": null
},
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "title",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "description",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "enabled",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "broadcasting_status",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v7 = [
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
      (v2/*:: as any*/),
      (v3/*:: as any*/),
      (v4/*:: as any*/),
      (v5/*:: as any*/),
      (v6/*:: as any*/),
      {
        "alias": null,
        "args": null,
        "concreteType": "CastrPlatform",
        "kind": "LinkedField",
        "name": "platforms",
        "plural": true,
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "template",
            "storageKey": null
          },
          (v6/*:: as any*/),
          (v5/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "channel_name",
            "storageKey": null
          },
          (v4/*:: as any*/),
          (v1/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "stream_key",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "requiresNewStreamKey",
            "storageKey": null
          },
          (v2/*:: as any*/),
          (v3/*:: as any*/)
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "castrPlayerUrl",
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
    "name": "CastrChannelEditorQuery",
    "selections": (v7/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "CastrChannelEditorQuery",
    "selections": (v7/*:: as any*/)
  },
  "params": {
    "cacheID": "4bfd433bbfa0b71f6f49c726cb619915",
    "id": null,
    "metadata": {},
    "name": "CastrChannelEditorQuery",
    "operationKind": "query",
    "text": "query CastrChannelEditorQuery(\n  $campusSlug: String!\n) {\n  castrStream(campusSlug: $campusSlug) {\n    name\n    title\n    description\n    enabled\n    broadcasting_status\n    id\n    platforms {\n      template\n      id\n      broadcasting_status\n      channel_name\n      enabled\n      name\n      stream_key\n      requiresNewStreamKey\n      title\n      description\n    }\n    castrPlayerUrl\n  }\n}\n"
  }
};
})();

(node as any).hash = "a756878a1d2411ca8b77f442b093b9a3";

export default node;
