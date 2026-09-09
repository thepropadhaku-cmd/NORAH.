import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { Streamdown } from "streamdown";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, CircleHelp, Command, Compass, Copy, Leaf, Loader2, LogIn, Menu, Mic, MoreHorizontal, PanelRight, Plus, Search, Send, Settings2, Sparkles, SquarePen, UserRound, Volume2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { buildTaskConfirmationInput, type TaskProposal } from "@/lib/taskProposal";
import { createAssistantSpeechController, type SpeechStatus } from "@/lib/assistantSpeechController";

type ChatMessage = { role: "user" | "assistant"; content: string; mode?: string; live?: boolean };

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
    try { return JSON.parse(localStorage.getItem("manus-demo-messages") || "null") || [initialMessage]; } catch { return [initialMessage]; }
  });
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [phase, setPhase] = useState<"idle" | "composing" | "thinking" | "responding" | "error">("idle");
  const [contextDraft, setContextDraft] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState<number | undefined>();
  const [activeTab, setActiveTab] = useState<"chat" | "memory" | "tools">("chat");
  const [rightRailOpen, setRightRailOpen] = useState(true);
  const [copied, setCopied] = useState<number | null>(null);
  const [pendingTaskProposal, setPendingTaskProposal] = useState<TaskProposal | null>(null);
  const [speakingMessage, setSpeakingMessage] = useState<number | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<SpeechStatus>("idle");
  const scrollRef = useRef<HTMLDivElement>(null);
  const capabilities = trpc.assistant.capabilities.useQuery();
  const conversations = trpc.assistant.conversations.useQuery(undefined, { enabled: Boolean(isAuthenticated) });
  const context = trpc.assistant.context.useQuery(undefined, { enabled: Boolean(isAuthenticated) });
  const serverMessages = trpc.assistant.messages.useQuery({ conversationId: selectedConversationId as number }, { enabled: Boolean(selectedConversationId && isAuthenticated) });
  const saveContext = trpc.assistant.saveContext.useMutation({ onSuccess: () => context.refetch() });
  const send = trpc.assistant.send.useMutation();
  const confirmTask = trpc.assistant.confirmTask.useMutation();
  const cancelTask = trpc.assistant.cancelTask.useMutation();
  const speak = trpc.assistant.speak.useMutation();
  const speechController = useMemo(() => createAssistantSpeechController(
    text => speak.mutateAsync({ text }),
    window.speechSynthesis,
    status => { setVoiceStatus(status); if (status === "idle" || status === "error") setSpeakingMessage(null); },
  ), [speak.mutateAsync]);
  const toolList = capabilities.data || [];

  useEffect(() => { localStorage.setItem("manus-demo-messages", JSON.stringify(messages)); }, [messages]);
  useEffect(() => { if (context.data?.contextNotes !== undefined) setContextDraft(context.data.contextNotes || ""); }, [context.data?.contextNotes]);
  useEffect(() => { if (serverMessages.data?.length) setMessages(serverMessages.data.map(message => ({ role: message.role, content: message.content, mode: message.mode || undefined, live: message.role === "assistant" }))); }, [serverMessages.data]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, isThinking]);

  const userName = user?.name?.split(" ")[0] || "there";
  const liveStatus = useMemo(() => toolList.some(tool => tool.id === "assistant-core" && tool.status === "ready"), [toolList]);

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

  const clearConversation = () => { setMessages([initialMessage]); setPendingTaskProposal(null); setPhase("idle"); localStorage.removeItem("manus-demo-messages"); };
  const handleInputChange = (value: string) => { setInput(value); if (value.trim() && !isThinking) setPhase("composing"); else if (!value.trim() && !isThinking) setPhase("idle"); };
  const saveMemory = () => { if (contextDraft.trim()) saveContext.mutate({ contextNotes: contextDraft.trim(), displayName: user?.name || undefined }); };
  const copyMessage = async (content: string, index: number) => { await navigator.clipboard?.writeText(content); setCopied(index); window.setTimeout(() => setCopied(null), 1400); };

  return (
    <div className="min-h-screen bg-[#f7f6f2] text-[#20201e] selection:bg-[#d9f75d]">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[#deded6] bg-[#f2f1eb] px-4 py-5 lg:flex">
          <div className="flex items-center gap-3 px-2"><div className="manus-mark"><Sparkles className="size-4" /></div><span className="font-display text-[22px] tracking-[-0.04em]">Norah</span><Badge className="ml-auto rounded-full bg-[#e3e3d9] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#686861]">Beta</Badge></div>
          <Button onClick={clearConversation} className="mt-8 h-11 justify-start gap-3 rounded-xl bg-[#242421] px-4 text-sm font-medium text-white shadow-[0_5px_0_#b9b9ae] hover:bg-[#33332e] active:translate-y-0.5 active:shadow-none"><Plus className="size-4" />New conversation<span className="ml-auto rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-white/60">⌘ K</span></Button>
          <div className="mt-8 px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#9b9b90]">Workspace</div>
          <nav className="mt-2 space-y-1"><NavItem icon={Search} label="Conversations" active /><NavItem icon={Leaf} label="Memory" /><NavItem icon={Zap} label="Capabilities" />{isAuthenticated && <div className="mt-7"><p className="eyebrow px-2">Recent threads</p><div className="mt-2 space-y-1">{conversations.isLoading ? <p className="px-2 py-2 text-[11px] text-[#99998f]">Loading history…</p> : conversations.isError ? <p className="px-2 py-2 text-[11px] text-[#aa7168]">History unavailable</p> : conversations.data?.slice(0, 3).map(thread => <button key={thread.id} onClick={() => setSelectedConversationId(thread.id)} className="w-full truncate rounded-lg px-2 py-2 text-left text-[11px] text-[#85857b] hover:bg-[#e9e8e0]">{thread.title}</button>)}</div></div>}{!authLoading && !isAuthenticated && <div className="mt-7 rounded-2xl border border-[#d9d9cf] bg-[#fbfaf6] p-3"><p className="text-xs font-semibold">Keep the thread going</p><p className="mt-1 text-[11px] leading-4 text-[#8a8a81]">Sign in to sync conversations and context across sessions.</p><Button onClick={() => startLogin()} variant="outline" className="mt-3 h-8 w-full rounded-lg border-[#d4d4c9] bg-transparent text-xs"><LogIn className="mr-2 size-3.5" />Sign in</Button></div>}</nav>
          <div className="mt-auto rounded-2xl border border-[#deded6] bg-[#fbfaf6] p-4"><div className="flex items-center gap-2 text-xs font-semibold"><span className="status-dot" />Core is ready</div><p className="mt-2 text-xs leading-relaxed text-[#87877e]">Start with a question. Norah will help you find the shape of it.</p></div>
          <div className="mt-4 flex items-center gap-3 border-t border-[#deded6] px-2 pt-4"><div className="flex size-8 items-center justify-center rounded-full bg-[#d9f75d] text-xs font-bold">{user?.name?.[0] || "G"}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{user?.name || "Guest workspace"}</p><p className="truncate text-[11px] text-[#92928a]">{user ? "Synced account" : "Local prototype"}</p></div><MoreHorizontal className="size-4 text-[#999990]" /></div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[72px] items-center justify-between border-b border-[#deded6] bg-[#f7f6f2]/90 px-5 backdrop-blur md:px-8"><div className="flex items-center gap-3 lg:hidden"><div className="manus-mark"><Sparkles className="size-4" /></div><span className="font-display text-xl">Norah</span></div><div className="hidden items-center gap-2 text-xs text-[#8a8a81] md:flex"><span className="size-1.5 rounded-full bg-[#b3b3aa]" />Personal workspace <span className="mx-1 text-[#c5c5ba]">/</span> <span className="text-[#373733]">New conversation</span></div><div className="flex items-center gap-2"><Button variant="ghost" size="icon" className="rounded-full text-[#7d7d73] hover:bg-[#ecebe5] lg:hidden"><Menu className="size-4" /></Button><Button variant="ghost" size="icon" onClick={() => setRightRailOpen(!rightRailOpen)} className="rounded-full text-[#7d7d73] hover:bg-[#ecebe5]"><PanelRight className="size-4" /></Button><Button variant="ghost" size="icon" className="rounded-full text-[#7d7d73] hover:bg-[#ecebe5]"><Settings2 className="size-4" /></Button></div></header>

          <div className="flex min-h-0 flex-1">
            <section className="relative flex min-w-0 flex-1 flex-col">
              <div ref={scrollRef} className="chat-scroll flex-1 overflow-y-auto px-5 pb-40 pt-10 md:px-12 md:pt-14 lg:px-[clamp(48px,9vw,150px)]"><div className="mx-auto max-w-[720px]">
                {messages.length === 1 && <div className="mb-10 animate-rise"><p className="eyebrow">{authLoading ? "Preparing your workspace" : `Good morning, ${userName}`}</p><h1 className="mt-3 max-w-[560px] font-display text-[clamp(2.5rem,5vw,4.8rem)] leading-[0.94] tracking-[-0.07em]">What would you like to <span className="text-[#9aa62e]">move forward</span> today?</h1><p className="mt-6 max-w-[480px] text-[15px] leading-7 text-[#77776e]">Bring a question, a half-formed idea, or a task you keep postponing. We’ll give it a useful shape.</p></div>}
                <div className="space-y-8">{messages.map((message, index) => <div key={`${index}-${message.role}`} className={cn("animate-rise", message.role === "user" ? "flex justify-end" : "")}><div className={cn(message.role === "user" ? "max-w-[88%] rounded-[18px] rounded-br-md bg-[#242421] px-5 py-3.5 text-[15px] leading-6 text-white" : "max-w-[680px]")}>
                  {message.role === "assistant" && <div className="mb-3 flex items-center gap-2"><div className="manus-mark size-7"><Sparkles className="size-3.5" /></div><span className="text-xs font-bold tracking-[0.04em]">Norah</span>{message.mode && message.mode !== "general" && <span className="rounded-full bg-[#ecece4] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#85857b]">{message.mode}</span>}<button onClick={() => copyMessage(message.content, index)} className="ml-auto text-[#a2a299] transition-colors hover:text-[#33332d]" aria-label="Copy response">{copied === index ? <Check className="size-3.5 text-[#8b9d24]" /> : <Copy className="size-3.5" />}</button><button onClick={() => void speakAssistantMessage(message.content, index)} className="text-[#a2a299] transition-colors hover:text-[#33332d]" aria-label="Play response" title={voiceStatus === "error" ? "Voice unavailable" : speakingMessage === index ? "Playing response" : "Play response"} disabled={speak.isPending}><Volume2 className={cn("size-3.5", speakingMessage === index && "text-[#8b9d24]")} /></button></div>}
                  {message.role === "assistant" ? <div className="prose prose-sm max-w-none text-[15px] leading-7 text-[#494943]"><Streamdown>{message.content}</Streamdown></div> : <p className="whitespace-pre-wrap">{message.content}</p>}
                  {message.role === "assistant" && message.live === false && <div className="mt-4 flex items-center gap-2 text-[11px] text-[#a09f92]"><CircleHelp className="size-3.5" />Local fallback · safe to keep going</div>}
                </div></div>)}
                {pendingTaskProposal && <div className="mt-5 rounded-2xl border border-[#d8e59a] bg-[#f8fbe9] p-4 animate-rise"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#81901f]">Confirmation required</p><p className="mt-2 text-sm leading-6 text-[#454b26]">{pendingTaskProposal.action === "cancel_task" ? "Cancel this task?" : pendingTaskProposal.action === "update_task" ? "Update this task?" : pendingTaskProposal.scheduledAt ? `Save this reminder${pendingTaskProposal.scheduleLabel ? ` for ${pendingTaskProposal.scheduleLabel}` : ""}?` : "Save this task?"}</p><p className="mt-1 text-xs text-[#777c55]">“{pendingTaskProposal.title}”</p><div className="mt-3 flex gap-2"><Button onClick={() => handleSend("Yes")} disabled={isThinking} className="h-8 rounded-lg bg-[#242421] px-3 text-xs text-white hover:bg-[#33332e]"><Check className="mr-1.5 size-3.5" />Confirm</Button><Button onClick={() => handleSend("No")} disabled={isThinking} variant="outline" className="h-8 rounded-lg border-[#cfd8a0] bg-transparent px-3 text-xs text-[#5f6730]"><X className="mr-1.5 size-3.5" />Cancel</Button></div></div>}
                {isThinking && <div className="flex items-center gap-3 animate-rise"><div className="manus-mark size-7"><Sparkles className="size-3.5" /></div><div className="flex items-center gap-1.5 rounded-full bg-[#ecece5] px-4 py-2.5"><span className="typing-dot" /><span className="typing-dot delay-1" /><span className="typing-dot delay-2" /></div><span className="text-xs text-[#a09f95]">Thinking through it</span></div>}
              </div></div></div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-[#f7f6f2] via-[#f7f6f2]/95 to-transparent px-5 pb-5 pt-16"><form onSubmit={e => { e.preventDefault(); handleSend(); }} className="pointer-events-auto flex w-full max-w-[720px] items-end gap-2 rounded-[20px] border border-[#d8d8ce] bg-[#fbfaf6] p-2 shadow-[0_10px_30px_rgba(46,46,38,0.08)] focus-within:border-[#aab83a] focus-within:ring-4 focus-within:ring-[#d9f75d]/20"><Textarea value={input} onChange={e => handleInputChange(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder="Ask Norah anything…" className="min-h-[42px] max-h-28 resize-none border-0 bg-transparent px-3 py-2.5 text-sm shadow-none focus-visible:ring-0" rows={1} aria-label="Message Norah" /><Button type="button" variant="ghost" size="icon" className="mb-0.5 hidden rounded-full text-[#8d8d83] hover:bg-[#eeeee6] sm:flex" aria-label="Voice input"><Mic className="size-4" /></Button><div className="mb-1 mr-1 hidden text-[10px] text-[#a09f95] sm:block">{voiceStatus === "loading" ? "Preparing Norah’s voice…" : voiceStatus === "speaking" ? "Norah is speaking" : voiceStatus === "fallback" ? "Browser voice fallback" : voiceStatus === "error" ? "Voice unavailable · try replay" : phase === "composing" ? "Ready when you are" : phase === "responding" ? "Response ready" : phase === "error" ? "Retry available" : ""}</div><Button type="submit" size="icon" disabled={!input.trim() || isThinking} className="mb-0.5 size-9 shrink-0 rounded-[13px] bg-[#d9f75d] text-[#25251f] shadow-none hover:bg-[#c9e94b] disabled:bg-[#e4e4dc]"><ArrowUp className="size-4" /></Button></form></div>
            </section>

            {rightRailOpen && <aside className="hidden w-[285px] shrink-0 border-l border-[#deded6] bg-[#f2f1eb] p-5 xl:block"><div className="flex items-center justify-between"><div><p className="eyebrow">Context panel</p><h2 className="mt-2 font-display text-2xl tracking-[-0.05em]">Workspace signals</h2></div><button onClick={() => setRightRailOpen(false)} className="rounded-full p-1.5 text-[#99998f] hover:bg-[#e5e4dc]" aria-label="Close context panel"><X className="size-4" /></button></div><div className="mt-7 flex gap-1 rounded-xl bg-[#e5e4dc] p-1"><TabButton active={activeTab === "chat"} onClick={() => setActiveTab("chat")}>Today</TabButton><TabButton active={activeTab === "memory"} onClick={() => setActiveTab("memory")}>Memory</TabButton><TabButton active={activeTab === "tools"} onClick={() => setActiveTab("tools")}>Tools</TabButton></div>{activeTab === "chat" && <div className="mt-7 space-y-5"><div className="rounded-2xl border border-[#deded6] bg-[#fbfaf6] p-4"><div className="flex items-center gap-2 text-xs font-semibold"><span className="status-dot" />{liveStatus ? "Assistant core ready" : "Fallback mode active"}</div><p className="mt-3 text-xs leading-5 text-[#85857b]">A calm starting point is usually better than a busy dashboard. Ask for a plan, a draft, an explanation, or a diagnosis.</p></div><div><p className="eyebrow">Try a direction</p><div className="mt-3 space-y-2">{starterPrompts.map(item => <button key={item.eyebrow} onClick={() => handleSend(item.prompt)} disabled={isThinking} className="group w-full rounded-xl border border-[#deded6] bg-[#fbfaf6] p-3 text-left transition-all hover:-translate-y-0.5 hover:border-[#b9c54e] hover:shadow-sm"><div className="flex items-center gap-2"><item.icon className="size-3.5 text-[#98a62b]" /><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9b9b90]">{item.eyebrow}</span><ArrowUp className="ml-auto size-3 -rotate-45 text-[#b2b2a8] opacity-0 transition-opacity group-hover:opacity-100" /></div><p className="mt-2 text-xs font-medium leading-5">{item.title}</p></button>)}</div></div></div>}{activeTab === "memory" && <div className="mt-7"><div className="rounded-2xl border border-[#deded6] bg-[#fbfaf6] p-4"><Leaf className="size-4 text-[#98a62b]" /><p className="mt-3 text-sm font-medium">Lightweight memory</p><p className="mt-2 text-xs leading-5 text-[#85857b]">Signed-in context is used as a hint, not a hidden profile. You can edit it at any time.</p>{isAuthenticated ? <><textarea value={contextDraft} onChange={e => setContextDraft(e.target.value)} placeholder="For example: I prefer concise answers and I’m learning TypeScript." className="mt-4 min-h-24 w-full resize-none rounded-xl border border-[#deded6] bg-[#f7f6f2] p-3 text-xs leading-5 outline-none focus:border-[#aab83a]" /><Button onClick={saveMemory} disabled={!contextDraft.trim() || saveContext.isPending} className="mt-3 h-8 w-full rounded-lg bg-[#242421] text-xs text-white hover:bg-[#33332e]">{saveContext.isPending ? "Saving…" : "Save context"}</Button>{context.isError && <p className="mt-2 text-[11px] text-[#aa7168]">Context could not be loaded. Try again.</p>}</> : <Button onClick={() => startLogin()} variant="outline" className="mt-4 h-8 w-full rounded-lg border-[#d4d4c9] bg-transparent text-xs"><LogIn className="mr-2 size-3.5" />Sign in to save memory</Button>}<Badge className="mt-4 rounded-full bg-[#e8f3bd] text-[10px] text-[#69791d]">Privacy by design</Badge></div></div>}{activeTab === "tools" && <div className="mt-7 space-y-2">{capabilities.isLoading ? <p className="rounded-xl border border-[#deded6] bg-[#fbfaf6] p-3 text-xs text-[#85857b]">Checking available capabilities…</p> : capabilities.isError ? <p className="rounded-xl border border-[#e2c9c4] bg-[#fff8f6] p-3 text-xs text-[#aa7168]">Capabilities are temporarily unavailable. No external action is enabled.</p> : toolList.length === 0 ? <p className="rounded-xl border border-[#deded6] bg-[#fbfaf6] p-3 text-xs text-[#85857b]">No capabilities reported.</p> : toolList.map(tool => <div key={tool.id} className="rounded-xl border border-[#deded6] bg-[#fbfaf6] p-3"><div className="flex items-center gap-2"><span className={cn("size-1.5 rounded-full", tool.status === "ready" ? "bg-[#a8bc34]" : "bg-[#c6c6bc]")} /><p className="text-xs font-semibold">{tool.label}</p><span className="ml-auto text-[10px] uppercase tracking-wider text-[#9b9b90]">{tool.status === "ready" ? "ready" : "soon"}</span></div><p className="mt-2 text-[11px] leading-4 text-[#8a8a81]">{tool.description}</p></div>)}</div>}</aside>}
          </div>
        </main>
      </div>
    </div>
  );
}

function NavItem({ icon: Icon, label, active }: { icon: typeof Search; label: string; active?: boolean }) { return <button className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition-colors", active ? "bg-[#e5e4dc] font-semibold text-[#282822]" : "text-[#898980] hover:bg-[#e9e8e0] hover:text-[#383832]")}><Icon className="size-4" />{label}{active && <span className="ml-auto size-1.5 rounded-full bg-[#a8bc34]" />}</button>; }
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={cn("flex-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition-colors", active ? "bg-[#fbfaf6] text-[#393931] shadow-sm" : "text-[#99998f]")}>{children}</button>; }
