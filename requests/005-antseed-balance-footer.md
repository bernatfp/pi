# Antseed account balance in the footer

**Status:** done (via local extension)

## Problem

When using Antseed as the model provider (local buyer proxy on
`localhost:8377`), there is no visibility into the remaining deposits
balance from inside pi. You only find out you're out of credits when
requests start failing, and topping up requires noticing in time.

## Proposal

Show the remaining account balance in the footer (bottom-right, next to the
model info) whenever the active model routes through Antseed:

- balance >= $5 → dim/neutral
- balance < $5 → yellow (warning)
- balance < $1 → red (error)

Upstream, pi could offer a generic "provider balance" footer hook that
custom providers populate.

## Notes

- The Antseed buyer proxy exposes a control-plane endpoint
  `GET /_antseed/balances` that returns
  `{ address, available, reserved, walletUsdc, creditLimit, ... }`
  (USDC, 6-decimal strings). It requires the gateway control secret via the
  `x-antseed-gateway-auth` header, read from
  `~/.antseed/gateway/buyer-control.secret` (or the
  `ANTSEED_GATEWAY_CONTROL_SECRET` env var). Port comes from
  `~/.antseed/gateway/buyer-port` (default 8377).
- `antseed buyer balance` CLI cannot be used here: it fails with an
  app-encrypted identity (`identity.enc` created by the AI VPN app), and it
  reads the chain directly anyway. The control-plane endpoint uses the
  daemon's own cached chain reader (~15 s cache), so polling it is cheap.
- "Available" is the deposits balance; "reserved" is held by open payment
  channels and flows back when channels settle, so available is the right
  top-up signal.
- pi's `ctx.ui.setStatus(key, text)` renders in the default footer's
  status area (right side), so no footer replacement is needed.

## Resolution

Implemented as extension `~/.pi/agent/extensions/antseed-balance.ts` (copy in
[`extensions/antseed-balance.ts`](../extensions/antseed-balance.ts)).

- Shows `⬡ $X.XX` in the footer status area when the active model's
  provider is `antseed` (or its baseUrl points at `localhost:8377`).
- Colors: dim ≥ $5, `warning` (yellow) < $5, `error` (red) < $1.
- Polls every 60 s, refreshes after each agent run settles
  (`agent_settled`), and clears itself when switching to a non-Antseed
  model (`model_select`).
- Appends `~` to the amount when the daemon reports the value as stale
  (chain temporarily unreadable).
- `/balance` command forces a refresh and shows available / reserved /
  wallet amounts in a notification.
- Degrades gracefully: shows `⬡ $?` when the proxy is down or the secret
  is missing; TUI-guarded with `ctx.hasUI`.

Apply with `/reload`.
