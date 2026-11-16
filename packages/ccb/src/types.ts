import { Data, type Schema } from "effect";

import { AddToGroupSchema } from "./schemas/AddToGroup";
import { ResponseSchema as AttendanceProfileSchema } from "./schemas/AttendanceProfile";
import { CCBFormsSchema } from "./schemas/CCBForms";
import { CCBGroupsSchema } from "./schemas/GetCCBGroups";
import { ResponseSchema as GivingSchema } from "./schemas/Givings";
import { ResponseSchema as GroupByIdSchema } from "./schemas/GroupById";
import { GroupProfileResponseSchema } from "./schemas/GroupProfile";
import { GroupParticipantsSchema } from "./schemas/GroupsParticipants";
import { ResponseSchema } from "./schemas/RSP";

/** Unified CCB request type enum — merges all 3 prior definitions. */
export enum CCBRequestType {
	SEARCH_USER_BY_EMAIL = "searchUserByEmail",
	GET_USER_GROUPS_BY_ID = "getUserGroupsById",
	GET_GROUPS = "getGroups",
	ADD_USER_GROUPS = "addUserGroups",
	REMOVE_USER_GROUP = "removeUserGroup",
	GET_GIVING = "getGiving",
	GET_GROUPS_MEMBERS = "getGroupsMembers",
	GET_ATTENDANCE_PROFILE = "getAttendanceProfile",
	GET_FORMS = "getForms",
}

/** Per-request-type parameter shapes. */
export interface CCBParams {
	[CCBRequestType.SEARCH_USER_BY_EMAIL]: { email: string };
	[CCBRequestType.GET_USER_GROUPS_BY_ID]: { individualId: number };
	[CCBRequestType.GET_GROUPS]: { modifiedSince?: string };
	[CCBRequestType.ADD_USER_GROUPS]: {
		individualId: number;
		groupId: number;
		isPending?: boolean;
	};
	[CCBRequestType.REMOVE_USER_GROUP]: { individualId: number; groupId: number };
	[CCBRequestType.GET_GIVING]: { familyId: string; year?: number };
	[CCBRequestType.GET_GROUPS_MEMBERS]: { groupId: number };
	[CCBRequestType.GET_ATTENDANCE_PROFILE]: {
		eventId: number;
		occurrence: string;
	};
	[CCBRequestType.GET_FORMS]: Record<string, never>;
}

/** Maps each request type to its Effect Schema for runtime validation. */
export const CCB_Response = {
	[CCBRequestType.SEARCH_USER_BY_EMAIL]: ResponseSchema,
	[CCBRequestType.GET_USER_GROUPS_BY_ID]: GroupByIdSchema,
	[CCBRequestType.GET_GROUPS]: CCBGroupsSchema,
	[CCBRequestType.ADD_USER_GROUPS]: AddToGroupSchema,
	[CCBRequestType.REMOVE_USER_GROUP]: GroupProfileResponseSchema,
	[CCBRequestType.GET_GIVING]: GivingSchema,
	[CCBRequestType.GET_GROUPS_MEMBERS]: GroupParticipantsSchema,
	[CCBRequestType.GET_ATTENDANCE_PROFILE]: AttendanceProfileSchema,
	[CCBRequestType.GET_FORMS]: CCBFormsSchema,
} as const;

/** Maps each request type to its inferred response type. */
export type CCBResponse<T extends CCBRequestType> = Schema.Schema.Type<(typeof CCB_Response)[T]>;

export class CCBFetchError extends Data.TaggedError("CCBFetchError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class CCBParseError extends Data.TaggedError("CCBParseError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class CCBRemoteError extends Data.TaggedError("CCBRemoteError")<{
	readonly message: string;
	readonly ccbError?: string;
}> {}

export type CCBError = CCBFetchError | CCBParseError | CCBRemoteError;

export interface CreateEventAttendanceInput {
	eventId: number | string;
	occurrence: string;
	attendeeIds: (number | string)[];
	topic: string;
	notes: string;
}
