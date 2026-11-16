/**
 * @generated SignedSource<<52749e67fdc6ac7afa68162515a457b6>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type LatestSermonsQuery$variables = Record<PropertyKey, never>;
export type LatestSermonsQuery$data = {
  readonly sermons: {
    readonly edges: ReadonlyArray<{
      readonly node: {
        readonly slug: string | null | undefined;
        readonly speakerFullName: string | null | undefined;
        readonly speakerImage: string | null | undefined;
        readonly thumbnail: string | null | undefined;
        readonly title: string | null | undefined;
        readonly youtubeLink: string | null | undefined;
      } | null | undefined;
    }> | null | undefined;
  } | null | undefined;
};
export type LatestSermonsQuery = {
  response: LatestSermonsQuery$data;
  variables: LatestSermonsQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "kind": "Literal",
    "name": "first",
    "value": 3
  }
],
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "slug",
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
  "name": "thumbnail",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "speakerFullName",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "speakerImage",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "youtubeLink",
  "storageKey": null
};
return {
  "fragment": {
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "LatestSermonsQuery",
    "selections": [
      {
        "alias": null,
        "args": (v0/*:: as any*/),
        "concreteType": "SermonConnection",
        "kind": "LinkedField",
        "name": "sermons",
        "plural": false,
        "selections": [
          {
            "alias": null,
            "args": null,
            "concreteType": "SermonEdge",
            "kind": "LinkedField",
            "name": "edges",
            "plural": true,
            "selections": [
              {
                "alias": null,
                "args": null,
                "concreteType": "Sermon",
                "kind": "LinkedField",
                "name": "node",
                "plural": false,
                "selections": [
                  (v1/*:: as any*/),
                  (v2/*:: as any*/),
                  (v3/*:: as any*/),
                  (v4/*:: as any*/),
                  (v5/*:: as any*/),
                  (v6/*:: as any*/)
                ],
                "storageKey": null
              }
            ],
            "storageKey": null
          }
        ],
        "storageKey": "sermons(first:3)"
      }
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "LatestSermonsQuery",
    "selections": [
      {
        "alias": null,
        "args": (v0/*:: as any*/),
        "concreteType": "SermonConnection",
        "kind": "LinkedField",
        "name": "sermons",
        "plural": false,
        "selections": [
          {
            "alias": null,
            "args": null,
            "concreteType": "SermonEdge",
            "kind": "LinkedField",
            "name": "edges",
            "plural": true,
            "selections": [
              {
                "alias": null,
                "args": null,
                "concreteType": "Sermon",
                "kind": "LinkedField",
                "name": "node",
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
                    "kind": "ScalarField",
                    "name": "id",
                    "storageKey": null
                  }
                ],
                "storageKey": null
              }
            ],
            "storageKey": null
          }
        ],
        "storageKey": "sermons(first:3)"
      }
    ]
  },
  "params": {
    "cacheID": "b3879daf97678c2cc4a0db558b674f25",
    "id": null,
    "metadata": {},
    "name": "LatestSermonsQuery",
    "operationKind": "query",
    "text": "query LatestSermonsQuery {\n  sermons(first: 3) {\n    edges {\n      node {\n        slug\n        title\n        thumbnail\n        speakerFullName\n        speakerImage\n        youtubeLink\n        id\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "0b7e2468f5157e9bb1332c5954e8b962";

export default node;
