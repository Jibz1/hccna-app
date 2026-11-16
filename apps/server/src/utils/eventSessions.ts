import { DateTime } from "luxon";

import type { CmsEvent } from "@hccnj/strapi-v2";

const TIMEZONE = "America/New_York";

export interface EventSession {
	readonly startsAt: DateTime;
	readonly endsAt: DateTime | null;
	readonly label: string | null;
}

/** CMS dates and times are New York wall-clock values. */
const inNewYork = (date: string, time: string) =>
	DateTime.fromISO(`${date}T${time}`, { zone: TIMEZONE });

const byStart = (a: EventSession, b: EventSession) => a.startsAt.toMillis() - b.startsAt.toMillis();

export interface EventSchedule {
	/** False when the event has no sessions or recurring times: its one session is its own dates. */
	readonly scheduled: boolean;
	readonly sessions: readonly EventSession[];
}

/** Every session of a one-time event, or each recurring time on the occurrence's day. */
const cmsSessions = (record: CmsEvent, occurrence: DateTime): EventSession[] => {
	if (record.sessions.length > 0) {
		return record.sessions.map(({ date, startTime, endTime, label }) => {
			const startsAt = inNewYork(date, startTime);
			const endsAt = endTime === null ? null : inNewYork(date, endTime);
			// An end time before the start time finishes after midnight.
			return {
				startsAt,
				endsAt: endsAt && endsAt < startsAt ? endsAt.plus({ days: 1 }) : endsAt,
				label,
			};
		});
	}
	const day = occurrence.setZone(TIMEZONE).toISODate();
	if (day === null) {
		return [];
	}
	return record.recurringTimes.map(({ startTime, label }) => ({
		startsAt: inNewYork(day, startTime),
		endsAt: null,
		label,
	}));
};

/** The sessions shown for an event whose next date is `occurrence`, soonest first. */
export const eventSessions = (record: CmsEvent, occurrence: DateTime): EventSchedule => {
	const scheduled = cmsSessions(record, occurrence).filter(
		(session) => session.startsAt.isValid && (session.endsAt?.isValid ?? true),
	);
	if (scheduled.length > 0) {
		return { scheduled: true, sessions: scheduled.toSorted(byStart) };
	}
	if (!occurrence.isValid) {
		return { scheduled: false, sessions: [] };
	}

	// A recurring event's end date ends the series, not this occurrence.
	const oneTime = (record.reoccurring?.trim() ?? "One time Event") === "One time Event";
	const endsAt = oneTime && record.endDate ? DateTime.fromISO(record.endDate) : null;
	return {
		scheduled: false,
		sessions: [{ startsAt: occurrence, endsAt: endsAt?.isValid ? endsAt : null, label: null }],
	};
};

/** The first session that has not finished, or the last one once all have. */
export const currentSession = (sessions: readonly EventSession[], now: DateTime) =>
	sessions.find((session) => (session.endsAt ?? session.startsAt) > now) ?? sessions.at(-1);
