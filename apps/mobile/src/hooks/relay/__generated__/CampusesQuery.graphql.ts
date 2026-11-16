/**
 * @generated SignedSource<<f508d50e3eaf93987e5b3301f9a68b3c>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type CampusesQuery$variables = {
  preferredCampus?: string | null | undefined;
};
export type CampusesQuery$data = {
  readonly campusesV2: {
    readonly __typename: "CampusesFetchError";
    readonly message: string | null | undefined;
  } | {
    readonly __typename: "CampusesNotFoundError";
    readonly message: string | null | undefined;
  } | {
    readonly __typename: "CampusesSuccess";
    readonly campuses: ReadonlyArray<{
      readonly campusLead: {
        readonly image: string | null | undefined;
        readonly name: string | null | undefined;
        readonly subTitle: string | null | undefined;
      } | null | undefined;
      readonly campusLeads: ReadonlyArray<{
        readonly image: string | null | undefined;
        readonly leadershipGroup: string | null | undefined;
        readonly name: string | null | undefined;
        readonly slug: string | null | undefined;
      }> | null | undefined;
      readonly campusName: string | null | undefined;
      readonly cityState: string | null | undefined;
      readonly content: any | null | undefined;
      readonly facebook: string | null | undefined;
      readonly giving: string | null | undefined;
      readonly givingPlatforms: ReadonlyArray<{
        readonly icon: string | null | undefined;
        readonly link: string | null | undefined;
        readonly text: string | null | undefined;
        readonly title: string | null | undefined;
      }> | null | undefined;
      readonly image: string | null | undefined;
      readonly instagram: string | null | undefined;
      readonly isPreferred: boolean;
      readonly location: string | null | undefined;
      readonly slug: string;
      readonly streamLink: string | null | undefined;
    }>;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  } | null | undefined;
};
export type CampusesQuery = {
  response: CampusesQuery$data;
  variables: CampusesQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "preferredCampus"
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
  "name": "image",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v4 = [
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "message",
    "storageKey": null
  }
],
v5 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "preferredCampus",
        "variableName": "preferredCampus"
      }
    ],
    "concreteType": null,
    "kind": "LinkedField",
    "name": "campusesV2",
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
            "concreteType": "Campus",
            "kind": "LinkedField",
            "name": "campuses",
            "plural": true,
            "selections": [
              (v1/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "content",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "campusName",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "facebook",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "instagram",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "giving",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "concreteType": "GivingPlatform",
                "kind": "LinkedField",
                "name": "givingPlatforms",
                "plural": true,
                "selections": [
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "icon",
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
                    "name": "title",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "text",
                    "storageKey": null
                  }
                ],
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "location",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "isPreferred",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "cityState",
                "storageKey": null
              },
              (v2/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "streamLink",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "concreteType": "CampusLead",
                "kind": "LinkedField",
                "name": "campusLead",
                "plural": false,
                "selections": [
                  (v3/*:: as any*/),
                  (v2/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "subTitle",
                    "storageKey": null
                  }
                ],
                "storageKey": null
              },
              {
                "alias": "campusLeads",
                "args": null,
                "concreteType": "LeadPastor",
                "kind": "LinkedField",
                "name": "leadPastor",
                "plural": true,
                "selections": [
                  (v1/*:: as any*/),
                  (v3/*:: as any*/),
                  (v2/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "leadershipGroup",
                    "storageKey": null
                  }
                ],
                "storageKey": null
              }
            ],
            "storageKey": null
          }
        ],
        "type": "CampusesSuccess",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": (v4/*:: as any*/),
        "type": "CampusesFetchError",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": (v4/*:: as any*/),
        "type": "CampusesNotFoundError",
        "abstractKey": null
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
    "name": "CampusesQuery",
    "selections": (v5/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "CampusesQuery",
    "selections": (v5/*:: as any*/)
  },
  "params": {
    "cacheID": "999fd3716c0bbca0a830ab973324aa94",
    "id": null,
    "metadata": {},
    "name": "CampusesQuery",
    "operationKind": "query",
    "text": "query CampusesQuery(\n  $preferredCampus: String\n) {\n  campusesV2(preferredCampus: $preferredCampus) {\n    __typename\n    ... on CampusesSuccess {\n      campuses {\n        slug\n        content\n        campusName\n        facebook\n        instagram\n        giving\n        givingPlatforms {\n          icon\n          link\n          title\n          text\n        }\n        location\n        isPreferred\n        cityState\n        image\n        streamLink\n        campusLead {\n          name\n          image\n          subTitle\n        }\n        campusLeads: leadPastor {\n          slug\n          name\n          image\n          leadershipGroup\n        }\n      }\n    }\n    ... on CampusesFetchError {\n      message\n    }\n    ... on CampusesNotFoundError {\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "7cce06b3bc08065aadf75d2e1023b1b3";

export default node;
