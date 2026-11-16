import { isValid, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

interface EventSessionTime {
  readonly startsAt: string | null | undefined;
  readonly label: string | null | undefined;
}

/**
 * One line per session in the viewer's time zone, such as "9:00 AM CDT · First
 * Service". Lines name the day only when the sessions fall on different days.
 */
export function eventSessionTimes(
  sessions: readonly EventSessionTime[],
  timeZone: string,
): string[] {
  const starts = sessions.flatMap(({ startsAt, label }) => {
    const date = startsAt ? parseISO(startsAt) : null;
    return date && isValid(date) ? [{ date, label: label?.trim() }] : [];
  });
  const days = new Set(
    starts.map(({ date }) => formatInTimeZone(date, timeZone, "yyyy-MM-dd")),
  );

  return starts.map(({ date, label }) =>
    [
      days.size > 1 ? formatInTimeZone(date, timeZone, "EEE, MMM d") : "",
      formatInTimeZone(date, timeZone, "h:mm a zzz"),
      label ?? "",
    ]
      .filter((part) => part !== "")
      .join(" · "),
  );
}
