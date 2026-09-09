import { describe, expect, it } from "vitest";
import { parseTaskTime } from "./taskTime";

const now = new Date(2026, 7, 29, 10, 0, 0, 0);

describe("task time parser", () => {
  it("parses an exact clock time and rolls past times to tomorrow", () => {
    const result = parseTaskTime("Remind me to call Dad at 7:35pm", now);
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.scheduledAt).toEqual(new Date(2026, 7, 29, 19, 35));
    }

    const rolled = parseTaskTime("at 8am", now);
    expect(rolled.status).toBe("parsed");
    if (rolled.status === "parsed") expect(rolled.scheduledAt).toEqual(new Date(2026, 7, 30, 8, 0));
  });

  it("parses relative minutes and hours", () => {
    const minutes = parseTaskTime("in 20 minutes", now);
    const hours = parseTaskTime("in 2 hours", now);
    expect(minutes.status).toBe("parsed");
    expect(hours.status).toBe("parsed");
    if (minutes.status === "parsed") expect(minutes.scheduledAt).toEqual(new Date(2026, 7, 29, 10, 20));
    if (hours.status === "parsed") expect(hours.scheduledAt).toEqual(new Date(2026, 7, 29, 12, 0));
  });

  it("parses tomorrow at a clock time and common dayparts", () => {
    const exact = parseTaskTime("tomorrow at 8am", now);
    const morning = parseTaskTime("tomorrow morning", now);
    expect(exact.status).toBe("parsed");
    expect(morning.status).toBe("parsed");
    if (exact.status === "parsed") expect(exact.scheduledAt).toEqual(new Date(2026, 7, 30, 8, 0));
    if (morning.status === "parsed") expect(morning.scheduledAt).toEqual(new Date(2026, 7, 30, 9, 0));
  });

  it("parses ISO and named calendar dates when a time is supplied", () => {
    const iso = parseTaskTime("on 2026-09-02 at 14:05", now);
    const named = parseTaskTime("September 4, 2026 at 6pm", now);
    expect(iso.status).toBe("parsed");
    expect(named.status).toBe("parsed");
    if (iso.status === "parsed") expect(iso.scheduledAt).toEqual(new Date(2026, 8, 2, 14, 5));
    if (named.status === "parsed") expect(named.scheduledAt).toEqual(new Date(2026, 8, 4, 18, 0));
  });

  it("asks for clarification when a date or relative phrase lacks precision", () => {
    const tomorrow = parseTaskTime("tomorrow", now);
    const dateOnly = parseTaskTime("on 2026-09-02", now);
    expect(tomorrow.status).toBe("ambiguous");
    expect(dateOnly.status).toBe("ambiguous");
  });

  it("reports missing time without guessing", () => {
    const result = parseTaskTime("call Dad", now);
    expect(result).toMatchObject({ status: "missing" });
  });
});
