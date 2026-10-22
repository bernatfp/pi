/**
 * Adds an /exit command that works like /quit — requests an orderly shutdown.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function exitCommand(pi: ExtensionAPI) {
	pi.registerCommand("exit", {
		description: "Exit pi (alias for /quit)",
		handler: async (_args, ctx) => {
			await ctx.shutdown();
		},
	});
}
