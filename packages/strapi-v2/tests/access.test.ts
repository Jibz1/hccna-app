import { describe, expect, it } from "bun:test";
import { Schema } from "effect";

import { CheckInData, toCheckInPermissions } from "../src/queries/checkIn";
import { DepartmentsData, MinistriesData, toDepartments, toMinistries } from "../src/queries/groups";
import {
	CampusStreamData,
	SPECIAL_STREAM_SLUGS,
	specialStreamChannelName,
	StreamChannelsData,
	toCampusAcl,
	toChannelAcl,
} from "../src/queries/streamAcl";

describe("stream access", () => {
	it("knows the two special stream slugs", () => {
		expect(SPECIAL_STREAM_SLUGS).toHaveLength(2);
		expect(specialStreamChannelName("house-of-stars-junior-church")).toBe("HCC JUNIOR CHURCH");
		expect(specialStreamChannelName("house-of-stars")).toBeUndefined();
	});

	it("rejects prototype pollution probes", () => {
		for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
			expect(specialStreamChannelName(key)).toBeUndefined();
		}
	});

	it("reads a named channel with raw coordinator rows", () => {
		const data = Schema.decodeUnknownSync(StreamChannelsData)({
			stream: {
				StreamChannel: [
					{
						ChannelName: "HCC JUNIOR CHURCH",
						CastrID: "castr-jc",
						CoordinatorEmails: [{ email: " Coord@Example.com ", excludesIDs: "a, b" }, { email: null, excludesIDs: null }],
					},
				],
			},
		});

		expect(toChannelAcl(data, "HCC JUNIOR CHURCH")).toEqual({
			streamId: "castr-jc",
			coordinators: [
				{ email: " Coord@Example.com ", excludesIds: "a, b" },
				{ email: null, excludesIds: null },
			],
		});
		expect(toChannelAcl(data, "ANOTHER CHANNEL")).toBeNull();
	});

	it("only accepts the campus whose slug was requested", () => {
		const data = Schema.decodeUnknownSync(CampusStreamData)({
			campuses: [{ slug: "light-house", Stream: { CastrID: "castr-lh", CoordinatorEmails: [] } }],
		});

		expect(toCampusAcl(data, "light-house")).toEqual({ streamId: "castr-lh", coordinators: [] });
		expect(toCampusAcl(data, "house-of-stars")).toBeNull();
	});
});

describe("check-in permissions", () => {
	it("maps one row per check-in admin entry", () => {
		const data = Schema.decodeUnknownSync(CheckInData)({
			checkInPermission: {
				CheckInAdmin: [
					{
						events_check_in: { EventName: "Morning Service - Kids", AttendanceDescription: "Kids", CCBEventID: "901", CCBGroupID: "902" },
						Emails: [{ email: "lead@example.com" }],
					},
					{ events_check_in: null, Emails: null },
				],
			},
		});

		expect(toCheckInPermissions(data)).toEqual([
			{ eventName: "Morning Service - Kids", description: "Kids", eventCcbId: "901", groupCcbId: "902", coordinatorEmails: ["lead@example.com"] },
			{ eventName: null, description: null, eventCcbId: null, groupCcbId: null, coordinatorEmails: [] },
		]);
	});

	it("returns null when the single type or its list is missing", () => {
		expect(toCheckInPermissions(Schema.decodeUnknownSync(CheckInData)({ checkInPermission: null }))).toBeNull();
		expect(toCheckInPermissions(Schema.decodeUnknownSync(CheckInData)({ checkInPermission: { CheckInAdmin: null } }))).toBeNull();
	});
});

describe("departments and ministries", () => {
	const header = { title: "Sample Choir", description: "Worship team", featureImage: { url: "https://img.example/choir.jpg" } };

	it("uses the CCB group id as the numeric id and drops rows without one", () => {
		const data = Schema.decodeUnknownSync(DepartmentsData)({
			departments: [
				{ slug: "sample-choir", Name: "Sample Choir", CCBID: "11", Header: header },
				{ slug: "no-ccb", Name: "No CCB", CCBID: null, Header: null },
				{ slug: "bad-ccb", Name: "Bad", CCBID: "abc", Header: null },
			],
		});

		expect(toDepartments(data)).toEqual([
			{ id: 11, slug: "sample-choir", ccbId: "11", name: "Sample Choir", fullName: "Sample Choir", description: "Worship team", image: "https://img.example/choir.jpg" },
		]);
	});

	it("names ministries from their header title", () => {
		const data = Schema.decodeUnknownSync(MinistriesData)({
			ministries: [{ slug: "family-life", PageName: "Family Life", CCBID: "48", Header: { ...header, title: "Family Ministry " } }],
		});

		expect(toMinistries(data)).toEqual([
			{ id: 48, slug: "family-life", ccbId: "48", name: "Family Ministry ", description: "Worship team", image: "https://img.example/choir.jpg" },
		]);
	});
});
