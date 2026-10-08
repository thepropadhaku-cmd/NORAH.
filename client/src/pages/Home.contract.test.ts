import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildTaskConfirmationInput, type TaskProposal } from "@/lib/taskProposal";

describe("Norah workspace contract", () => {
  const source = readFileSync(resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");

  it("keeps the core composer and starter directions present", () => {
    expect(source).toContain("Ask Norah anything");
    expect(source).toContain('eyebrow: "Organize"');
    expect(source).toContain('phase === "composing"');
    expect(source).toContain('phase === "responding"');
    expect(source).toContain("Voice unavailable · try replay");
    expect(source).toContain("disabled={speak.isPending}");
  });

  it("builds an explicit create-task confirmation payload", () => {
    const proposal: TaskProposal = { action: "create_task", title: "call Dad", targetTask: null, sourceText: "Remind me to call Dad", scheduledAt: null, scheduleLabel: null, requiresConfirmation: true };
    expect(buildTaskConfirmationInput(proposal)).toMatchObject({ action: "create_task", targetTask: null, title: "call Dad" });
  });

  it("builds an explicit update-task confirmation payload", () => {
    const proposal: TaskProposal = { action: "update_task", title: "call Dad", targetTask: "call Dad", sourceText: "Reschedule my reminder to call Dad", scheduledAt: "2026-09-01T08:00:00.000Z", scheduleLabel: "tomorrow at 8am", requiresConfirmation: true };
    expect(buildTaskConfirmationInput(proposal)).toMatchObject({ action: "update_task", targetTask: "call Dad", scheduledAt: "2026-09-01T08:00:00.000Z" });
  });

  it("builds an explicit cancellation confirmation payload", () => {
    const proposal: TaskProposal = { action: "cancel_task", title: "call Dad", targetTask: "call Dad", sourceText: "Cancel my reminder to call Dad", scheduledAt: null, scheduleLabel: null, requiresConfirmation: true };
    expect(buildTaskConfirmationInput(proposal)).toMatchObject({ action: "cancel_task", targetTask: "call Dad", scheduledAt: null });
  });

  it("keeps the guest-to-account continuity path present", () => {
    expect(source).toContain("Sign in to save memory");
    expect(source).toContain("localStorage.setItem");
    expect(source).toContain("assistant.conversations.useQuery");
  });

  it("exposes the existing OAuth sign-in flow from the primary header", () => {
    expect(source).toContain('onClick={() => startLogin()}');
    expect(source).toContain('aria-label="Sign in"');
    expect(source).not.toContain("Voice input (not yet connected)");
  });
});
