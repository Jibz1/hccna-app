import { useKnownOperationGuard } from "@/graphql/knownOperationGuard";
import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import { describe, expect, it, spyOn } from "bun:test";
import { GraphQLError, parse } from "graphql";

const invokeOnParse = (plugin: ReturnType<typeof useKnownOperationGuard>, query: string) => {
	const { onParse } = plugin;
	if (!onParse) {
		throw new Error("plugin must define onParse");
	}
	const afterParse = onParse({} as never);
	if (!afterParse) {
		throw new Error("onParse must return an after-parse callback");
	}
	return afterParse({ result: parse(query) } as never);
};

describe("useKnownOperationGuard", () => {
	it("rejects unknown operations when enforcement is on", () => {
		const plugin = useKnownOperationGuard({ enforce: true });
		expect(() => invokeOnParse(plugin, "query TotallyUnknownQuery { __typename }")).toThrow(
			GraphQLError,
		);
	});

	it("rejects a non-introspection document even when named IntrospectionQuery", () => {
		const plugin = useKnownOperationGuard({ enforce: true });
		expect(() => invokeOnParse(plugin, "query IntrospectionQuery { __typename }")).toThrow(
			GraphQLError,
		);
	});

	// Operations production traffic sent in October 2026 that the list was missing.
	it.each([
		// Mobile app (Relay)
		"CampusesQuery",
		"ExportEventAttendanceModalQuery",
		"ExportEventAttendanceQuery",
		"MinistryToolsAccessQuery",
		"UserGivingQuery",
		"UserProfileQuery",
		"UserUpdateProfileMutation",
		"UserWoaQuery",
		"useExportEventAttendanceMutation",
		// Website
		"WebsiteCcbForms",
		"WebsiteLiveStreamStatus",
		"WebsiteVerseOfTheDay",
		// Cloud Scheduler jobs and Strapi 5 change notices
		"SetVerseOfTheDay",
		"VodPushNotification",
		"Strapi5ChangeNoticeMutation",
	])("accepts %s, which a current client sends", (operationName) => {
		const plugin = useKnownOperationGuard({ enforce: true });
		expect(() => invokeOnParse(plugin, `query ${operationName} { __typename }`)).not.toThrow();
	});

	it("warns about an unknown operation once, not on every request", () => {
		const warn = spyOn(getLogger(), "warn").mockImplementation(() => {});
		try {
			const plugin = useKnownOperationGuard({ enforce: false });

			invokeOnParse(plugin, "query RepeatedProbe { __typename }");
			invokeOnParse(plugin, "query RepeatedProbe { __typename }");
			invokeOnParse(plugin, "query OtherProbe { __typename }");

			expect(warn.mock.calls.map(([fields]) => fields)).toEqual([
				{ operationName: "RepeatedProbe" },
				{ operationName: "OtherProbe" },
			]);
		} finally {
			warn.mockRestore();
		}
	});
});
