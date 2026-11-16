interface Base {
	featureImge: string;
	copy: string;
}

export interface ProminentColors {
	dark: string;
	light: string;
	accent: string;
}

export interface MoreLinks {
	title: string;
	subTitle: string;
	iconName: string;
	link: string;
	group: "Other" | "Get Connected";
}

export interface CoreData {
	giving: Base;
	profile: Base;
	sermons: Base;
	hccexpression: Base;
	events: Base;
	more: Base & { links: MoreLinks[] };
}

export interface FeaturedEvent {
	eventTitle: string;
	description: string;
	eventImageUrl: string;
	prominentColors: ProminentColors;
	pageLink?: string;
	slug: string | null;
}

export type ReoccurringType =
	| "One time Event"
	| "Daily "
	| "Weekly"
	| "BiWeekly"
	| "Monthly"
	| "Twice a month";

export interface UpComingEvent {
	eventTitle: string;
	description: string;
	slug: string;
	image: string | null;
	reoccurring: ReoccurringType;
	eventDate: string;
	eventTime: string;
	eventMonth: string;
}

export interface HomeData {
	featuredEvents: {
		events: FeaturedEvent[];
	};
	upComingEvents: UpComingEvent[];
}

export interface CachedEntry<T> {
	data: T;
	cachedAt: number;
}
