# MANUS — Plain-Language Product Audit

## 1. What can the app actually do right now?

| Capability | Current reality |
|---|---|
| Chat | **Works.** You can type a message and submit it with Enter or the arrow button. The server tries to generate an assistant response. |
| Planning, writing, learning, organizing, and troubleshooting | **Works at a basic assistant level.** The system identifies the broad intent and gives a practical starting direction. |
| Task creation | **Not implemented.** There is no real task object, checklist database, reminder record, or task-management workflow. |
| Reminders and scheduled actions | **Not implemented.** “Remind me to call Dad at 7:35 PM” is treated as conversation, not as a real reminder. |
| Conversations | **Partly works.** Signed-in conversations and messages can be saved to the server. Guest conversations are saved in that browser’s local storage. |
| Memory | **Partly works.** Signed-in users can manually save lightweight context notes. There is no automatic long-term memory extraction or semantic memory search. |
| Voice input | **Not implemented.** The microphone button is currently interface-only. Server transcription infrastructure exists, but is not connected to the page. |
| Voice output | **Not implemented.** No text-to-speech service is wired into the app. |
| External actions | **Not implemented.** Calendar, web search, email, task services, and arbitrary APIs are shown as future capabilities, not connected integrations. |

## 2. Does it understand natural language?

When the live model is available, every submitted text message is sent to the server-side model, so it can handle ordinary natural language rather than requiring exact commands.

For example, it can understand that this request contains multiple intentions:

> Remind me to call Dad at 7:35 PM, and I have surgery lecture tomorrow.

However, understanding the request does not mean the app can execute it. The current version will not create the reminder or calendar event.

If the live model is unavailable, MANUS switches to a local fallback. That fallback uses simple keyword-based intent detection, such as words related to planning, writing, learning, fixing, or organizing. It is useful for continuity, but it is not a full natural-language reasoning system.

## 3. Is there an AI model behind it?

**Yes.** Submitted messages go through the server to the managed Manus LLM service.

The application does not hard-code the underlying provider as GPT, Gemini, or Claude, so the exact model name cannot honestly be specified from the app itself. The managed service controls that choice.

The model is attempted on each submitted text message that does not require an unavailable tool. Typing alone does not call the model. Pressing Enter, clicking send, or selecting a starter prompt does.

If the model fails or is unavailable, MANUS returns a clearly labeled local fallback response instead of pretending that a live model answered.

## 4. Where are my tasks and conversations saved?

There are currently no real saved tasks or reminders.

For conversations, the behavior is split:

| User state | Storage location | What happens if browser data is cleared? |
|---|---|---|
| Signed in | Server database | Conversations and context should remain available after signing back into the same account. |
| Guest | Browser local storage | The local conversation can be lost if browser data is cleared, another browser/device is used, or local storage is removed. |

Guest data is not currently synchronized across devices.

## 5. Are API keys used, and where are they stored?

**Yes.** The server uses a managed LLM service credential. It is read from a server environment variable and used by the server-side assistant code.

The credential is not embedded in the React frontend and is not sent to the browser as the model credential. The browser sends conversation text to the server endpoint, and the server decides whether to call the model and what context to include.

In plain terms:

> The model key is kept on the managed server side, not in the page running in your browser.

Other managed values exist for authentication and infrastructure, but real secret values are not committed into the source code.

## 6. Does voice output work?

**No.** There is no voice output in the current app, so there is no active text-to-speech provider or voice-output fallback.

Voice input is also not active. The project contains prepared server-side speech-to-text infrastructure, but the microphone control is not connected to an upload/transcription route.

The voice capability is therefore a future-ready seam, not a working feature.

## 7. Is it hosted somewhere permanently?

The current published deployment is available at:

<https://manusai-jfawovjd.manus.space>

It is hosted as a managed Manus web deployment rather than running only on your computer. The URL is intended to remain available as long as the project and deployment remain active, but it is not an unconditional permanent guarantee.

The hosting uses autoscaling, so the app may sleep while idle and take a moment to wake up. That is different from the URL disappearing.

## 8. What is fragile, unfinished, or likely to break?

The most important limitation is that MANUS currently looks more capable than it operationally is. It has architecture for tools, memory, voice, and providers, but only the conversation path, lightweight context, persistence, and fallback behavior are active.

| Area | Current limitation |
|---|---|
| Actions | No real reminders, task creation, calendar changes, web browsing, email, or API actions. |
| Memory | Manual context notes only; no automatic memory formation, ranking, or deletion workflow beyond editing. |
| Responses | No token streaming; replies arrive as a completed response. |
| Voice | Microphone and speech output are not connected. |
| Reliability | Provider failures are handled with fallback text, but there is no mature retry or observability system yet. |
| Security maturity | The basic secret boundary is correct, but future tools still need permissions, allowlists, audit logs, confirmation screens, and rate limits. |
| Mobile and desktop | The responsive web interface works on mobile-sized screens, but there is no installable native mobile or desktop application. |
| Proactivity | It does not run background jobs or proactively remind you about anything. |

The honest description is:

> This is a polished assistant workspace with a real server-side model path and persistence foundation—not yet a complete personal agent.

## 9. What would another AI need to continue the project?

The most useful handoff would be the **actual source repository**, not screenshots or a description.

Another AI would need:

1. The complete source repository or a ZIP export.
2. The dependency lockfile.
3. The database schema and migrations.
4. The architecture and setup documentation.
5. Environment-variable names and setup instructions, but not secret values pasted into chat or source control.
6. A safe database backup/export if the existing data matters.
7. Appropriate project/admin access if it needs to manage the live deployment, database, secrets, or integrations.
8. Authorized access to any external services that should be integrated, such as calendar, email, web search, or task tools.

A checkpoint or code export is enough for another AI to understand and modify the application. Admin access is only needed for live deployment and connected-service management.

## One-sentence summary

**MANUS is currently a polished, server-connected conversational assistant prototype with basic intent shaping, signed-in persistence, manual context memory, and honest fallback behavior; it is not yet a task manager, reminder system, voice assistant, or autonomous agent.**
