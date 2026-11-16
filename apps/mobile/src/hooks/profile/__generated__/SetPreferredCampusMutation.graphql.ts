/**
 * @generated SignedSource<<48214f37d5129ea8e0da4402e1d03833>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type SetPreferredCampusMutation$variables = {
  campusSlug: string;
  expectedVersion: number;
};
export type SetPreferredCampusMutation$data = {
  readonly setPreferredCampus: {
    readonly campusPreferenceVersion: number;
    readonly preferredCampusSlug: string | null | undefined;
    readonly success: boolean;
    readonly syncPending: boolean;
  } | null | undefined;
};
export type SetPreferredCampusMutation = {
  response: SetPreferredCampusMutation$data;
  variables: SetPreferredCampusMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "campusSlug"
  },
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "expectedVersion"
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
      },
      {
        "kind": "Variable",
        "name": "expectedVersion",
        "variableName": "expectedVersion"
      }
    ],
    "concreteType": "CampusPreferenceResult",
    "kind": "LinkedField",
    "name": "setPreferredCampus",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "success",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "preferredCampusSlug",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "campusPreferenceVersion",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "syncPending",
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
    "name": "SetPreferredCampusMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "SetPreferredCampusMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "f23824036fdb6a6f3c52fafaea39260d",
    "id": null,
    "metadata": {},
    "name": "SetPreferredCampusMutation",
    "operationKind": "mutation",
    "text": "mutation SetPreferredCampusMutation(\n  $campusSlug: String!\n  $expectedVersion: Int!\n) {\n  setPreferredCampus(campusSlug: $campusSlug, expectedVersion: $expectedVersion) {\n    success\n    preferredCampusSlug\n    campusPreferenceVersion\n    syncPending\n  }\n}\n"
  }
};
})();

(node as any).hash = "0b86ff5c2f209ccd9e75c5787dd2cff2";

export default node;
