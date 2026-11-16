/**
 * @generated SignedSource<<f3e2c90fb481586e8315a455976341d0>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type CoreDataQuery$variables = Record<PropertyKey, never>;
export type CoreDataQuery$data = {
  readonly core: {
    readonly events: {
      readonly copy: string | null | undefined;
      readonly featureImge: string | null | undefined;
    } | null | undefined;
    readonly giving: {
      readonly copy: string | null | undefined;
      readonly featureImge: string | null | undefined;
    } | null | undefined;
    readonly hccexpression: {
      readonly copy: string | null | undefined;
      readonly featureImge: string | null | undefined;
    } | null | undefined;
    readonly more: {
      readonly copy: string | null | undefined;
      readonly featureImge: string | null | undefined;
      readonly links: ReadonlyArray<{
        readonly group: string | null | undefined;
        readonly iconName: string | null | undefined;
        readonly link: string | null | undefined;
        readonly subTitle: string | null | undefined;
        readonly title: string | null | undefined;
      }> | null | undefined;
    } | null | undefined;
    readonly profile: {
      readonly copy: string | null | undefined;
      readonly featureImge: string | null | undefined;
    } | null | undefined;
    readonly sermons: {
      readonly copy: string | null | undefined;
      readonly featureImge: string | null | undefined;
    } | null | undefined;
  } | null | undefined;
};
export type CoreDataQuery = {
  response: CoreDataQuery$data;
  variables: CoreDataQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "featureImge",
  "storageKey": null
},
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "copy",
  "storageKey": null
},
v2 = [
  (v0/*:: as any*/),
  (v1/*:: as any*/)
],
v3 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "Core",
    "kind": "LinkedField",
    "name": "core",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": "Base",
        "kind": "LinkedField",
        "name": "giving",
        "plural": false,
        "selections": (v2/*:: as any*/),
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "Base",
        "kind": "LinkedField",
        "name": "profile",
        "plural": false,
        "selections": (v2/*:: as any*/),
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "Base",
        "kind": "LinkedField",
        "name": "sermons",
        "plural": false,
        "selections": (v2/*:: as any*/),
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "Base",
        "kind": "LinkedField",
        "name": "hccexpression",
        "plural": false,
        "selections": (v2/*:: as any*/),
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "Base",
        "kind": "LinkedField",
        "name": "events",
        "plural": false,
        "selections": (v2/*:: as any*/),
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "MoreLinksRefType",
        "kind": "LinkedField",
        "name": "more",
        "plural": false,
        "selections": [
          (v0/*:: as any*/),
          (v1/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "MoreLinks",
            "kind": "LinkedField",
            "name": "links",
            "plural": true,
            "selections": [
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "title",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "link",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "iconName",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "subTitle",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "group",
                "storageKey": null
              }
            ],
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
    "name": "CoreDataQuery",
    "selections": (v3/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "CoreDataQuery",
    "selections": (v3/*:: as any*/)
  },
  "params": {
    "cacheID": "c61df25c2917bf0d58eac7e1326472f4",
    "id": null,
    "metadata": {},
    "name": "CoreDataQuery",
    "operationKind": "query",
    "text": "query CoreDataQuery {\n  core {\n    giving {\n      featureImge\n      copy\n    }\n    profile {\n      featureImge\n      copy\n    }\n    sermons {\n      featureImge\n      copy\n    }\n    hccexpression {\n      featureImge\n      copy\n    }\n    events {\n      featureImge\n      copy\n    }\n    more {\n      featureImge\n      copy\n      links {\n        title\n        link\n        iconName\n        subTitle\n        group\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "1d0332e3abd8578885c681c43f7ab055";

export default node;
