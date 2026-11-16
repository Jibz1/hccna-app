/**
 * @generated SignedSource<<9a9cbbeb24dce909528bbbbf3fd31158>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type ThoughtOfGodImplQuery$variables = Record<PropertyKey, never>;
export type ThoughtOfGodImplQuery$data = {
  readonly thoughtOfGod: {
    readonly blogs: ReadonlyArray<{
      readonly date: string;
      readonly description: string;
      readonly link: string;
      readonly thumbnail: string | null | undefined;
      readonly title: string;
    }> | null | undefined;
    readonly description: string;
    readonly thumbnail: string | null | undefined;
    readonly title: string;
    readonly youtube: ReadonlyArray<{
      readonly body: string;
      readonly thumbnail: string | null | undefined;
      readonly title: string;
      readonly youtubeLink: string;
    }> | null | undefined;
  } | null | undefined;
};
export type ThoughtOfGodImplQuery = {
  response: ThoughtOfGodImplQuery$data;
  variables: ThoughtOfGodImplQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "description",
  "storageKey": null
},
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "thumbnail",
  "storageKey": null
},
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "title",
  "storageKey": null
},
v3 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "ThoughtOfGodPage",
    "kind": "LinkedField",
    "name": "thoughtOfGod",
    "plural": false,
    "selections": [
      (v0/*:: as any*/),
      (v1/*:: as any*/),
      (v2/*:: as any*/),
      {
        "alias": null,
        "args": null,
        "concreteType": "ThoughtOfBlog",
        "kind": "LinkedField",
        "name": "blogs",
        "plural": true,
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "date",
            "storageKey": null
          },
          (v0/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "link",
            "storageKey": null
          },
          (v1/*:: as any*/),
          (v2/*:: as any*/)
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "ThoughtOfGodYoutube",
        "kind": "LinkedField",
        "name": "youtube",
        "plural": true,
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "body",
            "storageKey": null
          },
          (v1/*:: as any*/),
          (v2/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "youtubeLink",
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
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "ThoughtOfGodImplQuery",
    "selections": (v3/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "ThoughtOfGodImplQuery",
    "selections": (v3/*:: as any*/)
  },
  "params": {
    "cacheID": "fa77a387a1ef74e8561b763ecd690660",
    "id": null,
    "metadata": {},
    "name": "ThoughtOfGodImplQuery",
    "operationKind": "query",
    "text": "query ThoughtOfGodImplQuery {\n  thoughtOfGod {\n    description\n    thumbnail\n    title\n    blogs {\n      date\n      description\n      link\n      thumbnail\n      title\n    }\n    youtube {\n      body\n      thumbnail\n      title\n      youtubeLink\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "ee2c2d0a8ef7a92435b7233cc9440b10";

export default node;
