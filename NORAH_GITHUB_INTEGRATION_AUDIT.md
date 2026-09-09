# Norah GitHub Repository Audit and Integration Recommendation

**Repository inspected:** [thepropadhaku-cmd/Norah](https://github.com/thepropadhaku-cmd/Norah), `main` branch, through the connected GitHub session.

**Comparison target:** The current managed MANUS/Norah project in `/home/ubuntu/manus-assistant`.

## Executive conclusion

The GitHub Norah project is not “brain-dead” because Gemini is completely absent. It has a real Gemini call and a thoughtful task-oriented prompt, but its entire contract is built around producing structured task actions. The assistant is therefore an **action interpreter for a task list**, not a general personal assistant.

The strongest path is to preserve the GitHub project’s valuable domain work—medical-student tone, task action schema, time normalization, task completion/deletion semantics, and initial voice intent—while using the current MANUS/Norah project as the durable product shell and server boundary. We should not replace either codebase wholesale.

## 1. What exists in the GitHub Norah repository

The repository is a small Netlify-style single-page application. The important files are:

| Area | File | What it does |
|---|---|---|
| Frontend and UI | `index.html` | Contains the complete page, styling, task interface, client logic, and local interaction state. |
| Assistant brain | `netlify/functions/norah-brain.js` | Calls Gemini and requests a structured `norah_actions` function response. |
| Text-to-speech | `netlify/functions/tts.js` | Calls ElevenLabs and returns base64-encoded MP3 audio. |
| Offline/install shell | `service-worker.js`, `manifest.json` | Provides PWA-style installation and service-worker behavior. |
| Branding | `icon-192.png`, `icon-512.png` | Application icons. |

The repository is primarily HTML and JavaScript. In the visible tree there is no package manifest, typed application layer, database schema, automated test suite, or durable task persistence model.

## 2. Why it turns normal conversation into to-do lists

The brain’s contract is explicitly action-first:

```text
POST { text, tasks, now }
→ { reply: string, actions: [...] }
```

The Gemini prompt tells the model to always call a function named `norah_actions`. The function can return `add`, `complete`, `delete`, or `speak` actions. The brain also forces Gemini’s function-calling mode to `ANY`, which means every response is expected to use that structured function path rather than ordinary conversational text.

The prompt contains a good distinction: genuine tasks should become `add` actions, while questions and conversation should become `speak` actions. However, the entire product still revolves around the action schema. If the frontend mishandles or ignores the `speak` action, ordinary questions become silent or appear to do nothing. If the model interprets a sentence as an implied commitment, the task-first UI makes that behavior feel like the assistant is converting everything into a to-do item.

The core issue is therefore not merely wording. It is the product contract:

> The GitHub version asks, “Which task actions should I apply?” before it asks, “What kind of help does this person need?”

That is the opposite order for a general personal assistant.

## 3. What the GitHub brain does well

The existing repository contains useful work that should not be thrown away.

First, its tone is more specific than the current prototype. It is designed for a medical student and includes constraints such as being warm without becoming fake-emotional, concise without fluff, and practical without over-praising.

Second, the action schema is a useful beginning for future tools. It distinguishes adding, completing, deleting, and speaking. That is better than allowing the model to emit arbitrary unvalidated commands.

Third, the code has deliberate time normalization. It recognizes variants such as `7:35 pm`, `7.35 pm`, `7 35 pm`, and `19:35`, converts them to 24-hour time, and tries not to confuse a duration such as “35 minutes” with a clock time.

Fourth, the brain sanitizes returned actions rather than trusting the model output blindly. It validates action types, removes invalid titles, normalizes times, and avoids inventing task titles from malformed output.

Fifth, the voice intent is conceptually present. The `speak` action separates spoken conversational content from the short task confirmation. This is a good design idea even though the full path needs verification.

## 4. What is fragile or incomplete in the GitHub version

The task model appears to live in the browser rather than in a durable server database. That makes the project useful as a personal local tool, but weak for cross-device continuity, backups, or reliable background reminders.

The brain and UI are tightly coupled through one large JavaScript/HTML file. The client contract, rendering, local storage, task mutation, speech behavior, and presentation are all close together. This makes rapid prototyping easy but makes future features harder to isolate and test.

There is no visible automated test suite. The most important behaviors—task-versus-conversation classification, time parsing, `speak` handling, ElevenLabs response decoding, browser fallback, and action safety—can regress without being detected.

The TTS function is a real server-side attempt, but it assumes a fixed ElevenLabs voice ID and returns raw MP3 bytes as base64. That can work in Netlify Functions, but it depends on correct deployment configuration, correct API permissions, a valid voice ID, and frontend code that converts the base64 response into playable audio. The presence of the function alone does not prove that every normal assistant response reaches it.

The repository also appears to depend on separate deployment configuration for `GEMINI_API_KEY` and `ELEVENLABS_API_KEY`. Those keys are correctly intended to stay in Netlify environment variables, but the project does not visibly provide a typed configuration layer, startup validation, or a clear test that the deployed secrets and endpoint contracts are healthy.

## 5. Comparison with the current MANUS/Norah project

| Concern | GitHub Norah | Current MANUS/Norah project |
|---|---|---|
| Main strength | Concrete task UX and domain-specific action logic. | Extensible product shell, typed server boundary, auth, database, and fallback behavior. |
| Model | Gemini 2.5 Flash through a Netlify function. | Managed server-side LLM helper behind `assistantCore`. |
| Response shape | Always structured `reply + actions`. | Primary conversational response with assistant mode and live/fallback metadata. |
| Task system | Core product behavior, apparently browser-managed. | Not yet a real task system; tools are intentionally gated. |
| Memory | Existing task list is sent as context; no durable semantic memory visible. | Signed-in conversations and lightweight context notes persist in a server database. |
| Voice | ElevenLabs TTS function and browser speech fallback code exist in the repository. | Voice was intentionally marked future-ready and is not yet fully connected in the current project. |
| Security | API keys intended for Netlify server environment variables. | Server-side credentials and typed server procedures are already part of the managed runtime. |
| Testing | No visible test suite. | Type checks and automated tests exist, including assistant-core and persistence coverage. |
| Deployment | Netlify-oriented static/PWA structure. | Managed full-stack deployment with Express, tRPC, Drizzle, OAuth, and autoscaling. |

## 6. Recommended integration architecture

The safest integration is a **three-layer model**.

### Layer 1: Norah product interface

Keep the current polished Norah workspace as the user-facing interface. It should remain replaceable: the UI talks to typed assistant procedures rather than directly to Gemini, ElevenLabs, calendars, or task databases.

### Layer 2: Assistant core

Keep the current `assistantCore` boundary, but evolve its response contract to support both conversation and optional actions:

```text
AssistantResponse {
  message: string,
  mode: plan | write | learn | organize | troubleshoot | general,
  actions: proposed actions,
  speech: optional speech request,
  needs_confirmation: boolean
}
```

The assistant should first classify the user’s intent. A normal question should produce a useful answer. A genuine “remember this,” “add this,” or “remind me” request should produce a proposed task action. A side effect should never happen simply because a model emitted a function call.

### Layer 3: Governed tools and persistence

Bring over the GitHub action schema as a server-side, validated tool/action layer. Store tasks in durable database tables alongside conversations and messages. Add explicit confirmation rules for actions that create, delete, send, schedule, or change external data.

The old `speak` action should become a speech request generated from the assistant’s actual answer, rather than a second-class path that competes with the main response. Text should remain the source of truth; audio should be an optional representation of that text.

## 7. Recommended implementation order

| Priority | Build next | Why |
|---:|---|---|
| 1 | Add a real task/reminder data model to the current server database. | This converts the existing task idea into durable product behavior instead of browser-only state. |
| 2 | Port and test GitHub Norah’s time parser and action sanitizer. | This preserves the best existing logic while putting it behind typed server contracts. |
| 3 | Add a response classifier that separates conversation, information requests, planning, and genuine task commands. | This directly fixes the “everything becomes a to-do” problem. |
| 4 | Add task proposals and confirmation before mutation. | The assistant can understand intent without silently creating or deleting things. |
| 5 | Finish one complete TTS path in the current project using ElevenLabs server-side plus browser speech fallback. | This provides a reusable audio capability for all future assistant responses. |
| 6 | Add traceable assistant runs and tests for model output, actions, TTS, failures, and prompt-injection resistance. | This is necessary before trusting Norah with daily use. |
| 7 | Only then add calendars, web research, email, notifications, and proactive background work. | External actions should build on stable identity, memory, permissions, and confirmation contracts. |

## 8. What should be preserved versus replaced

| Preserve from GitHub Norah | Replace or restructure |
|---|---|
| Medical-student tone and personality constraints. | The action-first contract as the top-level assistant behavior. |
| `add`, `complete`, `delete`, and `speak` concepts. | Browser-only task state as the long-term storage model. |
| Clock-time normalization and duration distinction. | One-file coupling between UI, brain, task mutation, and voice. |
| Action sanitization. | Unconditionally forcing function calling for every message. |
| ElevenLabs request details as a reference implementation. | Unverified voice wiring without end-to-end tests and error states. |
| PWA manifest, icons, and service-worker ideas. | Lack of typed contracts and automated regression coverage. |

## 9. Bottom line

Your GitHub work is not wasted. It contains the beginnings of a useful **task/action subsystem**, especially the time parsing, task mutation vocabulary, personality prompt, and voice intent.

Our current project is stronger as the foundation for the actual assistant product because it already has a server-side assistant boundary, durable signed-in conversations, user context, typed procedures, authentication, fallback behavior, and automated tests.

The right move is to integrate the GitHub project’s task intelligence into the current Norah assistant core—not to merge the two frontends blindly and not to keep the current project as a purely decorative chat shell. The next major build should make Norah conversational first, task-aware second, and action-capable only through explicit server-side validation and user confirmation.

## Current status

No major architectural changes were made during this audit. The GitHub repository was inspected in the connected session, and the findings were recorded for review. The next implementation step should wait for your approval of this preservation-first integration direction.


## Evidence update from the approved audit session

The current MANUS project inventory was rechecked. It has the React workspace, typed tRPC assistant router, assistant-core contracts, Drizzle migrations, auth, persistence helpers, and automated tests. `pnpm check` passes. The full test command currently reports 9 passing tests and 1 failing test: `server/voiceElevenLabs.test.ts` receives HTTP 401 from ElevenLabs `/v1/user`. The production build was not reached because the test command stops on that failure.

The failure is a credential/configuration issue, not evidence that the assistant-core or GitHub Norah architecture is unusable. The current shell contains an `ELEVENLABS_API_KEY` value, but ElevenLabs rejects it as unauthorized. No key value was printed or recorded.

The GitHub Norah repository remains source-inspected rather than directly executed. Its visible tree has no package manifest or test runner, and its brain function requires the deployed Netlify `GEMINI_API_KEY`. The source confirms the Gemini action-first architecture and the separate ElevenLabs Netlify function, but a live conversational prompt and task prompt have not been exercised against that deployment. Direct runtime reproduction remains blocked until a valid deployed endpoint or runnable checkout with valid Gemini configuration is available.

No application merge, refactor, database migration, or UI change was made during this audit session. The only current project changes are audit documentation and checklist entries.


## Fresh repository inventory from this audit phase

The connected GitHub repository is private, on `main`, with one branch, zero tags, and 18 commits at the time of inspection. Its current visible top-level tree contains `netlify/functions/`, `icon-192.png`, `icon-512.png`, `index.html`, `manifest.json`, and `service-worker.js`. The functions directory contains `norah-brain.js` and `tts.js`. GitHub identifies the repository as approximately 70.3% HTML and 29.7% JavaScript. No package manifest, test directory, database schema, or workflow configuration was visible in the current top-level tree.

The latest visible commits include `Update task action schema descriptions` for the brain function, `Refactor TTS function to Netlify function handler` for `tts.js`, and `Add voice output functionality for 'speak' action` for `index.html`. This confirms recent work on task schema and voice behavior, but not a verified end-to-end deployment test.
