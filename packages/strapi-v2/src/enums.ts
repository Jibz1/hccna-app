import { Schema } from "effect";

// Strapi 5 GraphQL rewrites enum values into GraphQL names in RESPONSES
// ("One time Event" → One_time_Event). FILTERS still compare the stored value,
// so query variables must use the display values, never these names.
const reoccurrenceDisplay = {
	One_time_Event: "One time Event",
	Daily: "Daily",
	Weekly: "Weekly",
	BiWeekly: "BiWeekly",
	Monthly: "Monthly",
	Twice_a_month: "Twice a month",
} as const;

const leadershipGroupDisplay = {
	Regional_Pastors: "Regional Pastors",
	Lead_Pastors_Campus_Leads: "Lead Pastors/Campus Leads",
	Ministers: "Ministers",
	HODs: "HODs",
	Decons: "Decons",
} as const;

export const ReoccurrenceName = Schema.Literals([
	"One_time_Event",
	"Daily",
	"Weekly",
	"BiWeekly",
	"Monthly",
	"Twice_a_month",
]);

export const LeadershipGroupName = Schema.Literals([
	"Regional_Pastors",
	"Lead_Pastors_Campus_Leads",
	"Ministers",
	"HODs",
	"Decons",
]);

export const GivingPlatformName = Schema.Literals(["Zelle", "Cashapp", "Givelify", "Website", "Other"]);

export const REOCCURRENCE_DISPLAY_VALUES = Object.values(reoccurrenceDisplay);

export const reoccurrenceValue = (name: typeof ReoccurrenceName.Type) => reoccurrenceDisplay[name];

export const leadershipGroupValue = (name: typeof LeadershipGroupName.Type) =>
	leadershipGroupDisplay[name];
