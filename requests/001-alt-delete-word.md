# Support Alt+Delete to delete the previous word in the TUI editor

**Status:** done (already supported upstream)

## Problem

In the pi TUI input editor, Alt+Delete (Option+Delete on macOS) does not delete the
word before the cursor. This is a standard keybinding in terminals, shells (readline/zsh),
macOS text fields, and most other CLI tools, so muscle memory breaks when typing prompts
in pi — you end up deleting character by character.

## Proposal

Bind Alt+Delete (and the common equivalents that terminals emit for it, e.g. Alt+Backspace /
`ESC DEL` / Ctrl+W-style word kill) to "delete word backwards" in pi's editor component:

- Delete from the cursor to the start of the previous word.
- Match readline semantics for word boundaries (skip trailing whitespace, then delete the word).
- Ideally also support Alt+D / forward-delete-word for symmetry.

## Resolution

Pi already ships these defaults (see docs/keybindings.md):

- `tui.editor.deleteWordBackward`: `ctrl+w`, `alt+backspace`
- `tui.editor.deleteWordForward`: `alt+d`, `alt+delete`

On macOS the "delete" key is backspace, so Option+Delete maps to `alt+backspace` and works
once the terminal sends Option as Meta/Esc+:

- iTerm2: Profiles → Keys → Left Option key → "Esc+"
- Terminal.app: Profiles → Keyboard → "Use Option as Meta key"

Custom bindings go in `~/.pi/agent/keybindings.json`, applied with `/reload`:

```json
{
  "tui.editor.deleteWordBackward": ["ctrl+w", "alt+backspace"]
}
```
