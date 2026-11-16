import { Predicate } from "effect";

import type { YearlyGiving } from "@/relay/userData";

export function hasNumericYear(
  year: YearlyGiving,
): year is YearlyGiving & { year: number } {
  return Predicate.isNumber(year.year) && Number.isInteger(year.year);
}

export function contributionsLabel(count: number) {
  if (!count) {
    return "No contributions yet";
  }
  return `${count} ${count === 1 ? "contribution" : "contributions"}`;
}
