# Interrupt an ongoing agent action

**Status:** done (already supported upstream)

## Problem

An agent can start a very broad filesystem search or another long-running tool
call. The familiar terminal reflex is to press Ctrl+C, but in pi that did not
stop the ongoing action, leaving no obvious way to regain control.

## Proposal

Make cancellation easy to discover and support a familiar interrupt shortcut.
If Ctrl+C is intentionally reserved, clearly document the active cancellation
binding and ensure built-in tool processes honor it.

## Resolution

Pi already supports this. Press **Esc** once to abort the current run, including
its running tool calls. The default binding is `app.interrupt: escape`; `/hotkeys`
shows the active binding, and the working indicator displays an interrupt hint.

Ctrl+C is intentionally assigned to `app.clear`, not `app.interrupt`: it clears
the editor first and exits on a second press. No local configuration change was
made; `~/.pi/agent/keybindings.json` does not exist, so the defaults apply.

The built-in `find` tool listens for its abort signal and kills its child `fd`
process. If a shell command launched through `bash` keeps running after Esc,
that is a separate process-cancellation issue rather than a missing interrupt
command.

If Ctrl+C should also cancel a running agent without changing its idle behavior,
an optional upstream behavior or configurable action could be proposed, but Esc
is the supported solution today. No extension is needed.
