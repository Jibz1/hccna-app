/**
 * @generated SignedSource<<6500a728a19f3c9f169d8c99b7e4944c>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type RemoveSavedVerseMutation$variables = {
  verseId: string;
};
export type RemoveSavedVerseMutation$data = {
  readonly removeSavedVerse: {
    readonly removed: boolean;
    readonly verseId: string;
  };
};
export type RemoveSavedVerseMutation = {
  response: RemoveSavedVerseMutation$data;
  variables: RemoveSavedVerseMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "verseId"
  }
],
v1 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "verseId",
        "variableName": "verseId"
      }
    ],
    "concreteType": "RemoveSavedVersePayload",
    "kind": "LinkedField",
    "name": "removeSavedVerse",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "verseId",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "removed",
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
    "name": "RemoveSavedVerseMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "RemoveSavedVerseMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "3c94a73211c065f9c293e813df3cda91",
    "id": null,
    "metadata": {},
    "name": "RemoveSavedVerseMutation",
    "operationKind": "mutation",
    "text": "mutation RemoveSavedVerseMutation(\n  $verseId: ID!\n) {\n  removeSavedVerse(verseId: $verseId) {\n    verseId\n    removed\n  }\n}\n"
  }
};
})();

(node as any).hash = "15b0d72cf3619001dbd6787766f69e2f";

export default node;
