import { expect, test } from "vitest";

import { eventSessionTimes } from "./eventSessionTimes";

const CHICAGO = "America/Chicago";

test("lists each time on one day with its label, earliest first", () => {
  expect(
    eventSessionTimes(
      [
        { startsAt: "2026-10-11T13:00:00.000Z", label: "First Service" },
        { startsAt: "2026-10-11T15:00:00.000Z", label: " Second Service " },
      ],
      CHICAGO,
    ),
  ).toEqual(["8:00 AM CDT · First Service", "10:00 AM CDT · Second Service"]);
});

test("leaves the label off a time without one", () => {
  expect(
    eventSessionTimes(
      [
        { startsAt: "2026-10-11T13:00:00.000Z", label: null },
        { startsAt: "2026-10-11T15:00:00.000Z", label: "  " },
      ],
      CHICAGO,
    ),
  ).toEqual(["8:00 AM CDT", "10:00 AM CDT"]);
});

test("names the day when sessions fall on different days", () => {
  expect(
    eventSessionTimes(
      [
        { startsAt: "2026-11-06T23:30:00.000Z", label: "Opening night" },
        { startsAt: "2026-11-07T15:00:00.000Z", label: null },
      ],
      CHICAGO,
    ),
  ).toEqual([
    "Fri, Nov 6 · 5:30 PM CST · Opening night",
    "Sat, Nov 7 · 9:00 AM CST",
  ]);
});

test("skips times it cannot read", () => {
  expect(
    eventSessionTimes(
      [
        { startsAt: "not a date", label: "Broken" },
        { startsAt: null, label: "Missing" },
        { startsAt: "2026-10-11T15:00:00.000Z", label: "Second Service" },
      ],
      CHICAGO,
    ),
  ).toEqual(["10:00 AM CDT · Second Service"]);
});
