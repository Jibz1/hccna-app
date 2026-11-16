// This probably is not the ideal way to handle granular access control
// Temp for events coordinator checking

import { CmsContent } from "@/effect/services/cms/content/CmsContent";
import { builder } from "@/graphql/builder";
import { Effect } from "effect";

import type { EffectRunner } from "@/effect/DataLoaderFactory";
import type { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";
import type { RequestContext } from "@/effect/RequestContext";
import type { AppRuntimeContext } from "@/effect/requestExecution";
import type { CmsCheckInPermission } from "@hccnj/strapi-v2";

interface CoordinatorEmail {
	email?: string | null;
}

interface CoordinatorEventAttendance {
	AttendanceEventName?: string | null;
	EventAttendanceDescription?: string | null;
	AttendanceEventCCBID?: string | null;
	AttendingGroupCCBID?: string | null;
	CoordinatorEmails?: CoordinatorEmail[] | null;
}

export interface ExportAttendanceEventRecord {
	attendanceEventName: string;
	attendanceEventCCBID: string;
}

interface EventAttendance {
	attendanceEventName: string;
	eventAttendanceDescription: string;
	attendanceEventCCBID: string;
	attendingGroupCCBID: string;
	coordinatorEmails: CoordinatorEmail[];
}

type GraphQLEffectRunner = EffectRunner<AppRuntimeContext | FirebaseAdminContext | RequestContext>;

function normalizeValue(value: string | null | undefined): string {
	return value?.trim() ?? "";
}

function filterCoordinatorEvents(eventInfo: CoordinatorEventAttendance[], email: string) {
	const normalizedEmail = normalizeValue(email).toLowerCase();
	if (!normalizedEmail) {
		return null;
	}

	const coordinatorEvents = eventInfo.filter((item) =>
		item.CoordinatorEmails?.some(
			(coordinator) => normalizeValue(coordinator.email).toLowerCase() === normalizedEmail,
		),
	);

	const deduplicatedEvents = new Map<string, CoordinatorEventAttendance>();
	for (const event of coordinatorEvents) {
		const attendanceEventCCBID = normalizeValue(event.AttendanceEventCCBID);
		const attendingGroupCCBID = normalizeValue(event.AttendingGroupCCBID);

		if (attendanceEventCCBID && attendingGroupCCBID) {
			const uniqueKey = `${attendanceEventCCBID}:${attendingGroupCCBID}`;
			if (!deduplicatedEvents.has(uniqueKey)) {
				deduplicatedEvents.set(uniqueKey, {
					...event,
					AttendanceEventCCBID: attendanceEventCCBID,
					AttendingGroupCCBID: attendingGroupCCBID,
				});
			}
		}
	}

	// oxlint-disable-next-line no-null
	return deduplicatedEvents.size > 0 ? [...deduplicatedEvents.values()] : null;
}

// attendance.ts reads these rows by their Strapi 4 field names; records are mapped back to that shape here.
const toCoordinatorEvent = (row: CmsCheckInPermission): CoordinatorEventAttendance => ({
	AttendanceEventName: row.eventName,
	EventAttendanceDescription: row.description,
	AttendanceEventCCBID: row.eventCcbId,
	AttendingGroupCCBID: row.groupCcbId,
	CoordinatorEmails: row.coordinatorEmails.map((email) => ({ email })),
});

async function getEventAttendanceInfo(runEffect: GraphQLEffectRunner) {
	const rows = await runEffect(
		Effect.gen(function* () {
			const cms = yield* CmsContent;
			return yield* cms.checkInPermissions;
		}),
	);

	if (!rows) {
		throw new Error("Invalid Event Attendance Data");
	}

	return rows.map((row) => toCoordinatorEvent(row));
}

function toExportAttendanceEvents(
	eventInfo: CoordinatorEventAttendance[],
): ExportAttendanceEventRecord[] {
	const exportAttendanceEvents = new Map<string, ExportAttendanceEventRecord>();

	for (const event of eventInfo) {
		const attendanceEventCCBID = normalizeValue(event.AttendanceEventCCBID);
		const attendingGroupCCBID = normalizeValue(event.AttendingGroupCCBID);
		if (!attendanceEventCCBID || !attendingGroupCCBID) {
			// oxlint-disable-next-line no-continue
			continue;
		}

		if (!exportAttendanceEvents.has(attendanceEventCCBID)) {
			exportAttendanceEvents.set(attendanceEventCCBID, {
				attendanceEventName: normalizeValue(event.AttendanceEventName),
				attendanceEventCCBID,
			});
		}
	}

	return [...exportAttendanceEvents.values()];
}

export async function getAllEventAttendance(runEffect: GraphQLEffectRunner) {
	const resp = await getEventAttendanceInfo(runEffect);
	return toExportAttendanceEvents(resp);
}

export async function getEventAttendanceMap(runEffect: GraphQLEffectRunner) {
	const resp = await getEventAttendanceInfo(runEffect);
	const eventMap = new Map<string, string>();

	for (const event of resp) {
		const attendanceEventCCBID = normalizeValue(event.AttendanceEventCCBID);
		const attendingGroupCCBID = normalizeValue(event.AttendingGroupCCBID);

		if (attendanceEventCCBID && attendingGroupCCBID) {
			eventMap.set(attendanceEventCCBID, attendingGroupCCBID);
		}
	}

	return eventMap;
}

export const getEventAttendance = async (email: string, runEffect: GraphQLEffectRunner) => {
	const resp = await getEventAttendanceInfo(runEffect);
	return filterCoordinatorEvents(resp, email);
};

export const EventAttendanceRef = builder.objectRef<EventAttendance>("EventAttendance").implement({
	fields: (t) => ({
		eventName: t.exposeString("attendanceEventName"),
		eventDescription: t.exposeString("eventAttendanceDescription"),
		ccbEventId: t.exposeString("attendanceEventCCBID"),
		ccbGroupId: t.exposeString("attendingGroupCCBID"),
	}),
});
