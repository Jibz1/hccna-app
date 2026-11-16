/**
 * @generated SignedSource<<44e42369c9971d6d5f6b113afeceec00>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type ExportEventAttendanceModalQuery$variables = Record<PropertyKey, never>;
export type ExportEventAttendanceModalQuery$data = {
  readonly exportAttendance: {
    readonly exportAttendanceEvent: ReadonlyArray<{
      readonly attendanceEventCCBID: string | null | undefined;
      readonly attendanceEventName: string | null | undefined;
    }> | null | undefined;
  } | null | undefined;
};
export type ExportEventAttendanceModalQuery = {
  response: ExportEventAttendanceModalQuery$data;
  variables: ExportEventAttendanceModalQuery$variables;
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
    "name": "ExportEventAttendanceModalQuery",
    "selections": (v0/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "ExportEventAttendanceModalQuery",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "ee122abce353e159a59df11f874e03ec",
    "id": null,
    "metadata": {},
    "name": "ExportEventAttendanceModalQuery",
    "operationKind": "query",
    "text": "query ExportEventAttendanceModalQuery {\n  exportAttendance {\n    exportAttendanceEvent {\n      attendanceEventCCBID\n      attendanceEventName\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "f33cfa3dc7f65607974744f08b1fb53d";

export default node;
