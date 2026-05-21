import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export const TIME_ZONE = "Asia/Taipei";

export function todayInTaipei(now = new Date()): string {
  return formatInTimeZone(now, TIME_ZONE, "yyyy-MM-dd");
}

export function yesterdayInTaipei(now = new Date()): string {
  return formatInTimeZone(subDays(now, 1), TIME_ZONE, "yyyy-MM-dd");
}

export function defaultReportDateInTaipei(now = new Date()): string {
  return yesterdayInTaipei(now);
}
