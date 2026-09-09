import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { getTask, getTasks, setTaskStoreOverride } from "./db";
import type { Task } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

describe("task proposal flow", () => {
  const baseContext = (user?: TrpcContext["user"]): TrpcContext => ({
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });

  it("returns a confirmation proposal without persisting an unconfirmed reminder", async () => {
    const caller = appRouter.createCaller(baseContext());
    const result = await caller.assistant.send({ message: "Remind me to call Dad at 7:35pm", history: [] });
    expect(result.intent).toBe("task");
    expect(result.taskProposal).toMatchObject({
      title: "call Dad",
      requiresConfirmation: true,
    });
    expect(result.content).toContain("Confirm?");
  });

  it("keeps ordinary conversation out of the task proposal flow", async () => {
    const caller = appRouter.createCaller(baseContext());
    const result = await caller.assistant.send({ message: "Can you explain how spaced repetition works?", history: [] });
    expect(result.intent).toBe("question");
    expect(result.taskProposal).toBeNull();
  });

  it("proposes modification and cancellation instead of executing them", async () => {
    const caller = appRouter.createCaller(baseContext());
    const modification = await caller.assistant.send({ message: "Reschedule my reminder to call Dad to tomorrow at 8am", history: [] });
    const cancellation = await caller.assistant.send({ message: "Cancel my reminder to call Dad", history: [] });
    expect(modification.taskProposal).toMatchObject({ action: "update_task", targetTask: "call Dad" });
    expect(modification.content).toContain("Confirm?");
    expect(cancellation.taskProposal).toMatchObject({ action: "cancel_task", targetTask: "call Dad" });
    expect(cancellation.content).toContain("Confirm?");
  });

  it("asks for a precise time instead of guessing an ambiguous reminder", async () => {
    const caller = appRouter.createCaller(baseContext());
    const result = await caller.assistant.send({ message: "Remind me to call Dad tomorrow", history: [] });
    expect(result.taskProposal).toBeNull();
    expect(result.content).toContain("more precise time");
  });

  it("supports an explicit cancellation without touching persistence", async () => {
    const user = { id: 42, openId: "test-user", name: "Test User", email: null, loginMethod: "test", role: "user" as const, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
    const caller = appRouter.createCaller(baseContext(user));
    await expect(caller.assistant.cancelTask()).resolves.toEqual({ cancelled: true, message: "Okay—I left that task unsaved." });
  });

  it("rejects confirmation for a time that has already passed", async () => {
    const user = { id: 42, openId: "test-user", name: "Test User", email: null, loginMethod: "test", role: "user" as const, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
    const caller = appRouter.createCaller(baseContext(user));
    await expect(caller.assistant.confirmTask({ title: "call Dad", sourceText: "Remind me to call Dad", scheduledAt: new Date(Date.now() - 60_000).toISOString() })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("persists a confirmed task and retrieves it through the authenticated router", async () => {
    const rows: Task[] = [];
    setTaskStoreOverride({
      create: async task => { const row = { ...task, id: rows.length + 1, createdAt: new Date(), updatedAt: new Date() } as Task; rows.push(row); return row; },
      list: async userId => rows.filter(row => row.userId === userId),
      get: async (userId, taskId) => rows.find(row => row.userId === userId && row.id === taskId),
      updateStatus: async (userId, taskId, status) => { const row = rows.find(item => item.userId === userId && item.id === taskId); if (row) row.status = status; return row; },
      updateDetails: async (userId, taskId, details) => { const row = rows.find(item => item.userId === userId && item.id === taskId); if (row) Object.assign(row, details); return row; },
    });
    try {
      const user = { id: 42, openId: "test-user", name: "Test User", email: null, loginMethod: "test", role: "user" as const, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
      const caller = appRouter.createCaller(baseContext(user));
      const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const saved = await caller.assistant.confirmTask({ title: "call Dad", sourceText: "Remind me to call Dad at 7:35pm", scheduledAt });
      expect(saved.saved).toBe(true);
      await expect(caller.assistant.tasks()).resolves.toMatchObject([{ title: "call Dad", status: "pending", scheduledAt: new Date(scheduledAt) }]);
    } finally {
      setTaskStoreOverride(undefined);
    }
  });

  it("rejects ambiguous duplicate task targets without mutating either task", async () => {
    const rows: Task[] = [
      { id: 1, userId: 42, title: "call Dad", sourceText: "", scheduledAt: null, status: "pending", createdAt: new Date(), updatedAt: new Date() },
      { id: 2, userId: 42, title: "call Dad about surgery", sourceText: "", scheduledAt: null, status: "pending", createdAt: new Date(), updatedAt: new Date() },
    ];
    setTaskStoreOverride({
      create: async task => task as Task,
      list: async userId => rows.filter(row => row.userId === userId),
      get: async (userId, taskId) => rows.find(row => row.userId === userId && row.id === taskId),
      updateStatus: async (userId, taskId, status) => { const row = rows.find(item => item.userId === userId && item.id === taskId); if (row) row.status = status; return row; },
      updateDetails: async (userId, taskId, details) => { const row = rows.find(item => item.userId === userId && item.id === taskId); if (row) Object.assign(row, details); return row; },
    });
    try {
      const user = { id: 42, openId: "test-user", name: "Test User", email: null, loginMethod: "test", role: "user" as const, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
      const caller = appRouter.createCaller(baseContext(user));
      await expect(caller.assistant.confirmTask({ action: "cancel_task", title: "call", targetTask: "call", sourceText: "Cancel my reminder to call", scheduledAt: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(rows.every(row => row.status === "pending")).toBe(true);
    } finally {
      setTaskStoreOverride(undefined);
    }
  });

  it("keeps task reads ownership-scoped and read-only for an unknown user", async () => {
    await expect(getTasks(-1)).resolves.toEqual([]);
    await expect(getTask(-1, -1)).resolves.toBeUndefined();
  });
});
