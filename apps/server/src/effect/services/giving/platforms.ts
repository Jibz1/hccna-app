import type { CmsGivingEntry } from "@hccnj/strapi-v2";

const GIVING_PLATFORMS_ICONS = {
	Givelify:
		"https://firebasestorage.googleapis.com/v0/b/app-hccnj.appspot.com/o/apps%2Fimages%2Fassets%2Fgiving%2FGivelify.svg?alt=media&token=c97aae53-ce72-4bce-b625-06d0e4dbd9be",
	Cashapp:
		"https://firebasestorage.googleapis.com/v0/b/app-hccnj.appspot.com/o/apps%2Fimages%2Fassets%2Fgiving%2Fcashapp.svg?alt=media&token=2119d6a0-1f95-4129-834b-4f6678669c1a",
	Zelle:
		"https://firebasestorage.googleapis.com/v0/b/app-hccnj.appspot.com/o/apps%2Fimages%2Fassets%2Fgiving%2Fzelle.svg?alt=media&token=96405337-3712-4e48-87e2-652a7ce48449",
	Website:
		"https://firebasestorage.googleapis.com/v0/b/app-hccnj.appspot.com/o/apps%2Fimages%2Fassets%2Fgiving%2Fhcclogo2.svg?alt=media&token=75171ecf-e0a3-44a8-a5fb-c1c438623994",
};

const TITHELY_ICON = "https://give.tithe.ly/icon/icon-192x192.png";
const WEBSITE_GIVING_ICONS = new Map([
	["tithe.ly", TITHELY_ICON],
	["give.tithe.ly", TITHELY_ICON],
	["paypal.com", "https://www.paypalobjects.com/webstatic/icon/pp196.png"],
	// These published campus links redirect to Tithe.ly. Match the complete short-link path.
	["bit.ly/Jubilee-Tithely", TITHELY_ICON],
	["tiny.cc/hccgiving", TITHELY_ICON],
]);

const websiteGivingIcon = (link: string | undefined): string => {
	const url = link === undefined ? null : URL.parse(link);
	if (url === null) {
		return GIVING_PLATFORMS_ICONS.Website;
	}
	const host = url.hostname.replace(/^www\./u, "");
	return (
		WEBSITE_GIVING_ICONS.get(`${host}${url.pathname}`) ??
		WEBSITE_GIVING_ICONS.get(host) ??
		GIVING_PLATFORMS_ICONS.Website
	);
};

interface GivingPlatform {
	platform: "Givelify" | "Cashapp" | "Zelle" | "Website";
	link?: string | undefined;
	text: string;
}
function toGivingPlatformCard({ platform, link, text }: GivingPlatform) {
	return {
		icon: platform === "Website" ? websiteGivingIcon(link) : GIVING_PLATFORMS_ICONS[platform],
		title: platform,
		link,
		text,
	};
}

export function getHouseOfStarsGivingPlatforms() {
	return [
		toGivingPlatformCard({
			platform: "Website",
			link: "https://hccnj.org/giving",
			text: "Website",
		}),
		toGivingPlatformCard({
			platform: "Cashapp",
			link: "https://cash.app/$UnionNJhgccnj",
			text: "Cashapp",
		}),
		toGivingPlatformCard({
			platform: "Givelify",
			link: "https://www.givelify.com/givenow/1.0/MzIwODY=/selection",
			text: "Givelify",
		}),
		toGivingPlatformCard({ platform: "Zelle", text: "giving@hccnj.org" }),
	];
}

const CASH_APP_LINK = /^(?:https?:\/\/)?(?:www\.)?cash\.(?:app|me)\//iu;

/** "$tag" from a Cash App tag or link. */
export function cashTag(value: string): string {
	const tag = value.trim().replace(CASH_APP_LINK, "");
	return tag.startsWith("$") ? tag : `$${tag}`;
}

/** Some CMS Website entries are email addresses; keep those copyable instead of opening them. */
const givingLink = (value: string): string | undefined => {
	const url = URL.parse(value.includes("://") ? value : `https://${value}`);
	return url !== null &&
		(url.protocol === "https:" || url.protocol === "http:") &&
		url.username === "" &&
		url.password === ""
		? url.href
		: undefined;
};

/** Keep legacy Cash App/Zelle ordering and include every additional giving destination. */
export function getCampusGivingPlatforms(entries: readonly CmsGivingEntry[]) {
	const cashApp = entries.findLast((entry) => entry.platform === "Cashapp");
	const zelle = entries.findLast((entry) => entry.platform === "Zelle");
	return [
		...(cashApp
			? [
					toGivingPlatformCard({
						platform: "Cashapp",
						link: `https://cash.me/${cashTag(cashApp.value)}`,
						text: "Cashapp",
					}),
				]
			: []),
		...(zelle
			? [toGivingPlatformCard({ platform: "Zelle", text: zelle.value.toLowerCase() })]
			: []),
		...entries.flatMap((entry) => {
			if (entry.platform !== "Website" && entry.platform !== "Givelify") {
				return [];
			}
			const link = givingLink(entry.value);
			return [
				toGivingPlatformCard({
					platform: entry.platform,
					link,
					text: link === undefined ? entry.value : entry.platform,
				}),
			];
		}),
	];
}
