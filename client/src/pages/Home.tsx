import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { Streamdown } from "streamdown";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Calendar, Check, CircleHelp, Clock, Compass, Copy, History, Leaf, LogIn, Plus, Sparkles, SquarePen, Volume2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { buildTaskConfirmationInput, type TaskProposal } from "@/lib/taskProposal";
import { createAssistantSpeechController, type SpeechStatus } from "@/lib/assistantSpeechController";
import { NorahOrb, type OrbState } from "@/components/NorahOrb";

type ChatMessage = { role: "user" | "assistant"; content: string; mode?: string; live?: boolean };
type View = "chat" | "day";
type PanelTab = "memory" | "tools";

const starterPrompts = [
  { icon: Compass, eyebrow: "Plan", title: "Make a messy goal feel doable", prompt: "Help me turn a vague goal into a practical plan with a small next step." },
  { icon: SquarePen, eyebrow: "Write", title: "Shape the words", prompt: "Help me write a clear, warm message for a situation I’m overthinking." },
  { icon: Leaf, eyebrow: "Learn", title: "Understand something deeply", prompt: "Teach me a complex idea simply, with an example I can remember." },
  { icon: Zap, eyebrow: "Fix", title: "Get unstuck", prompt: "Help me troubleshoot a problem by separating symptoms from likely causes." },
  { icon: Leaf, eyebrow: "Organize", title: "Clear the mental desk", prompt: "Help me organize my tasks, ideas, and commitments into a simple order." },
];

const initialMessage: ChatMessage = {
  role: "assistant",
  content: "Good to see you. I’m Norah — here to help you think clearly, make progress, and get things done.\n\nWhat’s on your mind?",
  mode: "general",
  live: true,
};

export default function Home() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try { return JSON.parse(localStorage.getItem("norah-demo-messages") || "null") || [initialMessage]; } catch { return [initialMessage]; }
  });
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [phase, setPhase] = useState<"idle" | "composing" | "thinking" | "responding" | "error">("idle");
  const [contextDraft, setContextDraft] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState<number | undefined>();
  const [view, setView] = useState<View>("chat");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("memory");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [pendingTaskProposal, setPendingTaskProposal] = useState<TaskProposal | null>(null);
  const [speakingMessage, setSpeakingMessage] = useState<number | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<SpeechStatus>("idle");
  const [entered, setEntered] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const capabilities = trpc.assistant.capabilities.useQuery();
  const conversations = trpc.assistant.conversations.useQuery(undefined, { enabled: Boolean(isAuthenticated) });
  const context = trpc.assistant.context.useQuery(undefined, { enabled: Boolean(isAuthenticated) });
  const serverMessages = trpc.assistant.messages.useQuery({ conversationId: selectedConversationId as number }, { enabled: Boolean(selectedConversationId && isAuthenticated) });
  const tasksQuery = trpc.assistant.tasks.useQuery(undefined, { enabled: Boolean(isAuthenticated) });
  const saveContext = trpc.assistant.saveContext.useMutation({ onSuccess: () => context.refetch() });
  const send = trpc.assistant.send.useMutation();
  const confirmTask = trpc.assistant.confirmTask.useMutation({ onSuccess: () => tasksQuery.refetch() });
  const cancelTask = trpc.assistant.cancelTask.useMutation();
  const speak = trpc.assistant.speak.useMutation();
  const updateTaskStatus = trpc.assistant.updateTaskStatus.useMutation({ onSuccess: () => tasksQuery.refetch() });

  const speechController = useMemo(() => createAssistantSpeechController(
    text => speak.mutateAsync({ text }),
    window.speechSynthesis,
    status => { setVoiceStatus(status); if (status === "idle" || status === "error") setSpeakingMessage(null); },
  ), [speak.mutateAsync]);
  const toolList = capabilities.data || [];

  useEffect(() => { localStorage.setItem("norah-demo-messages", JSON.stringify(messages)); }, [messages]);
  useEffect(() => { if (context.data?.contextNotes !== undefined) setContextDraft(context.data.contextNotes || ""); }, [context.data?.contextNotes]);
  useEffect(() => { if (serverMessages.data?.length) setMessages(serverMessages.data.map(message => ({ role: message.role, content: message.content, mode: message.mode || undefined, live: message.role === "assistant" }))); }, [serverMessages.data]);
  useEffect(() => {
    if (messages.length <= 1 && !isThinking) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);
  useEffect(() => { const t = window.setTimeout(() => setEntered(true), 60); return () => window.clearTimeout(t); }, []);

  const userName = user?.name?.split(" ")[0] || "there";
  const liveStatus = useMemo(() => toolList.some(tool => tool.id === "assistant-core" && tool.status === "ready"), [toolList]);

  const orbState: OrbState = useMemo(() => {
    if (!entered) return "summon";
    if (voiceStatus === "speaking" || voiceStatus === "loading") return "speaking";
    if (isThinking || phase === "thinking") return "thinking";
    if (phase === "composing") return "listening";
    return "idle";
  }, [entered, voiceStatus, isThinking, phase]);
  // The aura (NorahOrb's `speaking` prop) is driven ONLY by this explicit
  // check — never by `phase`/`orbState`, so typing/composing never triggers it.
  const auraActive = voiceStatus === "speaking";

  const stopCurrentSpeech = () => { speechController.stop(); setSpeakingMessage(null); };

  const speakAssistantMessage = async (text: string, messageIndex: number) => {
    setSpeakingMessage(messageIndex);
    await speechController.speak(text);
  };

  useEffect(() => () => stopCurrentSpeech(), [speechController]);

  const handleSend = async (value = input) => {
    const text = value.trim();
    if (!text || isThinking) return;
    const userMessage: ChatMessage = { role: "user", content: text };
    const normalized = text.toLowerCase();
    if (pendingTaskProposal && /^(yes|y|confirm|confirmed|do it|save it|okay|ok)$/i.test(normalized)) {
      setMessages(prev => [...prev, userMessage]);
      setInput("");
      if (!isAuthenticated) {
        startLogin();
        setPhase("idle");
        return;
      }
      setPhase("thinking");
      setIsThinking(true);
      try {
        const proposal = pendingTaskProposal;
        const result = await confirmTask.mutateAsync(buildTaskConfirmationInput(proposal));
        setMessages(prev => [...prev, { role: "assistant", content: result.message, mode: "organize", live: true }]);
        void speakAssistantMessage(result.message, messages.length + 1);
        if (result.saved) setPendingTaskProposal(null);
        setPhase("responding");
        window.setTimeout(() => setPhase("idle"), 900);
      } catch (error) {
        setPhase("error");
        setMessages(prev => [...prev, { role: "assistant", content: error instanceof Error ? error.message : "I couldn’t save that task. Nothing was changed.", mode: "error", live: false }]);
      } finally { setIsThinking(false); }
      return;
    }
    if (pendingTaskProposal && /^(no|n|cancel|cancel it|reject|not now|don't)$/i.test(normalized)) {
      const cancellationMessage = "Okay—I left that task unsaved.";
      setMessages(prev => [...prev, userMessage, { role: "assistant", content: cancellationMessage, mode: "organize", live: true }]);
      void speakAssistantMessage(cancellationMessage, messages.length + 1);
      setPendingTaskProposal(null);
      setInput("");
      setPhase("responding");
      window.setTimeout(() => setPhase("idle"), 900);
      return;
    }
    const history = [...messages, userMessage].filter(message => message.content !== initialMessage.content).map(({ role, content }) => ({ role, content }));
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setPhase("thinking");
    setIsThinking(true);
    try {
      const response = await send.mutateAsync({ message: text, history });
      setPhase("responding");
      setMessages(prev => [...prev, { role: "assistant", content: response.content, mode: response.mode, live: response.live }]);
      void speakAssistantMessage(response.content, messages.length + 1);
      setPendingTaskProposal(response.taskProposal);
      window.setTimeout(() => setPhase("idle"), 900);
    } catch {
      setPhase("error");
      setMessages(prev => [...prev, { role: "assistant", content: "I couldn’t reach the assistant core just now. Your message is still here locally — try again, or keep working in fallback mode.", mode: "error", live: false }]);
    } finally { setIsThinking(false); }
  };

  const clearConversation = () => { setMessages([initialMessage]); setPendingTaskProposal(null); setPhase("idle"); setSelectedConversationId(undefined); setHistoryOpen(false); localStorage.removeItem("norah-demo-messages"); };
  const handleInputChange = (value: string) => { setInput(value); if (value.trim() && !isThinking) setPhase("composing"); else if (!value.trim() && !isThinking) setPhase("idle"); };
  const saveMemory = () => { if (contextDraft.trim()) saveContext.mutate({ contextNotes: contextDraft.trim(), displayName: user?.name || undefined }); };
  const copyMessage = async (content: string, index: number) => { await navigator.clipboard?.writeText(content); setCopied(index); window.setTimeout(() => setCopied(null), 1400); };

  const pendingTasks = useMemo(() => (tasksQuery.data || [])
    .filter(task => task.status === "pending")
    .sort((a, b) => {
      const aTime = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity;
      const bTime = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity;
      return aTime - bTime;
    }), [tasksQuery.data]);
  const completedToday = useMemo(() => (tasksQuery.data || []).filter(task => task.status === "completed").slice(0, 6), [tasksQuery.data]);

  return (
    <div className="norah-app-shell flex flex-col bg-[var(--n-bg)] text-[var(--n-text)]" style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--n-border-soft)] px-4 md:px-6">
        <div className="flex items-center gap-2.5">
          <NorahOrb state={orbState} size={26} speaking={auraActive} />
          <span className="font-display text-[15px] tracking-[-0.02em]">Norah</span>
          <span role="status" aria-label={liveStatus ? "Assistant core ready" : "Assistant core unavailable; fallback mode"} className={cn("status-dot ml-1", !liveStatus && "status-dot--idle")} title={liveStatus ? "Core ready" : "Fallback mode"} />
        </div>
        <div className="flex items-center gap-1">
          {!authLoading && !isAuthenticated && <button type="button" onClick={() => startLogin()} className="mr-1 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[var(--n-border)] px-3 text-[11px] font-semibold text-[var(--n-text-dim)] transition-colors hover:border-[rgba(156,123,255,0.4)] hover:bg-white/[0.045] hover:text-[var(--n-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--n-violet-soft)]" aria-label="Sign in" title="Sign in"><LogIn className="size-3.5" /><span>Sign in</span></button>}
          <button type="button" onClick={clearConversation} className="flex size-9 items-center justify-center rounded-full text-[var(--n-text-dim)] transition-colors hover:bg-white/5 hover:text-[var(--n-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--n-violet-soft)]" aria-label="New conversation" title="New conversation"><Plus className="size-4" /></button>
          {isAuthenticated && <button type="button" onClick={() => setHistoryOpen(true)} className="flex size-9 items-center justify-center rounded-full text-[var(--n-text-dim)] transition-colors hover:bg-white/5 hover:text-[var(--n-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--n-violet-soft)]" aria-label="Conversation history" title="History"><History className="size-4" /></button>}
          <button type="button" onClick={() => setPanelOpen(true)} className="flex size-9 items-center justify-center rounded-full text-[var(--n-text-dim)] transition-colors hover:bg-white/5 hover:text-[var(--n-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--n-violet-soft)]" aria-label="Memory and capabilities" title="Memory & capabilities"><Sparkles className="size-4" /></button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-[64px] shrink-0 flex-col items-center gap-2 border-r border-[var(--n-border-soft)] py-5 md:flex">
          <RailButton icon={Sparkles} label="Norah" active={view === "chat"} onClick={() => setView("chat")} />
          <RailButton icon={Calendar} label="Your Day" active={view === "day"} onClick={() => setView("day")} />
        </nav>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {view === "chat" ? (
            <ChatSurface
              messages={messages}
              isThinking={isThinking}
              phase={phase}
              authLoading={authLoading}
              userName={userName}
              pendingTaskProposal={pendingTaskProposal}
              copied={copied}
              speakingMessage={speakingMessage}
              voiceStatus={voiceStatus}
              scrollRef={scrollRef}
              input={input}
              onInputChange={handleInputChange}
              onSend={handleSend}
              onCopy={copyMessage}
              onSpeak={speakAssistantMessage}
              speak={speak}
            />
          ) : (
            <YourDaySurface
              isAuthenticated={Boolean(isAuthenticated)}
              isLoading={tasksQuery.isLoading}
              isError={tasksQuery.isError}
              pendingTasks={pendingTasks}
              completedToday={completedToday}
              onComplete={id => updateTaskStatus.mutate({ taskId: id, status: "completed" })}
              onCancel={id => updateTaskStatus.mutate({ taskId: id, status: "cancelled" })}
            />
          )}
        </main>
      </div>

      <nav aria-label="Primary navigation" className="flex h-[64px] shrink-0 items-center justify-around border-t border-[var(--n-border-soft)] bg-[var(--n-bg)] md:hidden">
        <TabBarButton icon={Sparkles} label="Norah" active={view === "chat"} onClick={() => setView("chat")} />
        <TabBarButton icon={Calendar} label="Your Day" active={view === "day"} onClick={() => setView("day")} />
      </nav>

      {historyOpen && (
        <Drawer onClose={() => setHistoryOpen(false)} title="Recent conversations">
          {conversations.isLoading ? <EmptyNote>Loading history…</EmptyNote>
            : conversations.isError ? <EmptyNote tone="error">History unavailable right now.</EmptyNote>
            : !conversations.data?.length ? <EmptyNote>No conversations yet.</EmptyNote>
            : <div className="space-y-1">{conversations.data.map(thread => (
                <button key={thread.id} onClick={() => { setSelectedConversationId(thread.id); setHistoryOpen(false); }} className="w-full truncate rounded-xl px-3 py-2.5 text-left text-[13px] text-[var(--n-text-dim)] transition-colors hover:bg-white/5 hover:text-[var(--n-text)]">{thread.title}</button>
              ))}</div>}
        </Drawer>
      )}

      {panelOpen && (
        <Drawer onClose={() => setPanelOpen(false)} title="Memory & capabilities">
          <div className="flex gap-1 rounded-xl bg-white/[0.04] p-1">
            <PanelTabButton active={panelTab === "memory"} onClick={() => setPanelTab("memory")}>Memory</PanelTabButton>
            <PanelTabButton active={panelTab === "tools"} onClick={() => setPanelTab("tools")}>Capabilities</PanelTabButton>
          </div>
          {panelTab === "memory" ? (
            <div className="mt-5">
              <p className="text-[13px] leading-5 text-[var(--n-text-dim)]">Signed-in context is used as a hint, not a hidden profile. You can edit it any time.</p>
              {isAuthenticated ? (
                <>
                  <textarea value={contextDraft} onChange={e => setContextDraft(e.target.value)} placeholder="For example: I prefer concise answers and I’m learning TypeScript." className="mt-4 min-h-24 w-full resize-none rounded-xl border border-[var(--n-border)] bg-white/[0.03] p-3 text-[13px] leading-5 text-[var(--n-text)] outline-none placeholder:text-[var(--n-text-faint)] focus:border-[var(--n-violet-soft)]" />
                  <Button onClick={saveMemory} disabled={!contextDraft.trim() || saveContext.isPending} className="mt-3 h-9 w-full rounded-xl bg-[var(--n-violet)] text-xs text-white hover:bg-[var(--n-violet-soft)]">{saveContext.isPending ? "Saving…" : "Save context"}</Button>
                  {context.isError && <p className="mt-2 text-[11px] text-[#e08a8a]">Context could not be loaded. Try again.</p>}
                </>
              ) : (
                <Button onClick={() => startLogin()} variant="outline" className="mt-4 h-9 w-full rounded-xl border-[var(--n-border)] bg-transparent text-xs text-[var(--n-text)]"><LogIn className="mr-2 size-3.5" />Sign in to save memory</Button>
              )}
            </div>
          ) : (
            <div className="mt-5 space-y-2">
              {capabilities.isLoading ? <EmptyNote>Checking available capabilities…</EmptyNote>
                : capabilities.isError ? <EmptyNote tone="error">Capabilities are temporarily unavailable. No external action is enabled.</EmptyNote>
                : toolList.length === 0 ? <EmptyNote>No capabilities reported.</EmptyNote>
                : toolList.map(tool => (
                  <div key={tool.id} className="rounded-xl border border-[var(--n-border)] bg-white/[0.03] p-3">
                    <div className="flex items-center gap-2"><span className={cn("size-1.5 rounded-full", tool.status === "ready" ? "bg-[var(--n-violet-soft)]" : "bg-[var(--n-text-faint)]")} /><p className="text-xs font-semibold">{tool.label}</p><span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--n-text-faint)]">{tool.status === "ready" ? "ready" : "soon"}</span></div>
                    <p className="mt-2 text-[11px] leading-4 text-[var(--n-text-dim)]">{tool.description}</p>
                  </div>
                ))}
            </div>
          )}
        </Drawer>
      )}
    </div>
  );
}

function ChatSurface({ messages, isThinking, phase, authLoading, userName, pendingTaskProposal, copied, speakingMessage, voiceStatus, scrollRef, input, onInputChange, onSend, onCopy, onSpeak, speak }: {
  messages: ChatMessage[];
  isThinking: boolean;
  phase: "idle" | "composing" | "thinking" | "responding" | "error";
  authLoading: boolean;
  userName: string;
  pendingTaskProposal: TaskProposal | null;
  copied: number | null;
  speakingMessage: number | null;
  voiceStatus: SpeechStatus;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  onInputChange: (value: string) => void;
  onSend: (value?: string) => void;
  onCopy: (content: string, index: number) => void;
  onSpeak: (text: string, index: number) => void;
  speak: { isPending: boolean };
}) {
  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={scrollRef} className="chat-scroll flex-1 overflow-y-auto px-5 pb-44 pt-8 md:px-10 md:pt-12 lg:px-[clamp(40px,7vw,120px)]">
        <div className="mx-auto max-w-[680px]">
          {messages.length === 1 && (
            <div className="mb-10 animate-rise">
              <p className="eyebrow">{authLoading ? "Preparing your workspace" : `Good to see you, ${userName}`}</p>
              <h1 className="mt-3 max-w-[540px] font-display text-[clamp(2rem,4.4vw,3.4rem)] leading-[1.02] tracking-[-0.03em] text-[var(--n-text)]">What's on your mind?</h1>
              <p className="mt-5 max-w-[460px] text-[14px] leading-6 text-[var(--n-text-dim)]">Bring a question, a half-formed idea, or a task you keep postponing.</p>
              <div role="group" aria-label="Start with a mode" className="mt-7 grid gap-2 sm:grid-cols-2">
                {starterPrompts.map(item => (
                  <button key={item.eyebrow} onClick={() => onSend(item.prompt)} disabled={isThinking} className="group rounded-2xl border border-[var(--n-border)] bg-white/[0.025] p-3.5 text-left transition-colors hover:border-[rgba(156,123,255,0.35)] hover:bg-white/[0.045]">
                    <div className="flex items-center gap-2"><item.icon className="size-3.5 text-[var(--n-violet-soft)]" /><span className="eyebrow">{item.eyebrow}</span></div>
                    <p className="mt-2 text-[13px] font-medium leading-5 text-[var(--n-text)]">{item.title}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-7">
            {messages.map((message, index) => (
              <div key={`${index}-${message.role}`} className={cn("animate-rise", message.role === "user" ? "flex justify-end" : "")}>
                <div className={cn(message.role === "user" ? "max-w-[86%] rounded-[16px] rounded-br-sm bg-white/[0.06] px-4 py-3 text-[14px] leading-6 text-[var(--n-text)]" : "max-w-[640px]")}>
                  {message.role === "assistant" && (
                    <div className="mb-2.5 flex items-center gap-2">
                      <NorahOrb state="idle" size={18} />
                      <span className="text-[11px] font-semibold tracking-[0.04em] text-[var(--n-text-dim)]">Norah</span>
                      {message.mode && message.mode !== "general" && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--n-text-faint)]">{message.mode}</span>}
                      <button onClick={() => onCopy(message.content, index)} className="ml-auto text-[var(--n-text-faint)] transition-colors hover:text-[var(--n-text)]" aria-label="Copy response">{copied === index ? <Check className="size-3.5 text-[var(--n-violet-soft)]" /> : <Copy className="size-3.5" />}</button>
                      <button onClick={() => void onSpeak(message.content, index)} className="text-[var(--n-text-faint)] transition-colors hover:text-[var(--n-text)]" aria-label="Play response" title={voiceStatus === "error" ? "Voice unavailable" : "Play response"} disabled={speak.isPending}><Volume2 className={cn("size-3.5", speakingMessage === index && "text-[var(--n-violet-soft)]")} /></button>
                    </div>
                  )}
                  {message.role === "assistant" ? <div className="prose prose-sm prose-invert max-w-none text-[14px] leading-7 text-[var(--n-text-dim)]"><Streamdown>{message.content}</Streamdown></div> : <p className="whitespace-pre-wrap">{message.content}</p>}
                  {message.role === "assistant" && message.live === false && <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--n-text-faint)]"><CircleHelp className="size-3.5" />Local fallback · safe to keep going</div>}
                </div>
              </div>
            ))}

            {pendingTaskProposal && (
              <div className="rounded-2xl border border-[rgba(156,123,255,0.28)] bg-[rgba(124,77,255,0.08)] p-4 animate-rise">
                <p className="eyebrow text-[var(--n-violet-soft)]">Confirmation required</p>
                <p className="mt-2 text-[14px] leading-6 text-[var(--n-text)]">{pendingTaskProposal.action === "cancel_task" ? "Cancel this task?" : pendingTaskProposal.action === "update_task" ? "Update this task?" : pendingTaskProposal.scheduledAt ? `Save this reminder${pendingTaskProposal.scheduleLabel ? ` for ${pendingTaskProposal.scheduleLabel}` : ""}?` : "Save this task?"}</p>
                <p className="mt-1 text-xs text-[var(--n-text-dim)]">"{pendingTaskProposal.title}"</p>
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => onSend("Yes")} disabled={isThinking} className="h-8 rounded-lg bg-[var(--n-violet)] px-3 text-xs text-white hover:bg-[var(--n-violet-soft)]"><Check className="mr-1.5 size-3.5" />Confirm</Button>
                  <Button onClick={() => onSend("No")} disabled={isThinking} variant="outline" className="h-8 rounded-lg border-[var(--n-border)] bg-transparent px-3 text-xs text-[var(--n-text-dim)]"><X className="mr-1.5 size-3.5" />Cancel</Button>
                </div>
              </div>
            )}

            {isThinking && (
              <div className="flex items-center gap-3 animate-rise">
                <NorahOrb state="thinking" size={18} />
                <div className="flex items-center gap-1.5 rounded-full bg-white/[0.05] px-4 py-2.5"><span className="typing-dot" /><span className="typing-dot delay-1" /><span className="typing-dot delay-2" /></div>
                <span className="text-xs text-[var(--n-text-faint)]">Thinking through it</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-[var(--n-bg)] via-[var(--n-bg)]/95 to-transparent px-5 pb-5 pt-14">
        <form onSubmit={e => { e.preventDefault(); onSend(); }} className="pointer-events-auto flex w-full max-w-[640px] items-end gap-2 rounded-[20px] border border-[var(--n-border)] bg-white/[0.035] p-2 shadow-[0_10px_30px_rgba(6,5,10,0.45)] backdrop-blur focus-within:border-[rgba(156,123,255,0.45)] focus-within:ring-4 focus-within:ring-[rgba(124,77,255,0.14)]">
          <Textarea value={input} onChange={e => onInputChange(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }} placeholder="Ask Norah anything…" className="min-h-[42px] max-h-28 resize-none border-0 bg-transparent px-3 py-2.5 text-sm text-[var(--n-text)] shadow-none placeholder:text-[var(--n-text-faint)] focus-visible:ring-0" rows={1} aria-label="Message Norah" enterKeyHint="send" />
          <div className="mb-1 mr-1 hidden text-[10px] text-[var(--n-text-faint)] sm:block">{voiceStatus === "loading" ? "Preparing Norah’s voice…" : voiceStatus === "speaking" ? "Norah is speaking" : voiceStatus === "fallback" ? "Browser voice fallback" : voiceStatus === "error" ? "Voice unavailable · try replay" : phase === "composing" ? "Ready when you are" : phase === "responding" ? "Response ready" : phase === "error" ? "Retry available" : ""}</div>
          <Button type="submit" size="icon" disabled={!input.trim() || isThinking} className="mb-0.5 size-9 shrink-0 rounded-[13px] bg-[var(--n-violet)] text-white shadow-none hover:bg-[var(--n-violet-soft)] disabled:bg-white/[0.06] disabled:text-[var(--n-text-faint)]"><ArrowUp className="size-4" /></Button>
        </form>
      </div>
    </section>
  );
}

type TaskItem = { id: number; title: string; scheduledAt: Date | string | null; status: string };

function YourDaySurface({ isAuthenticated, isLoading, isError, pendingTasks, completedToday, onComplete, onCancel }: {
  isAuthenticated: boolean;
  isLoading: boolean;
  isError: boolean;
  pendingTasks: TaskItem[];
  completedToday: TaskItem[];
  onComplete: (id: number) => void;
  onCancel: (id: number) => void;
}) {
  if (!isAuthenticated) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <NorahOrb state="idle" size={40} className="mb-5" />
        <p className="font-display text-xl tracking-[-0.02em] text-[var(--n-text)]">Your Day needs an account</p>
        <p className="mt-2 max-w-[320px] text-[13px] leading-5 text-[var(--n-text-dim)]">Sign in so Norah can keep track of what matters today across sessions.</p>
        <Button onClick={() => startLogin()} variant="outline" className="mt-5 h-9 rounded-xl border-[var(--n-border)] bg-transparent text-xs text-[var(--n-text)]"><LogIn className="mr-2 size-3.5" />Sign in</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto chat-scroll px-5 py-8 md:px-10 md:py-10">
      <div className="mx-auto max-w-[620px]">
        <p className="eyebrow">Today</p>
        <h1 className="mt-2 font-display text-[clamp(1.7rem,3.4vw,2.4rem)] tracking-[-0.03em] text-[var(--n-text)]">A calm look at what matters</h1>
        <p className="mt-3 text-[13px] leading-5 text-[var(--n-text-dim)]">Tasks and reminders Norah has saved for you. Ask her in chat to add more.</p>

        <div className="mt-8">
          {isLoading ? <EmptyNote>Loading your day…</EmptyNote>
            : isError ? <EmptyNote tone="error">Couldn't load tasks right now.</EmptyNote>
            : pendingTasks.length === 0 ? (
              <div className="rounded-2xl border border-[var(--n-border)] bg-white/[0.025] p-6 text-center">
                <p className="text-[13px] leading-5 text-[var(--n-text-dim)]">Nothing pending. Tell Norah about a task or reminder and it will show up here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingTasks.map(task => <TaskRow key={task.id} task={task} onComplete={() => onComplete(task.id)} onCancel={() => onCancel(task.id)} />)}
              </div>
            )}
        </div>

        {completedToday.length > 0 && (
          <div className="mt-9">
            <p className="eyebrow">Recently completed</p>
            <div className="mt-3 space-y-1.5">
              {completedToday.map(task => (
                <div key={task.id} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-[var(--n-text-faint)]">
                  <Check className="size-3.5 text-[var(--n-violet-soft)]" />
                  <span className="line-through">{task.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, onComplete, onCancel }: { task: TaskItem; onComplete: () => void; onCancel: () => void }) {
  const time = task.scheduledAt ? new Date(task.scheduledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : null;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--n-border)] bg-white/[0.025] p-3.5">
      <button onClick={onComplete} className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--n-border)] text-transparent transition-colors hover:border-[var(--n-violet-soft)] hover:text-[var(--n-violet-soft)]" aria-label="Mark complete"><Check className="size-3.5" /></button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-[var(--n-text)]">{task.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--n-text-faint)]">{time ? <><Clock className="size-3" />{time}</> : "No time set"}</p>
      </div>
      <button onClick={onCancel} className="flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--n-text-faint)] transition-colors hover:bg-white/5 hover:text-[var(--n-text)]" aria-label="Dismiss task"><X className="size-3.5" /></button>
    </div>
  );
}

function RailButton({ icon: Icon, label, active, onClick }: { icon: typeof Sparkles; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} aria-pressed={Boolean(active)} className={cn("flex size-11 flex-col items-center justify-center gap-1 rounded-2xl text-[var(--n-text-faint)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--n-violet-soft)]", active ? "bg-[rgba(124,77,255,0.14)] text-[var(--n-violet-soft)]" : "hover:bg-white/5 hover:text-[var(--n-text-dim)]")}>
      <Icon className="size-[18px]" />
    </button>
  );
}

function TabBarButton({ icon: Icon, label, active, onClick }: { icon: typeof Sparkles; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={Boolean(active)} className={cn("flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--n-violet-soft)]", active ? "text-[var(--n-violet-soft)]" : "text-[var(--n-text-faint)]")}>
      <Icon className="size-[18px]" />
      {label}
    </button>
  );
}

function PanelTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={cn("flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors", active ? "bg-white/[0.08] text-[var(--n-text)]" : "text-[var(--n-text-faint)]")}>{children}</button>;
}

function EmptyNote({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "error" }) {
  return <p className={cn("rounded-xl border p-3 text-xs", tone === "error" ? "border-[rgba(224,138,138,0.3)] bg-[rgba(224,138,138,0.06)] text-[#e0a8a8]" : "border-[var(--n-border)] bg-white/[0.025] text-[var(--n-text-dim)]")}>{children}</p>;
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 animate-rise" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative flex h-full w-full max-w-[380px] flex-col border-l border-[var(--n-border)] bg-[var(--n-bg-raised)] p-5" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 20px)", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg tracking-[-0.02em] text-[var(--n-text)]">{title}</h2>
          <button onClick={onClose} className="flex size-8 items-center justify-center rounded-full text-[var(--n-text-faint)] hover:bg-white/5 hover:text-[var(--n-text)]" aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="mt-5 flex-1 overflow-y-auto chat-scroll">{children}</div>
      </div>
    </div>
  );
}
