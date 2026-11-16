/**
 * @generated SignedSource<<a2c105504c37128c9d13f4106c715bdb>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type EventAttendancesQuery$variables = Record<PropertyKey, never>;
export type EventAttendancesQuery$data = {
  readonly kidsEventAttendance: ReadonlyArray<{
    readonly ccbEventId: string | null | undefined;
    readonly ccbGroupId: string | null | undefined;
    readonly eventDescription: string | null | undefined;
    readonly eventName: string | null | undefined;
  } | null | undefined> | null | undefined;
};
export type EventAttendancesQuery = {
  response: EventAttendancesQuery$data;
  variables: EventAttendancesQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
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
  }
];
return {
  "fragment": {
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "EventAttendancesQuery",
    "selections": (v0/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "EventAttendancesQuery",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "566018f88c73775e77ee9cbce245a128",
    "id": null,
    "metadata": {},
    "name": "EventAttendancesQuery",
    "operationKind": "query",
    "text": "query EventAttendancesQuery {\n  kidsEventAttendance {\n    ccbEventId\n    ccbGroupId\n    eventDescription\n    eventName\n  }\n}\n"
  }
};
})();

(node as any).hash = "51d0c57a530e6e5cb0e71dce2eefaf04";

export default node;
