import { DateTime } from "luxon";

export type RecurringType =
	| "One time Event"
	| "Daily"
	| "Weekly"
	| "BiWeekly"
	| "Monthly"
	| "Twice a month";

/**
 * Translate CMS recurrence labels into concrete future datetimes.
 * Calculations stay in the church scheduling timezone.
 */
// oxlint-disable-next-line no-extraneous-class
export class RecurrenceCalculator {
	private static readonly TIMEZONE = "America/New_York";

	/**
	 * Calculate the next occurrence of an event based on its recurring type
	 * All calculations are done in America/New_York timezone
	 * @param eventDate - The original event date/time
	 * @param recurringType - The type of recurrence
	 * @param referenceDate optional - The date to calculate the next occurrence from (defaults to now in America/New_York)
	 * @returns The next occurrence date/time in America/New_York timezone
	 */
	static getNextOccurrence(
		eventDate: DateTime,
		recurringType: RecurringType,
		referenceDate: DateTime = DateTime.now().setZone("America/New_York"),
	): DateTime {
		// Ensure both dates are in America/New_York timezone
		const eventDateNY = eventDate.setZone(this.TIMEZONE);
		const referenceDateNY = referenceDate.setZone(this.TIMEZONE);

		const eventTime = {
			hours: eventDateNY.hour,
			minutes: eventDateNY.minute,
			seconds: eventDateNY.second,
			milliseconds: eventDateNY.millisecond,
		};

		switch (recurringType) {
			case "One time Event": {
				return eventDateNY;
			}
			case "Daily": {
				return this.getNextDaily(eventTime, referenceDateNY);
			}
			case "Weekly": {
				return this.getNextWeekly(eventDateNY, referenceDateNY);
			}
			case "BiWeekly": {
				return this.getNextBiWeekly(eventDateNY, referenceDateNY);
			}
			case "Monthly": {
				return this.getNextMonthly(eventDateNY, referenceDateNY);
			}
			case "Twice a month": {
				return this.getNextTwiceMonthly(eventDateNY, referenceDateNY);
			}
			default: {
				throw new Error(`Unsupported recurring type: ${recurringType as string}`, {
					cause: new Error(`Unsupported recurring type: ${recurringType as string}`),
				});
			}
		}
	}

	private static getNextDaily(
		eventTime: {
			hours: number;
			minutes: number;
			seconds: number;
			milliseconds: number;
		},
		referenceDate: DateTime,
	): DateTime {
		// Set the event time on today's date
		let nextOccurrence = referenceDate.startOf("day").set({
			hour: eventTime.hours,
			minute: eventTime.minutes,
			second: eventTime.seconds,
			millisecond: eventTime.milliseconds,
		});

		// If the time has already passed today, return tomorrow
		if (referenceDate > nextOccurrence.endOf("day")) {
			nextOccurrence = nextOccurrence.plus({ days: 1 });
		}

		return nextOccurrence;
	}

	private static getNextWeekly(eventDate: DateTime, referenceDate: DateTime): DateTime {
		// Convert Luxon weekday (1-7, Mon-Sun) to JavaScript getDay format (0-6, Sun-Sat)
		const eventDayOfWeek = eventDate.weekday % 7;
		const referenceDayOfWeek = referenceDate.weekday % 7;

		let daysUntilNext = eventDayOfWeek - referenceDayOfWeek;

		if (daysUntilNext < 0) {
			daysUntilNext += 7;
		} else if (daysUntilNext === 0) {
			// Same day of week - check if time has passed
			const todayWithEventTime = referenceDate.startOf("day").set({
				hour: eventDate.hour,
				minute: eventDate.minute,
				second: eventDate.second,
				millisecond: eventDate.millisecond,
			});

			if (referenceDate > todayWithEventTime.endOf("day")) {
				daysUntilNext = 7; // Next week
			}
		}

		let nextOccurrence = referenceDate.startOf("day").plus({ days: daysUntilNext });

		// Preserve the original time
		nextOccurrence = nextOccurrence.set({
			hour: eventDate.hour,
			minute: eventDate.minute,
			second: eventDate.second,
			millisecond: eventDate.millisecond,
		});

		return nextOccurrence;
	}

	private static getNextBiWeekly(eventDate: DateTime, referenceDate: DateTime): DateTime {
		// Get the next occurrence on the same day of week
		let nextOccurrence = this.getNextWeekly(eventDate, referenceDate);

		// Keep the event anchored to the original two-week cadence.
		// If we're not on the right bi-weekly cycle, add another week
		const weeksUntilNext = Math.floor(nextOccurrence.diff(eventDate, "weeks").weeks);
		if (weeksUntilNext % 2 !== 0) {
			nextOccurrence = nextOccurrence.plus({ weeks: 1 });
		}

		return nextOccurrence;
	}

	private static getNextMonthly(eventDate: DateTime, referenceDate: DateTime): DateTime {
		const eventDayOfMonth = eventDate.day;

		// Set to the same day of the current month with the event time
		let nextOccurrence = referenceDate.set({
			day: eventDayOfMonth,
			hour: eventDate.hour,
			minute: eventDate.minute,
			second: eventDate.second,
			millisecond: eventDate.millisecond,
		});

		// If the date has passed this month, move to next month
		if (referenceDate > nextOccurrence.endOf("day")) {
			nextOccurrence = nextOccurrence.plus({ months: 1 });
			// Handle edge case where day doesn't exist in next month (e.g., Jan 31 -> Feb 31)
			// Luxon automatically handles this by going to the last valid day
		}

		return nextOccurrence;
	}

	private static getNextTwiceMonthly(eventDate: DateTime, referenceDate: DateTime): DateTime {
		// The CMS uses "Twice a month" for the 1st and 15th cadence.
		const firstOfMonth = 1;
		const midMonth = 15;

		const eventTime = {
			hours: eventDate.hour,
			minutes: eventDate.minute,
			seconds: eventDate.second,
			milliseconds: eventDate.millisecond,
		};

		let nextOccurrence = referenceDate;
		const currentDay = referenceDate.day;

		// Determine next occurrence
		if (currentDay < firstOfMonth) {
			nextOccurrence = nextOccurrence.set({ day: firstOfMonth });
		} else if (currentDay < midMonth) {
			// Check if we've passed the 1st occurrence time
			const firstOccurrence = referenceDate.set({
				day: firstOfMonth,
				hour: eventTime.hours,
				minute: eventTime.minutes,
				second: eventTime.seconds,
				millisecond: eventTime.milliseconds,
			});

			nextOccurrence =
				currentDay === firstOfMonth && referenceDate <= firstOccurrence
					? firstOccurrence
					: nextOccurrence.set({ day: midMonth });
		} else {
			// Check if we've passed the 15th occurrence time
			const midOccurrence = referenceDate.set({
				day: midMonth,
				hour: eventTime.hours,
				minute: eventTime.minutes,
				second: eventTime.seconds,
				millisecond: eventTime.milliseconds,
			});

			nextOccurrence =
				currentDay === midMonth && referenceDate <= midOccurrence
					? midOccurrence
					: nextOccurrence.plus({ months: 1 }).set({ day: firstOfMonth });
		}

		// Set the time
		nextOccurrence = nextOccurrence.set({
			hour: eventTime.hours,
			minute: eventTime.minutes,
			second: eventTime.seconds,
			millisecond: eventTime.milliseconds,
		});

		return nextOccurrence;
	}
}

// Alternative functional approach
// function getNextOccurrence(
// 	eventDate: DateTime,
// 	recurringType: RecurringType,
// 	referenceDate: DateTime = DateTime.now().setZone('America/New_York'),
// ): DateTime {
// 	return RecurrenceCalculator.getNextOccurrence(
// 		eventDate,
// 		recurringType,
// 		referenceDate,
// 	);
// }
