import { CCBService } from "@/effect/services/CCBService";
import { CmsContent } from "@/effect/services/cms/content/CmsContent";
import { getOnboardingProfileEffect } from "@/services/onboarding/userProvisioning";
import { describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";

import type { SearchUserByEmailResponse } from "@hccnj/ccb";

const email = "ada@example.com";
const individual = {
	id: "42",
	login: email,
	first_name: "Ada",
	last_name: "Example",
	family: { id: "7" },
};

const matched: SearchUserByEmailResponse = { individuals: { individual } };

const lookup = (groupIds: readonly string[], response = matched) => {
	const searchUserByEmail = mock(() => Effect.succeed(response));
	const getUserGroupsById = mock(() =>
		Effect.succeed({
			individuals: {
				individual: { groups: { group: groupIds.map((group_id) => ({ group_id })) } },
			},
		}),
	);
	const layer = Layer.mergeAll(
		Layer.succeed(CCBService, { searchUserByEmail, getUserGroupsById } as never),
		Layer.succeed(CmsContent, {
			departments: Effect.succeed([{ id: 1, slug: "worship", ccbId: "5", name: "Worship" }]),
			ministries: Effect.succeed([{ id: 2, slug: "youth", ccbId: "6", name: "Youth" }]),
		} as never),
	);
	return {
		run: () => Effect.runPromise(getOnboardingProfileEffect(email).pipe(Effect.provide(layer))),
		searchUserByEmail,
		getUserGroupsById,
	};
};

describe("directory profile lookup", () => {
	it("reports a matched member's groups, read fresh from CCB", async () => {
		const ccb = lookup(["5", "6"]);
		const profile = await ccb.run();
		expect(profile).toMatchObject({
			ccbId: "42",
			ccbFamilyId: "7",
			departments: [{ slug: "worship" }],
			ministries: [{ slug: "youth" }],
		});
		expect(ccb.searchUserByEmail).toHaveBeenCalledWith(email, { skipCache: true });
		expect(ccb.getUserGroupsById).toHaveBeenCalledWith(42, { skipCache: true });
	});

	it("reports empty group lists for a matched member with no groups", async () => {
		const profile = await lookup([]).run();
		expect(profile?.departments).toEqual([]);
		expect(profile?.ministries).toEqual([]);
	});

	it.each([
		{ individuals: { count: "0" } },
		{ individuals: { count: "0", individual: null } },
		{ individuals: { individual: [] } },
	])("clears memberships on an explicit empty directory result (%j)", async (response) => {
		const ccb = lookup([], response);
		expect(await ccb.run()).toEqual({ email, departments: [], ministries: [] });
		expect(ccb.getUserGroupsById).not.toHaveBeenCalled();
	});

	it.each([
		{},
		{ individuals: { individual: null } },
		{ individuals: { individual: [{ ...individual, login: "another@example.com" }] } },
	])("preserves memberships when the result is missing or ambiguous (%j)", async (response) => {
		const ccb = lookup([], response);
		expect(await ccb.run()).toBeNull();
		expect(ccb.getUserGroupsById).not.toHaveBeenCalled();
	});
});
