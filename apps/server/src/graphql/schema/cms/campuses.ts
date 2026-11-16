import { CmsContent } from "@/effect/services/cms/content/CmsContent";
import { CMSFetchError } from "@/effect/services/CMSErrors";
import {
	getCampusGivingPlatforms,
	getHouseOfStarsGivingPlatforms,
} from "@/effect/services/giving/platforms";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { givingText, leadPastorOf } from "@/graphql/schema/cms/legacyWire";
import { CAMPUS_SLUGS } from "@/utils/campuses";
import { Effect } from "effect";

import type { CmsCampus, RichDocument } from "@hccnj/strapi-v2";

type LeadershipGroup = "Regional Pastors" | "Lead Pastors/Campus Leads" | "Ministers" | "HODs";

const CAMPUS_ORDER: readonly string[] = CAMPUS_SLUGS;

const normalizeText = (text: string | undefined) => text?.replaceAll(/\s+/gu, " ").trim();

const cleanLeadName = (name: string | undefined) =>
	name
		?.trim()
		.replace(/^(?:Pastor|Reverend|Rev\.?|Dr\.?|Bishop|Apostle)\s+(?<name>.+)$/iu, "$<name>")
		.trim();

interface LeadPastor {
	name?: string | undefined;
	slug: string;
	image?: string | undefined;
	subTitle?: string | undefined;
	body?: string | undefined;
	leadershipGroup?: LeadershipGroup | undefined;
}

interface Campus {
	slug: string;
	body: string | null;
	content: RichDocument | null;
	campusName: string;
	isPreferred?: boolean;
	description: string;
	phone?: string | undefined;
	giving?: string | undefined;
	address?: string | undefined;
	cityState?: string | undefined;
	image?: string | undefined;
	facebook?: string | undefined;
	givingPlatforms?: GivingPlatform[] | undefined;
	instagram?: string | undefined;
	streamLink?: string | undefined;
	leadPastor?: LeadPastor | undefined;
	campusLeads: LeadPastor[];
	castrStreamId?: string | undefined;
}

interface Campuses {
	campus: Campus[];
	pageBody: string;
}

const LeadPastorType = builder.objectRef<LeadPastor>("LeadPastor").implement({
	fields: (t) => ({
		name: t.exposeString("name", {
			nullable: true,
		}),
		slug: t.exposeString("slug"),
		image: t.exposeString("image", {
			nullable: true,
		}),
		subTitle: t.exposeString("subTitle", {
			nullable: true,
		}),
		body: t.exposeString("body", {
			nullable: true,
		}),
		leadershipGroup: t.exposeString("leadershipGroup", {
			nullable: true,
		}),
	}),
});

type CampusLead = Pick<LeadPastor, "name" | "image" | "subTitle">;

const CampusLeadType = builder.objectRef<CampusLead>("CampusLead").implement({
	fields: (t) => ({
		name: t.exposeString("name", { nullable: true }),
		image: t.exposeString("image", { nullable: true }),
		subTitle: t.exposeString("subTitle", { nullable: true }),
	}),
});

interface GivingPlatform {
	icon: string;
	title: "Website" | "Cashapp" | "Zelle" | "Givelify";
	link?: string | undefined;
	text: string;
}

const GivingPlatformType = builder.objectRef<GivingPlatform>("GivingPlatform").implement({
	fields: (t) => ({
		icon: t.exposeString("icon"),
		title: t.exposeString("title"),
		link: t.exposeString("link", {
			nullable: true,
		}),
		text: t.exposeString("text"),
	}),
});

const CampusType = builder.objectRef<Campus>("Campus").implement({
	fields: (t) => ({
		slug: t.exposeString("slug", {
			nullable: false,
		}),
		body: t.exposeString("body"),
		content: t.field({
			type: "JSON",
			nullable: true,
			description:
				"The campus page's rich text as a Tiptap document (paragraphs, headings, nested lists, marks, media), or null when the page has none. Prefer it over body, the EditorJS JSON string installed apps render.",
			resolve: (root) => root.content,
		}),
		campusName: t.exposeString("campusName"),
		isPreferred: t.boolean({
			nullable: false,
			description: "Whether this campus matches the preferredCampus argument.",
			resolve: (root) => root.isPreferred ?? false,
		}),
		location: t.string({
			nullable: true,
			description: "Display address, falling back to city and state when the address is blank.",
			resolve: (root) => normalizeText(root.address) || normalizeText(root.cityState) || null,
		}),
		description: t.exposeString("description", {
			nullable: false,
		}),
		phone: t.exposeString("phone", {
			nullable: true,
		}),
		giving: t.exposeString("giving", {
			nullable: true,
		}),
		address: t.exposeString("address", {
			nullable: true,
		}),
		cityState: t.exposeString("cityState", {
			nullable: true,
		}),
		image: t.exposeString("image", {
			nullable: true,
		}),
		facebook: t.exposeString("facebook", {
			nullable: true,
		}),
		instagram: t.exposeString("instagram", {
			nullable: true,
		}),
		streamLink: t.exposeString("streamLink", {
			nullable: true,
		}),
		castrStreamId: t.exposeString("castrStreamId", {
			nullable: true,
		}),
		givingPlatforms: t.field({
			type: [GivingPlatformType],
			resolve: (root) => root.givingPlatforms,
		}),
		campusLead: t.field({
			type: CampusLeadType,
			nullable: true,
			description:
				"The campus lead's display name, photo, and subtitle for campus locations and details.",
			resolve: (root) => root.leadPastor,
		}),
		leadPastor: t.field({
			type: [LeadPastorType],
			resolve: (root) => root.campusLeads,
		}),
	}),
});

// Temporary filter to only include specific campuses in the response
const CAMPUS_FILTER = new Set(CAMPUS_ORDER);

const CampusesType = builder.objectRef<Campuses>("Campuses").implement({
	fields: (t) => ({
		campus: t.field({
			type: [CampusType],
			resolve: (root) => root.campus,
		}),
		pageBody: t.exposeString("pageBody"),
	}),
});

/*
 * House of Stars' giving cards are fixed: any CMS giving switches them on, as any Strapi 4 `Giving`
 * text did. Its `giving` is the Cash App and Zelle text, or else the first entry (Strapi 4's whole
 * text, or Strapi 5's first link), because the app's campus screen needs both fields set.
 */
const houseOfStarsGiving = (record: CmsCampus): Pick<Campus, "giving" | "givingPlatforms"> => {
	const [first] = record.giving;
	if (first === undefined) {
		return { giving: undefined, givingPlatforms: undefined };
	}
	return {
		giving: givingText(record.giving) ?? first.value,
		givingPlatforms: getHouseOfStarsGivingPlatforms(),
	};
};

/** Preserve legacy giving text while exposing the CMS's additional giving destinations. */
const campusGiving = (record: CmsCampus): Pick<Campus, "giving" | "givingPlatforms"> => {
	if (record.slug === "house-of-stars") {
		return houseOfStarsGiving(record);
	}
	const givingPlatforms = getCampusGivingPlatforms(record.giving);
	const giving = givingText(record.giving) ?? givingPlatforms[0]?.link ?? givingPlatforms[0]?.text;
	return {
		giving,
		givingPlatforms: givingPlatforms.length > 0 ? givingPlatforms : undefined,
	};
};

const toCampus = (record: CmsCampus): Campus => {
	const { giving, givingPlatforms } = campusGiving(record);
	const leader = leadPastorOf(record.leaders);
	const campusLeads = record.leaders.filter((item) => item.group === "Lead Pastors/Campus Leads");
	// Some campuses are led by regional pastors; keep every leader in the fallback group.
	const displayLeads =
		campusLeads.length > 0
			? campusLeads
			: record.leaders.filter((item) => item.group === leader?.group);
	return {
		slug: record.slug,
		body: record.body,
		content: record.content,
		campusName: record.name ?? "",
		// Campus.description is String!: a missing CMS description must not fail every campus.
		description: record.description ?? "",
		phone: record.phone ?? undefined,
		giving,
		address: record.address ?? undefined,
		cityState: record.cityState ?? undefined,
		image: record.image ?? undefined,
		facebook: record.facebook ?? undefined,
		instagram: record.instagram ?? undefined,
		streamLink: record.streamLink ?? undefined,
		castrStreamId: record.castrStreamId ?? undefined,
		campusLeads: displayLeads.flatMap((item) =>
			item.name?.trim()
				? [
						{
							slug: item.slug ?? "",
							name: item.name,
							image: item.image ?? undefined,
							subTitle: item.bio ?? undefined,
							body: item.body ?? undefined,
							leadershipGroup: (item.group ?? undefined) as LeadershipGroup | undefined,
						},
					]
				: [],
		),
		leadPastor: leader?.name
			? {
					name: leader.name,
					slug: leader.slug ?? "",
					image: leader.image ?? undefined,
					subTitle: leader.bio ?? undefined,
					body: leader.body ?? undefined,
					leadershipGroup: (leader.group ?? undefined) as LeadershipGroup | undefined,
				}
			: undefined,
		givingPlatforms,
	};
};

const loadCampuses = Effect.gen(function* () {
	const cms = yield* CmsContent;
	return yield* cms.campuses;
}).pipe(
	// Clients only get the generic error below; the log keeps what the CMS reported.
	Effect.tapError((cause) =>
		Effect.logError("CMS fetch: Unable to load campuses").pipe(
			Effect.annotateLogs({ reason: cause.reason, detail: cause.detail }),
		),
	),
	Effect.mapError((cause) => new CMSFetchError({ detail: "Unable to load campuses", cause })),
	Effect.map((records) => {
		const sortedCampuses = records
			.filter((record) => CAMPUS_FILTER.has(record.slug))
			.map((record) => toCampus(record))
			.toSorted((a, b) => {
				if (a.slug === "house-of-stars") {
					return -1;
				}
				if (b.slug === "house-of-stars") {
					return 1;
				}
				return CAMPUS_ORDER.indexOf(a.slug) - CAMPUS_ORDER.indexOf(b.slug);
			});
		return { pageBody: records[0]?.body || "", campus: sortedCampuses };
	}),
	Effect.withSpan("GraphQL.campuses"),
);

interface CampusesSuccess {
	_tag: "CampusesSuccess";
	campuses: Campus[];
}

interface CampusesFetchError {
	_tag: "CampusesFetchError";
	message: string;
}

interface CampusesNotFoundError {
	_tag: "CampusesNotFoundError";
	message: string;
}

type CampusesResult = CampusesSuccess | CampusesFetchError | CampusesNotFoundError;

const CampusesSuccessType = builder.objectRef<CampusesSuccess>("CampusesSuccess").implement({
	fields: (t) => ({
		campuses: t.field({ type: [CampusType], nullable: false, resolve: (root) => root.campuses }),
	}),
});

const CampusesFetchErrorType = builder
	.objectRef<CampusesFetchError>("CampusesFetchError")
	.implement({
		fields: (t) => ({ message: t.exposeString("message") }),
	});

const CampusesNotFoundErrorType = builder
	.objectRef<CampusesNotFoundError>("CampusesNotFoundError")
	.implement({
		fields: (t) => ({ message: t.exposeString("message") }),
	});

const CampusesResultType = builder.unionType("CampusesResult", {
	types: [CampusesSuccessType, CampusesFetchErrorType, CampusesNotFoundErrorType],
	resolveType: (value) => value._tag,
});

const loadCampusesV2 = Effect.fn("GraphQL.campusesV2")(function* (
	preferredCampus?: string | null,
): Effect.fn.Return<CampusesResult, never, CmsContent> {
	return yield* loadCampuses.pipe(
		Effect.map(({ campus }): CampusesResult => {
			if (campus.length === 0) {
				return { _tag: "CampusesNotFoundError", message: "No campuses found" };
			}
			const slug = preferredCampus?.trim();
			const campuses = campus
				.map((item) => ({
					...item,
					campusName: normalizeText(item.campusName) ?? "",
					cityState: normalizeText(item.cityState),
					isPreferred: item.slug === slug,
				}))
				.toSorted((a, b) => Number(b.isPreferred) - Number(a.isPreferred));
			for (const item of campuses) {
				for (const lead of item.campusLeads) {
					lead.name = cleanLeadName(lead.name);
				}
				if (item.leadPastor) {
					item.leadPastor.name = cleanLeadName(item.leadPastor.name);
				}
			}
			return { _tag: "CampusesSuccess", campuses };
		}),
		Effect.catchTag("CMSFetchError", () =>
			Effect.succeed<CampusesFetchError>({
				_tag: "CampusesFetchError",
				message: "Unable to load campuses",
			}),
		),
	);
});

builder.queryFields((t) => ({
	campuses: t.field({
		type: CampusesType,
		authScopes: authScope.authorized,
		description: "Get Campuses",
		resolve: (_, __, ctx) => ctx.effect.runPromise(loadCampuses),
	}),
	campusesV2: t.field({
		type: CampusesResultType,
		authScopes: authScope.authorized,
		description:
			"Get campuses with preferred-campus ordering, cleaned lead names, and typed success and error responses",
		args: {
			preferredCampus: t.arg.string({
				required: false,
				description:
					"Optional campus slug to place first. Omitted, null, blank, or unknown slugs keep the default campus order.",
			}),
		},
		resolve: (_, { preferredCampus }, ctx) =>
			ctx.effect.runPromise(loadCampusesV2(preferredCampus)),
	}),
}));
