import { parseGiving } from "@/effect/services/giving/parseGiving";
import { describe, expect, it } from "bun:test";

interface RawDetailFixture {
	id?: string;
	amount?: string | number;
	tax_deductible?: unknown;
	coa?: { text: string };
}

function response(details: RawDetailFixture | RawDetailFixture[], date = "2026-09-01") {
	return {
		transactions: {
			transaction: [
				{
					individual: { id: "member" },
					date,
					transaction_details: { transaction_detail: details },
				},
			],
		},
	};
}
const detail = { id: "one", amount: "25", coa: { text: "Giving" } };
const gift = (id: string, date: string, amount: string) => ({
	individual: { id: "member" },
	date,
	transaction_details: { transaction_detail: { id, amount, coa: { text: "Giving" } } },
});

describe("giving normalization", () => {
	it.each([false, "false", { _text: "false" }])("preserves explicit false: %j", (value) => {
		expect(
			parseGiving(response({ ...detail, tax_deductible: value }), "member", 2026).giving[0]
				?.taxDeductible,
		).toBe(false);
	});
	it("defaults only absent tax status and rejects malformed values", () => {
		expect(parseGiving(response(detail), "member", 2026).giving[0]?.taxDeductible).toBe(true);
		for (const value of [null, "unknown", 0, {}, { _text: undefined }]) {
			expect(() =>
				parseGiving(response({ ...detail, tax_deductible: value }), "member", 2026),
			).toThrow();
		}
	});
	it("preserves split details and offsetting contributions", () => {
		const parsed = parseGiving(
			response([detail, { ...detail, id: "two", amount: "-25", tax_deductible: false }]),
			"member",
			2026,
		);
		expect(parsed).toMatchObject({ total: 0, numberOfGiving: 2 });
		expect(parsed.giving.map((item) => item.transactionId)).toEqual(["one", "two"]);
	});
	it("keeps date-only values in the same calendar day", () => {
		const originalTimezone = process.env.TZ;
		try {
			for (const timezone of ["America/Chicago", "UTC", "Pacific/Auckland"]) {
				process.env.TZ = timezone;
				expect(parseGiving(response(detail), "member", 2026).giving[0]?.date).toBe("2026-09-01");
			}
		} finally {
			if (originalTimezone === undefined) {
				delete process.env.TZ;
			} else {
				process.env.TZ = originalTimezone;
			}
		}
	});
	it("does not include another member's transactions", () => {
		expect(parseGiving(response(detail), "other", 2026).giving).toEqual([]);
	});
	it("keeps only gifts dated in the requested year", () => {
		// CCB filters this window by modification date, so a 2025 gift edited in 2026 comes back too.
		const parsed = parseGiving(
			{
				transactions: {
					transaction: [
						gift("edited-later", "2025-12-31", "40"),
						gift("first-day", "2026-01-01", "10"),
						gift("last-day", "2026-12-31", "15"),
					],
				},
			},
			"member",
			2026,
		);
		expect(parsed.giving.map((item) => item.transactionId)).toEqual(["last-day", "first-day"]);
		expect(parsed).toMatchObject({ total: 25, numberOfGiving: 2 });
	});
});
