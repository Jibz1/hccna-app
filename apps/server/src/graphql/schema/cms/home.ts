import { loadAppConfigSync } from "@/effect/AppConfig";
import { CMSService } from "@/effect/services/CMSService";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { Effect, Predicate } from "effect";

import type { GraphQLContext } from "@/graphql/context";

type HomeRecurringType =
	| "One time Event"
	| "Daily "
	| "Weekly"
	| "BiWeekly"
	| "Monthly"
	| "Twice a month";

type HomeRoom = "Main auditorium" | "Junior church" | "Church lobby" | "Packing lot" | "Online";

interface HomeFeaturedEvent {
	eventTitle: string;
	description: string;
	eventImageUrl: string;
	prominentColors: {
		dark: string;
		light: string;
		accent: string;
	};
	featureEventsTags?: string[];
	pageLink?: string;
	slug: string | null;
}

interface HomeServiceTime {
	eventTitle: string;
	description: string;
	slug: string;
	endDate: string;
	eventDate: string;
	reoccurring: HomeRecurringType;
	room?: HomeRoom;
	zoomLink?: string;
	body?: string;
}

interface HomeUpcomingEvent {
	eventTitle: string;
	description: string;
	slug: string;
	image: string | null;
	reoccurring: HomeRecurringType;
	eventDate: string;
	eventMonth: string;
	eventTime: string;
}

interface HomeType {
	featuredEvents: {
		events: HomeFeaturedEvent[];
	};
	serviceTimes: (HomeServiceTime | undefined)[];
	upComingEvents?: (HomeUpcomingEvent | undefined)[];
}

interface FeaturedEventsSuccess {
	_tag: "FeaturedEventsSuccess";
	events: HomeFeaturedEvent[];
}

interface FeaturedEventsFetchError {
	_tag: "FeaturedEventsFetchError";
	message: string;
}

interface FeaturedEventsNotFoundError {
	_tag: "FeaturedEventsNotFoundError";
	message: string;
}

type FeaturedEventsResult =
	| FeaturedEventsSuccess
	| FeaturedEventsFetchError
	| FeaturedEventsNotFoundError;

const FeaturedEventProminentColors = builder
	.objectRef<HomeFeaturedEvent["prominentColors"]>("FeaturedEventProminentColors")
	.implement({
		fields: (t) => ({
			dark: t.exposeString("dark", {
				description: "Dark prominent color hex value",
				nullable: false,
			}),
			light: t.exposeString("light", {
				description: "Light prominent color hex value",
				nullable: false,
			}),
			accent: t.exposeString("accent", {
				description: "Accent prominent color hex value",
				nullable: false,
			}),
		}),
	});

const FeaturedEvents = builder
	.objectRef<HomeType["featuredEvents"]["events"][number]>("FeaturedEvents")
	.implement({
		fields: (t) => ({
			eventTitle: t.exposeString("eventTitle", {
				description: "Event title",
			}),
			description: t.exposeString("description", {
				description: "Event description",
			}),
			eventImageUrl: t.exposeString("eventImageUrl", {
				description: "Event image URL",
			}),
			prominentColors: t.field({
				type: FeaturedEventProminentColors,
				description: "Prominent colors derived from the Featured Event image",
				resolve: (root) => root.prominentColors,
			}),
			pageLink: t.exposeString("pageLink", {
				description: "Event page link",
			}),
			slug: t.exposeString("slug", {
				description: "Event slug",
			}),
		}),
	});

const ServiceTime = builder
	.objectRef<NonNullable<HomeType["serviceTimes"][0]>>("ServiceTimes")
	.implement({
		fields: (t) => ({
			eventTitle: t.exposeString("eventTitle", {
				description: "Event title",
				nullable: true,
			}),
			description: t.exposeString("description", {
				description: "Event description",
				nullable: true,
			}),
			slug: t.exposeString("slug", {
				description: "Event slug",
			}),
			endDate: t.exposeString("endDate", {
				description: "Event end date",
				nullable: true,
			}),
			eventDate: t.exposeString("eventDate", {
				description: "Event date",
			}),
			reoccurring: t.exposeString("reoccurring", {
				description: "Event reoccurring",
				nullable: true,
			}),
			room: t.exposeString("room", {
				description: "Event room",
			}),
			zoomLink: t.exposeString("zoomLink", {
				description: "Event zoom link",
				nullable: true,
			}),
			body: t.exposeString("body", {
				description: "Event body",
				deprecationReason: "Use from events api instead",
			}),
		}),
	});

type _UpComingEvents = NonNullable<NonNullable<HomeType["upComingEvents"]>[number]>;

const UpComingEvent = builder.objectRef<_UpComingEvents>("UpComingEvents").implement({
	fields: (t) => ({
		eventTitle: t.exposeString("eventTitle", {
			description: "Event title",
		}),
		description: t.exposeString("description", {
			description: "Event description",
		}),
		slug: t.exposeString("slug", {
			description: "Event slug",
		}),
		image: t.exposeString("image", {
			description: "Event image",
			nullable: true,
		}),
		reoccurring: t.exposeString("reoccurring", {
			description: "Event reoccurring",
		}),
		eventDate: t.exposeString("eventDate", {
			description: "Event date",
		}),
		eventTime: t.exposeString("eventTime", {
			description: "Event time",
		}),
		eventMonth: t.exposeString("eventMonth", {
			description: "Event month",
		}),
	}),
});

const FeaturedEventsList = builder
	.objectRef<HomeType["featuredEvents"]>("FeaturedEventsList")
	.implement({
		fields: (t) => ({
			events: t.field({
				type: [FeaturedEvents],
				resolve: (root) => root.events,
			}),
		}),
	});

const Home = builder.objectRef<HomeType>("Home").implement({
	fields: (t) => ({
		featuredEvents: t.field({
			type: FeaturedEventsList,
			resolve: (root) => root.featuredEvents,
		}),
		serviceTimes: t.field({
			type: [ServiceTime],
			resolve: (root) => root.serviceTimes.filter(Predicate.isNotUndefined),
		}),
		upComingEvents: t.field({
			type: [UpComingEvent],
			resolve: (root) => root.upComingEvents?.filter(Predicate.isNotUndefined),
		}),
	}),
});

const FeaturedEventsSuccessType = builder
	.objectRef<FeaturedEventsSuccess>("FeaturedEventsSuccess")
	.implement({
		fields: (t) => ({
			events: t.field({
				type: [FeaturedEvents],
				resolve: (root) => root.events,
			}),
		}),
	});

const FeaturedEventsFetchErrorType = builder
	.objectRef<FeaturedEventsFetchError>("FeaturedEventsFetchError")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message"),
		}),
	});

const FeaturedEventsNotFoundErrorType = builder
	.objectRef<FeaturedEventsNotFoundError>("FeaturedEventsNotFoundError")
	.implement({
		fields: (t) => ({
			message: t.exposeString("message"),
		}),
	});

const FeaturedEventsResultType = builder.unionType("FeaturedEventsResult", {
	types: [FeaturedEventsSuccessType, FeaturedEventsFetchErrorType, FeaturedEventsNotFoundErrorType],
	resolveType: (value) => {
		switch (value._tag) {
			case "FeaturedEventsSuccess": {
				return FeaturedEventsSuccessType;
			}
			case "FeaturedEventsFetchError": {
				return FeaturedEventsFetchErrorType;
			}
			case "FeaturedEventsNotFoundError": {
				return FeaturedEventsNotFoundErrorType;
			}
		}
	},
});

const resolveFeaturedEvents = (
	ctx: GraphQLContext,
	campusSlug?: string | null,
): Promise<FeaturedEventsResult> => {
	const program = Effect.gen(function* () {
		const service = yield* CMSService;
		const loadEvents = loadAppConfigSync().graphql.featuredEventsDirectStrapi
			? service.getFeaturedEventsFromStrapi(campusSlug)
			: service.getFeaturedEvents(campusSlug);
		return yield* loadEvents.pipe(
			Effect.map((events): FeaturedEventsSuccess => ({
				_tag: "FeaturedEventsSuccess",
				events,
			})),
			Effect.catchTags({
				CMSFetchError: (error) =>
					Effect.succeed<FeaturedEventsFetchError>({
						_tag: "FeaturedEventsFetchError",
						message: error.message,
					}),
				CMSNotFoundError: (error) =>
					Effect.succeed<FeaturedEventsNotFoundError>({
						_tag: "FeaturedEventsNotFoundError",
						message: error.message,
					}),
			}),
		);
	}).pipe(Effect.withSpan("GraphQL.featuredEvents"));

	return ctx.effect.runPromise(program);
};

builder.queryFields((t) => ({
	featuredEvents: t.field({
		type: FeaturedEventsResultType,
		authScopes: authScope.authorized,
		description:
			"Get featured events with optional campus filtering and typed success and error responses",
		args: {
			campusSlug: t.arg.string({
				required: false,
				description:
					"Optional campus slug. Returns that campus's featured events, falling back to the home selection when none are stored. Omitted, null, or blank slugs return the home selection.",
			}),
		},
		resolve: (_, { campusSlug }, ctx) => resolveFeaturedEvents(ctx, campusSlug),
	}),
	home: t.field({
		type: Home,
		authScopes: authScope.authorized,
		description: "Get home page",
		resolve: async (_, __, ctx) => {
			const program = Effect.gen(function* () {
				const service = yield* CMSService;
				return yield* service.getHomeData;
			}).pipe(Effect.withSpan("GraphQL.home"));

			const homeData = await ctx.effect.runPromise(program);

			return {
				...homeData,
				serviceTimes: [],
			};
		},
	}),
}));
