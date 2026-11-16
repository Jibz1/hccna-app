import { CCBService } from "@/effect/services/CCBService";
import { createMockContext } from "@/graphql/__tests__/utils/test-context";
import { resolvePreviousFiveYearsGiving } from "@/graphql/schema/user";
import { describe, expect, it, mock } from "bun:test";
import { Effect } from "effect";

import type { UserGiving } from "@/effect/services/giving/parseGiving";

// Exercise the real resolver and normalization with one shared cache across requests.
describe("legacy giving cache isolation", () => {
	it.each([
		["member-a", "member-b"],
		["member-b", "member-a"],
	])("isolates %s and %s in the same family", async (first, second) => {
		const values = new Map<string, (UserGiving & { year: number })[]>();
		const years = Array.from({ length: 5 }, (_, index) => new Date().getFullYear() - index);
		values.set(`shared-family:${years.join(",")}`, [
			{ ccbId: "old-member", total: 999, giving: [], numberOfGiving: 0, year: years[0]! },
		]);
		const cache = {
			get: (key: string) =>
				Promise.resolve({
					value: values.get(key) ?? null,
					stale: false,
					expiresAt: Date.now() + 60_000,
				}),
			set: (key: string, value: (UserGiving & { year: number })[]) => {
				values.set(key, value);
				return Promise.resolve();
			},
		};
		// CCB answers per year; each year's gifts are dated in that year.
		const getGiving = mock((_familyId: string, year: number) =>
			Effect.succeed({
				transactions: {
					transaction: [
						{
							date: `${year}-01-02`,
							individual: { id: "member-a" },
							transaction_details: { transaction_detail: { id: "donation-a", amount: 10 } },
						},
						{
							date: `${year}-01-02`,
							individual: { id: "member-b" },
							transaction_details: { transaction_detail: { id: "donation-b", amount: 20 } },
						},
					],
				},
			}),
		);
		const fetchMember = async (member: string) => {
			const profile = {
				uid: member,
				email: `${member}@example.com`,
				firstName: "Member",
				lastName: "Test",
				img: "https://example.com/photo",
				provider: "email",
				isVerified: true,
				ccbId: member,
				ccbFamilyId: "shared-family",
			};
			const context = createMockContext({
				// Only the loader's load method is used by the resolver.
				loaders: { userProfile: { load: () => Promise.resolve(profile) } as never },
			});
			const result = await Effect.runPromise(
				resolvePreviousFiveYearsGiving(context, member, cache).pipe(
					// Other CCB operations are not used by this resolver.
					Effect.provideService(CCBService, { getGiving } as never),
				),
			);
			expect(result).toHaveLength(5);
			for (const year of result ?? []) {
				expect(year.ccbId).toBe(member);
				expect(year.total).toBe(member === "member-a" ? 10 : 20);
				expect(year.giving.map((giving) => giving.transactionId)).toEqual([
					member === "member-a" ? "donation-a" : "donation-b",
				]);
			}
		};
		await fetchMember(first);
		await fetchMember(second);
		expect(getGiving).toHaveBeenCalledTimes(10);
		await fetchMember(first);
		await fetchMember(second);
		expect(getGiving).toHaveBeenCalledTimes(10);
	});
});
