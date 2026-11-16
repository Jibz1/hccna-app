import { type UserGiving } from "@/effect/services/giving/parseGiving";
import { builder } from "@/graphql/builder";

import type { FIRST_INDEX } from "@/utils/constants";

type UserGivingWithYear = UserGiving & { year: number };

// Type for monthly grouped giving
interface MonthlyGivingGroup {
	month: string;
	givingList: NonNullable<UserGiving["giving"]>;
	total: number;
	number: number;
}

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const getMonthFromDate = (dateStr: string): number => {
	// Handle both formats:
	// - MM/dd/yyyy (from CCB/Redis)
	// - YYYY-MM-DD (from PostgreSQL)
	if (dateStr.includes("-")) {
		// YYYY-MM-DD format
		const month = dateStr.split("-")[1] ?? "0";
		return Number(month) - 1; // 0-indexed
	}
	// MM/dd/yyyy format
	const month = dateStr.split("/")[0] ?? "0";
	return Number(month) - 1; // 0-indexed
};

const getDayFromDate = (dateStr: string): number => {
	// Handle both formats:
	// - MM/dd/yyyy (from CCB/Redis)
	// - YYYY-MM-DD (from PostgreSQL)
	if (dateStr.includes("-")) {
		// YYYY-MM-DD format
		const day = dateStr.split("-")[2] ?? "0";
		return Number(day);
	}
	// MM/dd/yyyy format
	const day = dateStr.split("/")[1] ?? "0";
	return Number(day);
};

const UserDonation = builder
	.objectRef<NonNullable<UserGiving["giving"]>[typeof FIRST_INDEX]>("UserDonation")
	.implement({
		fields: (t) => ({
			amount: t.exposeFloat("amount", {
				description: "User amount",
			}),
			date: t.exposeString("date", {
				description: "User date",
			}),
			name: t.exposeString("name", {
				description: "User name",
			}),
			transactionId: t.exposeString("transactionId", {
				description: "User transaction id",
			}),
			taxDeductible: t.exposeBoolean("taxDeductible", {
				description: "User tax deductible",
			}),
			paymentType: t.exposeString("paymentType", {
				description: "User payment type",
			}),
			campus: t.exposeString("campus", {
				description: "User campus",
			}),
			campusId: t.exposeString("campusId", {
				description: "User campus id",
			}),
		}),
	});

const MonthlyGivingGroupType = builder
	.objectRef<MonthlyGivingGroup>("MonthlyGivingGroup")
	.implement({
		fields: (t) => ({
			month: t.exposeString("month", {
				description: "Month name (e.g., January)",
			}),
			givingList: t.field({
				type: [UserDonation],
				description: "List of donations for this month",
				resolve: (root) => root.givingList,
			}),
			total: t.exposeFloat("total", {
				description: "Total amount for this month",
			}),
			number: t.exposeInt("number", {
				description: "Number of donations for this month",
			}),
		}),
	});

export const UserDonationsFields = builder.objectRef<UserGiving>("UserDonations").implement({
	fields: (t) => ({
		ccbId: t.exposeString("ccbId", {
			description: "User ccb id",
		}),
		total: t.exposeFloat("total", {
			description: "User total",
		}),
		numberOfGiving: t.exposeInt("numberOfGiving", {
			description: "User number of giving",
		}),
		giving: t.field({
			type: [UserDonation],
			resolve: (root) => root.giving,
		}),
	}),
});

export const UserPreviousFiveYearsDonationsFields = builder
	.objectRef<UserGivingWithYear>("UserPreviousFiveYearsDonations")
	.implement({
		fields: (t) => ({
			ccbId: t.exposeString("ccbId", {
				description: "User ccb id",
			}),
			total: t.exposeFloat("total", {
				description: "User total",
			}),
			numberOfGiving: t.exposeInt("numberOfGiving", {
				description: "User number of giving",
			}),
			giving: t.field({
				type: [UserDonation],
				resolve: (root) => root.giving,
			}),
			year: t.exposeInt("year", {
				description: "User year",
			}),
			groupGivingByMonth: t.field({
				type: [MonthlyGivingGroupType],
				description: "Giving grouped by month",
				resolve: (root) => {
					const giving = root.giving ?? [];

					// Return empty array if no giving for this year
					if (giving.length === 0) {
						return [];
					}

					// Group donations by month index
					const monthlyMap = new Map<number, MonthlyGivingGroup>();

					for (const donation of giving) {
						const monthIndex = getMonthFromDate(donation.date);
						if (monthIndex >= 0 && monthIndex < 12) {
							const existing = monthlyMap.get(monthIndex);
							if (existing) {
								existing.givingList.push(donation);
								existing.total += donation.amount;
								existing.number += 1;
							} else {
								monthlyMap.set(monthIndex, {
									month: MONTH_NAMES[monthIndex] ?? "",
									givingList: [donation],
									total: donation.amount,
									number: 1,
								});
							}
						}
					}

					// Return only months that have giving, sorted by month order
					// Sort givingList within each month by date (descending - most recent first)
					return (
						[...monthlyMap.entries()]
							.toSorted(([a], [b]) => b - a)
							// oxlint-disable-next-line no-map-spread
							.map(([, group]) => ({
								...group,
								givingList: group.givingList.toSorted(
									(a, b) => getDayFromDate(b.date) - getDayFromDate(a.date),
								),
							}))
					);
				},
			}),
		}),
	});
