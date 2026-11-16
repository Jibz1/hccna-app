/**
 * @generated SignedSource<<55e445141badf7b10c5e86be7ab79114>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type FeaturedEventsQuery$variables = {
  campusSlug: string;
};
export type FeaturedEventsQuery$data = {
  readonly featuredEvents: {
    readonly __typename: "FeaturedEventsFetchError";
    readonly message: string | null | undefined;
  } | {
    readonly __typename: "FeaturedEventsNotFoundError";
    readonly message: string | null | undefined;
  } | {
    readonly __typename: "FeaturedEventsSuccess";
    readonly events: ReadonlyArray<{
      readonly description: string | null | undefined;
      readonly eventImageUrl: string | null | undefined;
      readonly eventTitle: string | null | undefined;
      readonly pageLink: string | null | undefined;
      readonly prominentColors: {
        readonly accent: string;
        readonly dark: string;
        readonly light: string;
      } | null | undefined;
      readonly slug: string | null | undefined;
    }> | null | undefined;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  } | null | undefined;
};
export type FeaturedEventsQuery = {
  response: FeaturedEventsQuery$data;
  variables: FeaturedEventsQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "campusSlug"
  }
],
v1 = [
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "message",
    "storageKey": null
  }
],
v2 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "campusSlug",
        "variableName": "campusSlug"
      }
    ],
    "concreteType": null,
    "kind": "LinkedField",
    "name": "featuredEvents",
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
            "concreteType": "FeaturedEvents",
            "kind": "LinkedField",
            "name": "events",
            "plural": true,
            "selections": [
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "eventTitle",
                "storageKey": null
              },
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
                "name": "eventImageUrl",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "pageLink",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "concreteType": "FeaturedEventProminentColors",
                "kind": "LinkedField",
                "name": "prominentColors",
                "plural": false,
                "selections": [
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "accent",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "dark",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "light",
                    "storageKey": null
                  }
                ],
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
        "type": "FeaturedEventsSuccess",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": (v1/*:: as any*/),
        "type": "FeaturedEventsFetchError",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": (v1/*:: as any*/),
        "type": "FeaturedEventsNotFoundError",
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
    "name": "FeaturedEventsQuery",
    "selections": (v2/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "FeaturedEventsQuery",
    "selections": (v2/*:: as any*/)
  },
  "params": {
    "cacheID": "5595e107e79a9abaea22fed1b38895aa",
    "id": null,
    "metadata": {},
    "name": "FeaturedEventsQuery",
    "operationKind": "query",
    "text": "query FeaturedEventsQuery(\n  $campusSlug: String!\n) {\n  featuredEvents(campusSlug: $campusSlug) {\n    __typename\n    ... on FeaturedEventsSuccess {\n      events {\n        eventTitle\n        description\n        eventImageUrl\n        pageLink\n        prominentColors {\n          accent\n          dark\n          light\n        }\n        slug\n      }\n    }\n    ... on FeaturedEventsFetchError {\n      message\n    }\n    ... on FeaturedEventsNotFoundError {\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "5bed59ab720d8b3dd5c9e50b137f5e28";

export default node;
