# Add a `/clear` command that works like `/new`

**Status:** done (via local extension)

## Problem

Pi has `/new` to start a fresh session, but no `/clear`. Other agent CLIs (e.g. Claude
Code) use `/clear` to wipe the context and start over, so muscle memory types it and
nothing happens. Note pi's `app.clear` keybinding (Ctrl+C) only clears the editor input,
not the conversation context.

## Proposal

Register `/clear` as an alias for `/new` upstream.

## Resolution

Implemented locally as an extension at `~/.pi/agent/extensions/clear-command.ts`
(copy in this repo: [`extensions/clear-command.ts`](../extensions/clear-command.ts)):

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function clearCommand(pi: ExtensionAPI) {
	pi.registerCommand("clear", {
		description: "Clear context by starting a new session (alias for /new)",
		handler: async (_args, ctx) => {
			await ctx.newSession();
		},
	});
}
```

`ctx.newSession()` on `ExtensionCommandContext` performs the same session replacement
as `/new` (runs `session_before_switch` / `session_shutdown`, then starts a fresh
session). Apply with `/reload`. Still worth proposing upstream as a built-in alias.
