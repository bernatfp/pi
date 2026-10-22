/**
 * Adds a /clear command that works like /new — starts a fresh session.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function clearCommand(pi: ExtensionAPI) {
	pi.registerCommand("clear", {
		description: "Clear context by starting a new session (alias for /new)",
		handler: async (_args, ctx) => {
			await ctx.newSession();
		},
	});
}
