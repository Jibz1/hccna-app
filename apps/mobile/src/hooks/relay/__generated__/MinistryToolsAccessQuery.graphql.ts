/**
 * @generated SignedSource<<40cf486d87921af64710aa4475f7a832>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type MinistryToolsAccessQuery$variables = {
  campusSlug: string;
};
export type MinistryToolsAccessQuery$data = {
  readonly castrStream: {
    readonly id: string | null | undefined;
    readonly name: string | null | undefined;
    readonly platforms: ReadonlyArray<{
      readonly id: string | null | undefined;
      readonly template: string | null | undefined;
    }> | null | undefined;
    readonly title: string | null | undefined;
  } | null | undefined;
  readonly exportAttendance: {
    readonly exportAttendanceEvent: ReadonlyArray<{
      readonly attendanceEventCCBID: string | null | undefined;
      readonly attendanceEventName: string | null | undefined;
    }> | null | undefined;
  } | null | undefined;
  readonly kidsEventAttendance: ReadonlyArray<{
    readonly ccbEventId: string | null | undefined;
    readonly ccbGroupId: string | null | undefined;
    readonly eventDescription: string | null | undefined;
    readonly eventName: string | null | undefined;
  } | null | undefined> | null | undefined;
};
export type MinistryToolsAccessQuery = {
  response: MinistryToolsAccessQuery$data;
  variables: MinistryToolsAccessQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "campusSlug"
  }
],
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v2 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "EventAttendance",
    "kind": "LinkedField",
    "name": "kidsEventAttendance",
    "plural": true,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "ccbEventId",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "ccbGroupId",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "eventDescription",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "eventName",
        "storageKey": null
      }
    ],
    "storageKey": null
  },
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "campusSlug",
        "variableName": "campusSlug"
      }
    ],
    "concreteType": "CastrStream",
    "kind": "LinkedField",
    "name": "castrStream",
    "plural": false,
    "selections": [
      (v1/*:: as any*/),
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
        "name": "title",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "CastrPlatform",
        "kind": "LinkedField",
        "name": "platforms",
        "plural": true,
        "selections": [
          (v1/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "template",
            "storageKey": null
          }
        ],
        "storageKey": null
      }
    ],
    "storageKey": null
  },
  {
    "alias": null,
    "args": null,
    "concreteType": "ExportAttendanceResult",
    "kind": "LinkedField",
    "name": "exportAttendance",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": "ExportAttendanceEvent",
        "kind": "LinkedField",
        "name": "exportAttendanceEvent",
        "plural": true,
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "attendanceEventCCBID",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "attendanceEventName",
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
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "MinistryToolsAccessQuery",
    "selections": (v2/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "MinistryToolsAccessQuery",
    "selections": (v2/*:: as any*/)
  },
  "params": {
    "cacheID": "21889b49795e4ffb6dd2becba131096c",
    "id": null,
    "metadata": {},
    "name": "MinistryToolsAccessQuery",
    "operationKind": "query",
    "text": "query MinistryToolsAccessQuery(\n  $campusSlug: String!\n) {\n  kidsEventAttendance {\n    ccbEventId\n    ccbGroupId\n    eventDescription\n    eventName\n  }\n  castrStream(campusSlug: $campusSlug) {\n    id\n    name\n    title\n    platforms {\n      id\n      template\n    }\n  }\n  exportAttendance {\n    exportAttendanceEvent {\n      attendanceEventCCBID\n      attendanceEventName\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "f1bbd182025c52c7d9dc1b9cfce38f7e";

export default node;
