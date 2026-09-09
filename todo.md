# MANUS Prototype TODO

- [x] Establish the MANUS product shell with a distinctive responsive assistant workspace.
- [x] Add starter prompts for planning, writing, learning, troubleshooting, and organizing.
- [x] Add clear task states for idle, composing, thinking, responding, fallback, error, and empty history.
- [x] Add keyboard-friendly composer controls, submit behavior, and accessible labels/focus states.
- [x] Add secure server-side assistant-core boundary for model/provider access.
- [x] Add assistant intent framing and structured response metadata for practical help.
- [x] Add persistent conversations and lightweight user preferences/context.
- [x] Add explicit interfaces for memory retrieval, tool execution, and provider/model access.
- [x] Add transparent tool-readiness surface with safe unavailable-integration messaging.
- [x] Add locally functional fallback behavior when live model configuration is unavailable.
- [x] Add robust unauthenticated, loading, error, and empty states.
- [x] Add tests for assistant-core behavior, persistence paths, and frontend-critical contracts.
- [x] Add project documentation covering setup, security boundaries, architecture, limitations, and next priorities.
- [x] Run type checks and test suite; resolve obvious functional issues.
- [x] Verify desktop and mobile presentation with screenshots.

## Follow-up gaps found during verification

- [x] Add an Organize starter prompt and route it through the quick-start UI.
- [x] Surface explicit composing and responding states in the workspace.
- [x] Wire signed-in conversation history and user context/preferences into the frontend.
- [x] Introduce concrete assistant-core provider and executor boundaries in the send path.
- [x] Add a clear unauthenticated sign-in CTA and fuller capability/persistence loading/error handling.
- [x] Add tests for persistence helpers and frontend-critical interaction contracts.

## Bug fix: assistant.context query

- [x] Fix `assistant.context` so the tRPC query always returns a defined value when no preference row exists.
- [x] Add regression coverage for the empty-context query contract.
- [x] Run type checks and focused tests for the fix.

- [x] Add a router-level regression test proving `assistant.context` returns null, not undefined, for an authenticated user without saved preferences.

- [x] Add a copyable plain-language MANUS audit document for handoff and reuse.

## Norah voice output and naming update

- [x] Inspect the current assistant response path and any ElevenLabs configuration.
- [ ] Add a server-side ElevenLabs TTS boundary without exposing the API key.
- [x] Deliver generated audio safely to the frontend and preserve text chat behavior.
- [x] Add automatic response playback with browser speechSynthesis fallback.
- [x] Add voice loading, error, disabled, and fallback states.
- [x] Rename visible product/interface copy from MANUS to Norah without redesigning the UI.
- [x] Test user message → AI response → TTS → audio playback and fallback behavior.

## Cross-repository Norah audit and integration

- [x] Access and inventory the connected GitHub Norah repository without modifying it.
- [x] Compare the GitHub Norah brain path with the current server-side assistant-core.
- [x] Reproduce and diagnose why natural-language input becomes task/to-do output.
- [x] Identify reusable UI, data, and integration components in each codebase.
- [x] Propose a safe integration boundary that preserves existing work.
- [x] Report findings and wait for approval before major architectural changes.

## Audit follow-ups requiring next session or approval

- [ ] Directly run or exercise the private GitHub Norah brain path with one conversational prompt and one task-like prompt; this requires a runnable checkout plus valid Gemini deployment credentials or a deployed endpoint.
- [ ] Obtain user approval for the preservation-first integration direction before any merge, task-model migration, or major refactor.

## Integration plan requested — no implementation

- [x] Produce a detailed architecture comparison and smallest safe vertical-slice plan without merging or rewriting code.

## Approved Norah integration audit — evidence-first

- [x] Re-inventory the connected GitHub Norah repository and the current MANUS project.
- [ ] Safely exercise the existing Norah Gemini/function-calling path where deployment and credentials permit.
- [x] Document reusable capabilities, preservation points, dependencies, credentials, permissions, and infrastructure.
- [x] Document affected modules, integration risks, and what should remain untouched.
- [x] Deliver a staged implementation plan and pause before major merge/refactor work.

- [x] Re-inspect and record the connected GitHub Norah inventory during the approved audit phase.

## Milestone 1 — typed intent and task classifier

- [x] Define typed intent, confidence, evidence, and proposed-action contracts without changing the database or voice layers.
- [x] Implement conversation-versus-task classification with ambiguity and multi-intent handling.
- [x] Add classifier regression tests for ordinary conversation, executable task requests, ambiguous phrasing, and multi-intent messages.
- [x] Run Milestone 1 type checks and tests; stop before Milestone 2.

## Milestone 2 — task proposals and persistence

- [x] Inspect current task-related contracts, schema, router, UI send flow, and scheduling constraints.
- [x] Add a durable task schema with pending, completed, cancelled, and failed states.
- [x] Implement server-side parsing for exact, relative, tomorrow, and common-daypart times with explicit ambiguity handling.
- [x] Add task proposal creation without persistence until confirmation.
- [x] Add explicit confirmation and cancellation procedures with ownership checks.
- [x] Add persistence and retrieval helpers for confirmed tasks.
- [x] Add tests for parsing, ambiguity, ordinary conversation, proposal confirmation/cancellation, and database contracts.
- [x] Run Milestone 2 validation and stop before Milestone 3.

## Milestone 3 — structured action understanding

- [x] Reinspect Milestone 2 task contracts, router behavior, UI proposal flow, and scheduling boundaries.
- [x] Extend typed intent classification with question, task, modification, and cancellation intents.
- [x] Extract structured action fields including title, date, time, duration, and recurrence when present.
- [x] Preserve explicit confirmation before task mutation and handle rejection safely.
- [x] Add safe task modification and cancellation proposals with ownership checks.
- [x] Add realistic conversational integration tests for answer-vs-action decisions.
- [x] Run Milestone 3 validation and stop before the next milestone.

## Milestone 3 hardening gaps

- [x] Wire frontend confirmation submission to explicitly send action and targetTask for update/cancel proposals.
- [x] Make task modification/cancellation resolution reject zero or multiple matches instead of choosing the first fuzzy match.
- [x] Add duplicate/similar task-title tests proving ambiguous targets do not mutate data.
- [x] Add frontend contract coverage for update and cancel confirmation payloads.

## Norah Voice Design — configuration and candidate previews

- [x] Refresh and inspect the existing ElevenLabs connector state without exposing credentials.
- [ ] Diagnose and resolve the 401 authentication problem only through approved connector configuration.
- [ ] Generate multiple Voice Design candidates using the approved Norah voice target and test script.
- [ ] Present candidate previews and relevant settings without selecting a final voice.
- [x] Leave all Norah application code unchanged.

## Approved Inworld Norah voice integration

- [x] Integrate the verified Inworld Norah voice through a server-side TTS service.
- [x] Add a typed speech procedure with server-only credential handling and error states.
- [x] Normalize common contractions for speech while preserving displayed chat text.
- [x] Add automatic assistant audio playback with browser speechSynthesis fallback.
- [x] Add voice integration, normalization, fallback, and regression tests.
- [x] Verify the complete response-to-audio path, build, and existing task functionality.

## Voice verification hardening

- [x] Add frontend playback and browser speechSynthesis fallback regression coverage.
- [x] Add an assistant-response-to-speech integration contract test.
- [x] Run browser-level response-to-audio and induced-provider-failure verification.

## Voice verification follow-ups

- [x] Add explicit voice error and unavailable/disabled playback handling.
- [x] Add a response-to-speech integration test covering provider failure and browser fallback.
- [x] Document the browser-level verification limitation without claiming manual audio playback was completed.

## Home playback integration coverage

- [x] Add a Home-level playback controller test for provider failure to browser speech fallback.
- [x] Add coverage for the browser-unavailable branch and visible voice status recovery.
- [x] Add a Home UI contract assertion for visible voice error/replay state and disabled playback behavior.

## Read-only Norah capability audit

- [ ] Inspect current provider, model, prompt, tool, TTS, audio, STT, streaming, fallback, security, and limitation behavior without code changes.
- [ ] Deliver a status-labeled audit with exact file paths and function names.

## Current-source export

- [ ] Export the current Norah source tree without secrets, validate reproducibility, and publish an independent private GitHub repository.
