/**
 * @generated SignedSource<<c92ee72cafe85e1de3d2a08fc3696067>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type CCBFormsQuery$variables = Record<PropertyKey, never>;
export type CCBFormsQuery$data = {
  readonly ccbFormsV2: {
    readonly __typename: "CCBFormsFetchError";
    readonly message: string | null | undefined;
  } | {
    readonly __typename: "CCBFormsNotFoundError";
    readonly message: string | null | undefined;
  } | {
    readonly __typename: "CCBFormsSuccess";
    readonly forms: ReadonlyArray<{
      readonly title: string | null | undefined;
      readonly url: string | null | undefined;
    }> | null | undefined;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  } | null | undefined;
};
export type CCBFormsQuery = {
  response: CCBFormsQuery$data;
  variables: CCBFormsQuery$variables;
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
    "name": "ccbFormsV2",
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
            "concreteType": "CCBForm",
            "kind": "LinkedField",
            "name": "forms",
            "plural": true,
            "selections": [
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
                "name": "url",
                "storageKey": null
              }
            ],
            "storageKey": null
          }
        ],
        "type": "CCBFormsSuccess",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": (v0/*:: as any*/),
        "type": "CCBFormsFetchError",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": (v0/*:: as any*/),
        "type": "CCBFormsNotFoundError",
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
    "name": "CCBFormsQuery",
    "selections": (v1/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "CCBFormsQuery",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "da6026c556c8107a5e216e37d42bc2b8",
    "id": null,
    "metadata": {},
    "name": "CCBFormsQuery",
    "operationKind": "query",
    "text": "query CCBFormsQuery {\n  ccbFormsV2 {\n    __typename\n    ... on CCBFormsSuccess {\n      forms {\n        title\n        url\n      }\n    }\n    ... on CCBFormsFetchError {\n      message\n    }\n    ... on CCBFormsNotFoundError {\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "3fd2a5d68a0849df4d87afb33785b171";

export default node;
