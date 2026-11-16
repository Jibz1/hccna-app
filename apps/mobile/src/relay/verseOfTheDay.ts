import type { VerseOfTheDayQuery$data } from "@/hooks/relay/__generated__/VerseOfTheDayQuery.graphql";

type VerseOfTheDayResult = VerseOfTheDayQuery$data["verseOfTheDayV2"];

export type VerseOfTheDayData = Extract<
  NonNullable<VerseOfTheDayResult>,
  { readonly __typename: "Scripture" }
>;

export function resolveVerseOfTheDay(
  result: VerseOfTheDayResult,
): VerseOfTheDayData | null {
  if (result == null || result.__typename === "VodNotFoundError") {
    return null;
  }

  if (result.__typename === "VodFetchError") {
    throw new Error(result.message ?? "Unable to load the verse of the day");
  }

  return result.__typename === "Scripture" ? result : null;
}
