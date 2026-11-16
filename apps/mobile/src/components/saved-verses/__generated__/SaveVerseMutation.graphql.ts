/**
 * @generated SignedSource<<d6a2435dae1c86fc23bdffb5b9b36465>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type SavedVerseKind = "VERSE_OF_THE_DAY" | "WORD_OF_ACTIVATION" | "%future added value";
export type SaveVerseMutation$variables = {
  kind: SavedVerseKind;
  verseId: string;
};
export type SaveVerseMutation$data = {
  readonly saveVerse: {
    readonly book: string;
    readonly image: string | null | undefined;
    readonly kind: SavedVerseKind;
    readonly savedAt: any;
    readonly text: string;
    readonly verseId: string;
  };
};
export type SaveVerseMutation = {
  response: SaveVerseMutation$data;
  variables: SaveVerseMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "kind"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "verseId"
},
v2 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "kind",
        "variableName": "kind"
      },
      {
        "kind": "Variable",
        "name": "verseId",
        "variableName": "verseId"
      }
    ],
    "concreteType": "SavedVerse",
    "kind": "LinkedField",
    "name": "saveVerse",
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
        "name": "kind",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "savedAt",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "book",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "text",
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
    "name": "SaveVerseMutation",
    "selections": (v2/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v1/*:: as any*/),
      (v0/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "SaveVerseMutation",
    "selections": (v2/*:: as any*/)
  },
  "params": {
    "cacheID": "178a597a3633fb74169989418fb4bb95",
    "id": null,
    "metadata": {},
    "name": "SaveVerseMutation",
    "operationKind": "mutation",
    "text": "mutation SaveVerseMutation(\n  $verseId: ID!\n  $kind: SavedVerseKind!\n) {\n  saveVerse(verseId: $verseId, kind: $kind) {\n    verseId\n    kind\n    savedAt\n    book\n    text\n    image\n  }\n}\n"
  }
};
})();

(node as any).hash = "00a42722c448a60fe51c4d969efcc239";

export default node;
