import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { addMessage, createConversation, createTask, getConversationMessages, getRecentConversations, getTask, getTasks, getUserContext, saveUserContext, updateTaskDetails, updateTaskStatus } from "./db";
import { classifyIntent, createAssistantReply, defaultToolExecutor, prototypeTools, type AssistantMessage } from "./assistantCore";
import { hermesToolExecutor } from "./hermesBridge";
import { parseTaskTime } from "./taskTime";
import { InworldTtsError, normalizeSpeechText, synthesizeInworldSpeech } from "./inworldTts";

const sendInput = z.object({
  message: z.string().min(1).max(12000),
  conversationId: z.number().int().positive().optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(12000) })).max(20).default([]),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  assistant: router({
    capabilities: publicProcedure.query(() => prototypeTools.list()),
    speak: publicProcedure.input(z.object({ text: z.string().min(1).max(12000) })).mutation(async ({ input }) => {
      try {
        const speech = await synthesizeInworldSpeech(input.text);
        return { available: true as const, ...speech, error: null };
      } catch (error) {
        return {
          available: false as const,
          audioContent: null,
          mimeType: null,
          modelId: null,
          normalizedText: normalizeSpeechText(input.text),
          error: error instanceof InworldTtsError ? error.message : "Norah’s voice is unavailable right now.",
        };
      }
    }),
    send: publicProcedure.input(sendInput).mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      const classification = classifyIntent(input.message);
      const proposedAction = classification.taskActions[0];
      const isReminderRequest = /\b(?:remind me|remember to|schedule)\b/i.test(input.message);
      let conversationId = input.conversationId;

      if (proposedAction && ["task", "task_modification", "task_cancellation", "mixed"].includes(classification.intent)) {
        const parsedTime = proposedAction.type === "cancel_task" ? { status: "missing" as const, reason: "Cancellation does not require a new time." } : parseTaskTime(input.message);
        const needsTime = isReminderRequest || (proposedAction.type === "update_task" && /\b(?:reschedule|move|postpone|push back)\b/i.test(input.message));
        if (needsTime && parsedTime.status !== "parsed") {
          const clarification = parsedTime.status === "ambiguous"
            ? `I understand the reminder, but I need a more precise time. ${parsedTime.reason}`
            : "I can save that reminder, but I need a specific time—try something like tomorrow at 8am or in 20 minutes.";
          if (userId && !conversationId) conversationId = await createConversation(userId, input.message, "organize");
          if (userId && conversationId) {
            await addMessage(userId, conversationId, "user", input.message, "organize");
            await addMessage(userId, conversationId, "assistant", clarification, "organize", "task-classifier");
          }
          return { content: clarification, mode: "organize" as const, model: "task-classifier", live: true, conversationId, intent: classification.intent, taskProposal: null };
        }

        const scheduleLabel = parsedTime.status === "parsed" ? parsedTime.label : null;
        const scheduledAt = parsedTime.status === "parsed" ? parsedTime.scheduledAt.toISOString() : null;
        const cleanTitle = proposedAction.type === "create_task" ? proposedAction.title.replace(/\s+at\s+[^,]+$/i, "") : proposedAction.title;
        const targetTask = proposedAction.fields.targetTask;
        const proposalAction: "create_task" | "update_task" | "cancel_task" = proposedAction.type === "update_task" || proposedAction.type === "cancel_task" ? proposedAction.type : "create_task";
        let confirmation: string;
        if (proposedAction.type === "cancel_task") {
          confirmation = `You want me to cancel “${targetTask || cleanTitle}”. Confirm?`;
        } else if (proposedAction.type === "update_task") {
          const newTime = scheduledAt ? ` to ${new Date(scheduledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : "";
          confirmation = `You want me to update “${targetTask || cleanTitle}”${newTime}. Confirm?`;
        } else if (scheduledAt) {
          confirmation = `You want me to remind you to ${cleanTitle} at ${new Date(scheduledAt).toLocaleString([], { hour: "numeric", minute: "2-digit" })}. Confirm?`;
        } else {
          confirmation = `You want me to add “${cleanTitle}” to your task list. Confirm?`;
        }
        if (userId && !conversationId) conversationId = await createConversation(userId, input.message, "organize");
        if (userId && conversationId) {
          await addMessage(userId, conversationId, "user", input.message, "organize");
          await addMessage(userId, conversationId, "assistant", confirmation, "organize", "task-classifier");
        }
        return {
          content: confirmation,
          mode: "organize" as const,
          model: "task-classifier",
          live: true,
          conversationId,
          intent: classification.intent,
          taskProposal: { action: proposalAction, title: cleanTitle, targetTask, sourceText: input.message, scheduledAt, scheduleLabel, requiresConfirmation: true as const },
        };
      }

      const context = userId ? await getUserContext(userId) : undefined;
      const memory = context?.contextNotes ? [context.contextNotes] : [];
      const history: AssistantMessage[] = input.history.map(item => ({ role: item.role, content: item.content }));
      const toolExecutor = /test Hermes connectivity|test hermes|hermes connectivity|\b(?:ask|tell|via)\s+hermes\b/i.test(input.message) ? hermesToolExecutor : defaultToolExecutor;
      const reply = await createAssistantReply(input.message, history, memory, toolExecutor);
      if (userId && !conversationId) conversationId = await createConversation(userId, input.message, reply.mode);
      if (userId && conversationId) {
        await addMessage(userId, conversationId, "user", input.message, reply.mode);
        await addMessage(userId, conversationId, "assistant", reply.content, reply.mode, reply.model);
      }
      return { ...reply, conversationId, intent: classification.intent, taskProposal: null };
    }),
    confirmTask: protectedProcedure.input(z.object({ action: z.enum(["create_task", "update_task", "cancel_task"]).default("create_task"), title: z.string().min(1).max(500), targetTask: z.string().max(500).nullable().optional(), sourceText: z.string().min(1).max(12000), scheduledAt: z.string().datetime().nullable() })).mutation(async ({ ctx, input }) => {
      const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
      if (scheduledAt && scheduledAt <= new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "That time has already passed. Please create the reminder again with a future time." });
      if (input.action === "create_task") {
        const task = await createTask({ userId: ctx.user.id, title: input.title, sourceText: input.sourceText, scheduledAt, status: "pending" });
        if (!task) return { saved: false as const, message: "I could not save the task because persistent storage is unavailable." };
        return { saved: true as const, task, message: scheduledAt ? `Done. I've saved that reminder for ${scheduledAt.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.` : `Done. I've saved “${task.title}” to your task list.` };
      }
      const candidates = (await getTasks(ctx.user.id)).filter(task => task.status === "pending");
      const target = (input.targetTask?.trim() || input.title.trim()).toLowerCase();
      const exactMatches = candidates.filter(task => task.title.trim().toLowerCase() === target);
      const fuzzyMatches = candidates.filter(task => task.title.toLowerCase().includes(target) || target.includes(task.title.toLowerCase()));
      const matches = exactMatches.length > 0 ? exactMatches : fuzzyMatches;
      if (matches.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: `I couldn't find a saved task matching “${input.targetTask || input.title}”.` });
      if (matches.length > 1) throw new TRPCError({ code: "BAD_REQUEST", message: `I found multiple pending tasks matching “${input.targetTask || input.title}”. Please tell me which one you mean.` });
      const existing = matches[0];
      if (input.action === "cancel_task") {
        const task = await updateTaskStatus(ctx.user.id, existing.id, "cancelled");
        return { saved: true as const, task, message: `Done. I've cancelled “${existing.title}”.` };
      }
      if (!scheduledAt) throw new TRPCError({ code: "BAD_REQUEST", message: "I need the new date or time before I can update that task." });
      const task = await updateTaskDetails(ctx.user.id, existing.id, { scheduledAt });
      return { saved: true as const, task, message: `Done. I've moved “${existing.title}” to ${scheduledAt.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.` };
    }),
    cancelTask: protectedProcedure.mutation(() => ({ cancelled: true as const, message: "Okay—I left that task unsaved." })),
    tasks: protectedProcedure.query(({ ctx }) => getTasks(ctx.user.id)),
    updateTaskStatus: protectedProcedure.input(z.object({ taskId: z.number().int().positive(), status: z.enum(["pending", "completed", "cancelled", "failed"]) })).mutation(async ({ ctx, input }) => {
      const existing = await getTask(ctx.user.id, input.taskId);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
      const task = await updateTaskStatus(ctx.user.id, input.taskId, input.status);
      return { task };
    }),
    conversations: protectedProcedure.query(({ ctx }) => getRecentConversations(ctx.user.id)),
    messages: protectedProcedure.input(z.object({ conversationId: z.number().int().positive() })).query(({ ctx, input }) => getConversationMessages(ctx.user.id, input.conversationId)),
    context: protectedProcedure.query(({ ctx }) => getUserContext(ctx.user.id)),
    saveContext: protectedProcedure.input(z.object({ contextNotes: z.string().max(2000), displayName: z.string().max(120).optional() })).mutation(({ ctx, input }) => saveUserContext(ctx.user.id, input.contextNotes, input.displayName).then(() => ({ success: true }))),
  }),
});

export type AppRouter = typeof appRouter;
