import { Temporal } from "@js-temporal/polyfill";
import type { AutomationSchedule } from "../shared/automations.js";
function occurrence(
  schedule: AutomationSchedule,
  after: number,
  direction: 1 | -1,
): number | null {
  const date = Temporal.PlainDate.from(schedule.date);
  const time = Temporal.PlainTime.from(schedule.time);
  const local = Temporal.Instant.fromEpochMilliseconds(
    after,
  ).toZonedDateTimeISO(schedule.timezone);
  const at = (d: Temporal.PlainDate, clock = time) =>
    d
      .toPlainDateTime(clock)
      .toZonedDateTime(schedule.timezone, { disambiguation: "compatible" })
      .epochMilliseconds;
  if (schedule.frequency === "once") {
    const value = at(date);
    return (direction === 1 ? value > after : value <= after) ? value : null;
  }
  let day = local.toPlainDate();
  if (Temporal.PlainDate.compare(day, date) < 0) {
    if (direction === -1) return null;
    day = date;
  }
  for (let i = 0; i < 366 * 9; i++, day = day.add({ days: direction })) {
    if (Temporal.PlainDate.compare(day, date) < 0) break;
    if (schedule.frequency === "hourly") {
      if (
        schedule.weekdays.length &&
        !schedule.weekdays.includes(day.dayOfWeek)
      )
        continue;
      const end = Temporal.PlainTime.from(schedule.until || schedule.time);
      const minutes = time.hour * 60 + time.minute;
      const last = end.hour * 60 + end.minute;
      const candidates: number[] = [];
      for (let m = minutes; m <= last; m += 60) {
        const clock = Temporal.PlainTime.from({
          hour: Math.floor(m / 60),
          minute: m % 60,
        });
        const value = at(day, clock);
        const actual = Temporal.Instant.fromEpochMilliseconds(
          value,
        ).toZonedDateTimeISO(schedule.timezone);
        if (actual.hour !== clock.hour || actual.minute !== clock.minute)
          continue;
        candidates.push(value);
      }
      if (direction === -1) candidates.reverse();
      const value = candidates.find((v) =>
        direction === 1 ? v > after : v <= after,
      );
      if (value !== undefined) return value;
      continue;
    }
    if (schedule.frequency === "weekdays" && day.dayOfWeek > 5) continue;
    if (
      schedule.frequency === "weekly" &&
      !schedule.weekdays.includes(day.dayOfWeek)
    )
      continue;
    if (
      ["monthly", "yearly"].includes(schedule.frequency) &&
      day.day !== date.day
    )
      continue;
    if (schedule.frequency === "yearly" && day.month !== date.month) continue;
    const value = at(day);
    if (direction === 1 ? value > after : value <= after) return value;
  }
  return null;
}
export function nextScheduled(triggers: AutomationSchedule[], after: number) {
  const values = triggers
    .map((t) => nextOccurrence(t, after))
    .filter((n): n is number => n !== null);
  return values.length ? Math.min(...values) : null;
}

export function nextOccurrence(schedule: AutomationSchedule, after: number) {
  return occurrence(schedule, after, 1);
}
export function latestScheduled(
  triggers: AutomationSchedule[],
  before: number,
) {
  const values = triggers
    .map((t) => occurrence(t, before, -1))
    .filter((v): v is number => v !== null);
  return values.length ? Math.max(...values) : null;
}
