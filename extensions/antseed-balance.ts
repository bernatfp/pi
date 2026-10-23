/**
 * Antseed balance in the footer.
 *
 * When the active model is served through the local Antseed buyer proxy,
 * shows the deposits balance (USDC) in the footer status area so you know
 * when to top up:
 *   - >= $5   dim
 *   - <  $5   yellow (warning)
 *   - <  $1   red (error)
 *
 * Reads the balance from the buyer's control plane
 * (`GET /_antseed/balances`), authenticated with the local gateway control
 * secret at `~/.antseed/gateway/buyer-control.secret`. Polls every 60s and
 * refreshes after each agent run settles. `/balance` forces a refresh and
 * shows details.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "antseed-balance";
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

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let fetching = false;
	let last: Balances | null = null;

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

	function render(ctx: any, balances: Balances | null) {
		if (!ctx.hasUI) return;
		if (!balances) {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "⬡ $?"));
			return;
		}
		const available = Number.parseFloat(balances.available);
		const text = `⬡ $${available.toFixed(2)}${balances.stale ? "~" : ""}`;
		const color = available < ERROR_BELOW ? "error" : available < WARN_BELOW ? "warning" : "dim";
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(color, text));
	}

	async function refresh(ctx: any) {
		if (fetching) return;
		fetching = true;
		try {
			last = await fetchBalances();
			render(ctx, last);
		} catch {
			render(ctx, last); // keep last known value on transient errors
		} finally {
			fetching = false;
		}
	}

	function start(ctx: any) {
		stop(ctx);
		void refresh(ctx);
		timer = setInterval(() => void refresh(ctx), POLL_MS);
	}

	function stop(ctx: any) {
		if (timer !== undefined) {
			clearInterval(timer);
			timer = undefined;
		}
		if (ctx?.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (isAntseedModel(ctx)) start(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (isAntseedModel(ctx)) {
			if (timer === undefined) start(ctx);
		} else {
			stop(ctx);
		}
	});

	// Spend happens during runs; refresh once the agent settles.
	pi.on("agent_settled", async (_event, ctx) => {
		if (timer !== undefined) void refresh(ctx);
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
				render(ctx, last);
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
