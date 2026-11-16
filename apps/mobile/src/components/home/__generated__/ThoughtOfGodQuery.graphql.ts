/**
 * @generated SignedSource<<7e4beb7945aa7905e9e87be953b6c37e>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type ThoughtOfGodQuery$variables = Record<PropertyKey, never>;
export type ThoughtOfGodQuery$data = {
  readonly thoughtOfGod: {
    readonly description: string;
    readonly thumbnail: string | null | undefined;
    readonly title: string;
  } | null | undefined;
};
export type ThoughtOfGodQuery = {
  response: ThoughtOfGodQuery$data;
  variables: ThoughtOfGodQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "ThoughtOfGodPage",
    "kind": "LinkedField",
    "name": "thoughtOfGod",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "description",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "thumbnail",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "title",
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
    "name": "ThoughtOfGodQuery",
    "selections": (v0/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "ThoughtOfGodQuery",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "666d415285cc2cd1cc1a2538b994e3d2",
    "id": null,
    "metadata": {},
    "name": "ThoughtOfGodQuery",
    "operationKind": "query",
    "text": "query ThoughtOfGodQuery {\n  thoughtOfGod {\n    description\n    thumbnail\n    title\n  }\n}\n"
  }
};
})();

(node as any).hash = "2d8c90c4ff11344c60a4e9071b71f17d";

export default node;
