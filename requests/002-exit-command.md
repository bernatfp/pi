# Add an `/exit` command that works like `/quit`

**Status:** done (via local extension)

## Problem

Pi has `/quit` but no `/exit`. Many tools (psql, python REPL, various CLIs) accept
`exit`/`/exit`, so muscle memory types it and nothing happens.

## Proposal

Register `/exit` as an alias for `/quit` upstream.

## Resolution

Implemented locally as an extension at `~/.pi/agent/extensions/exit-command.ts`
(copy in this repo: [`extensions/exit-command.ts`](../extensions/exit-command.ts)):

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function exitCommand(pi: ExtensionAPI) {
	pi.registerCommand("exit", {
		description: "Exit pi (alias for /quit)",
		handler: async (_args, ctx) => {
			await ctx.shutdown();
		},
	});
}
```

`ctx.shutdown()` requests the same orderly shutdown path as `/quit` (runs
`session_shutdown` handlers, etc.). Still worth proposing upstream as a built-in alias.
