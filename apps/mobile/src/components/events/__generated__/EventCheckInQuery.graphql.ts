/**
 * @generated SignedSource<<caf5f8edfbf09161567c3bc20b485879>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type EventCheckInQuery$variables = {
  ccbEventId: string;
  ccbGroupId: string;
};
export type EventCheckInQuery$data = {
  readonly eventWithAttendance: {
    readonly attendanceRecord: {
      readonly attendee: ReadonlyArray<string> | null | undefined;
      readonly notes: string | null | undefined;
      readonly topic: string | null | undefined;
    } | null | undefined;
    readonly attendanceRecordDate: string | null | undefined;
    readonly attendees: ReadonlyArray<{
      readonly attendeeCCBID: string | null | undefined;
      readonly attendeeName: string | null | undefined;
    }> | null | undefined;
    readonly ccbEventId: string | null | undefined;
    readonly ccbGroupId: string | null | undefined;
  } | null | undefined;
};
export type EventCheckInQuery = {
  response: EventCheckInQuery$data;
  variables: EventCheckInQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "ccbEventId"
  },
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "ccbGroupId"
  }
],
v1 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "ccbGroupId",
        "variableName": "ccbGroupId"
      },
      {
        "kind": "Variable",
        "name": "eventID",
        "variableName": "ccbEventId"
      }
    ],
    "concreteType": "AttendandedEvent",
    "kind": "LinkedField",
    "name": "eventWithAttendance",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": "EventAttendee",
        "kind": "LinkedField",
        "name": "attendees",
        "plural": true,
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "attendeeCCBID",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "attendeeName",
            "storageKey": null
          }
        ],
        "storageKey": null
      },
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
        "name": "attendanceRecordDate",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "AttendanceRecord",
        "kind": "LinkedField",
        "name": "attendanceRecord",
        "plural": false,
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "attendee",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "notes",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "topic",
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
    "name": "EventCheckInQuery",
    "selections": (v1/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "EventCheckInQuery",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "021a3d906b0d1b26723686ea57d8055e",
    "id": null,
    "metadata": {},
    "name": "EventCheckInQuery",
    "operationKind": "query",
    "text": "query EventCheckInQuery(\n  $ccbEventId: String!\n  $ccbGroupId: String!\n) {\n  eventWithAttendance(ccbGroupId: $ccbGroupId, eventID: $ccbEventId) {\n    attendees {\n      attendeeCCBID\n      attendeeName\n    }\n    ccbEventId\n    ccbGroupId\n    attendanceRecordDate\n    attendanceRecord {\n      attendee\n      notes\n      topic\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "689ec8a5e7c73c5516ef5ced22833439";

export default node;
