/**
 * Voice mode for pi — streaming dictation into the input editor.
 *
 * Uses the `hear` CLI (https://github.com/sveinbjornt/hear), which wraps
 * Apple's native SFSpeechRecognizer. Partial transcription results stream
 * to stdout as you speak and are mirrored live into pi's input editor,
 * giving the same live-dictation feel as Claude's clients.
 *
 * Usage:
 *   /voice              — toggle recording on/off
 *   ctrl+shift+v        — same toggle as a shortcut
 *
 * While recording, a "🎤 listening" widget is shown and your words appear
 * in the editor in real time. Toggle off (or just stop talking and review)
 * and press enter to send. Text already in the editor is preserved and the
 * transcription is appended.
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
import { Key } from "@earendil-works/pi-tui";

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

export default function voiceMode(pi: ExtensionAPI) {
	let proc: ChildProcess | null = null;
	let stopping = false;
	// Editor text present before recording started; transcription is appended to it.
	let baseText = "";
	// Finalized utterance segments (see commit heuristic below).
	let committed = "";
	// Current in-flight partial hypothesis.
	let partial = "";

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
	}

	function clearState() {
		proc = null;
		stopping = false;
		baseText = "";
		committed = "";
		partial = "";
	}

	function stopRecording(ctx: ExtensionContext, notifyUser: boolean) {
		if (!proc) return;
		stopping = true;
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

	function startRecording(ctx: ExtensionContext, args: string[], hearPath: string) {
		baseText = ctx.ui.getEditorText();
		committed = "";
		partial = "";
		stopping = false;

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

		ctx.ui.setWidget(WIDGET_KEY, ["🎤 listening — /voice or ctrl+shift+v to stop"]);
	}

	async function toggle(ctx: ExtensionContext) {
		if (ctx.mode !== "tui") {
			return;
		}
		if (proc) {
			stopRecording(ctx, true);
			return;
		}
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
			await toggle(ctx);
		},
	});

	pi.registerShortcut(Key.ctrlShift("v"), {
		description: "Toggle voice dictation",
		handler: async (ctx) => {
			await toggle(ctx);
		},
	});

	pi.on("session_shutdown", async () => {
		if (proc) {
			stopping = true;
			proc.kill("SIGTERM");
			proc = null;
		}
	});
}
