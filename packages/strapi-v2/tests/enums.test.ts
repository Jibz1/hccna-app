import { describe, expect, it } from "bun:test";

import {
	leadershipGroupValue,
	REOCCURRENCE_DISPLAY_VALUES,
	reoccurrenceValue,
	type LeadershipGroupName,
	type ReoccurrenceName,
} from "../src/enums";

// Strapi derives GraphQL enum names by replacing every non-alphanumeric run with "_".
const toGraphQLName = (value: string) => value.replaceAll(/[^A-Za-z0-9]+/gu, "_");

describe("enum names", () => {
	it("maps every recurrence GraphQL name back to its CMS value", () => {
		const names: (typeof ReoccurrenceName.Type)[] = [
			"One_time_Event",
			"Daily",
			"Weekly",
			"BiWeekly",
			"Monthly",
			"Twice_a_month",
		];
		for (const name of names) {
			expect(toGraphQLName(reoccurrenceValue(name))).toBe(name);
		}
		expect(names.map(reoccurrenceValue)).toEqual([...REOCCURRENCE_DISPLAY_VALUES]);
	});

	it("maps every leadership group GraphQL name back to its CMS value", () => {
		const names: (typeof LeadershipGroupName.Type)[] = [
			"Regional_Pastors",
			"Lead_Pastors_Campus_Leads",
			"Ministers",
			"HODs",
			"Decons",
		];
		for (const name of names) {
			expect(toGraphQLName(leadershipGroupValue(name))).toBe(name);
		}
		expect(leadershipGroupValue("Lead_Pastors_Campus_Leads")).toBe("Lead Pastors/Campus Leads");
	});
});
