import { startOfWeek, subDays } from "date-fns";

export function getSundayStartOfWeek(date: Date) {
  return startOfWeek(date, { weekStartsOn: 0 });
}

export function getPreviousSunday() {
  return getSundayStartOfWeek(subDays(new Date(), 1));
}
