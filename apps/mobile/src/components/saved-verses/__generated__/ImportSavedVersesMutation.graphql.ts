/**
 * @generated SignedSource<<ae665991a567d78c9c8c2a0840d28110>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type SavedVerseKind = "VERSE_OF_THE_DAY" | "WORD_OF_ACTIVATION" | "%future added value";
export type SavedVerseImportInput = {
  book: string;
  kind: SavedVerseKind;
  savedAt?: any | null | undefined;
  text: string;
};
export type ImportSavedVersesMutation$variables = {
  verses: ReadonlyArray<SavedVerseImportInput>;
};
export type ImportSavedVersesMutation$data = {
  readonly importSavedVerses: {
    readonly alreadySaved: number;
    readonly imported: number;
    readonly skipped: number;
  };
};
export type ImportSavedVersesMutation = {
  response: ImportSavedVersesMutation$data;
  variables: ImportSavedVersesMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "verses"
  }
],
v1 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "verses",
        "variableName": "verses"
      }
    ],
    "concreteType": "ImportSavedVersesPayload",
    "kind": "LinkedField",
    "name": "importSavedVerses",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "imported",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "alreadySaved",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "skipped",
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
    "name": "ImportSavedVersesMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "ImportSavedVersesMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "c163d6cb7717b67ecf1fc981e26aa3f0",
    "id": null,
    "metadata": {},
    "name": "ImportSavedVersesMutation",
    "operationKind": "mutation",
    "text": "mutation ImportSavedVersesMutation(\n  $verses: [SavedVerseImportInput!]!\n) {\n  importSavedVerses(verses: $verses) {\n    imported\n    alreadySaved\n    skipped\n  }\n}\n"
  }
};
})();

(node as any).hash = "f46d6ce02ed642578ef14f1643ce06c4";

export default node;
