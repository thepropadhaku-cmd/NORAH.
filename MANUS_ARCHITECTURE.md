# MANUS prototype

MANUS is a personal assistant workspace designed around a simple product principle: reduce cognitive load without pretending to be more connected or capable than it is. The first prototype combines an editorial conversation surface with an assistant-core boundary that can grow into richer model, memory, and tool capabilities.

## What is implemented

The current workspace supports starter directions for planning, writing, learning, and troubleshooting. Messages are sent through a typed tRPC procedure and rendered as markdown. The UI keeps a local conversation fallback so the prototype remains useful when a model provider is unavailable or the user is unauthenticated. Signed-in users can persist conversations, messages, and lightweight context notes in the database.

The context rail deliberately exposes readiness instead of hiding missing integrations. The assistant core and memory boundaries are marked ready in this prototype; web research, calendar, and voice are clearly marked as coming soon. The interface does not claim that those external actions have happened.

## Architecture

The frontend is a React 19 application. `client/src/pages/Home.tsx` owns presentation state and calls the typed `assistant.send` procedure through the generated tRPC client. The UI does not hold model credentials and does not call a model provider directly.

The server exposes `server/assistantCore.ts` as the capability boundary. It owns intent inference, system framing, memory hints, provider invocation, and the local fallback response. `ModelProvider`, `MemoryProvider`, and `ToolRegistry` are explicit contracts so later integrations can be introduced without changing the conversation surface.

The server router in `server/routers.ts` handles transport and authorization concerns. When a signed-in user is present, the procedure loads lightweight context and persists the user and assistant turns. `server/db.ts` keeps Drizzle details away from the UI. The schema contains `conversations`, `messages`, and `userPreferences` alongside the scaffolded `users` table.

## Security boundary

Model access is server-side through the preconfigured managed LLM helper. No provider credential is included in client bundles. The browser sends conversation text to the server procedure, and the server decides what context can be used. External tools should be added behind explicit server-side allowlists, user authorization, input validation, audit logging, and confirmation gates for side effects.

This prototype intentionally does not connect to arbitrary browser sessions, calendar accounts, email, or third-party APIs. A future tool executor should distinguish read-only tools from actions that create, send, delete, purchase, or publish something. High-impact actions should require an explicit user confirmation immediately before execution.

## Local and production behavior

A signed-in user with a working database gets durable conversation rows and context notes. A guest user receives a locally persisted browser conversation and can still use the assistant route. If the managed model call fails, the server returns a transparent local fallback response with `live: false`; the UI labels that state rather than presenting it as a live model answer.

The project uses the managed full-stack runtime with Vite, Express, tRPC, Drizzle, and Manus OAuth. Run `pnpm check` for type safety, `pnpm test` for the backend tests, and `pnpm build` for a production bundle. Secrets remain in managed environment variables; do not commit `.env` files or paste real credentials into source control.

## Current limitations

The assistant is not yet a proactive agent. It does not schedule background work, browse the web, call external user services, execute arbitrary functions, stream tokens, accept voice input, or synthesize speech. Memory is intentionally lightweight and is not yet semantic retrieval. The guest fallback is browser-local rather than a cross-device identity system. These are deliberate seams for future sessions rather than hidden claims of functionality.

## Priority next build

1. Add a durable assistant run model with traceable tool-call events, provider latency, token metadata, and error states.
2. Add a governed tool executor with read-only web research first, then user-approved calendar and task integrations.
3. Replace text context notes with structured memory facts, user-approved saves, retrieval scoring, and deletion controls.
4. Add streaming responses and a voice loop with explicit microphone permission and interruption handling.
5. Add evaluation fixtures for intent routing, fallback honesty, prompt-injection resistance, and action confirmation.
6. Add an installable mobile/desktop shell after the core interaction contracts stabilize.
