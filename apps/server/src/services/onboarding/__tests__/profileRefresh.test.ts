import { hasPlaceholderName, needsCcbProfileRefresh } from "@/services/onboarding/profileRefresh";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

const MIGRATION = new URL(
	"../../../../drizzle/20261018120000_ccb_profile_refresh/migration.sql",
	import.meta.url,
);

const dayMs = 24 * 60 * 60 * 1000;
const checkedAt = new Date("2026-10-18T12:00:00Z");
const after = (ms: number) => checkedAt.getTime() + ms;

describe("CCB profile refresh rule", () => {
	it("treats only signup fallbacks as placeholder names", () => {
		expect(hasPlaceholderName({ firstName: "Hi", lastName: "There" })).toBe(true);
		expect(hasPlaceholderName({ firstName: "Ada", lastName: "Anonymous" })).toBe(true);
		expect(hasPlaceholderName({ firstName: "Ada", lastName: "Example" })).toBe(false);
		expect(hasPlaceholderName({ firstName: null, lastName: "" })).toBe(false);
	});

	it("checks unchecked profiles at once, incomplete ones daily, and complete ones weekly", () => {
		expect(needsCcbProfileRefresh({ ccbProfileCheckedAt: null }, after(0))).toBe(true);
		const complete = { firstName: "Ada", lastName: "Example", ccbProfileCheckedAt: checkedAt };
		expect(needsCcbProfileRefresh(complete, after(dayMs))).toBe(false);
		const pending = { ...complete, enrichmentPending: true };
		expect(needsCcbProfileRefresh(pending, after(dayMs - 1))).toBe(false);
		expect(needsCcbProfileRefresh(pending, after(dayMs))).toBe(true);
		// Callers can mark a profile incomplete from another store's signals.
		expect(needsCcbProfileRefresh(complete, after(dayMs), true)).toBe(true);
	});

	it("refreshes a weekly visitor who opens a little earlier the following Sunday", () => {
		const profile = { ccbProfileCheckedAt: checkedAt };
		expect(needsCcbProfileRefresh(profile, after(6 * dayMs - 1))).toBe(false);
		expect(needsCcbProfileRefresh(profile, after(6 * dayMs))).toBe(true);
		expect(needsCcbProfileRefresh(profile, after(7 * dayMs - 2 * 60 * 1000))).toBe(true);
	});

	// PGlite's WASM initialization competes with builds on CI and has taken over 20s there.
	it("spreads existing complete profiles' first check over six days and leaves repairs due", async () => {
		const client = new PGlite();
		try {
			await client.exec(`CREATE TABLE app_users (
				firebase_uid text PRIMARY KEY, first_name text, last_name text,
				enrichment_pending boolean DEFAULT false NOT NULL
			)`);
			await client.exec(`INSERT INTO app_users VALUES
				('unnamed', NULL, NULL, false),
				('pending', 'Ada', 'Example', true),
				('google-fallback', 'Hi', 'There', false),
				('apple-fallback', 'Ada', 'Anonymous', false)`);
			await client.exec(`INSERT INTO app_users
				SELECT 'complete-' || n, 'Ada', 'Example', false FROM generate_series(1, 50) AS n`);
			const before = Date.now();
			await client.exec(await readFile(MIGRATION, "utf8"));
			const { rows } = await client.query<{
				firebase_uid: string;
				ccb_profile_checked_at: Date | null;
			}>("SELECT firebase_uid, ccb_profile_checked_at FROM app_users");
			const checks = new Map(
				rows.map((row) => [
					row.firebase_uid,
					row.ccb_profile_checked_at && new Date(row.ccb_profile_checked_at).getTime(),
				]),
			);

			for (const uid of ["pending", "google-fallback", "apple-fallback"]) {
				expect(checks.get(uid)).toBeNull();
			}
			const seeded = rows
				.filter(
					(row) => !["pending", "google-fallback", "apple-fallback"].includes(row.firebase_uid),
				)
				.map((row) => checks.get(row.firebase_uid));
			expect(seeded).toHaveLength(51);
			for (const time of seeded) {
				expect(time).toBeGreaterThanOrEqual(before - 6 * dayMs - 1000);
				expect(time).toBeLessThanOrEqual(Date.now() + 1000);
			}
			const times = seeded.map(Number);
			expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(dayMs);
		} finally {
			await client.close();
		}
	}, 30_000);
});
