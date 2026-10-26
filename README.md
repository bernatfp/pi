# pi harness — improvement requests

A place to collect and version-control ideas, requests, and proposals for improving the [pi coding agent](https://github.com/earendil-works) harness.

## Structure

- `requests/` — one markdown file per improvement request, numbered for easy reference:
  - `requests/001-short-slug.md`
  - `requests/002-another-idea.md`
- `extensions/` — version-controlled copies of local pi extensions, installed in
  `~/.pi/agent/extensions/`.

## Requests

| # | Request | Status | Resolution |
| --- | --- | --- | --- |
| [001](requests/001-alt-delete-word.md) | Alt+Delete word deletion | done | Built into pi; configure the terminal to send Option as Alt. |
| [002](requests/002-exit-command.md) | `/exit` alias for `/quit` | done | Local extension. |
| [003](requests/003-clear-command.md) | `/clear` alias for `/new` | done | Local extension. |
| [004](requests/004-voice-mode.md) | Streaming voice dictation | done | Local extension using `hear`; `/voice` or Alt+V. |
| [005](requests/005-antseed-balance-footer.md) | Antseed balance in the footer | done | Local extension; `/balance` shows details. |

All five requests are resolved. See the linked documents for implementation notes,
prerequisites, and possible upstream improvements.

## Local extensions

| Extension | Provides |
| --- | --- |
| [`exit-command.ts`](extensions/exit-command.ts) | `/exit` for orderly shutdown. |
| [`clear-command.ts`](extensions/clear-command.ts) | `/clear` to start a fresh session. |
| [`voice-mode.ts`](extensions/voice-mode.ts) | Live dictation, with push-to-talk or toggle mode. |
| [`antseed-balance.ts`](extensions/antseed-balance.ts) | Antseed balance in the footer and `/balance`. |

Install the tracked copies and reload pi:

```sh
mkdir -p ~/.pi/agent/extensions
cp extensions/*.ts ~/.pi/agent/extensions/
```

Run `/reload` inside pi to apply changes. Voice mode requires macOS and
[`hear`](https://github.com/sveinbjornt/hear) at `~/.local/bin/hear`; the Antseed
extension requires the local buyer proxy and its gateway control secret. Alt
shortcuts require the terminal to send Option as Alt (Ghostty:
`macos-option-as-alt = true`, followed by a restart).

## Request template

```markdown
# Title

**Status:** idea | proposed | in-progress | done | rejected

## Problem

What's painful or missing today.

## Proposal

What should change and roughly how.

## Notes

Links, context, alternatives considered.
```
