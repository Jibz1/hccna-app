/**
 * @generated SignedSource<<785b4fef1e060d7fbae1dcad0863449c>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type UserWoaQuery$variables = Record<PropertyKey, never>;
export type UserWoaQuery$data = {
  readonly user: {
    readonly woa: {
      readonly book: string | null | undefined;
      readonly email: string | null | undefined;
      readonly image: string | null | undefined;
      readonly month: string | null | undefined;
      readonly monthlySub: boolean | null | undefined;
      readonly name: string | null | undefined;
      readonly stBook: string | null | undefined;
      readonly text: string | null | undefined;
      readonly verseId: string | null | undefined;
    } | null | undefined;
  };
};
export type UserWoaQuery = {
  response: UserWoaQuery$data;
  variables: UserWoaQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "User",
    "kind": "LinkedField",
    "name": "user",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": "WordOfActivation",
        "kind": "LinkedField",
        "name": "woa",
        "plural": false,
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
            "name": "email",
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
            "name": "month",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "monthlySub",
            "storageKey": null
          },
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
    "name": "UserWoaQuery",
    "selections": (v0/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "UserWoaQuery",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "5b9a7d789f6da88ed9e085232494399a",
    "id": null,
    "metadata": {},
    "name": "UserWoaQuery",
    "operationKind": "query",
    "text": "query UserWoaQuery {\n  user {\n    woa {\n      book\n      email\n      image\n      month\n      monthlySub\n      name\n      stBook\n      text\n      verseId\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "47e5cd6b51ed204e10ea9a98c8071780";

export default node;
