import { describe, expect, it } from "vitest";
import { classifyIntent, fallbackReply, inferMode, prototypeTools } from "./assistantCore";

describe("assistant core", () => {
  it("routes common requests to useful modes", () => {
    expect(inferMode("Help me plan a launch")).toBe("plan");
    expect(inferMode("Rewrite this email")).toBe("write");
    expect(inferMode("Explain recursion with an example")).toBe("learn");
    expect(inferMode("Why is my app broken?")).toBe("troubleshoot");
  });

  it("is transparent when operating in fallback mode", () => {
    const reply = fallbackReply("I need help", "general");
    expect(reply).toContain("local fallback mode");
    expect(reply).toContain("still kept in the conversation");
  });

  it("exposes readiness without pretending integrations are connected", () => {
    const tools = prototypeTools.list();
    expect(tools.find(tool => tool.id === "assistant-core")?.status).toBe("ready");
    expect(tools.find(tool => tool.id === "calendar")?.status).toBe("coming_soon");
  });

  it("keeps ordinary questions conversational", () => {
    const result = classifyIntent("Why do I keep procrastinating on studying?");
    expect(result.intent).toBe("question");
    expect(result.evidence).toContain("question language");
    expect(result.taskActions).toHaveLength(0);
  });

  it("recognizes explicit task requests and proposes rather than executes them", () => {
    const result = classifyIntent("Remind me to call Dad at 7:35pm");
    expect(result.intent).toBe("task");
    expect(result.confidence).toBe("high");
    expect(result.evidence).toContain("Remind me to call Dad at 7:35pm");
    expect(result.taskActions[0]).toMatchObject({
      type: "create_task",
      title: "call Dad at 7:35pm",
      requiresConfirmation: true,
    });
  });

  it("treats ambiguous commitments as conversation until the user explicitly asks for a task", () => {
    const result = classifyIntent("I have surgery lecture tomorrow and need to remember it");
    expect(result.intent).toBe("conversation");
    expect(result.taskActions).toHaveLength(0);
  });

  it("preserves both sides of a multi-intent message", () => {
    const result = classifyIntent("Help me plan tomorrow and remind me to email my professor");
    expect(result.intent).toBe("mixed");
    expect(result.evidence).toContain("remind me to email my professor");
    expect(result.taskActions).toHaveLength(1);
    expect(result.taskActions[0]?.title).toBe("email my professor");
  });

  it("recognizes task-list language without mistaking a question for a task", () => {
    const task = classifyIntent("Add a task: review renal physiology");
    const question = classifyIntent("Can you help me organize my study plan?");
    expect(task.intent).toBe("task");
    expect(task.taskActions[0]?.title).toBe("review renal physiology");
    expect(question.intent).toBe("question");
  });

  it("classifies natural-language modification and cancellation requests", () => {
    const modification = classifyIntent("Reschedule my reminder to call Dad to tomorrow at 8am");
    const cancellation = classifyIntent("Cancel my reminder to call Dad");
    expect(modification.intent).toBe("task_modification");
    expect(modification.taskActions[0]).toMatchObject({ type: "update_task", fields: { action: "update_task", date: "tomorrow", time: "8am" } });
    expect(cancellation.intent).toBe("task_cancellation");
    expect(cancellation.taskActions[0]).toMatchObject({ type: "cancel_task", fields: { action: "cancel_task" } });
  });

  it("keeps ordinary multi-sentence conversation out of the action path", () => {
    const result = classifyIntent("I had a long day. Tell me something encouraging.");
    expect(result.intent).toBe("question");
    expect(result.taskActions).toHaveLength(0);
  });

  it.each([
    ["What is the difference between RAM and storage?", "question", "none"],
    ["Remind me to call Dad tomorrow at 8am", "task", "create_task"],
    ["Add a task: review renal physiology", "task", "create_task"],
    ["Reschedule my reminder to call Dad to tomorrow at 8am", "task_modification", "update_task"],
    ["Cancel my reminder to call Dad", "task_cancellation", "cancel_task"],
    ["I have lecture tomorrow and need to remember it", "conversation", "none"],
    ["Help me plan the day and remind me to email my professor at 4pm", "mixed", "create_task"],
  ])("makes a safe decision for %s", (input, intent, action) => {
    const result = classifyIntent(input);
    expect(result.intent).toBe(intent);
    expect(result.taskActions[0]?.type ?? "none").toBe(action);
  });

  it("extracts structured duration and recurrence without executing anything", () => {
    const result = classifyIntent("Remind me to stretch in 20 minutes every weekday");
    expect(result.taskActions[0]?.fields).toMatchObject({ durationMinutes: 20, recurrence: "every weekday", action: "create_task" });
    expect(result.taskActions[0]?.requiresConfirmation).toBe(true);
  });
});
