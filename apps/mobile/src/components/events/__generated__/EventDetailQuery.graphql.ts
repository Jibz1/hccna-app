/**
 * @generated SignedSource<<aabd5932298b9d59b2457fec2ab24180>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type EventDetailQuery$variables = {
  campusSlug: string;
  slug: string;
};
export type EventDetailQuery$data = {
  readonly events: ReadonlyArray<{
    readonly content: any | null | undefined;
    readonly description: string | null | undefined;
    readonly eventDate: string | null | undefined;
    readonly eventImageUrl: string | null | undefined;
    readonly eventMonth: string | null | undefined;
    readonly eventSpeakers: ReadonlyArray<{
      readonly fullName: string | null | undefined;
      readonly image: string | null | undefined;
    }> | null | undefined;
    readonly eventTime: string | null | undefined;
    readonly eventTitle: string | null | undefined;
    readonly pageName: string | null | undefined;
    readonly pageTitle: string | null | undefined;
    readonly reoccurring: string | null | undefined;
    readonly room: string | null | undefined;
    readonly sessions: ReadonlyArray<{
      readonly id: string;
      readonly label: string | null | undefined;
      readonly startsAt: any;
    }>;
    readonly slug: string | null | undefined;
    readonly zoomLink: string | null | undefined;
  }> | null | undefined;
};
export type EventDetailQuery = {
  response: EventDetailQuery$data;
  variables: EventDetailQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "campusSlug"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "slug"
},
v2 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "campusSlug",
        "variableName": "campusSlug"
      },
      {
        "kind": "Variable",
        "name": "slug",
        "variableName": "slug"
      }
    ],
    "concreteType": "Event",
    "kind": "LinkedField",
    "name": "events",
    "plural": true,
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
        "name": "eventDate",
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
        "name": "eventTime",
        "storageKey": null
      },
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
        "name": "pageTitle",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "reoccurring",
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
        "kind": "ScalarField",
        "name": "eventMonth",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "pageName",
        "storageKey": null
      },
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
        "concreteType": "EventSession",
        "kind": "LinkedField",
        "name": "sessions",
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
            "name": "startsAt",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "label",
            "storageKey": null
          }
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "zoomLink",
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
            "name": "fullName",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "image",
            "storageKey": null
          }
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "room",
        "storageKey": null
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "EventDetailQuery",
    "selections": (v2/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v1/*:: as any*/),
      (v0/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "EventDetailQuery",
    "selections": (v2/*:: as any*/)
  },
  "params": {
    "cacheID": "153ae67482e1ce27554d0b64445b5b32",
    "id": null,
    "metadata": {},
    "name": "EventDetailQuery",
    "operationKind": "query",
    "text": "query EventDetailQuery(\n  $slug: String!\n  $campusSlug: String!\n) {\n  events(slug: $slug, campusSlug: $campusSlug) {\n    description\n    eventDate\n    eventImageUrl\n    eventTime\n    eventTitle\n    pageTitle\n    reoccurring\n    slug\n    eventMonth\n    pageName\n    content\n    sessions {\n      id\n      startsAt\n      label\n    }\n    zoomLink\n    eventSpeakers {\n      fullName\n      image\n    }\n    room\n  }\n}\n"
  }
};
})();

(node as any).hash = "2add5d1afe87c15dd2af083b80ea5823";

export default node;
