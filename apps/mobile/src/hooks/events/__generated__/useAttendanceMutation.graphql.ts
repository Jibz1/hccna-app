/**
 * @generated SignedSource<<06c1af6f7107e4dc8c7e8520d664d80e>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type UpdateEventAttendanceInput = {
  attendeesIds: ReadonlyArray<string>;
  eventId: string;
  notes: string;
  topic: string;
};
export type useAttendanceMutation$variables = {
  input: UpdateEventAttendanceInput;
};
export type useAttendanceMutation$data = {
  readonly createEventAttendance: {
    readonly message: string | null | undefined;
    readonly success: boolean | null | undefined;
  } | null | undefined;
};
export type useAttendanceMutation = {
  response: useAttendanceMutation$data;
  variables: useAttendanceMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "input"
  }
],
v1 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "input",
        "variableName": "input"
      }
    ],
    "concreteType": "UpdateEventAttendanceResult",
    "kind": "LinkedField",
    "name": "createEventAttendance",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "message",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "success",
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
    "name": "useAttendanceMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "useAttendanceMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "1dbaac654dd40d530363d310412acda8",
    "id": null,
    "metadata": {},
    "name": "useAttendanceMutation",
    "operationKind": "mutation",
    "text": "mutation useAttendanceMutation(\n  $input: UpdateEventAttendanceInput!\n) {\n  createEventAttendance(input: $input) {\n    message\n    success\n  }\n}\n"
  }
};
})();

(node as any).hash = "7b71bf057745aea74a80641b2a666e62";

export default node;
