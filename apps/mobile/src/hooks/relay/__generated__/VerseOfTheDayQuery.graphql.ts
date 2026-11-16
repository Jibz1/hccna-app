/**
 * @generated SignedSource<<b878001eb9f15cc8cdfd9581278b9359>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type VerseOfTheDayQuery$variables = Record<PropertyKey, never>;
export type VerseOfTheDayQuery$data = {
  readonly verseOfTheDayV2: {
    readonly __typename: "Scripture";
    readonly book: string | null | undefined;
    readonly date: string | null | undefined;
    readonly image: string | null | undefined;
    readonly stBook: string | null | undefined;
    readonly text: string | null | undefined;
    readonly verseId: string | null | undefined;
  } | {
    readonly __typename: "VodFetchError";
    readonly message: string | null | undefined;
  } | {
    readonly __typename: "VodNotFoundError";
    readonly message: string | null | undefined;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  } | null | undefined;
};
export type VerseOfTheDayQuery = {
  response: VerseOfTheDayQuery$data;
  variables: VerseOfTheDayQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "message",
    "storageKey": null
  }
],
v1 = [
  {
    "alias": null,
    "args": null,
    "concreteType": null,
    "kind": "LinkedField",
    "name": "verseOfTheDayV2",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "__typename",
        "storageKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "book",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "date",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "image",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "stBook",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "text",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "verseId",
            "storageKey": null
          }
        ],
        "type": "Scripture",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": (v0/*:: as any*/),
        "type": "VodFetchError",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": (v0/*:: as any*/),
        "type": "VodNotFoundError",
        "abstractKey": null
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
    "name": "VerseOfTheDayQuery",
    "selections": (v1/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "VerseOfTheDayQuery",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "7e02d34f03708f4d13ce1f9bc99d766b",
    "id": null,
    "metadata": {},
    "name": "VerseOfTheDayQuery",
    "operationKind": "query",
    "text": "query VerseOfTheDayQuery {\n  verseOfTheDayV2 {\n    __typename\n    ... on Scripture {\n      book\n      date\n      image\n      stBook\n      text\n      verseId\n    }\n    ... on VodFetchError {\n      message\n    }\n    ... on VodNotFoundError {\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "d5a59ff93b4c2f798fab021c3339ba0a";

export default node;
