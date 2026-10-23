/**
 * Antseed balance in the footer, next to the model name.
 *
 * When the active model is served through the local Antseed buyer proxy,
 * replaces the footer with a replica of the default one that appends the
 * deposits balance (USDC) on the right, next to the model name:
 *   - >= $5   dim
 *   - <  $5   yellow (warning)
 *   - <  $1   red (error)
 *
 * Reads the balance from the buyer's control plane
 * (`GET /_antseed/balances`), authenticated with the local gateway control
 * secret at `~/.antseed/gateway/buyer-control.secret`. Polls every 60s and
 * refreshes after each agent run settles. `/balance` forces a refresh and
 * shows details. Switching to a non-Antseed model restores the default
 * footer.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const POLL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;
const WARN_BELOW = 5;
const ERROR_BELOW = 1;

interface Balances {
	available: string;
	reserved: string;
	walletUsdc: string | null;
	stale?: boolean;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwd(cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return cwd;
	const rel = relative(resolve(home), resolve(cwd));
	const inside = rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
	if (!inside) return cwd;
	return rel === "" ? "~" : `~${sep}${rel}`;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let fetching = false;
	let last: Balances | null = null;
	let footerActive = false;
	let requestRender: (() => void) | undefined;

	const dataDir = process.env.ANTSEED_DATA_DIR?.trim() || join(homedir(), ".antseed");

	function readSecret(): string | null {
		const env = process.env.ANTSEED_GATEWAY_CONTROL_SECRET?.trim();
		if (env) return env;
		try {
			const secret = readFileSync(join(dataDir, "gateway", "buyer-control.secret"), "utf8").trim();
			return secret || null;
		} catch {
			return null;
		}
	}

	function readPort(): number {
		try {
			const port = Number.parseInt(readFileSync(join(dataDir, "gateway", "buyer-port"), "utf8").trim(), 10);
			if (Number.isFinite(port) && port > 0) return port;
		} catch {
			// fall through to default
		}
		return 8377;
	}

	function isAntseedModel(ctx: { model?: { provider?: string; baseUrl?: string } | null }): boolean {
		const model = ctx.model;
		if (!model) return false;
		if (model.provider === "antseed") return true;
		const baseUrl = String(model.baseUrl ?? "");
		return /(localhost|127\.0\.0\.1):8377/.test(baseUrl);
	}

	async function fetchBalances(): Promise<Balances | null> {
		const secret = readSecret();
		if (!secret) return null;
		const res = await fetch(`http://127.0.0.1:${readPort()}/_antseed/balances`, {
			headers: { "x-antseed-gateway-auth": secret },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as Balances;
		if (typeof data.available !== "string") return null;
		return data;
	}

	async function refresh() {
		if (fetching) return;
		fetching = true;
		try {
			last = await fetchBalances();
		} catch {
			// keep last known value on transient errors
		} finally {
			fetching = false;
			requestRender?.();
		}
	}

	/** Balance segment, colored by threshold. Returns null when unavailable. */
	function balanceSegment(theme: any): string | null {
		if (!last) return theme.fg("dim", "⬡ $?");
		const available = Number.parseFloat(last.available);
		const text = `⬡ $${available.toFixed(2)}${last.stale ? "~" : ""}`;
		const color = available < ERROR_BELOW ? "error" : available < WARN_BELOW ? "warning" : "dim";
		return theme.fg(color, text);
	}

	function enableFooter(ctx: any) {
		if (footerActive || ctx.mode !== "tui") return;
		footerActive = true;

		ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
			requestRender = () => tui.requestRender();
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose() {
					unsubBranch();
					requestRender = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					// --- line 1: cwd (branch) • session name ---
					let pwd = formatCwd(ctx.sessionManager.getCwd());
					const branch = footerData.getGitBranch();
					if (branch) pwd = `${pwd} (${branch})`;
					const sessionName = ctx.sessionManager.getSessionName?.();
					if (sessionName) pwd = `${pwd} • ${sessionName}`;
					const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));

					// --- line 2 left: token/cost/context stats ---
					let input = 0;
					let output = 0;
					let cacheRead = 0;
					let cacheWrite = 0;
					let cost = 0;
					let latestCacheHitRate: number | undefined;
					for (const entry of ctx.sessionManager.getEntries()) {
						const usage =
							entry.type === "usage"
								? entry.usage
								: entry.type === "message" && (entry.message.role === "assistant" || entry.message.role === "toolResult")
									? (entry.message as AssistantMessage).usage
									: (entry.type === "branch_summary" || entry.type === "compaction") && entry.usage
										? entry.usage
										: undefined;
						if (!usage) continue;
						input += usage.input ?? 0;
						output += usage.output ?? 0;
						cacheRead += usage.cacheRead ?? 0;
						cacheWrite += usage.cacheWrite ?? 0;
						cost += usage.cost?.total ?? 0;
						if (entry.type === "message" && entry.message.role === "assistant") {
							const prompt = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
							latestCacheHitRate = prompt > 0 ? ((usage.cacheRead ?? 0) / prompt) * 100 : undefined;
						}
					}

					const statsParts: string[] = [];
					if (input) statsParts.push(`↑${formatTokens(input)}`);
					if (output) statsParts.push(`↓${formatTokens(output)}`);
					if (cacheRead) statsParts.push(`R${formatTokens(cacheRead)}`);
					if (cacheWrite) statsParts.push(`W${formatTokens(cacheWrite)}`);
					if ((cacheRead > 0 || cacheWrite > 0) && latestCacheHitRate !== undefined) {
						statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
					}
					if (cost) statsParts.push(`$${cost.toFixed(3)}`);

					const contextUsage = ctx.getContextUsage?.();
					const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const percentValue = contextUsage?.percent ?? 0;
					const percent = contextUsage?.percent != null ? percentValue.toFixed(1) : "?";
					let autoCompact = true;
					try {
						autoCompact = pi.getSettings?.()?.compaction?.enabled !== false;
					} catch {
						// default to (auto)
					}
					const autoIndicator = autoCompact ? " (auto)" : "";
					const ctxDisplay =
						percent === "?"
							? `?/${formatTokens(contextWindow)}${autoIndicator}`
							: `${percent}%/${formatTokens(contextWindow)}${autoIndicator}`;
					const ctxStr =
						percentValue > 90
							? theme.fg("error", ctxDisplay)
							: percentValue > 70
								? theme.fg("warning", ctxDisplay)
								: ctxDisplay;
					statsParts.push(ctxStr);

					let statsLeft = theme.fg("dim", statsParts.join(" "));
					let statsLeftWidth = visibleWidth(statsLeft);
					if (statsLeftWidth > width) {
						statsLeft = truncateToWidth(statsLeft, width, "...");
						statsLeftWidth = visibleWidth(statsLeft);
					}

					// --- line 2 right: balance • (provider) model [• thinking] ---
					const modelName = ctx.model?.id || "no-model";
					let modelPart = modelName;
					if (ctx.model?.reasoning) {
						const level = pi.getThinkingLevel?.() || "off";
						modelPart = level === "off" ? `${modelName} • thinking off` : `${modelName} • ${level}`;
					}
					let modelPartFull = modelPart;
					if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
						modelPartFull = `(${ctx.model.provider}) ${modelPart}`;
					}

					const balance = balanceSegment(theme);
					const minPadding = 2;
					const buildRight = (part: string) =>
						balance ? `${balance}${theme.fg("dim", ` • ${part}`)}` : theme.fg("dim", part);

					let rightSide = buildRight(modelPartFull);
					if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width && modelPartFull !== modelPart) {
						rightSide = buildRight(modelPart); // drop provider prefix when tight
					}

					const rightWidth = visibleWidth(rightSide);
					let statsLine: string;
					if (statsLeftWidth + minPadding + rightWidth <= width) {
						statsLine = statsLeft + " ".repeat(width - statsLeftWidth - rightWidth) + rightSide;
					} else {
						const availableForRight = width - statsLeftWidth - minPadding;
						if (availableForRight > 0) {
							const truncated = truncateToWidth(rightSide, availableForRight, "");
							statsLine = statsLeft + " ".repeat(Math.max(0, width - statsLeftWidth - visibleWidth(truncated))) + truncated;
						} else {
							statsLine = statsLeft;
						}
					}

					const lines = [pwdLine, statsLine];

					// --- line 3: other extensions' statuses (as the default footer does) ---
					const statuses = footerData.getExtensionStatuses();
					if (statuses.size > 0) {
						const statusLine = Array.from(statuses.entries() as Iterable<[string, string]>)
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, text]) => sanitizeStatusText(text))
							.join(" ");
						lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
					}

					return lines;
				},
			};
		});
	}

	function disableFooter(ctx: any) {
		if (!footerActive) return;
		footerActive = false;
		requestRender = undefined;
		if (ctx?.mode === "tui") ctx.ui.setFooter(undefined);
	}

	function start(ctx: any) {
		stop(ctx);
		enableFooter(ctx);
		void refresh();
		timer = setInterval(() => void refresh(), POLL_MS);
	}

	function stop(ctx: any) {
		if (timer !== undefined) {
			clearInterval(timer);
			timer = undefined;
		}
		disableFooter(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (isAntseedModel(ctx)) start(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (isAntseedModel(ctx)) {
			if (timer === undefined) start(ctx);
		} else {
			stop(ctx);
		}
	});

	// Spend happens during runs; refresh once the agent settles.
	pi.on("agent_settled", async () => {
		if (timer !== undefined) void refresh();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		stop(ctx);
	});

	pi.registerCommand("balance", {
		description: "Show Antseed deposits balance",
		handler: async (_args, ctx) => {
			try {
				const balances = await fetchBalances();
				last = balances ?? last;
				requestRender?.();
				if (!balances) {
					ctx.ui.notify("Antseed balance unavailable (is the buyer proxy running?)", "warning");
					return;
				}
				const available = Number.parseFloat(balances.available);
				const level = available < ERROR_BELOW ? "error" : available < WARN_BELOW ? "warning" : "info";
				ctx.ui.notify(
					`Antseed deposits: $${balances.available} available, $${balances.reserved} reserved` +
						(balances.walletUsdc ? `, $${balances.walletUsdc} wallet` : ""),
					level,
				);
			} catch (err: any) {
				ctx.ui.notify(`Antseed balance error: ${err?.message ?? err}`, "error");
			}
		},
	});
}
