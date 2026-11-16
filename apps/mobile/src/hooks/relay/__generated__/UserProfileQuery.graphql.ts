/**
 * @generated SignedSource<<72c4fed69417f85341eb3c9ea3f076da>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type UserProfileQuery$variables = Record<PropertyKey, never>;
export type UserProfileQuery$data = {
  readonly user: {
    readonly profile: {
      readonly campusPreferenceVersion: number;
      readonly ccbFamilyId: string | null | undefined;
      readonly ccbId: string | null | undefined;
      readonly createdAt: string | null | undefined;
      readonly departments: ReadonlyArray<{
        readonly ccbId: string | null | undefined;
        readonly description: string | null | undefined;
        readonly fullName: string | null | undefined;
        readonly image: string | null | undefined;
        readonly link: string | null | undefined;
        readonly name: string | null | undefined;
        readonly slug: string | null | undefined;
      }> | null | undefined;
      readonly email: string | null | undefined;
      readonly enrichmentPending: boolean;
      readonly firstName: string | null | undefined;
      readonly img: string | null | undefined;
      readonly isVerified: boolean | null | undefined;
      readonly lastName: string | null | undefined;
      readonly phone: string | null | undefined;
      readonly preferredCampusSlug: string | null | undefined;
      readonly provider: string | null | undefined;
      readonly uid: string | null | undefined;
    } | null | undefined;
  };
};
export type UserProfileQuery = {
  response: UserProfileQuery$data;
  variables: UserProfileQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "ccbId",
  "storageKey": null
},
v1 = [
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
        "concreteType": "UserProfile",
        "kind": "LinkedField",
        "name": "profile",
        "plural": false,
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "ccbFamilyId",
            "storageKey": null
          },
          (v0/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "createdAt",
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
            "name": "enrichmentPending",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "firstName",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "img",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "isVerified",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "lastName",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "phone",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "provider",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "uid",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "preferredCampusSlug",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "campusPreferenceVersion",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "Department",
            "kind": "LinkedField",
            "name": "departments",
            "plural": true,
            "selections": [
              (v0/*:: as any*/),
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
                "name": "fullName",
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
                "name": "link",
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
                "name": "slug",
                "storageKey": null
              }
            ],
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
    "name": "UserProfileQuery",
    "selections": (v1/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "UserProfileQuery",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "e5c835c9ca1bf4e6401f0753f5cdefd7",
    "id": null,
    "metadata": {},
    "name": "UserProfileQuery",
    "operationKind": "query",
    "text": "query UserProfileQuery {\n  user {\n    profile {\n      ccbFamilyId\n      ccbId\n      createdAt\n      email\n      enrichmentPending\n      firstName\n      img\n      isVerified\n      lastName\n      phone\n      provider\n      uid\n      preferredCampusSlug\n      campusPreferenceVersion\n      departments {\n        ccbId\n        description\n        fullName\n        image\n        link\n        name\n        slug\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "ab4605a7274d9c8a9a8643da98f63e1f";

export default node;
