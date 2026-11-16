import { Schema } from "effect";

import { Media, mediaUrl, Text } from "./shared";

import type { CmsCoreSection, CmsCoreSections } from "../records";

export const CORE_OPERATION = "StrapiV2CoreSections";
export const CORE_DOCUMENT = `query StrapiV2CoreSections {
  appConfig {
    Giving { Intro FeatureImage { url } }
    More { Intro FeatureImage { url } }
    HCCexpression { Intro FeatureImage { url } }
  }
}`;

const Section = Schema.NullOr(Schema.Struct({ Intro: Text, FeatureImage: Media }));

export const CoreData = Schema.Struct({
	appConfig: Schema.NullOr(
		Schema.Struct({ Giving: Section, More: Section, HCCexpression: Section }),
	),
});

const toSection = (section: typeof Section.Type): CmsCoreSection => ({
	copy: section?.Intro ?? null,
	image: mediaUrl(section?.FeatureImage ?? null),
});

/** Strapi 5 has no profile, sermons or events sections: those keys stay absent. */
export const toCoreSections = (data: typeof CoreData.Type): CmsCoreSections | null =>
	data.appConfig === null
		? null
		: {
				giving: toSection(data.appConfig.Giving),
				hccexpression: toSection(data.appConfig.HCCexpression),
				more: toSection(data.appConfig.More),
			};
