/**
 * @generated SignedSource<<976d4450a55a749f83598856692360c7>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type ExportEventAttendanceQuery$variables = Record<PropertyKey, never>;
export type ExportEventAttendanceQuery$data = {
  readonly exportAttendance: {
    readonly exportAttendanceEvent: ReadonlyArray<{
      readonly attendanceEventCCBID: string | null | undefined;
      readonly attendanceEventName: string | null | undefined;
    }> | null | undefined;
  } | null | undefined;
};
export type ExportEventAttendanceQuery = {
  response: ExportEventAttendanceQuery$data;
  variables: ExportEventAttendanceQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
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
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "ExportEventAttendanceQuery",
    "selections": (v0/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "ExportEventAttendanceQuery",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "a74ee5e3f91c43889a535ce86ea11992",
    "id": null,
    "metadata": {},
    "name": "ExportEventAttendanceQuery",
    "operationKind": "query",
    "text": "query ExportEventAttendanceQuery {\n  exportAttendance {\n    exportAttendanceEvent {\n      attendanceEventCCBID\n      attendanceEventName\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "5b400734bd3adf12c8734f67e78c2a6f";

export default node;
