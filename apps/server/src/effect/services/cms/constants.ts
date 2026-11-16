import type { MoreLinks } from "@/effect/services/cms/types";

export const CORE_LRU_CACHE_KEY = "cms:coreSettings";
export const CORE_REDIS_CACHE_KEY = "cms:coreSettings:v1";
export const HOME_LRU_CACHE_KEY = "cms:homeData:v3";
export const HOME_REDIS_CACHE_KEY = "cms:homeData:v3";
export const LRU_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const REDIS_TTL_SECONDS = 60 * 10; // 10 minutes
export const SERMON_STELLATE_OPERATION_NAMES = [
	"LatestSermonsQuery",
	"SermonsContainerQuery",
	"SermonsItemsRefetchQuery",
] as const;

export const FALLBACK_IMAGE =
	"https://storage.googleapis.com/app-hccnj/Image/events_f7b00973f5/events_f7b00973f5.jpg";

export const DEFAULT_PROMINENT_COLORS = {
	dark: "#000000",
	light: "#FFFFFF",
	accent: "#6B7280",
} as const;

export const FEATURED_EVENT_PAGE_URL_PREFIX = "https://hccnj.org/news-and-events/";

export const CORE_SETTINGS_ID = "core-settings-singleton";

export const MORE_LINKS: MoreLinks[] = [
	{
		title: "I'm new here",
		subTitle: "Get to know HCC NJ",
		iconName: "signature",
		link: "https://hccnj.ccbchurch.com/goto/forms/88/responses/new",
		group: "Get Connected",
	},
	{
		title: "Serve",
		subTitle: "Volunteer your skills at a department",
		iconName: "hand-holding-hand",
		link: "https://hccnj.ccbchurch.com/goto/forms/5/responses/new",
		group: "Get Connected",
	},
	{
		title: "Join a small group",
		subTitle: "Grow together spiritually",
		iconName: "people-group",
		link: "https://hccnj.ccbchurch.com/goto/forms/3/responses/new",
		group: "Get Connected",
	},
	{
		title: "Share your testimony",
		subTitle: "We'd love to celebrate with you",
		iconName: "people-arrows",
		link: "https://hccnj.ccbchurch.com/goto/forms/32/responses/new",
		group: "Other",
	},
	{
		title: "Privacy Policy",
		subTitle: "Read our privacy policy",
		iconName: "shield-halved",
		link: "https://hccnj.org/privacy-policy/",
		group: "Other",
	},
];
