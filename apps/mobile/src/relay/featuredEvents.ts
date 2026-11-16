import type { FeaturedEventsQuery$data } from "@/hooks/relay/__generated__/FeaturedEventsQuery.graphql";

export type FeaturedEventData = {
  readonly description: string;
  readonly eventImageUrl: string;
  readonly eventTitle: string;
  readonly pageLink?: string;
  readonly prominentColors?: {
    readonly accent: string;
    readonly dark: string;
    readonly light: string;
  };
  readonly slug: string | null;
};

type FeaturedEventsResult = FeaturedEventsQuery$data["featuredEvents"];

export function resolveFeaturedEvents(
  result: FeaturedEventsResult,
): readonly FeaturedEventData[] {
  if (result?.__typename === "FeaturedEventsFetchError") {
    throw new Error(result.message ?? "Unable to load featured events");
  }

  if (result?.__typename !== "FeaturedEventsSuccess") {
    return [];
  }

  return (
    result.events?.map((event) => {
      let featured: FeaturedEventData = {
        description: event.description ?? "",
        eventImageUrl: event.eventImageUrl ?? "",
        eventTitle: event.eventTitle ?? "",
        slug: event.slug ?? null,
      };
      if (event.pageLink) {
        featured = { ...featured, pageLink: event.pageLink };
      }
      if (event.prominentColors) {
        featured = {
          ...featured,
          prominentColors: {
            accent: event.prominentColors.accent,
            dark: event.prominentColors.dark,
            light: event.prominentColors.light,
          },
        };
      }
      return featured;
    }) ?? []
  );
}
