/**
 * @generated SignedSource<<1dace94c2765b25f1c659eec34aed2b2>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type UserGivingQuery$variables = Record<PropertyKey, never>;
export type UserGivingQuery$data = {
  readonly myGivingHistory: {
    readonly __typename: "MyGivingHistoryFetchError";
    readonly message: string | null | undefined;
  } | {
    readonly __typename: "MyGivingHistoryNotFoundError";
    readonly message: string | null | undefined;
  } | {
    readonly __typename: "MyGivingHistorySuccess";
    readonly years: ReadonlyArray<{
      readonly ccbId: string | null | undefined;
      readonly giving: ReadonlyArray<{
        readonly amount: number | null | undefined;
        readonly campus: string | null | undefined;
        readonly campusId: string | null | undefined;
        readonly date: string | null | undefined;
        readonly name: string | null | undefined;
        readonly paymentType: string | null | undefined;
        readonly taxDeductible: boolean | null | undefined;
        readonly transactionId: string | null | undefined;
      }> | null | undefined;
      readonly groupGivingByMonth: ReadonlyArray<{
        readonly givingList: ReadonlyArray<{
          readonly amount: number | null | undefined;
          readonly campus: string | null | undefined;
          readonly campusId: string | null | undefined;
          readonly date: string | null | undefined;
          readonly name: string | null | undefined;
          readonly paymentType: string | null | undefined;
          readonly taxDeductible: boolean | null | undefined;
          readonly transactionId: string | null | undefined;
        }> | null | undefined;
        readonly month: string | null | undefined;
        readonly number: number | null | undefined;
        readonly total: number | null | undefined;
      }> | null | undefined;
      readonly numberOfGiving: number | null | undefined;
      readonly total: number | null | undefined;
      readonly year: number | null | undefined;
    }> | null | undefined;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  } | null | undefined;
};
export type UserGivingQuery = {
  response: UserGivingQuery$data;
  variables: UserGivingQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "total",
  "storageKey": null
},
v1 = [
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "amount",
    "storageKey": null
  },
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "campus",
    "storageKey": null
  },
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "campusId",
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
    "name": "name",
    "storageKey": null
  },
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "paymentType",
    "storageKey": null
  },
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "taxDeductible",
    "storageKey": null
  },
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "transactionId",
    "storageKey": null
  }
],
v2 = [
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "message",
    "storageKey": null
  }
],
v3 = [
  {
    "alias": null,
    "args": null,
    "concreteType": null,
    "kind": "LinkedField",
    "name": "myGivingHistory",
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
            "concreteType": "UserPreviousFiveYearsDonations",
            "kind": "LinkedField",
            "name": "years",
            "plural": true,
            "selections": [
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "ccbId",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "numberOfGiving",
                "storageKey": null
              },
              (v0/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "year",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "concreteType": "UserDonation",
                "kind": "LinkedField",
                "name": "giving",
                "plural": true,
                "selections": (v1/*:: as any*/),
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "concreteType": "MonthlyGivingGroup",
                "kind": "LinkedField",
                "name": "groupGivingByMonth",
                "plural": true,
                "selections": [
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
                    "concreteType": "UserDonation",
                    "kind": "LinkedField",
                    "name": "givingList",
                    "plural": true,
                    "selections": (v1/*:: as any*/),
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "number",
                    "storageKey": null
                  },
                  (v0/*:: as any*/)
                ],
                "storageKey": null
              }
            ],
            "storageKey": null
          }
        ],
        "type": "MyGivingHistorySuccess",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": (v2/*:: as any*/),
        "type": "MyGivingHistoryFetchError",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": (v2/*:: as any*/),
        "type": "MyGivingHistoryNotFoundError",
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
    "name": "UserGivingQuery",
    "selections": (v3/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "UserGivingQuery",
    "selections": (v3/*:: as any*/)
  },
  "params": {
    "cacheID": "dc9ae5e7963261fa5bb979d4d6ad0828",
    "id": null,
    "metadata": {},
    "name": "UserGivingQuery",
    "operationKind": "query",
    "text": "query UserGivingQuery {\n  myGivingHistory {\n    __typename\n    ... on MyGivingHistorySuccess {\n      years {\n        ccbId\n        numberOfGiving\n        total\n        year\n        giving {\n          amount\n          campus\n          campusId\n          date\n          name\n          paymentType\n          taxDeductible\n          transactionId\n        }\n        groupGivingByMonth {\n          month\n          givingList {\n            amount\n            campus\n            campusId\n            date\n            name\n            paymentType\n            taxDeductible\n            transactionId\n          }\n          number\n          total\n        }\n      }\n    }\n    ... on MyGivingHistoryFetchError {\n      message\n    }\n    ... on MyGivingHistoryNotFoundError {\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "9ff25f830397e55d42c1091f6627e858";

export default node;
