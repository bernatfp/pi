# Support Alt+Delete to delete the previous word in the TUI editor

**Status:** idea

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

## Notes

- Related existing bindings to check in pi's keybindings docs/config: Ctrl+W (unix-word-rubout)
  may already exist; Alt+Delete should behave similarly.
- Terminals encode Option/Alt differently (ESC-prefix vs. meta bit); handling both encodings
  would make this work across iTerm2, Terminal.app, kitty, etc.
