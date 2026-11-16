import { defineRelations } from "drizzle-orm";

import { donations, donationSyncLogs, donationYearlySummaries } from "./donations";
import { dailyVerses, scriptures, wordActivationSubs } from "./scriptures";
import { userDepartments, userMinistries } from "./tables";
import { departments, ministries, users } from "./users";

// ═══════════════════════════════════════════════════════════════
// DEFINE ALL RELATIONS USING NEW API
// ═══════════════════════════════════════════════════════════════

export const relations = defineRelations(
	{
		users,
		departments,
		ministries,
		userDepartments,
		userMinistries,
		scriptures,
		wordActivationSubs,
		dailyVerses,
		donations,
		donationYearlySummaries,
		donationSyncLogs,
	},
	(r) => ({
		// ─────────────────────────────────────────────────────────────
		// USERS RELATIONS
		// ─────────────────────────────────────────────────────────────
		users: {
			departments: r.many.userDepartments({
				from: r.users.id,
				to: r.userDepartments.userId,
			}),
			ministries: r.many.userMinistries({
				from: r.users.id,
				to: r.userMinistries.userId,
			}),
			wordActivationSub: r.one.wordActivationSubs({
				from: r.users.id,
				to: r.wordActivationSubs.userId,
			}),
			donations: r.many.donations({
				from: r.users.id,
				to: r.donations.userId,
			}),
			donationSyncLogs: r.many.donationSyncLogs({
				from: r.users.id,
				to: r.donationSyncLogs.userId,
			}),
			donationYearlySummaries: r.many.donationYearlySummaries({
				from: r.users.id,
				to: r.donationYearlySummaries.userId,
			}),
		},

		// ─────────────────────────────────────────────────────────────
		// DEPARTMENTS RELATIONS
		// ─────────────────────────────────────────────────────────────
		departments: {
			users: r.many.userDepartments({
				from: r.departments.id,
				to: r.userDepartments.departmentId,
			}),
		},

		// ─────────────────────────────────────────────────────────────
		// MINISTRIES RELATIONS
		// ─────────────────────────────────────────────────────────────
		ministries: {
			users: r.many.userMinistries({
				from: r.ministries.id,
				to: r.userMinistries.ministryId,
			}),
		},

		// ─────────────────────────────────────────────────────────────
		// USER DEPARTMENTS (Junction) RELATIONS
		// ─────────────────────────────────────────────────────────────
		userDepartments: {
			user: r.one.users({
				from: r.userDepartments.userId,
				to: r.users.id,
			}),
			department: r.one.departments({
				from: r.userDepartments.departmentId,
				to: r.departments.id,
			}),
		},

		// ─────────────────────────────────────────────────────────────
		// USER MINISTRIES (Junction) RELATIONS
		// ─────────────────────────────────────────────────────────────
		userMinistries: {
			user: r.one.users({
				from: r.userMinistries.userId,
				to: r.users.id,
			}),
			ministry: r.one.ministries({
				from: r.userMinistries.ministryId,
				to: r.ministries.id,
			}),
		},

		// ─────────────────────────────────────────────────────────────
		// SCRIPTURES RELATIONS
		// ─────────────────────────────────────────────────────────────
		scriptures: {
			subscriptions: r.many.wordActivationSubs({
				from: r.scriptures.id,
				to: r.wordActivationSubs.scriptureId,
			}),
			dailyVerses: r.many.dailyVerses({
				from: r.scriptures.id,
				to: r.dailyVerses.scriptureId,
			}),
		},

		// ─────────────────────────────────────────────────────────────
		// WORD ACTIVATION SUBS RELATIONS
		// ─────────────────────────────────────────────────────────────
		wordActivationSubs: {
			user: r.one.users({
				from: r.wordActivationSubs.userId,
				to: r.users.id,
			}),
			scripture: r.one.scriptures({
				from: r.wordActivationSubs.scriptureId,
				to: r.scriptures.id,
			}),
		},

		// ─────────────────────────────────────────────────────────────
		// DAILY VERSES RELATIONS
		// ─────────────────────────────────────────────────────────────
		dailyVerses: {
			scripture: r.one.scriptures({
				from: r.dailyVerses.scriptureId,
				to: r.scriptures.id,
			}),
		},

		// ─────────────────────────────────────────────────────────────
		// DONATIONS RELATIONS
		// ─────────────────────────────────────────────────────────────
		donations: {
			user: r.one.users({
				from: r.donations.userId,
				to: r.users.id,
			}),
		},

		// ─────────────────────────────────────────────────────────────
		// DONATION YEARLY SUMMARIES RELATIONS
		// ─────────────────────────────────────────────────────────────
		donationYearlySummaries: {
			user: r.one.users({
				from: r.donationYearlySummaries.userId,
				to: r.users.id,
			}),
		},

		// ─────────────────────────────────────────────────────────────
		// DONATION SYNC LOGS RELATIONS
		// ─────────────────────────────────────────────────────────────
		donationSyncLogs: {
			user: r.one.users({
				from: r.donationSyncLogs.userId,
				to: r.users.id,
			}),
		},
	}),
);
