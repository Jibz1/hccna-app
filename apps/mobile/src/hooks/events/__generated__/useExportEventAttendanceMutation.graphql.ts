/**
 * @generated SignedSource<<7b301032e8a4de11873a8ebfb60fcef1>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type AttendanceExportFormat = "CSV" | "PDF" | "%future added value";
export type EventAttendanceExportEventInput = {
  eventId: string;
};
export type useExportEventAttendanceMutation$variables = {
  format?: AttendanceExportFormat | null | undefined;
  input: ReadonlyArray<EventAttendanceExportEventInput>;
  occurrenceDate: string;
};
export type useExportEventAttendanceMutation$data = {
  readonly exportEventAttendancePdf: {
    readonly dataHash: string | null | undefined;
    readonly exportKey: string | null | undefined;
    readonly format: AttendanceExportFormat | null | undefined;
    readonly generated: boolean | null | undefined;
    readonly lastGeneratedAt: any | null | undefined;
    readonly url: string | null | undefined;
  } | null | undefined;
};
export type useExportEventAttendanceMutation = {
  response: useExportEventAttendanceMutation$data;
  variables: useExportEventAttendanceMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "format"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "input"
},
v2 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "occurrenceDate"
},
v3 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "format",
        "variableName": "format"
      },
      {
        "kind": "Variable",
        "name": "input",
        "variableName": "input"
      },
      {
        "kind": "Variable",
        "name": "occurrenceDate",
        "variableName": "occurrenceDate"
      }
    ],
    "concreteType": "AttendancePdfExportResult",
    "kind": "LinkedField",
    "name": "exportEventAttendancePdf",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "dataHash",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "exportKey",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "format",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "generated",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "lastGeneratedAt",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "url",
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
      (v1/*:: as any*/),
      (v2/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "useExportEventAttendanceMutation",
    "selections": (v3/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v1/*:: as any*/),
      (v2/*:: as any*/),
      (v0/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "useExportEventAttendanceMutation",
    "selections": (v3/*:: as any*/)
  },
  "params": {
    "cacheID": "92ffa5aab8baba0ffd5c39a8c0ddfd2c",
    "id": null,
    "metadata": {},
    "name": "useExportEventAttendanceMutation",
    "operationKind": "mutation",
    "text": "mutation useExportEventAttendanceMutation(\n  $input: [EventAttendanceExportEventInput!]!\n  $occurrenceDate: String!\n  $format: AttendanceExportFormat\n) {\n  exportEventAttendancePdf(input: $input, occurrenceDate: $occurrenceDate, format: $format) {\n    dataHash\n    exportKey\n    format\n    generated\n    lastGeneratedAt\n    url\n  }\n}\n"
  }
};
})();

(node as any).hash = "a0bc4393643ff55805c68d9c8c7cd356";

export default node;
