import { expect, test } from "vitest";

import type { CampusData } from "@/relay/campuses";

import { campusLeadsOf, leadCycleOrders } from "./campusLeads";

const lead = (name: string | null) => ({
  name,
  slug: null,
  image: null,
  subTitle: null,
  leadershipGroup: null,
});

const campus = (
  slug: string,
  campusLeads: ReturnType<typeof lead>[] | null,
  campusLead: ReturnType<typeof lead> | null = null,
): CampusData => ({
  slug,
  campusName: slug,
  location: null,
  cityState: null,
  campusLead,
  campusLeads,
  content: null,
  facebook: null,
  giving: null,
  givingPlatforms: null,
  image: null,
  instagram: null,
  isPreferred: false,
  streamLink: null,
});

test("uses every campus lead, falling back to the single campus lead", () => {
  expect(campusLeadsOf(campus("a", [lead("A"), lead("B")]))).toHaveLength(2);
  expect(campusLeadsOf(campus("b", [], lead("Solo")))).toEqual([lead("Solo")]);
  expect(campusLeadsOf(campus("c", null))).toEqual([]);
});

test("orders only the cards that cycle, so they change one after another", () => {
  const orders = leadCycleOrders([
    campus("stars", [lead("A"), lead("B")]),
    campus("grace", [lead("Solo")]),
    campus("unnamed", [lead("A"), lead(null)]),
    campus("praise", [lead("C"), lead("D")]),
  ]);

  expect([...orders]).toEqual([
    ["stars", 0],
    ["praise", 1],
  ]);
});
