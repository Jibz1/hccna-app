import { CCBRequestType, type CCBParams } from "./types";

export const CCBServiceNames = {
	[CCBRequestType.SEARCH_USER_BY_EMAIL]: "individual_search",
	[CCBRequestType.GET_USER_GROUPS_BY_ID]: "individual_groups",
	[CCBRequestType.GET_GROUPS]: "group_profiles",
	[CCBRequestType.ADD_USER_GROUPS]: "add_individual_to_group",
	[CCBRequestType.REMOVE_USER_GROUP]: "remove_individual_from_group",
	[CCBRequestType.GET_GIVING]: "transactions_by_family",
	[CCBRequestType.GET_GROUPS_MEMBERS]: "group_participants",
	[CCBRequestType.GET_ATTENDANCE_PROFILE]: "attendance_profile",
	[CCBRequestType.GET_FORMS]: "forms",
} satisfies Record<CCBRequestType, string>;

export function buildCCBUrl<T extends CCBRequestType>(type: T, params: CCBParams[T]): string {
	const srv = CCBServiceNames[type];

	switch (type) {
		case CCBRequestType.SEARCH_USER_BY_EMAIL: {
			const p = params as CCBParams[CCBRequestType.SEARCH_USER_BY_EMAIL];
			return `srv=${srv}&email=${encodeURIComponent(p.email)}`;
		}
		case CCBRequestType.GET_USER_GROUPS_BY_ID: {
			const p = params as CCBParams[CCBRequestType.GET_USER_GROUPS_BY_ID];
			return `srv=${srv}&individual_id=${p.individualId}`;
		}
		case CCBRequestType.GET_GROUPS: {
			const p = params as CCBParams[CCBRequestType.GET_GROUPS];
			const modifiedSince = p.modifiedSince ?? "2010-02-01";
			return `srv=${srv}&modified_since=${modifiedSince}`;
		}
		case CCBRequestType.ADD_USER_GROUPS: {
			const p = params as CCBParams[CCBRequestType.ADD_USER_GROUPS];
			const status = p.isPending ? "" : "&status=requesting";
			return `srv=${srv}&id=${p.individualId}&group_id=${p.groupId}${status}`;
		}
		case CCBRequestType.REMOVE_USER_GROUP: {
			const p = params as CCBParams[CCBRequestType.REMOVE_USER_GROUP];
			return `srv=${srv}&id=${p.individualId}&group_id=${p.groupId}`;
		}
		case CCBRequestType.GET_GIVING: {
			const p = params as CCBParams[CCBRequestType.GET_GIVING];
			const year = p.year ?? new Date().getFullYear();
			const lastDayOfLastYear = `${year - 1}-12-31`;
			const endDate = `${year}-12-31`;
			return `srv=${srv}&family_id=${p.familyId}&modified_since=${lastDayOfLastYear}&date_end=${endDate}`;
		}
		case CCBRequestType.GET_GROUPS_MEMBERS: {
			const p = params as CCBParams[CCBRequestType.GET_GROUPS_MEMBERS];
			return `srv=${srv}&id=${p.groupId}`;
		}
		case CCBRequestType.GET_ATTENDANCE_PROFILE: {
			const p = params as CCBParams[CCBRequestType.GET_ATTENDANCE_PROFILE];
			return `srv=${srv}&id=${p.eventId}&occurrence=${p.occurrence}`;
		}
		case CCBRequestType.GET_FORMS: {
			return `srv=${srv}`;
		}
		default: {
			const _exhaustive: never = type;
			throw new Error(`[CCBClient] Unhandled request type: ${String(_exhaustive)}`);
		}
	}
}
