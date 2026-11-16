import {
	AttendanceExportService,
	type AttendanceExportFormat,
} from "@/effect/services/AttendanceExportService";
import { CCBService } from "@/effect/services/CCBService";
import { authScope } from "@/graphql/auth-scopes";
import { builder } from "@/graphql/builder";
import { capitalizeText } from "@/utils/capitalizeText";
import { FIRST_INDEX } from "@/utils/constants";
import { omitUndefined } from "@/utils/omitUndefined";
import { format, startOfWeek } from "date-fns";
import { Effect, Predicate } from "effect";
import { GraphQLError } from "graphql";

import {
	getAllEventAttendance,
	getEventAttendance,
	getEventAttendanceMap,
	EventAttendanceRef as KidsEventAttendanceRef,
	type ExportAttendanceEventRecord,
} from "../user/event-coordinator";

import type { GraphQLContext } from "@/graphql/context";

const BULK_LOOKUP_LIMIT = 50;
export const STATSIG_EVENT_ATTENDANCE_EXPORT_ALLOWLIST = "eventattendanceexportallowlist";

type GraphQLEffectRunner = GraphQLContext["effect"]["runPromise"];

/**
 * Translate export failures into stable GraphQL errors for the mobile clients.
 */
function toAttendanceExportGraphQLError(
	cause: unknown,
	context: {
		ccbId?: string;
		eventId?: string;
		format: AttendanceExportFormat;
		inputSize?: number;
		occurrenceDate?: string;
		operation: "exportEventAttendancePdf" | "exportEventAttendeesPdf";
	},
) {
	if (cause instanceof Error) {
		if (cause.message.includes("You are not authorized")) {
			return new GraphQLError(cause.message, {
				extensions: {
					code: "FORBIDDEN",
					reason: "ACCESS_DENIED",
					...context,
				},
			});
		}
		if (cause.message.includes("No attendance found")) {
			return new GraphQLError(cause.message, {
				extensions: {
					code: "NO_EXPORT_DATA",
					reason: "NO_EVENT_ATTENDEES",
					...context,
				},
			});
		}
		if (cause.message.includes("No matching attendees were found")) {
			return new GraphQLError(cause.message, {
				extensions: {
					code: "NO_EXPORT_DATA",
					reason: "NO_MATCHING_LOOKUP_ROWS",
					hint: "Verify ccbId belongs to the event group for the occurrenceDate.",
					...context,
				},
			});
		}
		if (cause.message.includes("No attended attendees were found")) {
			return new GraphQLError(cause.message, {
				extensions: {
					code: "NO_EXPORT_DATA",
					reason: "NO_ATTENDED_ROWS",
					...context,
				},
			});
		}
		return new GraphQLError(cause.message, {
			extensions: {
				code: "ATTENDANCE_EXPORT_FAILED",
				reason: "RUNTIME_FAILURE",
				...context,
			},
		});
	}

	return new GraphQLError("Failed to export attendance.", {
		extensions: {
			code: "ATTENDANCE_EXPORT_FAILED",
			...context,
		},
	});
}

function normalizeEmail(value: string | null | undefined) {
	return value?.trim().toLowerCase() ?? "";
}

function isEmailAllowed(ctx: Pick<GraphQLContext, "currentUserEmail" | "statsig">, email: string) {
	const normalizedEmail = normalizeEmail(email);
	if (!normalizedEmail) {
		return false;
	}

	const allowedEmails = ctx.statsig
		.getDynamicConfig(STATSIG_EVENT_ATTENDANCE_EXPORT_ALLOWLIST)
		.getValue("allowedEmails", [] as string[]);

	const normalizedAllowedEmails = new Set(
		(Array.isArray(allowedEmails) ? allowedEmails : [])
			.map((emailAddress) => normalizeEmail(Predicate.isString(emailAddress) ? emailAddress : null))
			.filter(Boolean),
	);

	return normalizedAllowedEmails.has(normalizedEmail);
}

function assertExportEventAttendanceByCcbPdfAccess(
	ctx: Pick<GraphQLContext, "currentUserEmail" | "statsig">,
) {
	if (!isEmailAllowed(ctx, ctx.currentUserEmail ?? "")) {
		throw new Error("You are not authorized to perform this action");
	}
}

// Attendance writes default to the current church week unless a date is provided.
function getCheckInDate(attendanceRecordDate?: string) {
	const mostRecentSunday = attendanceRecordDate
		? new Date(attendanceRecordDate)
		: startOfWeek(new Date(), { weekStartsOn: 0 });

	return {
		attendanceRecordDate: format(mostRecentSunday, "yyyy-MM-dd"),
		attendanceFormatDate: format(mostRecentSunday, "MMMM d, yyyy"),
	};
}

// Map each coordinator-owned event to the group that controls its attendance records.
async function getCoordinatorEventMap(currentUserEmail: string, runEffect: GraphQLEffectRunner) {
	const coordinatorEvents = await getEventAttendance(currentUserEmail, runEffect);

	if (!coordinatorEvents || !coordinatorEvents?.length) {
		throw new Error("You are not authorized to perform this action");
	}

	const eventMap = new Map<string, string>();
	for (const event of coordinatorEvents) {
		if (event.AttendanceEventCCBID && event.AttendingGroupCCBID) {
			eventMap.set(event.AttendanceEventCCBID, event.AttendingGroupCCBID);
		}
	}

	return eventMap;
}

interface EventAttendee {
	attendeeName: string;
	attendeeCCBID: string;
}

interface AttendanceRecord {
	notes?: string | undefined;
	topic?: string | undefined;
	attendee: string[];
}

interface AttendandedEvent {
	eventName: string;
	ccbEventId: string;
	ccbGroupId: string;
	attendeesCount: number;
	attendees: EventAttendee[];
	attendanceRecordDate: string;
	attendanceRecord?: AttendanceRecord | undefined;
}

interface EventAttendeeStatus {
	attendeeCCBID: string;
	attendeeName?: string | undefined;
	attended: boolean;
}

interface EventAttendanceSnapshot {
	attendees: EventAttendeeStatus[];
	attendeesCount: number;
	ccbGroupId: string;
	eventId: string;
	eventName: string;
	notes?: string | undefined;
	occurrenceDate: string;
	topic?: string | undefined;
}

interface EventAttendanceLookupResult {
	attended: boolean;
	attendeeName?: string | undefined;
	ccbId: string;
	eventId: string;
	occurrenceDate: string;
}

interface AttendancePdfExportResult {
	dataHash: string;
	exportKey: string;
	format: AttendanceExportFormat;
	generated: boolean;
	lastGeneratedAt: Date;
	url: string;
}

interface ExportAttendanceResult {
	exportAttendanceEvent: ExportAttendanceEventRecord[];
}

const AttendanceExportFormatRef = builder.enumType("AttendanceExportFormat", {
	values: ["CSV", "PDF"] as const,
});

const ExportAttendanceEventRef = builder
	.objectRef<ExportAttendanceEventRecord>("ExportAttendanceEvent")
	.implement({
		fields: (t) => ({
			attendanceEventCCBID: t.exposeString("attendanceEventCCBID"),
			attendanceEventName: t.exposeString("attendanceEventName"),
		}),
	});

const EventAttendeeRef = builder.objectRef<EventAttendee>("EventAttendee").implement({
	fields: (t) => ({
		attendeeName: t.exposeString("attendeeName"),
		attendeeCCBID: t.exposeString("attendeeCCBID"),
	}),
});

const AttendanceRecordRef = builder.objectRef<AttendanceRecord>("AttendanceRecord").implement({
	fields: (t) => ({
		notes: t.exposeString("notes"),
		topic: t.exposeString("topic"),
		attendee: t.exposeStringList("attendee"),
	}),
});

const AttendandedEventRef = builder.objectRef<AttendandedEvent>("AttendandedEvent").implement({
	authScopes: authScope.signedIn,
	fields: (t) => ({
		eventName: t.exposeString("eventName"),
		ccbEventId: t.exposeString("ccbEventId"),
		ccbGroupId: t.exposeString("ccbGroupId"),
		attendeesCount: t.exposeInt("attendeesCount"),
		attendanceRecordDate: t.exposeString("attendanceRecordDate", {
			nullable: true,
		}),
		attendanceRecord: t.field({
			type: AttendanceRecordRef,
			nullable: true,
			resolve: (root) => root.attendanceRecord,
		}),
		attendees: t.field({
			type: [EventAttendeeRef],
			resolve: (root) => root.attendees,
		}),
	}),
});

const EventAttendeeStatusRef = builder
	.objectRef<EventAttendeeStatus>("EventAttendeeStatus")
	.implement({
		fields: (t) => ({
			attended: t.exposeBoolean("attended"),
			attendeeCCBID: t.exposeString("attendeeCCBID"),
			attendeeName: t.exposeString("attendeeName", { nullable: true }),
		}),
	});

const EventAttendanceSnapshotRef = builder
	.objectRef<EventAttendanceSnapshot>("EventAttendanceSnapshot")
	.implement({
		fields: (t) => ({
			attendees: t.field({
				type: [EventAttendeeStatusRef],
				resolve: (root) => root.attendees,
			}),
			attendeesCount: t.exposeInt("attendeesCount"),
			ccbGroupId: t.exposeString("ccbGroupId"),
			eventId: t.exposeString("eventId"),
			eventName: t.exposeString("eventName"),
			notes: t.exposeString("notes", { nullable: true }),
			occurrenceDate: t.exposeString("occurrenceDate"),
			topic: t.exposeString("topic", { nullable: true }),
		}),
	});

const EventAttendanceLookupInputRef = builder.inputType("EventAttendanceLookupInput", {
	fields: (t) => ({
		ccbId: t.string({ required: true }),
		eventId: t.string({ required: true }),
		occurrenceDate: t.string({ required: true }),
	}),
});

const EventAttendanceExportEventInputRef = builder.inputType("EventAttendanceExportEventInput", {
	fields: (t) => ({
		eventId: t.string({ required: true }),
	}),
});

const EventAttendanceLookupResultRef = builder
	.objectRef<EventAttendanceLookupResult>("EventAttendanceLookupResult")
	.implement({
		fields: (t) => ({
			attended: t.exposeBoolean("attended"),
			attendeeName: t.exposeString("attendeeName", { nullable: true }),
			ccbId: t.exposeString("ccbId"),
			eventId: t.exposeString("eventId"),
			occurrenceDate: t.exposeString("occurrenceDate"),
		}),
	});

const AttendancePdfExportResultRef = builder
	.objectRef<AttendancePdfExportResult>("AttendancePdfExportResult")
	.implement({
		fields: (t) => ({
			dataHash: t.exposeString("dataHash"),
			exportKey: t.exposeString("exportKey"),
			format: t.field({
				type: AttendanceExportFormatRef,
				resolve: (root) => root.format,
			}),
			generated: t.exposeBoolean("generated"),
			lastGeneratedAt: t.field({
				type: "DateTime",
				resolve: (root) => root.lastGeneratedAt,
			}),
			url: t.exposeString("url"),
		}),
	});

const ExportAttendanceResultRef = builder
	.objectRef<ExportAttendanceResult>("ExportAttendanceResult")
	.implement({
		fields: (t) => ({
			exportAttendanceEvent: t.field({
				type: [ExportAttendanceEventRef],
				resolve: (root) => root.exportAttendanceEvent,
			}),
		}),
	});

// Attendance queries either return coordinator event summaries or export-oriented views.
builder.queryFields((t) => ({
	exportAttendance: t.field({
		nullable: true,
		authScopes: authScope.signedIn,
		type: ExportAttendanceResultRef,
		resolve: async (_, __, ctx) => {
			if (!ctx.currentUserEmail) {
				return null;
			}

			if (!isEmailAllowed(ctx, ctx.currentUserEmail)) {
				return null;
			}
			try {
				return {
					exportAttendanceEvent: await getAllEventAttendance(ctx.effect.runPromise),
				};
			} catch (error) {
				console.error(error);
				throw new GraphQLError("Failed to load export attendance.", {
					extensions: {
						code: "ATTENDANCE_EXPORT_FAILED",
						reason: "RUNTIME_FAILURE",
					},
				});
			}
		},
	}),
	eventWithAttendance: t.field({
		args: {
			ccbGroupId: t.arg.string({
				required: true,
			}),
			eventID: t.arg.string({
				required: true,
			}),
		},
		authScopes: authScope.signedIn,
		type: AttendandedEventRef,
		resolve: async (_, { ccbGroupId, eventID }, ctx) => {
			try {
				if (!ctx.currentUserEmail) {
					throw new Error("You are not authorized to perform this action");
				}
				const coordinatorEvents = await getEventAttendance(
					ctx.currentUserEmail,
					ctx.effect.runPromise,
				);
				if (!coordinatorEvents) {
					throw new Error("You are not authorized to perform this action");
				}

				// The caller must coordinate this event for this group: a group match alone
				// would let them read any event's record by passing its id.
				const isCoordinator = coordinatorEvents.some(
					(event) =>
						event.AttendingGroupCCBID === ccbGroupId && event.AttendanceEventCCBID === eventID,
				);
				if (!isCoordinator) {
					throw new Error("You are not authorized to perform this action");
				}
				const attendanceRecordDate = getCheckInDate();

				const result = await ctx.effect.runPromise(
					Effect.gen(function* () {
						const ccb = yield* CCBService;
						// Participant rosters and recorded attendance come from separate CCB endpoints.
						const groupParticipants = yield* ccb.getGroupParticipants(Number(ccbGroupId));
						const attendanceProfile = yield* ccb
							.getAttendanceProfile(Number(eventID), attendanceRecordDate.attendanceRecordDate)
							.pipe(Effect.catch(() => Effect.succeed(null)));
						return {
							cachedResult: groupParticipants,
							uncachedResult: attendanceProfile,
						};
					}),
				);

				const attendeesCount = Number(result?.cachedResult?.groups?.count || "0");
				const attendanceRecord = result?.uncachedResult || null;
				const attendees = result?.cachedResult?.groups?.group?.participants?.participant.map(
					(participant: any) => ({
						attendeeName: capitalizeText(participant.name),
						attendeeCCBID: participant?.id || "",
					}),
				);
				const eventAttendance = omitUndefined({
					attendeesCount,
					eventName: result?.cachedResult?.groups?.group?.name || "",
					ccbEventId: eventID,
					ccbGroupId: result?.cachedResult?.groups?.group?.id || ccbGroupId,
					attendees,
					attendanceRecordDate: attendanceRecordDate.attendanceFormatDate,
					attendanceRecord: attendanceRecord
						? {
								notes: attendanceRecord.events.event.notes,
								topic: attendanceRecord.events.event.topic,
								attendee: attendanceRecord.events.event?.attendees.attendee.map(
									(attendee: any) => attendee.id,
								),
							}
						: undefined,
				});
				return eventAttendance;
			} catch (error) {
				console.error(error);
				return null;
			}
		},
	}),
	eventAttendees: t.field({
		args: {
			eventId: t.arg.string({ required: true }),
			occurrenceDate: t.arg.string({ required: true }),
		},
		authScopes: authScope.signedIn,
		type: EventAttendanceSnapshotRef,
		resolve: async (_, { eventId, occurrenceDate }, ctx) => {
			if (!ctx.currentUserEmail) {
				throw new Error("You are not authorized to perform this action");
			}

			const coordinatorEventMap = await getCoordinatorEventMap(
				ctx.currentUserEmail,
				ctx.effect.runPromise,
			);
			const ccbGroupId = coordinatorEventMap.get(eventId);
			if (!ccbGroupId) {
				throw new Error("You are not authorized to perform this action");
			}

			// Resolve the caller's event permission first, then read the cached snapshot.
			return ctx.effect.runPromise(
				Effect.gen(function* () {
					const service = yield* AttendanceExportService;
					return yield* service.getEventAttendeesSnapshot({
						ccbGroupId,
						eventId,
						occurrenceDate,
					});
				}),
			);
		},
	}),
	eventAttendanceByCcb: t.field({
		args: {
			input: t.arg({
				required: true,
				type: [EventAttendanceLookupInputRef],
			}),
		},
		authScopes: authScope.signedIn,
		type: [EventAttendanceLookupResultRef],
		resolve: async (_, { input }, ctx) => {
			if (!ctx.currentUserEmail) {
				throw new Error("You are not authorized to perform this action");
			}
			if (input.length > BULK_LOOKUP_LIMIT) {
				throw new Error(`Bulk lookup limit exceeded. Maximum allowed is ${BULK_LOOKUP_LIMIT}.`);
			}

			const coordinatorEventMap = await getCoordinatorEventMap(
				ctx.currentUserEmail,
				ctx.effect.runPromise,
			);

			// Expand each requested event into the coordinator-owned group it belongs to.
			const authorizedInput = input.map((item) => {
				const ccbGroupId = coordinatorEventMap.get(item.eventId);
				if (!ccbGroupId) {
					throw new Error("You are not authorized to perform this action");
				}

				return {
					ccbGroupId,
					ccbId: item.ccbId,
					eventId: item.eventId,
					occurrenceDate: item.occurrenceDate,
				};
			});

			return ctx.effect.runPromise(
				Effect.gen(function* () {
					const service = yield* AttendanceExportService;
					return yield* service.getEventAttendanceByCcb(authorizedInput);
				}),
			);
		},
	}),
	kidsEventAttendance: t.field({
		nullable: true,
		authScopes: authScope.signedIn,
		type: t.listRef(KidsEventAttendanceRef, {
			nullable: true,
		}),
		resolve: async (_, __, ctx) => {
			try {
				const { currentUserEmail, currentUserUid } = ctx;
				if (!currentUserEmail || !currentUserUid) {
					return;
				}
				const userProfile = await ctx.loaders.userProfile.load(currentUserUid);
				if (!userProfile) {
					return;
				}
				const coordinatorEvents = await getEventAttendance(currentUserEmail, ctx.effect.runPromise);

				if (!coordinatorEvents || coordinatorEvents.length === FIRST_INDEX) {
					return;
				}

				return coordinatorEvents.map((item) => ({
					attendanceEventName: item.AttendanceEventName || "",
					eventAttendanceDescription: item.EventAttendanceDescription || "",
					attendanceEventCCBID: item.AttendanceEventCCBID || "",
					attendingGroupCCBID: item.AttendingGroupCCBID || "",
					coordinatorEmails: item.CoordinatorEmails || [],
				}));
			} catch (error) {
				console.error(error);
				return null;
			}
		},
	}),
}));

const EventAttendanceSchema = builder.inputType("UpdateEventAttendanceInput", {
	fields: (t) => ({
		attendeesIds: t.stringList({
			required: true,
			description: "List of attendees IDs",
		}),
		eventId: t.string({
			required: true,
			description: "Event ID",
		}),
		notes: t.string({
			required: true,
			description: "Notes",
		}),
		topic: t.string({
			required: true,
			description: "Topic",
		}),
	}),
});

const EventAttendanceResult = builder
	.objectRef<{
		success: boolean;
		message: string;
	}>("UpdateEventAttendanceResult")
	.implement({
		fields: (t) => ({
			success: t.boolean({
				description: "Update result success",
				resolve: (root) => root.success,
			}),
			message: t.string({
				description: "Update result message",
				resolve: (root) => root.message,
			}),
		}),
	});

// Attendance mutations either record a weekly check-in or trigger exports for a coordinator.
builder.mutationFields((t) => ({
	createEventAttendance: t.field({
		type: EventAttendanceResult,
		authScopes: authScope.signedIn,
		args: {
			input: t.arg({
				type: EventAttendanceSchema,
				required: true,
				description: "Event attendance input",
			}),
		},
		resolve: async (_, { input }, ctx) => {
			try {
				if (!ctx.currentUserEmail) {
					throw new Error("You are not authorized to perform this action");
				}
				const coordinatorEvents = await getEventAttendance(
					ctx.currentUserEmail,
					ctx.effect.runPromise,
				);
				// Coordinating some event is not enough: the write replaces this event's record in CCB.
				if (!coordinatorEvents?.some((event) => event.AttendanceEventCCBID === input.eventId)) {
					throw new Error("You are not authorized to perform this action");
				}

				// CCB records attendance against a concrete occurrence date, not just an event id.
				await ctx.effect.runPromise(
					Effect.gen(function* () {
						const ccb = yield* CCBService;
						yield* ccb.createEventAttendance({
							eventId: input.eventId,
							occurrence: getCheckInDate().attendanceRecordDate,
							attendeeIds: input.attendeesIds,
							topic: input.topic,
							notes: input.notes,
						});
					}),
				);

				return {
					success: true,
					message: "Event attendance created successfully",
				};
			} catch (error) {
				console.error(error);
				return {
					success: false,
					message: error instanceof Error ? error.message : "Failed to create event attendance",
				};
			}
		},
	}),
	exportEventAttendeesPdf: t.field({
		type: AttendancePdfExportResultRef,
		authScopes: authScope.signedIn,
		args: {
			eventId: t.arg.string({ required: true }),
			format: t.arg({
				defaultValue: "PDF",
				required: false,
				type: AttendanceExportFormatRef,
			}),
			occurrenceDate: t.arg.string({ required: true }),
		},
		resolve: async (_, { eventId, format: formatType, occurrenceDate }, ctx) => {
			if (!ctx.currentUserEmail) {
				throw new Error("You are not authorized to perform this action");
			}

			try {
				const coordinatorEventMap = await getCoordinatorEventMap(
					ctx.currentUserEmail,
					ctx.effect.runPromise,
				);
				const ccbGroupId = coordinatorEventMap.get(eventId);
				if (!ccbGroupId) {
					throw new Error("You are not authorized to perform this action");
				}

				return await ctx.effect.runPromise(
					Effect.gen(function* () {
						const service = yield* AttendanceExportService;
						return yield* service.exportEventAttendeesPdf(
							{
								ccbGroupId,
								eventId,
								occurrenceDate,
							},
							formatType ?? "PDF",
						);
					}),
				);
			} catch (error) {
				throw toAttendanceExportGraphQLError(error, {
					eventId,
					format: formatType ?? "PDF",
					occurrenceDate,
					operation: "exportEventAttendeesPdf",
				});
			}
		},
	}),
	exportEventAttendancePdf: t.field({
		type: AttendancePdfExportResultRef,
		authScopes: authScope.signedIn,
		args: {
			format: t.arg({
				defaultValue: "PDF",
				required: false,
				type: AttendanceExportFormatRef,
			}),
			occurrenceDate: t.arg.string({ required: true }),
			input: t.arg({
				required: true,
				type: [EventAttendanceExportEventInputRef],
			}),
		},
		resolve: async (_, { format: formatType, input, occurrenceDate }, ctx) => {
			if (!ctx.currentUserEmail) {
				throw new Error("You are not authorized to perform this action");
			}
			if (input.length > BULK_LOOKUP_LIMIT) {
				throw new Error(`Bulk lookup limit exceeded. Maximum allowed is ${BULK_LOOKUP_LIMIT}.`);
			}

			try {
				assertExportEventAttendanceByCcbPdfAccess(ctx);
				const eventAttendanceMap = await getEventAttendanceMap(ctx.effect.runPromise);
				const authorizedInput = input.map((item) => {
					const ccbGroupId = eventAttendanceMap.get(item.eventId);

					if (!ccbGroupId) {
						throw new Error("You are not authorized to perform this action");
					}

					return {
						ccbGroupId,
						eventId: item.eventId,
						occurrenceDate,
					};
				});

				return await ctx.effect.runPromise(
					Effect.gen(function* () {
						const service = yield* AttendanceExportService;
						return yield* service.exportEventAttendancePdf(authorizedInput, formatType ?? "PDF");
					}),
				);
			} catch (error) {
				const [firstInput] = input;
				throw toAttendanceExportGraphQLError(
					error,
					omitUndefined({
						format: formatType ?? "PDF",
						inputSize: input.length,
						operation: "exportEventAttendancePdf" as const,
						eventId: firstInput?.eventId || undefined,
						occurrenceDate,
					}),
				);
			}
		},
	}),
}));
