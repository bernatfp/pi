# pi harness improvement requests

This repo collects improvement requests for the pi coding agent harness, version-controlled at https://github.com/bernatfp/pi.

## Workflow

When the user describes a new improvement request:

1. Write it up as `requests/NNN-short-slug.md` (next sequential number), using the template in README.md (Title, Status, Problem, Proposal, Notes).
2. Before proposing upstream changes, check whether pi already supports it: read the pi docs at `/Users/bernat/.nvm/versions/node/v24.4.1/lib/node_modules/@earendil-works/pi-coding-agent/docs/` (keybindings.md, extensions.md, configuration.md, etc.).
3. If it can be solved today (config, keybinding, or extension), implement the fix locally and update the request's Status and add a Resolution section.
   - Local extensions live in `~/.pi/agent/extensions/` (pi auto-loads `.ts` files there; apply with `/reload`).
   - Keep a version-controlled copy of any extension in this repo's `extensions/` folder.
4. Commit with a message like `Request NNN: <summary>` and push to `origin main`.

## Statuses

`idea | proposed | in-progress | done | rejected`

## Context from past requests

- 001: Alt+Delete word-delete — already supported by pi (`alt+backspace`); real fix was Ghostty config `macos-option-as-alt = true` in `~/Library/Application Support/com.mitchellh.ghostty/config`.
- 002: `/exit` alias for `/quit` — implemented as extension `~/.pi/agent/extensions/exit-command.ts` (copy in `extensions/`).
- 003: `/clear` alias for `/new` — implemented as extension `~/.pi/agent/extensions/clear-command.ts` (copy in `extensions/`); uses `ctx.newSession()`.
- 004: Voice mode — implemented as extension `~/.pi/agent/extensions/voice-mode.ts` (copy in `extensions/`); streams live dictation into the editor using the `hear` CLI (Apple SFSpeechRecognizer, installed at `~/.local/bin/hear`). Toggle with `/voice` or `ctrl+shift+v`.
