// oxlint-disable-file no-magic-numbers
import {
	addDays,
	addMonths,
	differenceInWeeks,
	format,
	getDate,
	getDay,
	getHours,
	getMilliseconds,
	getMinutes,
	getSeconds,
	parseISO,
	setDate,
	setHours,
	startOfDay,
} from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

type RecurringType =
	| "One time Event"
	| "Daily "
	| "Weekly"
	| "BiWeekly"
	| "Monthly"
	| "Twice a month";

/**
 * Calculates the next occurrence of a recurring event
 * @param event - The event object with eventDate and reoccurring fields
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns The event with updated nextEventDate and eventMonth fields
 */

interface GetNextOccurrenceProps {
	date: string;
	reoccurring: RecurringType;
	referenceDate?: Date;
	withTime?: boolean;
}

export function getNextOccurrence({
	date,
	reoccurring,
	referenceDate = new Date(),
	withTime = false,
}: GetNextOccurrenceProps) {
	// Parse the date string and remove the timezone indicator (Z)
	// Then interpret it AS IF it were in America/New_York timezone
	const dateWithoutTZ = date.replace("Z", "").replace("T", " ");
	const parsedDate = parseISO(dateWithoutTZ);

	// Treat this parsed date AS IF it's in America/New_York timezone
	// This converts it to the correct UTC representation
	const originalDate = fromZonedTime(parsedDate, "America/New_York");

	// Extract the time in America/New_York timezone format
	const eventTime = formatInTimeZone(originalDate, "America/New_York", "HH:mm:ssXXX");

	const today = startOfDay(referenceDate);

	let nextDate: Date = originalDate;

	if (reoccurring !== "One time Event") {
		nextDate = calculateNextOccurrence(originalDate, reoccurring, today);
	}

	const baseDate = formatInTimeZone(nextDate, "America/New_York", "yyyy-MM-dd");

	return {
		eventDate: withTime ? `${baseDate} ${eventTime}` : nextDate.toISOString(),
		eventTime: formatInTimeZone(nextDate, "America/New_York", "HH:mm:ssXXX"),
		eventMonth: format(nextDate, "MMMM"),
	};
}

/**
 * Calculate the next occurrence based on recurring type
 */
function calculateNextOccurrence(
	originalDate: Date,
	recurringType: RecurringType,
	today: Date,
): Date {
	// Extract time components from original date
	const originalHours = getHours(originalDate);
	const originalMinutes = getMinutes(originalDate);
	const originalSeconds = getSeconds(originalDate);
	const originalMilliseconds = getMilliseconds(originalDate);

	switch (recurringType) {
		case "Daily ": {
			// Return today with original time
			const nextDate = new Date(today);
			nextDate.setHours(originalHours, originalMinutes, originalSeconds, originalMilliseconds);
			return nextDate;
		}

		case "Weekly": {
			// Get the day of week from original event (0 = Sunday, 6 = Saturday)
			const targetDayOfWeek = getDay(originalDate);
			const currentDayOfWeek = getDay(today);

			// Calculate days until next occurrence
			let daysUntilNext = targetDayOfWeek - currentDayOfWeek;

			// If the target day already passed this week, move to next week
			// oxlint-disable-next-line no-magic-numbers
			if (daysUntilNext < 0) {
				// oxlint-disable-next-line no-magic-numbers
				daysUntilNext += 7;
			}

			const nextDate = setHours(addDays(today, daysUntilNext), originalHours);
			nextDate.setHours(originalHours, originalMinutes, originalSeconds, originalMilliseconds);
			return nextDate;
		}

		case "BiWeekly": {
			// Calculate the difference in weeks between original date and today
			const weeksDifference = differenceInWeeks(today, originalDate);

			// Find the next biweekly occurrence
			const targetDayOfWeek = getDay(originalDate);
			const currentDayOfWeek = getDay(today);

			// Determine which biweekly cycle we're in
			// oxlint-disable-next-line no-magic-numbers
			const cycleWeek = weeksDifference % 2;

			let daysUntilNext = targetDayOfWeek - currentDayOfWeek;

			if (cycleWeek === 0) {
				// We're in an "on" week
				if (daysUntilNext < 0) {
					// Target day has passed, next occurrence is in 2 weeks
					daysUntilNext += 14;
				}
			} else {
				// we're in an "off" week, next occurrence is next week
				// if (daysUntilNext <= 0) {
				// 	daysUntilNext += 7;
				// } else {
				// 	daysUntilNext += 7;
				// }
				daysUntilNext += 7;
			}

			const nextDate = addDays(today, daysUntilNext);
			nextDate.setHours(originalHours, originalMinutes, originalSeconds, originalMilliseconds);
			return nextDate;
		}

		case "Monthly": {
			// Get the day of month from original event
			const targetDayOfMonth = getDate(originalDate);
			const currentDayOfMonth = getDate(today);

			// Start with current month
			let nextDate = setDate(today, targetDayOfMonth);

			// If the target day has passed this month, move to next month
			if (currentDayOfMonth > targetDayOfMonth) {
				nextDate = addMonths(nextDate, 1);
			}

			// handle cases where the target day doesn't exist in the month (e.g., Feb 30)
			// date-fns automatically adjusts to the last valid day of the month
			nextDate.setHours(originalHours, originalMinutes, originalSeconds, originalMilliseconds);
			return nextDate;
		}

		case "Twice a month": {
			// Assume events occur on 1st and 15th of each month
			const currentDayOfMonth = getDate(today);

			let nextDate: Date = setDate(addMonths(today, 1), 1);
			if (currentDayOfMonth < 15) {
				// Next occurrence is on the 15th of this month
				nextDate = setDate(today, 15);
			}
			nextDate.setHours(originalHours, originalMinutes, originalSeconds, originalMilliseconds);
			return nextDate;
		}

		default: {
			// Return today with original time for unknown recurring types
			const nextDate = new Date(today);
			nextDate.setHours(originalHours, originalMinutes, originalSeconds, originalMilliseconds);
			return nextDate;
		}
	}
}
