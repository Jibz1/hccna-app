/**
 * @generated SignedSource<<00f07718b98295d6d4a71bc9f387e371>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type ShortsFeedQuery$variables = Record<PropertyKey, never>;
export type ShortsFeedQuery$data = {
  readonly shorts: ReadonlyArray<{
    readonly channelTitle: string;
    readonly curated: boolean;
    readonly id: string;
    readonly thumbnail: string | null | undefined;
    readonly title: string;
    readonly videoId: string;
  }>;
};
export type ShortsFeedQuery = {
  response: ShortsFeedQuery$data;
  variables: ShortsFeedQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "Short",
    "kind": "LinkedField",
    "name": "shorts",
    "plural": true,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "id",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "videoId",
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
        "kind": "ScalarField",
        "name": "channelTitle",
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
        "name": "curated",
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
    "name": "ShortsFeedQuery",
    "selections": (v0/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "ShortsFeedQuery",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "9d271c02e57ebdef013bcf26d967e6aa",
    "id": null,
    "metadata": {},
    "name": "ShortsFeedQuery",
    "operationKind": "query",
    "text": "query ShortsFeedQuery {\n  shorts {\n    id\n    videoId\n    title\n    channelTitle\n    thumbnail\n    curated\n  }\n}\n"
  }
};
})();

(node as any).hash = "278f86fe7e295f4bb32bff2d8b78cee1";

export default node;
