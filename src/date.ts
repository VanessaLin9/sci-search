import { formatInTimeZone } from "date-fns-tz";

const TIME_ZONE = "Asia/Taipei";

export function todayInTaipei(now = new Date()): string {
  return formatInTimeZone(now, TIME_ZONE, "yyyy-MM-dd");
}
