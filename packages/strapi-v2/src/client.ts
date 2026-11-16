import { Effect } from "effect";

import { StrapiV2Error } from "./errors";
import { CAMPUSES_DOCUMENT, CAMPUSES_OPERATION, CampusesData, toCampusRecords } from "./queries/campuses";
import { CHECK_IN_DOCUMENT, CHECK_IN_OPERATION, CheckInData, toCheckInPermissions } from "./queries/checkIn";
import { CORE_DOCUMENT, CORE_OPERATION, CoreData, toCoreSections } from "./queries/coreSections";
import { EVENTS_DOCUMENT, EVENTS_OPERATION, EventsData, eventsVariables, toEventRecords } from "./queries/events";
import {
	CAMPUS_CARDS_DOCUMENT,
	CAMPUS_CARDS_OPERATION,
	CampusCardsData,
	HOME_CARDS_DOCUMENT,
	HOME_CARDS_OPERATION,
	HomeCardsData,
	toCampusCards,
	toHomeCards,
} from "./queries/featuredCards";
import {
	DEPARTMENTS_DOCUMENT,
	DEPARTMENTS_OPERATION,
	DepartmentsData,
	MINISTRIES_DOCUMENT,
	MINISTRIES_OPERATION,
	MinistriesData,
	toDepartments,
	toMinistries,
} from "./queries/groups";
import { SERMONS_DOCUMENT, SERMONS_OPERATION, SermonsData, sermonsVariables, toSermonPage } from "./queries/sermons";
import {
	CAMPUS_STREAM_DOCUMENT,
	CAMPUS_STREAM_OPERATION,
	CampusStreamData,
	specialStreamChannelName,
	STREAM_CHANNELS_DOCUMENT,
	STREAM_CHANNELS_OPERATION,
	StreamChannelsData,
	toCampusAcl,
	toChannelAcl,
} from "./queries/streamAcl";
import { TOG_DOCUMENT, TOG_OPERATION, TogData, toThoughtOfGod } from "./queries/thoughtOfGod";
import { makeTransport, type GraphQLVariables, type StrapiV2ClientConfig, type StrapiV2FetchFn } from "./transport";

import type { CmsEventsFilter, CmsSermonsQuery } from "./inputs";
import type {
	CmsCampus,
	CmsCheckInPermission,
	CmsCoreSections,
	CmsDepartment,
	CmsEvent,
	CmsFeaturedCard,
	CmsMinistry,
	CmsSermonPage,
	CmsStreamAcl,
	CmsThoughtOfGod,
} from "./records";
import type { Schema } from "effect";

export interface StrapiV2Client {
	readonly campuses: Effect.Effect<readonly CmsCampus[], StrapiV2Error>;
	readonly events: (filter: CmsEventsFilter) => Effect.Effect<readonly CmsEvent[], StrapiV2Error>;
	readonly sermons: (query: CmsSermonsQuery) => Effect.Effect<CmsSermonPage, StrapiV2Error>;
	readonly thoughtOfGod: Effect.Effect<CmsThoughtOfGod | null, StrapiV2Error>;
	readonly homeFeaturedCards: Effect.Effect<readonly CmsFeaturedCard[] | null, StrapiV2Error>;
	readonly campusFeaturedCards: (slug: string) => Effect.Effect<readonly CmsFeaturedCard[], StrapiV2Error>;
	readonly coreSections: Effect.Effect<CmsCoreSections | null, StrapiV2Error>;
	readonly streamAcl: (slug: string) => Effect.Effect<CmsStreamAcl | null, StrapiV2Error>;
	readonly checkInPermissions: Effect.Effect<readonly CmsCheckInPermission[] | null, StrapiV2Error>;
	readonly departments: Effect.Effect<readonly CmsDepartment[], StrapiV2Error>;
	readonly ministries: Effect.Effect<readonly CmsMinistry[], StrapiV2Error>;
}

export const createStrapiV2Client = (
	config: StrapiV2ClientConfig,
	fetch: StrapiV2FetchFn,
): StrapiV2Client => {
	const transport = makeTransport(config, fetch);

	// Mappers throw for content they cannot represent (unsupported rich text);
	// that is a Decode failure of this operation, not a defect.
	const mapped = <D, A>(
		operation: string,
		document: string,
		variables: GraphQLVariables,
		data: Schema.Codec<D>,
		toRecords: (decoded: D) => A,
	): Effect.Effect<A, StrapiV2Error> =>
		transport.query(operation, document, variables, data).pipe(
			Effect.flatMap((decoded) =>
				Effect.try({
					try: () => toRecords(decoded),
					catch: (cause) =>
						new StrapiV2Error({
							reason: "Decode",
							operation,
							detail: cause instanceof Error ? cause.message : String(cause),
							cause,
						}),
				}),
			),
		);

	return {
		campuses: mapped(CAMPUSES_OPERATION, CAMPUSES_DOCUMENT, {}, CampusesData, toCampusRecords),
		events: (filter) =>
			mapped(EVENTS_OPERATION, EVENTS_DOCUMENT, eventsVariables(filter), EventsData, toEventRecords),
		sermons: (query) =>
			mapped(SERMONS_OPERATION, SERMONS_DOCUMENT, sermonsVariables(query), SermonsData, toSermonPage),
		thoughtOfGod: mapped(TOG_OPERATION, TOG_DOCUMENT, {}, TogData, toThoughtOfGod),
		homeFeaturedCards: mapped(HOME_CARDS_OPERATION, HOME_CARDS_DOCUMENT, {}, HomeCardsData, toHomeCards),
		campusFeaturedCards: (slug) =>
			mapped(CAMPUS_CARDS_OPERATION, CAMPUS_CARDS_DOCUMENT, { slug }, CampusCardsData, (data) =>
				toCampusCards(data, slug),
			),
		coreSections: mapped(CORE_OPERATION, CORE_DOCUMENT, {}, CoreData, toCoreSections),
		streamAcl: (slug) => {
			const channelName = specialStreamChannelName(slug);
			return channelName === undefined
				? mapped(CAMPUS_STREAM_OPERATION, CAMPUS_STREAM_DOCUMENT, { slug }, CampusStreamData, (data) =>
						toCampusAcl(data, slug),
					)
				: mapped(STREAM_CHANNELS_OPERATION, STREAM_CHANNELS_DOCUMENT, {}, StreamChannelsData, (data) =>
						toChannelAcl(data, channelName),
					);
		},
		checkInPermissions: mapped(CHECK_IN_OPERATION, CHECK_IN_DOCUMENT, {}, CheckInData, toCheckInPermissions),
		departments: mapped(DEPARTMENTS_OPERATION, DEPARTMENTS_DOCUMENT, {}, DepartmentsData, toDepartments),
		ministries: mapped(MINISTRIES_OPERATION, MINISTRIES_DOCUMENT, {}, MinistriesData, toMinistries),
	};
};

export const STRAPI_V2_DOCUMENTS: Readonly<Record<string, string>> = {
	[CAMPUSES_OPERATION]: CAMPUSES_DOCUMENT,
	[EVENTS_OPERATION]: EVENTS_DOCUMENT,
	[SERMONS_OPERATION]: SERMONS_DOCUMENT,
	[TOG_OPERATION]: TOG_DOCUMENT,
	[HOME_CARDS_OPERATION]: HOME_CARDS_DOCUMENT,
	[CAMPUS_CARDS_OPERATION]: CAMPUS_CARDS_DOCUMENT,
	[CORE_OPERATION]: CORE_DOCUMENT,
	[STREAM_CHANNELS_OPERATION]: STREAM_CHANNELS_DOCUMENT,
	[CAMPUS_STREAM_OPERATION]: CAMPUS_STREAM_DOCUMENT,
	[CHECK_IN_OPERATION]: CHECK_IN_DOCUMENT,
	[DEPARTMENTS_OPERATION]: DEPARTMENTS_DOCUMENT,
	[MINISTRIES_OPERATION]: MINISTRIES_DOCUMENT,
};
