# Voice mode: streaming dictation into the input editor

**Status:** done (via local extension)

## Problem

Pi has no voice input. Claude's clients support live dictation where words
appear in the input box as you speak. Typing long prompts is slower than
speaking them, especially for high-level instructions and reviews.

## Proposal

Add a voice dictation mode to pi: a toggle (command + shortcut) that records
from the microphone, streams partial transcriptions into the input editor in
real time, and leaves the final text in the editor for review before sending.

Upstream, this could be a built-in `/voice` command with pluggable STT
backends (Apple SFSpeechRecognizer on macOS, whisper.cpp elsewhere).

## Notes

STT engine comparison for streaming latency:

| Engine | Streaming | Latency |
|---|---|---|
| `hear` (Apple SFSpeechRecognizer) | True incremental partials | ~100–300ms |
| whisper.cpp stream | Pseudo-streaming (chunked re-decode) | 0.5–3s, flickery |
| OpenAI Whisper API | Batch only | full utterance + network |

Apple's engine is the same one behind macOS dictation and is the only local
option with true word-by-word streaming, so it was chosen despite slightly
lower accuracy than Whisper on technical jargon.

`hear` is not in homebrew core; installed from the GitHub release
(https://github.com/sveinbjornt/hear, v0.8) to `~/.local/bin/hear`.

## Resolution

Implemented as extension `~/.pi/agent/extensions/voice-mode.ts` (copy in
[`extensions/voice-mode.ts`](../extensions/voice-mode.ts)).

- `alt+v` hold = push-to-talk (record while held, stop on release); quick tap =
  toggle mode (tap again to stop). `/voice` also toggles. Requires
  `macos-option-as-alt = true` in Ghostty (set per request 001; note Ghostty
  must be restarted after config changes — a running instance predating the
  setting composes √ instead of sending alt+v).
- Push-to-talk release detection uses Kitty keyboard protocol key-release
  events via `ctx.ui.onTerminalInput()` + `isKeyRelease()`/`isKeyRepeat()`
  from pi-tui; on legacy terminals alt+v degrades to a plain toggle.
- Spawns `hear -d -p` (on-device recognition, punctuation); falls back to
  server-backed recognition if the on-device model is unavailable.
- Partial hypotheses from stdout are mirrored live into the editor via
  `ctx.ui.setEditorText()`, appended to whatever text was already there.
  `setEditorText()` alone does not trigger a TUI render (text stayed invisible
  until the next keypress); the extension refreshes its widget on every
  partial, which calls `requestRender()` and makes streaming visible. Worth an
  upstream fix: `setEditorText` should request a render.
- Cumulative-partial heuristic commits an utterance segment when the
  recognizer starts a new, shorter hypothesis.
- Shows a `🎤 listening` widget while recording; cleans up the child process
  on `session_shutdown`.
- TUI-only (`ctx.mode === "tui"`), macOS-only; clear error notifications when
  `hear` is missing or mic/speech permissions are denied.

First use triggers macOS speech-recognition and microphone permission prompts
for the terminal app. Apply with `/reload`.

Possible follow-ups: hands-free mode (auto-send on silence + `say` the
assistant's reply on `agent_settled`), locale flag pass-through.
