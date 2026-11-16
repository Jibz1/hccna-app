/**
 * @generated SignedSource<<9cb88d7a1d5024ecc2f461881171781c>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type LatestEventsQuery$variables = {
  campusSlug: string;
};
export type LatestEventsQuery$data = {
  readonly upcomingEventsByMonth: {
    readonly __typename: "UpcomingEventsByMonthFetchError";
    readonly message: string | null | undefined;
  } | {
    readonly __typename: "UpcomingEventsByMonthSuccess";
    readonly months: ReadonlyArray<{
      readonly events: ReadonlyArray<{
        readonly description: string | null | undefined;
        readonly eventDate: string | null | undefined;
        readonly eventSpeakers: ReadonlyArray<{
          readonly image: string | null | undefined;
        }> | null | undefined;
        readonly eventTitle: string | null | undefined;
        readonly slug: string | null | undefined;
      }> | null | undefined;
      readonly month: string | null | undefined;
      readonly year: number | null | undefined;
    }> | null | undefined;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  } | null | undefined;
};
export type LatestEventsQuery = {
  response: LatestEventsQuery$data;
  variables: LatestEventsQuery$variables;
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
    "args": [
      {
        "kind": "Variable",
        "name": "campusSlug",
        "variableName": "campusSlug"
      }
    ],
    "concreteType": null,
    "kind": "LinkedField",
    "name": "upcomingEventsByMonth",
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
            "concreteType": "EventMonthGroup",
            "kind": "LinkedField",
            "name": "months",
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
                "kind": "ScalarField",
                "name": "year",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "concreteType": "Event",
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
                    "name": "eventDate",
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
                    "name": "slug",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "EventSpeaker",
                    "kind": "LinkedField",
                    "name": "eventSpeakers",
                    "plural": true,
                    "selections": [
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "image",
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
        ],
        "type": "UpcomingEventsByMonthSuccess",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "message",
            "storageKey": null
          }
        ],
        "type": "UpcomingEventsByMonthFetchError",
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
    "name": "LatestEventsQuery",
    "selections": (v1/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "LatestEventsQuery",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "9d315cf0405ddfb150d953c97e52cc5c",
    "id": null,
    "metadata": {},
    "name": "LatestEventsQuery",
    "operationKind": "query",
    "text": "query LatestEventsQuery(\n  $campusSlug: String!\n) {\n  upcomingEventsByMonth(campusSlug: $campusSlug) {\n    __typename\n    ... on UpcomingEventsByMonthSuccess {\n      months {\n        month\n        year\n        events {\n          eventTitle\n          eventDate\n          description\n          slug\n          eventSpeakers {\n            image\n          }\n        }\n      }\n    }\n    ... on UpcomingEventsByMonthFetchError {\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "65657d1fbbcf4c84bb4accb5583f58ff";

export default node;
