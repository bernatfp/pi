/**
 * Voice mode for pi — streaming dictation into the input editor.
 *
 * Uses the `hear` CLI (https://github.com/sveinbjornt/hear), which wraps
 * Apple's native SFSpeechRecognizer. Partial transcription results stream
 * to stdout as you speak and are mirrored live into pi's input editor,
 * giving the same live-dictation feel as Claude's clients.
 *
 * Usage:
 *   alt+v (hold)        — push-to-talk: record while held, stop on release
 *   alt+v (quick tap)   — toggle mode: start recording, tap again to stop
 *   /voice              — toggle recording on/off
 *
 * While recording, a "🎤 listening" widget is shown and your words appear
 * in the editor in real time. Stop, review, and press enter to send. Text
 * already in the editor is preserved and the transcription is appended.
 *
 * Push-to-talk release detection needs the Kitty keyboard protocol
 * (Ghostty, Kitty, WezTerm). On terminals without it, alt+v behaves as a
 * plain toggle.
 *
 * Requirements: macOS, `hear` binary on PATH or in ~/.local/bin. The first
 * run triggers a macOS speech-recognition permission prompt for your
 * terminal app.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, isKeyRepeat, isKittyProtocolActive, Key, matchesKey } from "@earendil-works/pi-tui";

const SHORTCUT = Key.alt("v");

const HEAR_CANDIDATES = [
	path.join(os.homedir(), ".local", "bin", "hear"),
	"/opt/homebrew/bin/hear",
	"/usr/local/bin/hear",
];

/** -d: on-device recognition (no ~500 char server-session limit), -p: punctuation. */
const PREFERRED_ARGS = ["-d", "-p"];
/** Fallback when the on-device model is unavailable on this Mac. */
const FALLBACK_ARGS = ["-p"];

const WIDGET_KEY = "voice-mode";

/** A press-release shorter than this is a tap (toggle mode); longer is push-to-talk. */
const TAP_MS = 400;
/** In legacy (non-Kitty) terminals, repeated press events closer than this are key auto-repeat. */
const LEGACY_REPEAT_GAP_MS = 600;

export default function voiceMode(pi: ExtensionAPI) {
	let proc: ChildProcess | null = null;
	let stopping = false;
	// Editor text present before recording started; transcription is appended to it.
	let baseText = "";
	// Finalized utterance segments (see commit heuristic below).
	let committed = "";
	// Current in-flight partial hypothesis.
	let partial = "";
	// Raw-input listener active while recording (push-to-talk release detection).
	let unsubscribeInput: (() => void) | undefined;
	// When the recording-starting press happened.
	let pressStartedAt = 0;
	// Last time any alt+v event was seen (legacy auto-repeat detection).
	let lastShortcutEventAt = 0;

	function findHear(): string | undefined {
		return HEAR_CANDIDATES.find((p) => existsSync(p));
	}

	function spokenText(): string {
		return [committed, partial].filter(Boolean).join(" ");
	}

	function composedText(): string {
		const spoken = spokenText();
		if (!baseText) return spoken;
		if (!spoken) return baseText;
		const sep = /\s$/.test(baseText) ? "" : " ";
		return baseText + sep + spoken;
	}

	function showListeningWidget(ctx: ExtensionContext) {
		const words = spokenText().split(/\s+/).filter(Boolean).length;
		ctx.ui.setWidget(WIDGET_KEY, [
			`🎤 listening${words > 0 ? ` (${words} word${words === 1 ? "" : "s"})` : ""} — release or tap ${SHORTCUT} to stop`,
		]);
	}

	function handlePartial(line: string, ctx: ExtensionContext) {
		const text = line.trim();
		if (!text) return;
		// Apple's recognizer emits cumulative partials that refine the current
		// hypothesis. If a new partial is shorter and no longer extends the
		// previous one, the recognizer started a new utterance segment:
		// commit the previous hypothesis and start accumulating fresh.
		if (
			partial &&
			text.length < partial.length &&
			!partial.startsWith(text) &&
			!text.startsWith(partial.slice(0, Math.min(12, partial.length)))
		) {
			committed = [committed, partial].filter(Boolean).join(" ");
		}
		partial = text;
		ctx.ui.setEditorText(composedText());
		// setEditorText does not request a TUI render; updating the widget does.
		// Without this, streamed text stays invisible until the next keypress.
		showListeningWidget(ctx);
	}

	function clearState() {
		proc = null;
		stopping = false;
		baseText = "";
		committed = "";
		partial = "";
		unsubscribeInput?.();
		unsubscribeInput = undefined;
	}

	function stopRecording(ctx: ExtensionContext, notifyUser: boolean) {
		if (!proc) return;
		stopping = true;
		unsubscribeInput?.();
		unsubscribeInput = undefined;
		proc.kill("SIGTERM");
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		if (notifyUser) {
			const spoken = spokenText();
			ctx.ui.notify(
				spoken ? "Voice: stopped — review and press enter" : "Voice: stopped (nothing transcribed)",
				"info",
			);
		}
	}

	/**
	 * While recording, alt+v events are intercepted at the raw-input layer:
	 * - auto-repeat (held key) is swallowed
	 * - release after a hold (> TAP_MS) stops recording (push-to-talk)
	 * - release after a quick tap keeps recording (toggle mode)
	 * - a fresh press stops recording (toggle off)
	 */
	function watchShortcutWhileRecording(ctx: ExtensionContext) {
		unsubscribeInput = ctx.ui.onTerminalInput((data: string) => {
			if (!proc || !matchesKey(data, SHORTCUT)) return undefined;
			const now = Date.now();
			const sinceLast = now - lastShortcutEventAt;
			lastShortcutEventAt = now;

			if (isKeyRepeat(data)) {
				// Kitty protocol auto-repeat while holding: ignore.
				return { consume: true };
			}
			if (isKeyRelease(data)) {
				// Kitty protocol release: stop if this was a hold, keep if a tap.
				if (now - pressStartedAt > TAP_MS) {
					stopRecording(ctx, true);
				}
				return { consume: true };
			}
			// A press. With the Kitty protocol active, auto-repeat is reported
			// separately (handled above), so any real press means toggle-off.
			// Legacy terminals report held-key auto-repeat as rapid presses;
			// consume closely-spaced ones and treat a distinct later press as
			// toggle-off.
			if (!isKittyProtocolActive() && sinceLast <= LEGACY_REPEAT_GAP_MS) {
				return { consume: true };
			}
			stopRecording(ctx, true);
			return { consume: true };
		});
	}

	function startRecording(ctx: ExtensionContext, args: string[], hearPath: string) {
		baseText = ctx.ui.getEditorText();
		committed = "";
		partial = "";
		stopping = false;
		pressStartedAt = Date.now();
		lastShortcutEventAt = pressStartedAt;

		const startedAt = Date.now();
		let stderrTail = "";

		proc = spawn(hearPath, args, { stdio: ["ignore", "pipe", "pipe"] });
		const current = proc;

		let buffer = "";
		current.stdout?.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			// hear emits partials separated by newlines (or \r in -m mode).
			const parts = buffer.split(/[\r\n]+/);
			buffer = parts.pop() ?? "";
			for (const part of parts) handlePartial(part, ctx);
			// Also surface an unterminated trailing partial immediately.
			if (buffer.trim()) handlePartial(buffer, ctx);
		});

		current.stderr?.on("data", (chunk: Buffer) => {
			stderrTail = (stderrTail + chunk.toString("utf8")).slice(-500);
		});

		current.on("error", (err) => {
			if (proc !== current) return;
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			ctx.ui.notify(`Voice: failed to start hear: ${err.message}`, "error");
			clearState();
		});

		current.on("exit", (code) => {
			if (proc !== current) return;
			const wasStopping = stopping;
			const failedFast = !wasStopping && code !== 0 && Date.now() - startedAt < 3000;

			// On-device model unavailable? Retry once without -d.
			if (failedFast && args.includes("-d")) {
				unsubscribeInput?.();
				unsubscribeInput = undefined;
				startRecording(ctx, FALLBACK_ARGS, hearPath);
				return;
			}

			ctx.ui.setWidget(WIDGET_KEY, undefined);
			if (!wasStopping && code !== 0) {
				const hint = stderrTail.trim().split("\n").pop() ?? "";
				ctx.ui.notify(
					`Voice: hear exited with code ${code}${hint ? ` (${hint})` : ""}. ` +
						"Check mic + speech recognition permissions for your terminal.",
					"error",
				);
			}
			clearState();
		});

		showListeningWidget(ctx);
		watchShortcutWhileRecording(ctx);
	}

	async function start(ctx: ExtensionContext) {
		if (process.platform !== "darwin") {
			ctx.ui.notify("Voice: only supported on macOS (uses Apple speech recognition)", "error");
			return;
		}
		const hearPath = findHear();
		if (!hearPath) {
			ctx.ui.notify(
				"Voice: `hear` binary not found. Install from https://github.com/sveinbjornt/hear " +
					"and place it in ~/.local/bin",
				"error",
			);
			return;
		}
		startRecording(ctx, PREFERRED_ARGS, hearPath);
	}

	pi.registerCommand("voice", {
		description: "Toggle voice dictation (streams speech into the editor)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			if (proc) {
				stopRecording(ctx, true);
				return;
			}
			await start(ctx);
		},
	});

	pi.registerShortcut(SHORTCUT, {
		description: "Voice dictation (hold to talk, tap to toggle)",
		handler: async (ctx) => {
			if (ctx.mode !== "tui") return;
			// Stop is handled by the raw-input listener while recording; this
			// only fires when not recording (or as a safety net).
			if (proc) {
				stopRecording(ctx, true);
				return;
			}
			await start(ctx);
		},
	});

	pi.on("session_shutdown", async () => {
		if (proc) {
			stopping = true;
			proc.kill("SIGTERM");
			proc = null;
		}
		unsubscribeInput?.();
		unsubscribeInput = undefined;
	});
}
