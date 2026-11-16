import { expect, test } from "vitest";

import { leadTitle } from "./leadTitle";

test("titles a lead by the singular form of their leadership group", () => {
  expect(leadTitle("Regional Pastors")).toBe("Regional Pastor");
  expect(leadTitle("Lead Pastors/Campus Leads")).toBe("Lead Pastor");
  expect(leadTitle("Ministers")).toBe("Minister");
  expect(leadTitle("HODs")).toBe("HOD");
  expect(leadTitle("Decons")).toBe("Deacon");
});

test("shows a group this build does not know as written", () => {
  expect(leadTitle(" Elders ")).toBe("Elders");
});

test("gives no title without a group", () => {
  expect(leadTitle(null)).toBeUndefined();
  expect(leadTitle(undefined)).toBeUndefined();
  expect(leadTitle("  ")).toBeUndefined();
});
