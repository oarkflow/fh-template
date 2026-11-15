# DDoS runbook

Defence in depth, outermost first. The application (layers 4-6) cannot stop a
flood that saturates your network link; layers 1-3 are where volumetric attacks
are won or lost.

| # | Layer | Stops | Where |
|---|---|---|---|
| 1 | CDN / scrubbing provider (Cloudflare, Fastly, CloudFront+Shield, cloud-provider DDoS service) | Volumetric L3/L4 (UDP/SYN/amplification), most L7 floods, bots | Provider. Origin must not be publicly reachable. |
| 2 | Host firewall + kernel | SYN floods, spoofing, direct-to-origin traffic, connection exhaustion | `deploy/nftables.conf`, `deploy/sysctl-ddos.conf` |
| 3 | Reverse proxy | Slowloris/slow-POST, connection floods, coarse request limits | `deploy/nginx.conf` |
| 4 | Process edge | Non-proxy peers, spoofed `X-Forwarded-For`, denied networks | `APP_TRUSTED_PROXIES`, `APP_ORIGIN_LOCK`, `APP_PROXY_PROTOCOL`, `APP_DENY_CIDRS` |
| 5 | Pressure-priced shield | Distributed L7 floods: proof-of-work under load, strikes/bans, per-pass budgets | `internal/shield` |
| 6 | Application limits | Per-IP rate, login throttling, tcpguard abuse rules, body/header/timeout ceilings | `main.go` |

## Setup checklist (production)

1. Put a CDN/scrubbing provider in front; enable its rate-limiting and "under
   attack" features. Lock the origin: firewall allows only the CDN ranges
   (`deploy/nftables.conf`), ideally also authenticated origin pulls (mTLS).
2. Set `APP_TRUSTED_PROXIES` to the CDN/LB ranges and keep `APP_ORIGIN_LOCK=on`.
   Without it every client looks like the proxy. For an L4 load balancer that
   speaks PROXY protocol set `APP_PROXY_PROTOCOL=on` (strict; the LB must send it).
3. Apply `deploy/sysctl-ddos.conf`; run the app with the `deploy/fh-app.service` limits.
4. Load-test, then set `APP_SHIELD_CAPACITY` / `APP_SHIELD_RATE` at ~70% of the
   measured knee. Watch `GET /_ops/shield`.
5. Never expose `/_ops/*` publicly; it is protected by the operations token but
   should also be firewalled to admin addresses.

## During an attack

```sh
# Raise the shield to maximum difficulty immediately (no restart):
curl -X POST -H "Authorization: Bearer $APP_OPERATIONS_TOKEN" "https://HOST/_ops/shield/attack?on=1"
# Watch pressure, bans, rejected counts:
curl -H "Authorization: Bearer $APP_OPERATIONS_TOKEN" https://HOST/_ops/shield
# Block a hostile network at the edge: add to APP_DENY_CIDRS (restart) or, better, at the CDN/firewall.
# When over:
curl -X POST -H "Authorization: Bearer $APP_OPERATIONS_TOKEN" "https://HOST/_ops/shield/attack?on=0"
```

Triage: `rejected` rising fast with low `pressure` = bans are absorbing it (good);
high `pressure` with `challenged` high and `solved` low = a distributed bot flood
that cannot pay (good); high `pressure` and high `solved` = bots doing the work -
raise `APP_SHIELD_MAX_BITS` and tighten `APP_SHIELD_PASS_BUDGET`, and move
filtering upstream.
