import type { CoreDataQuery$data } from "@/hooks/relay/__generated__/CoreDataQuery.graphql";

export type CoreFeatureType =
  | "giving"
  | "profile"
  | "more"
  | "sermons"
  | "events";

export type CoreDataView = {
  readonly events: CoreFeatureView;
  readonly giving: CoreFeatureView;
  readonly hccexpression: CoreFeatureView;
  readonly more: CoreFeatureView & {
    readonly links: readonly CoreLinkView[];
  };
  readonly profile: CoreFeatureView;
  readonly sermons: CoreFeatureView;
};

type CoreFeatureView = {
  readonly copy: string;
  readonly img: string;
};

export type CoreLinkView = {
  readonly group: string;
  readonly iconName: string;
  readonly link: string;
  readonly subTitle: string;
  readonly title: string;
};

type CoreDataResult = CoreDataQuery$data["core"];

function resolveFeature(
  feature:
    | {
        readonly copy?: string | null;
        readonly featureImge?: string | null;
      }
    | null
    | undefined,
): CoreFeatureView {
  return {
    copy: feature?.copy ?? "",
    img: feature?.featureImge ?? "",
  };
}

export function resolveCoreData(core: CoreDataResult): CoreDataView | null {
  if (core == null) {
    return null;
  }

  return {
    events: resolveFeature(core.events),
    giving: resolveFeature(core.giving),
    hccexpression: resolveFeature(core.hccexpression),
    more: {
      ...resolveFeature(core.more),
      links:
        core.more?.links?.map((link) => ({
          group: link.group ?? "",
          iconName: link.iconName ?? "",
          link: link.link ?? "",
          subTitle: link.subTitle ?? "",
          title: link.title ?? "",
        })) ?? [],
    },
    profile: resolveFeature(core.profile),
    sermons: resolveFeature(core.sermons),
  };
}

export function getCoreFeatureImage(
  coreData: CoreDataView | null,
  type: CoreFeatureType,
): string | null {
  const image = coreData?.[type].img;
  return image?.length ? image : null;
}
