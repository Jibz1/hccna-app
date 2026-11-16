import type { UserGivingQuery } from "@/hooks/relay/__generated__/UserGivingQuery.graphql";
import type { UserProfileQuery } from "@/hooks/relay/__generated__/UserProfileQuery.graphql";
import type { UserWoaQuery } from "@/hooks/relay/__generated__/UserWoaQuery.graphql";

export type UserProfile = NonNullable<
  NonNullable<UserProfileQuery["response"]["user"]>["profile"]
>;
export type WordOfActivation = NonNullable<
  NonNullable<UserWoaQuery["response"]["user"]>["woa"]
>;
type GivingSuccess = Extract<
  NonNullable<UserGivingQuery["response"]["myGivingHistory"]>,
  { readonly __typename: "MyGivingHistorySuccess" }
>;
export type YearlyGiving = NonNullable<GivingSuccess["years"]>[number];

export function resolveUserProfile(
  result: UserProfileQuery["response"] | null | undefined,
  expectedUid: string | null | undefined,
): UserProfile | null {
  const profile = result?.user?.profile ?? null;
  return expectedUid && profile?.uid === expectedUid ? profile : null;
}

export function resolveWordOfActivation(
  result: UserWoaQuery["response"] | null | undefined,
): WordOfActivation | null {
  return result?.user?.woa ?? null;
}

export type GivingHistory = {
  readonly status: "loading" | "success" | "empty" | "error";
  readonly years: readonly YearlyGiving[];
};

export function resolveGivingHistory(
  result: UserGivingQuery["response"] | null | undefined,
  previousYears: readonly YearlyGiving[] = [],
): GivingHistory {
  const history = result?.myGivingHistory;
  if (history === undefined) {
    return { status: "loading", years: previousYears };
  }
  if (history?.__typename === "MyGivingHistorySuccess") {
    const years = history.years ?? [];
    return {
      status: years.some(
        (year) => (year.numberOfGiving ?? year.giving?.length ?? 0) > 0,
      )
        ? "success"
        : "empty",
      years,
    };
  }
  return { status: "error", years: previousYears };
}
