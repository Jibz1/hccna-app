/**
 * @generated SignedSource<<5994b5050e93158387ab495ffda4fb92>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type SavedVerseKind = "VERSE_OF_THE_DAY" | "WORD_OF_ACTIVATION" | "%future added value";
export type SavedVersesQuery$variables = Record<PropertyKey, never>;
export type SavedVersesQuery$data = {
  readonly user: {
    readonly savedVerses: ReadonlyArray<{
      readonly book: string;
      readonly image: string | null | undefined;
      readonly kind: SavedVerseKind;
      readonly savedAt: any;
      readonly text: string;
      readonly verseId: string;
    }>;
  };
};
export type SavedVersesQuery = {
  response: SavedVersesQuery$data;
  variables: SavedVersesQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "User",
    "kind": "LinkedField",
    "name": "user",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": "SavedVerse",
        "kind": "LinkedField",
        "name": "savedVerses",
        "plural": true,
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
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "SavedVersesQuery",
    "selections": (v0/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "SavedVersesQuery",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "785be53e8a23106736e2661e75978faf",
    "id": null,
    "metadata": {},
    "name": "SavedVersesQuery",
    "operationKind": "query",
    "text": "query SavedVersesQuery {\n  user {\n    savedVerses {\n      verseId\n      kind\n      savedAt\n      book\n      text\n      image\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "6792bbb5de572360ae437091634d3d4f";

export default node;
