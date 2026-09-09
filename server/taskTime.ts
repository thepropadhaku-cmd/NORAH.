export type TaskTimeParseResult =
  | { status: "parsed"; scheduledAt: Date; label: string }
  | { status: "ambiguous"; reason: string; candidates: string[] }
  | { status: "missing"; reason: string };

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8,
  sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};

function atLocalTime(base: Date, hour: number, minute = 0): Date {
  const result = new Date(base);
  result.setHours(hour, minute, 0, 0);
  return result;
}

function parseClock(value: string): { hour: number; minute: number } | null {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour > 23) return null;
  return { hour, minute };
}

function nextDay(base: Date, days: number): Date {
  const result = new Date(base);
  result.setDate(result.getDate() + days);
  return result;
}

function parseDayPart(value: string): { hour: number; label: string } | null {
  const dayPart = value.toLowerCase();
  if (dayPart === "morning") return { hour: 9, label: "tomorrow morning" };
  if (dayPart === "afternoon") return { hour: 15, label: "tomorrow afternoon" };
  if (dayPart === "evening") return { hour: 18, label: "tomorrow evening" };
  if (dayPart === "night") return { hour: 21, label: "tomorrow night" };
  return null;
}

export function parseTaskTime(input: string, now = new Date()): TaskTimeParseResult {
  const text = input.trim();
  const relative = text.match(/\bin\s+(\d+)\s+(minute|minutes|hour|hours)\b/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    if (amount === 0) return { status: "ambiguous", reason: "The relative duration must be greater than zero.", candidates: [] };
    const scheduledAt = new Date(now.getTime() + amount * (unit.startsWith("hour") ? 60 * 60 * 1000 : 60 * 1000));
    return { status: "parsed", scheduledAt, label: `in ${amount} ${unit}` };
  }

  const tomorrowWithTime = text.match(/\btomorrow\s+at\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\b/i);
  if (tomorrowWithTime) {
    const clock = parseClock(tomorrowWithTime[1]);
    if (!clock) return { status: "ambiguous", reason: "The time after tomorrow is not valid.", candidates: [] };
    return { status: "parsed", scheduledAt: atLocalTime(nextDay(now, 1), clock.hour, clock.minute), label: `tomorrow at ${tomorrowWithTime[1]}` };
  }

  const tomorrowPart = text.match(/\btomorrow\s+(morning|afternoon|evening|night)\b/i);
  if (tomorrowPart) {
    const dayPart = parseDayPart(tomorrowPart[1]);
    if (dayPart) return { status: "parsed", scheduledAt: atLocalTime(nextDay(now, 1), dayPart.hour), label: dayPart.label };
  }

  const explicitDate = text.match(/\b(?:on\s+)?(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+at\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?))?\b/i);
  if (explicitDate) {
    const year = Number(explicitDate[1]);
    const month = Number(explicitDate[2]) - 1;
    const day = Number(explicitDate[3]);
    const candidate = new Date(year, month, day);
    if (candidate.getFullYear() !== year || candidate.getMonth() !== month || candidate.getDate() !== day) {
      return { status: "ambiguous", reason: "That calendar date is not valid.", candidates: [] };
    }
    if (!explicitDate[4]) return { status: "ambiguous", reason: "The date is clear, but the time is missing.", candidates: ["morning", "afternoon", "evening"] };
    const clock = parseClock(explicitDate[4]);
    if (!clock) return { status: "ambiguous", reason: "The time is not valid.", candidates: [] };
    return { status: "parsed", scheduledAt: atLocalTime(candidate, clock.hour, clock.minute), label: `${explicitDate[1]}-${explicitDate[2]}-${explicitDate[3]} at ${explicitDate[4]}` };
  }

  const monthDate = text.match(/\b(?:on\s+)?([a-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?(?:\s+at\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?))?\b/i);
  if (monthDate && MONTHS[monthDate[1].toLowerCase()] !== undefined) {
    const year = Number(monthDate[3] ?? now.getFullYear());
    const month = MONTHS[monthDate[1].toLowerCase()];
    const day = Number(monthDate[2]);
    const candidate = new Date(year, month, day);
    if (candidate.getFullYear() !== year || candidate.getMonth() !== month || candidate.getDate() !== day) {
      return { status: "ambiguous", reason: "That calendar date is not valid.", candidates: [] };
    }
    if (!monthDate[4]) return { status: "ambiguous", reason: "The date is clear, but the time is missing.", candidates: ["morning", "afternoon", "evening"] };
    const clock = parseClock(monthDate[4]);
    if (!clock) return { status: "ambiguous", reason: "The time is not valid.", candidates: [] };
    return { status: "parsed", scheduledAt: atLocalTime(candidate, clock.hour, clock.minute), label: `${monthDate[1]} ${monthDate[2]} at ${monthDate[4]}` };
  }

  const exactTime = text.match(/\bat\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\b/i);
  if (exactTime) {
    const clock = parseClock(exactTime[1]);
    if (!clock) return { status: "ambiguous", reason: "The requested clock time is not valid.", candidates: [] };
    const scheduledAt = atLocalTime(now, clock.hour, clock.minute);
    if (scheduledAt <= now) scheduledAt.setDate(scheduledAt.getDate() + 1);
    return { status: "parsed", scheduledAt, label: `at ${exactTime[1]}` };
  }

  if (/\b(?:tomorrow|today|later|soon)\b/i.test(text)) {
    return { status: "ambiguous", reason: "A day or relative expression was provided without a precise time.", candidates: ["tomorrow morning", "tomorrow afternoon", "tomorrow evening"] };
  }
  return { status: "missing", reason: "No schedule or reminder time was found." };
}
