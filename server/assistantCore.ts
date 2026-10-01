import { ENV } from "./_core/env";
import { invokeGeminiLLM } from "./_core/llm";

export type AssistantMode = "plan" | "write" | "learn" | "organize" | "troubleshoot" | "general";

export type AssistantMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type AssistantIntent = "conversation" | "question" | "task" | "task_modification" | "task_cancellation" | "mixed";
export type TaskActionType = "create_task" | "update_task" | "cancel_task" | "complete_task" | "delete_task";

export type StructuredActionFields = {
  action: TaskActionType;
  title: string;
  date: string | null;
  time: string | null;
  durationMinutes: number | null;
  recurrence: string | null;
  targetTask: string | null;
};

export type ProposedTaskAction = {
  type: TaskActionType;
  title: string;
  source: string;
  fields: StructuredActionFields;
  requiresConfirmation: true;
};

export type IntentClassification = {
  intent: AssistantIntent;
  confidence: "high" | "medium" | "low";
  rationale: string;
  evidence: string[];
  taskActions: ProposedTaskAction[];
};

export type MemoryProvider = {
  retrieve: (userId: number | null, query: string) => Promise<string[]>;
};

export type ToolRegistry = {
  list: () => Array<{ id: string; label: string; status: "ready" | "coming_soon"; description: string }>;
};

export type ModelProvider = {
  complete: (messages: AssistantMessage[]) => Promise<{ content: string; model: string; live: boolean }>;
};

export type ToolExecutor = {
  execute: (toolId: string, input: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>;
};

export const defaultToolExecutor: ToolExecutor = {
  async execute(toolId) {
    return { ok: false, message: `The ${toolId} tool is not connected in this prototype.` };
  },
};

export const managedModelProvider: ModelProvider = {
  async complete(messages) {
    const response = await invokeGeminiLLM({ messages });
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("Provider returned an empty response");
    return { content, model: response.model, live: true };
  },
};

const SYSTEM_PROMPT = `You are Norah, a thoughtful personal AI assistant. Be practical, warm, concise, and honest. Infer the user's intent and choose a useful response shape. For planning, use clear steps and a next action. For writing, produce a polished draft and briefly note assumptions. For learning, explain simply with an example. For troubleshooting, diagnose before prescribing fixes. Never claim to have taken an action, accessed an integration, or remembered something unless the system explicitly confirms it.`;

export const prototypeTools: ToolRegistry = {
  list: () => [
    { id: "assistant-core", label: "Assistant core", status: "ready", description: "Intent framing, response shaping, and fallback reasoning." },
    { id: "memory", label: "Conversation memory", status: "ready", description: "Lightweight conversation continuity and preferences." },
    { id: "hermes", label: "Hermes bridge (Termux)", status: "ready", description: "Talks to a local Hermes agent over ACP (JSON-RPC over the \"hermes acp\" process's stdio). \"Test Hermes connectivity\" runs a handshake; \"ask Hermes to ...\" sends the request to Hermes. Hermes's own approval gate applies and NORAH only ever auto-approves read-only actions you've explicitly allowed via HERMES_APPROVE_KINDS. Wire-level method names are unverified against your installed Hermes until a live run." },
    { id: "web", label: "Web research", status: "coming_soon", description: "Connect a user-approved web search provider." },
    { id: "calendar", label: "Calendar", status: "coming_soon", description: "Connect a calendar provider before scheduling anything." },
    { id: "voice", label: "Voice", status: "coming_soon", description: "Add speech input and output with explicit permissions." },
  ],
};

const TASK_REQUEST_PATTERNS = [
  /\bremind me to\b/i, /\bremember to\b/i, /\badd (?:a )?(?:task|todo|to-do|reminder)\b/i,
  /\bcreate (?:a )?(?:task|todo|to-do|reminder)\b/i, /\bput (?:this|that|it) (?:on|in) my (?:task|todo|to-do) list\b/i,
  /\b(?:task|todo|to-do)\s*[:\-]/i,
];
const TASK_UPDATE_PATTERNS = [/\b(?:change|edit|update|move|reschedule|postpone|push back)\b.*\b(?:task|todo|reminder)\b/i, /\b(?:complete|finish|check off|mark as done)\s+(?:the )?(?:task|todo|reminder)\b/i];
const TASK_CANCEL_PATTERNS = [/\b(?:cancel|delete|remove)\b.*\b(?:task|todo|reminder)\b/i, /\bforget\s+(?:about\s+)?(?:the )?(?:task|todo|reminder)\b/i];
const TASK_ACTION_PATTERN = /\b(?:remind me to|remember to|add (?:a )?(?:task|todo|to-do|reminder)|create (?:a )?(?:task|todo|to-do|reminder)|put (?:this|that|it) (?:on|in) my (?:task|todo|to-do) list|(?:task|todo|to-do)\s*[:\-])\s*(.+)$/i;

function normalizeTaskTitle(value: string): string {
  return value.replace(/^a\s+/i, "").replace(/^[:\-]\s*/, "").replace(/[.!?]+$/, "").replace(/\s+/g, " ").trim();
}

function extractStructuredFields(type: TaskActionType, title: string, source: string): StructuredActionFields {
  const duration = source.match(/\b(?:for|in)\s+(\d+)\s*(minutes?|hours?)\b/i);
  const durationMinutes = duration ? Number(duration[1]) * (duration[2].toLowerCase().startsWith("hour") ? 60 : 1) : null;
  const date = source.match(/\b(?:tomorrow|today|on\s+\d{4}-\d{1,2}-\d{1,2}|(?:on\s+)?[A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?)\b/i)?.[0] ?? null;
  const time = source.match(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i)?.[0]?.replace(/^at\s+/i, "") ?? null;
  const recurrence = source.match(/\b(?:every|each)\s+(day|weekday|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)?.[0] ?? null;
  const targetTask = type === "create_task" ? null : normalizeTaskTitle(title.replace(/\s+(?:to|for)\s+(?:tomorrow|today|at|on|in)\b.*$/i, ""));
  return { action: type, title, date, time, durationMinutes, recurrence, targetTask: targetTask || null };
}

function extractTaskAction(segment: string): ProposedTaskAction | null {
  const update = segment.match(/\b(?:change|edit|update|move|reschedule|postpone|push back)\b\s+(?:my\s+|the\s+)?(?:task|todo|reminder)?\s*(.*)$/i);
  const cancel = segment.match(/\b(?:cancel|delete|remove|forget)\b\s+(?:about\s+)?(?:my\s+|the\s+)?(?:task|todo|reminder)?\s*(.*)$/i);
  const create = segment.match(TASK_ACTION_PATTERN);
  const match = update ?? cancel ?? create;
  if (!match?.[1]) return null;
  const type: TaskActionType = update ? "update_task" : cancel ? "cancel_task" : "create_task";
  const rawTitle = normalizeTaskTitle(match[1]);
  const title = type === "create_task" ? rawTitle : rawTitle.replace(/\s+(?:to|for)\s+(?:tomorrow|today|at|on|in)\b.*$/i, "").replace(/^to\s+/i, "").trim();
  if (!title || /^(?:this|that|it|my task|my reminder)$/i.test(title)) return null;
  return { type, title, source: segment.trim(), fields: extractStructuredFields(type, title, segment), requiresConfirmation: true };
}

export function classifyIntent(input: string): IntentClassification {
  const text = input.trim();
  if (!text) return { intent: "conversation", confidence: "low", rationale: "There is no message to classify.", evidence: [], taskActions: [] };
  const segments = text.split(/\s+(?:and|also|then)\s+/i).map(segment => segment.trim()).filter(Boolean);
  const createSignals = segments.filter(segment => TASK_REQUEST_PATTERNS.some(pattern => pattern.test(segment)));
  const updateSignals = segments.filter(segment => TASK_UPDATE_PATTERNS.some(pattern => pattern.test(segment)));
  const cancelSignals = segments.filter(segment => TASK_CANCEL_PATTERNS.some(pattern => pattern.test(segment)));
  const taskActions = segments.map(extractTaskAction).filter((action): action is ProposedTaskAction => Boolean(action));
  const hasQuestion = /\?|\b(?:why|how|what|when|where|who|explain|tell me|help me understand|do you think)\b/i.test(text);
  const actionKinds = new Set(taskActions.map(action => action.type));
  const hasAction = taskActions.length > 0 || createSignals.length > 0 || updateSignals.length > 0 || cancelSignals.length > 0;
  if (hasAction && (hasQuestion || segments.length > 1)) return { intent: "mixed", confidence: taskActions.length ? "high" : "medium", rationale: "The message combines an actionable request with a question or another clause.", evidence: [...createSignals, ...updateSignals, ...cancelSignals, ...(hasQuestion ? ["question language"] : [])], taskActions };
  if (actionKinds.has("cancel_task") || cancelSignals.length) return { intent: "task_cancellation", confidence: taskActions.length ? "high" : "medium", rationale: "The message asks to cancel or remove an existing task.", evidence: cancelSignals.length ? cancelSignals : ["cancellation language"], taskActions };
  if (actionKinds.has("update_task") || updateSignals.length) return { intent: "task_modification", confidence: taskActions.length ? "high" : "medium", rationale: "The message asks to change an existing task.", evidence: updateSignals.length ? updateSignals : ["task modification language"], taskActions };
  if (actionKinds.has("create_task") || createSignals.length) return { intent: "task", confidence: taskActions.length ? "high" : "medium", rationale: "The message contains an explicit request to create a task or reminder.", evidence: createSignals.length ? createSignals : ["task creation language"], taskActions };
  if (hasQuestion) return { intent: "question", confidence: "high", rationale: "The message asks for information or explanation without an executable task command.", evidence: ["question language"], taskActions: [] };
  return { intent: "conversation", confidence: "medium", rationale: "No actionable task command was found, so the message should be answered rather than mutated.", evidence: ["no explicit task command"], taskActions: [] };
}

export function inferMode(input: string): AssistantMode {
  const text = input.toLowerCase();
  if (/plan|roadmap|schedule|priorit|steps|organize/.test(text)) return text.includes("organize") ? "organize" : "plan";
  if (/write|draft|rewrite|email|post|essay|copy/.test(text)) return "write";
  if (/learn|explain|understand|teach|study|what is/.test(text)) return "learn";
  if (/fix|bug|error|broken|debug|troubleshoot|not work/.test(text)) return "troubleshoot";
  return "general";
}

export function fallbackReply(input: string, mode: AssistantMode): string {
  const opening: Record<AssistantMode, string> = {
    plan: "Let’s turn that into a workable plan.",
    write: "I can help shape that into something you can use.",
    learn: "Let’s make that easier to understand.",
    organize: "Let’s reduce the noise and give it a clear order.",
    troubleshoot: "Let’s isolate the cause before changing things.",
    general: "I’m here with you on this.",
  };
  const next: Record<AssistantMode, string> = {
    plan: "Start by naming the outcome, then choose the smallest next action. If you share the deadline and constraints, I’ll turn it into a sequence with realistic checkpoints.",
    write: "Share the audience, tone, and desired length, and I’ll produce a polished first pass rather than making you assemble fragments.",
    learn: "Tell me your current level and what you want to be able to do with the idea. I’ll explain it in plain language, then test it with an example.",
    organize: "Put the items, commitments, or ideas in front of me. I’ll group them by urgency, importance, and energy required, then suggest a simple order.",
    troubleshoot: "Send the exact error or describe what you expected versus what happened. I’ll work from symptoms to likely causes and safe checks.",
    general: "I can help think it through, make a plan, write a draft, or turn a vague problem into a concrete next step.",
  };
  return `${opening[mode]}\n\nFor now, here’s the useful path: ${next[mode]}\n\nI’m running in local fallback mode because no live model response is available in this environment. Your request is still kept in the conversation so we can continue seamlessly when a provider is connected.`;
}

// Explicit user intent to hand a request to Hermes ("ask Hermes to ...",
// "tell Hermes ...", "... via Hermes"). Hermes is only ever invoked on
// this explicit trigger; NORAH (Gemini) still writes the final reply.
const HERMES_PROMPT_TRIGGER = /\b(?:ask|tell|via)\s+hermes\b[:,]?\s*(?:to\s+)?/i;

export async function createAssistantReply(input: string, history: AssistantMessage[], memory: string[] = [], toolExecutor: ToolExecutor = defaultToolExecutor): Promise<{ content: string; mode: AssistantMode; model: string; live: boolean }> {
  const mode = inferMode(input);
  const requestedTool = /test Hermes connectivity|test hermes|hermes connectivity/i.test(input)
    ? "hermes-connectivity"
    : HERMES_PROMPT_TRIGGER.test(input)
      ? "hermes-prompt"
      : /calendar|schedule a meeting|browse the web|search online|web search/i.test(input)
        ? (/calendar|schedule a meeting/i.test(input) ? "calendar" : "web")
        : null;
  let toolContext = "";
  if (requestedTool) {
    const toolInput = requestedTool === "hermes-prompt"
      ? { query: input, prompt: input.replace(HERMES_PROMPT_TRIGGER, "").trim() }
      : { query: input };
    const toolStatus = await toolExecutor.execute(requestedTool, toolInput);
    if (!toolStatus.ok) return { content: `${fallbackReply(input, mode)}\n\nTool readiness: ${toolStatus.message}`, mode, model: "local-fallback", live: false };
    toolContext = `\nExternal execution result (verified by NORAH): ${toolStatus.message}`;
  }
  const context = `${memory.length ? `\nRelevant user context (treat as hints, not facts):\n${memory.join("\n")}` : ""}${toolContext}`;
  const messages: AssistantMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\nCurrent mode: ${mode}.${context}` },
    ...history.slice(-10),
    { role: "user", content: input },
  ];

  // Not a new fallback system — the same fallbackReply() as before. The only
  // change is that WHY the live call failed is now captured and surfaced
  // (redacted) instead of being silently swallowed into a server-only
  // console.warn, so the real cause is visible without needing server logs.
  let providerErrorReason: string | null = null;
  try {
    const response = await managedModelProvider.complete(messages);
    if (response.content) return { content: response.content, mode, model: response.model, live: response.live };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    // Gemini's API key travels as a URL query param, so defensively strip any
    // occurrence of it from the error text before it can reach the user.
    providerErrorReason = ENV.geminiApiKey ? rawMessage.split(ENV.geminiApiKey).join("<redacted>") : rawMessage;
    console.warn("[AssistantCore] Falling back after provider error", providerErrorReason);
  }

  const reasonLine = providerErrorReason ? `\n\n[Live model unavailable: ${providerErrorReason}]` : "";
  return { content: `${fallbackReply(input, mode)}${toolContext ? `\n\n${toolContext.trim()}` : ""}${reasonLine}`, mode, model: "local-fallback", live: false };
}
