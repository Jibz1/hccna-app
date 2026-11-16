import {
	AttendancePdfExportError,
	type EventAttendanceLookupInput,
	type EventAttendanceSnapshot,
	type EventAttendeeStatus,
} from "@/effect/services/attendanceExport/types";
import { CCBParseError, type CCBService } from "@/effect/services/CCBService";
import { capitalizeText } from "@/utils/capitalizeText";
import { Effect } from "effect";

// Treat "no response body" as an empty attendance record because CCB uses that
// shape for events that exist but have no saved attendance yet.
const getAttendanceProfileOrEmpty = (
	ccb: typeof CCBService.Service,
	eventId: string,
	occurrenceDate: string,
): Effect.Effect<
	{
		events: {
			event: {
				attendees?: { attendee?: { id?: string }[] | { id?: string } };
				notes?: string;
				topic?: string;
			};
		};
	} | null,
	AttendancePdfExportError
> =>
	Effect.gen(function* () {
		const profile = yield* Effect.result(ccb.getAttendanceProfile(Number(eventId), occurrenceDate));

		if (profile._tag === "Success") {
			return profile.success as {
				events: {
					event: {
						attendees?: { attendee?: { id?: string }[] | { id?: string } };
						notes?: string;
						topic?: string;
					};
				};
			};
		}

		const error = profile.failure;
		if (error instanceof CCBParseError && error.message === "No response body from CCB") {
			return null;
		}

		return yield* Effect.fail(
			new AttendancePdfExportError({
				cause: error,
				message: "Failed to fetch attendance profile from CCB",
			}),
		);
	});

/**
 * Fetch a canonical attendance snapshot directly from CCB.
 */
export const fetchAttendanceSnapshotFromCcb = (
	ccb: typeof CCBService.Service,
	params: Pick<EventAttendanceLookupInput, "ccbGroupId" | "eventId" | "occurrenceDate">,
): Effect.Effect<EventAttendanceSnapshot, AttendancePdfExportError> =>
	Effect.gen(function* () {
		const participantsResponse = yield* ccb.getGroupParticipants(Number(params.ccbGroupId)).pipe(
			Effect.mapError(
				(error) =>
					new AttendancePdfExportError({
						cause: error,
						message: "Failed to fetch group participants from CCB",
					}),
			),
		);

		const attendanceProfile = yield* getAttendanceProfileOrEmpty(
			ccb,
			params.eventId,
			params.occurrenceDate,
		);

		// CCB alternates between object and array payloads for both participants and attendees.
		const participants = participantsResponse.groups?.group?.participants?.participant as
			| {
					id?: string;
					name?: string;
			  }[]
			| { id?: string; name?: string }
			| undefined;

		let participantList: { id?: string; name?: string }[] = [];
		if (Array.isArray(participants)) {
			participantList = participants;
		} else if (participants) {
			participantList = [participants];
		}

		const attendeePayload = attendanceProfile?.events?.event?.attendees?.attendee;
		let attendeeList: { id?: string }[] = [];
		if (Array.isArray(attendeePayload)) {
			attendeeList = attendeePayload;
		} else if (attendeePayload) {
			attendeeList = [attendeePayload];
		}

		const attendedIds = new Set(
			attendeeList.map((item) => String(item.id ?? "")).filter((id) => id.length > 0),
		);

		// Start from the full participant roster, then mark the subset that attended.
		const attendeeById = new Map<string, EventAttendeeStatus>();
		for (const participant of participantList) {
			const participantId = String(participant.id ?? "");
			if (participantId) {
				const attendee: EventAttendeeStatus = {
					attended: attendedIds.has(participantId),
					attendeeCCBID: participantId,
				};
				if (participant.name) {
					attendee.attendeeName = capitalizeText(participant.name);
				}
				attendeeById.set(participantId, attendee);
			}
		}

		for (const attendedId of attendedIds) {
			if (!attendeeById.has(attendedId)) {
				attendeeById.set(attendedId, {
					attended: true,
					attendeeCCBID: attendedId,
				});
			}
		}

		const attendees = [...attendeeById.values()].toSorted((a, b) => {
			const idComparison = a.attendeeCCBID.localeCompare(b.attendeeCCBID);
			if (idComparison !== 0) {
				return idComparison;
			}
			return (a.attendeeName ?? "").localeCompare(b.attendeeName ?? "");
		});

		const snapshot: EventAttendanceSnapshot = {
			attendees,
			attendeesCount: attendees.length,
			ccbGroupId: participantsResponse.groups?.group?.id ?? params.ccbGroupId,
			eventId: params.eventId,
			eventName: participantsResponse.groups?.group?.name ?? "",
			occurrenceDate: params.occurrenceDate,
		};
		if (attendanceProfile?.events?.event?.notes) {
			snapshot.notes = attendanceProfile.events.event.notes;
		}
		if (attendanceProfile?.events?.event?.topic) {
			snapshot.topic = attendanceProfile.events.event.topic;
		}
		return snapshot;
	});
