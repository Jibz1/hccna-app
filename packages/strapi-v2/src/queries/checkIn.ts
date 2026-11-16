import { Schema } from "effect";

import { Text } from "./shared";

import type { CmsCheckInPermission } from "../records";

export const CHECK_IN_OPERATION = "StrapiV2CheckInPermissions";
export const CHECK_IN_DOCUMENT = `query StrapiV2CheckInPermissions {
  checkInPermission {
    CheckInAdmin(pagination: { pageSize: 100 }) {
      events_check_in { EventName AttendanceDescription CCBEventID CCBGroupID }
      Emails(pagination: { pageSize: 100 }) { email }
    }
  }
}`;

export const CheckInData = Schema.Struct({
	checkInPermission: Schema.NullOr(
		Schema.Struct({
			CheckInAdmin: Schema.NullOr(
				Schema.Array(
					Schema.Struct({
						events_check_in: Schema.NullOr(
							Schema.Struct({ EventName: Text, AttendanceDescription: Text, CCBEventID: Text, CCBGroupID: Text }),
						),
						Emails: Schema.NullOr(Schema.Array(Schema.Struct({ email: Text }))),
					}),
				),
			),
		}),
	),
});

/** `null` when the list is missing, which the server treats as invalid data, like Strapi 4. */
export const toCheckInPermissions = (data: typeof CheckInData.Type): CmsCheckInPermission[] | null => {
	const rows = data.checkInPermission?.CheckInAdmin;
	if (rows === undefined || rows === null) {
		return null;
	}
	return rows.map((row) => ({
		eventName: row.events_check_in?.EventName ?? null,
		description: row.events_check_in?.AttendanceDescription ?? null,
		eventCcbId: row.events_check_in?.CCBEventID ?? null,
		groupCcbId: row.events_check_in?.CCBGroupID ?? null,
		coordinatorEmails: (row.Emails ?? []).map((entry) => entry.email),
	}));
};
