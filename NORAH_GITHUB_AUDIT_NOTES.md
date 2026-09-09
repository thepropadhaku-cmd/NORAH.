# Norah GitHub Audit Notes

Source inspected: `thepropadhaku-cmd/Norah`, `main` branch, via the connected GitHub browser session.

## Repository shape

The repository is a small Netlify-style single-page app. The visible top-level implementation includes `index.html`, `service-worker.js`, `manifest.json`, and `netlify/functions/norah-brain.js` plus `netlify/functions/tts.js`. GitHub reports the project as primarily HTML and JavaScript. There is no visible package manifest, typed application layer, database schema, test suite, or structured task persistence layer in the inspected tree.

## Brain path

`norah-brain.js` uses Gemini `gemini-2.5-flash` through the Google Generative Language API. It reads `GEMINI_API_KEY` from Netlify environment variables and does not place the key in frontend source. The client contract is `POST { text, tasks, now }` returning `{ reply, actions }`.

The brain always calls a Gemini function declaration named `norah_actions` and forces function-calling mode `ANY`. Its allowed action types are `add`, `complete`, `delete`, and `speak`. The prompt explicitly says non-task conversation should produce a `speak` action, while task commands produce task actions. It then cleans/normalizes actions, including clock-time parsing.

This is a narrow task/action interpreter rather than a general assistant brain. It is designed to turn every message into a structured action response. That explains why the product can feel like it only makes to-do lists: the core contract is action-first, the UI is task-first, and the client must separately handle `speak` actions for conversational answers.

## Voice path

`tts.js` is a Netlify function that accepts `{ text }`, calls ElevenLabs `POST https://api.elevenlabs.io/v1/text-to-speech/bTrcsfuKV8fA1AZjBDYK` with the server-side `ELEVENLABS_API_KEY`, uses model `eleven_flash_v2_5`, and returns base64-encoded `audio/mpeg`. The key is not in the frontend source.

The frontend includes a voice-output change in the latest commit and has browser speech fallback code using `window.speechSynthesis`, but the inspected rendered-source extraction does not make the complete response-to-TTS wiring easy to verify. The separate TTS function is therefore a real backend attempt, not proof that every assistant response reliably reaches and plays through it.

## Likely failure modes

1. The forced `ANY` function-calling contract makes the app action-oriented by design.
2. If Gemini returns a `speak` action but the client does not consistently call `/.netlify/functions/tts`, conversation will appear silent or task-only.
3. If ElevenLabs rejects the key, voice ID, model, or request, the app must fall back to `speechSynthesis`; the source contains fallback code, but this needs end-to-end verification.
4. The repository has no visible tests, so brain behavior, action classification, TTS response handling, and playback are not protected by regression coverage.
5. The app’s task data appears to be client-managed; no durable server database was visible in the inspected repository tree.

## Integration implication

The safest path is not to replace the GitHub app wholesale. Preserve its useful domain knowledge: medical-student tone, action schema, clock parsing, task completion/deletion semantics, and voice intent. Use the current MANUS/Norah project as the application shell and server boundary, then bring over the task/action contract as a governed tool/action layer behind the existing assistant core. Keep the conversational response as the primary output and make task actions optional, explicit, and testable.
