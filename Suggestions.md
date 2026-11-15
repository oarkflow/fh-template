# Suggestions: DDoS resilience for fh-template

## The problem with what we already have

The template already has a per-IP rate limiter, `WithMaxInFlightRequests`,
`WithMaxConnectionsPerIP`, header/body deadlines and tcpguard. All of them are
**identity-based** or **capacity-based**:

- A *distributed* flood (thousands of IPs, each politely under 120 req/min)
  never trips a per-IP limit.
- A pure capacity cap (`MaxInFlight=1000`) protects the process but does so by
  returning errors to **everyone**, including real users. The attacker wins by
  just filling the queue.
- Both are free for the attacker: a bot pays nothing to be refused.

## The idea: pressure-priced admission ("pay-to-enter when crowded")

Charge for admission **only when the server is stressed, and charge more the
more stressed it is** - in CPU time the client must burn, not money.

| Server pressure | What a client without a pass experiences |
|---|---|
| < 50% (normal) | Nothing. Zero added latency, zero friction. |
| 50-100% | `429` + a signed SHA-256 puzzle, 10 → 22 leading-zero bits (roughly 1 ms → ~2 s of browser CPU). |
| > 100% | Maximum difficulty; the cost an attacker must pay *per bot* keeps rising with the attack. |

A real person solves it once, gets a signed `fh_pass` cookie (10 min) and never
sees it again. A botnet has to pay the work *per bot*, and the price scales with
the attack's own intensity, so the attacker's economics get worse the harder
they push - the opposite of today, where more bots is strictly better for them.

### Why this is different from a CAPTCHA or a rate limit

- **No third party, no tracking, no user puzzle** - it's pure computation done
  by the page in the background.
- **Self-adjusting** - pressure is measured from in-flight requests and a
  fast-attack / slow-decay EWMA of arrival rate; difficulty is a continuous
  function of it, so there is no on/off "under attack" switch to flip at 3am.
- **The defender spends almost nothing.** Rejecting costs one HMAC (~7 µs,
  12 allocs). Verifying a solution costs one HMAC and one SHA-256.
- **Stateless**: challenges and passes are self-describing HMAC tokens. There is
  no per-client table to exhaust, so the defence itself isn't an attack surface.
  The only state is a bounded, sharded, fail-closed replay cache.

### Anti-abuse details

- Tokens are bound to the client network prefix (/24 v4, /64 v6) and User-Agent
  hash: a solved puzzle or pass can't be farmed once and fanned out to a botnet
  on other networks.
- Solutions are single-use (salt recorded until expiry).
- Challenge difficulty is signed into the token, and the server rejects tokens
  that are easier than current pressure demands (minus 2 bits of drift), so
  work solved while calm can't be stockpiled for use during an attack.
- Domain-separated HMACs for challenges vs. passes; key derived from the
  session secret (`HMAC(session_secret, "fh-shield-v1")`) - nothing new to provision.
- `/_pow` is plain same-origin HTTP so it works even though `/api/*` travels in
  the encrypted WASM envelope (which can't carry an outer solution header).
- The shield sits right after CORS and **before** body reading, sessions,
  tcpguard and the secure-transport crypto, so refused traffic never reaches
  anything expensive.

## What was implemented

| Layer | What | Where |
|---|---|---|
| Pressure-priced PoW admission | Signed, stateless hashcash puzzles; difficulty 10→`MAX_BITS` with pressure; pass cookie | `internal/shield/shield.go.tmpl` |
| Per-pass request budget | A solved pass can't become an unlimited flood | same |
| Strike → ban escalation | Invalid/replayed solutions, ignoring challenges, budget abuse → exact-IP ban 30s, doubling to 1h; banned IPs dropped first, even when calm | same + `tracker.go.tmpl` |
| Bounded tracking tables | Sharded, hard-capped, amortised purge; cannot be grown by a key flood | `tracker.go.tmpl` |
| `/_pow` endpoint | Plain HTTP puzzle/redeem, per-IP rate limited; works under the encrypted envelope | shield |
| Pluggable fleet pressure | `Config.ExtraPressure` max()-combined with local pressure | shield |
| Flood-proof logging | Shield sits *before* logger/audit/metrics; bans logged at Error level (the async logger drops Warn when saturated) | `cmd/server/main.go.tmpl` |
| Process admission | `slowloris` goroutine/heap ceilings first in chain | main |
| Connection limits | `MaxConnections` 10k, idle timeout 30s, HTTP/2 streams 100 (rapid-reset style abuse) | main |
| Data at rest | data dir `0700`, SQLite + WAL/journal `0600` | `internal/database/database.go.tmpl` |
| Data in caches | `Cache-Control: no-store` on `/api`, `/auth`, `/_ops`, `/secure-config.json` | main |
| Browser solver | Sync SHA-256, parallel Web Workers, shared solve, auto-retry; `shield-boot.js` wraps `fetch` globally | `web/wasm/pow.mjs`, `pow-worker.js`, `shield-boot.js` |
| Stats | `GET /_ops/shield` | main |
| Real client IP behind proxies | `APP_TRUSTED_PROXIES`: headers believed only from trusted peers, chains walked right-to-left (forged leftmost hop ignored); empty = trust nothing | `internal/edge/edge.go.tmpl` |
| Origin lock | Peers that aren't trusted proxies get `403`, so the CDN can't be bypassed by hitting the origin | edge |
| PROXY protocol v1/v2 | For L4 load balancers; strict, trusted peers only, graceful shutdown preserved | edge |
| Static deny list | `APP_DENY_CIDRS`, checked first | edge |
| Login throttling | `APP_LOGIN_RATE_LIMIT` (default 10/min/IP) on `/auth/login`, `/secure-config.json` | main |
| Operator switch | `POST /_ops/shield/attack?on=1` pins maximum difficulty without a restart; `APP_UNDER_ATTACK` | main |
| Volumetric layers | nftables (origin allow-list, SYN/conn caps, UDP drop), sysctl (SYN cookies etc.), nginx (slow clients, per-IP limits), hardened systemd unit, runbook | `deploy/` |

## Verification (actually run)

Scaffolded with `fh-init -template ~/Sites/fh-template`, built, run.

**Tests:** `go vet` clean; `go test -race` passes for shield, edge, auth, config
(shield: calm, solve/pass, replay, binding, forgery, expiry, difficulty, ban +
exponential backoff, hammering, pass budget, endpoint limit, fleet pressure, tracker bounded
under a 100k-key flood; edge: CIDR parsing, real IP only from trusted peers, forged chain
ignored, origin lock, deny list); 8 Node tests pass.

**Attack simulations** (loopback; attacker 127.0.0.1, legit client on the LAN IP):

| Attack | Result |
|---|---|
| 200-conn raw flood of `/api/notes`, 8s | 304k requests: 108 challenged, attacker banned, 301k dropped with a cheap `403`; legit client p99 ≈ 14-29 ms; RSS ≈ 51 MB |
| Bogus PoW solutions, 50 conns | banned after 4 requests; 380k requests (95k/s) dropped |
| Slowloris, 300 dripping connections | all 300 closed by the server; concurrent legit probe p99 ≈ 1.4 ms |
| Log amplification | 302k log lines per flood before moving the shield ahead of the logger; 527 after |

**Proxy / real-IP handling** (test proxy in front of the app):

| Scenario | Result |
|---|---|
| Direct connection to origin from a non-proxy address | `403` (origin lock) |
| Via proxy, three simulated clients | app logged each real client IP, not the proxy's |
| Client forges leftmost `X-Forwarded-For: 6.6.6.6` | ignored; the proxy-appended real address was used |
| Attacker A banned through the proxy | innocent client B through the same proxy still served (`429` puzzle, not `403`) |
| PROXY protocol v1 via an L4 proxy | real client `198.51.100.77` logged; direct connections (trusted peer without header, untrusted LAN peer) dropped |

**Real Chrome via the Claude extension** (shield forced on): the sign-in form renders, login
through the real UI succeeds, the encrypted WASM session is established (AES-256-GCM),
"Load profile" returns the profile over the encrypted transport. Server counters afterwards:
`challenged 1, solved 1, passed 9` - one puzzle solved, everything else rode the pass.
Operator switch: `POST /_ops/shield/attack?on=1|0` works, `401` without the token.

**Bugs found and fixed:** `/_pow` didn't count itself in-flight (client gave up under
pressure; client now also retries when pressure has eased); per-request log amplification
under flood; ban log entry dropped by the async logger (now Error level); favicon was
challenged; **the sign-in form never rendered** - Lithe 1.1.x's dead-code pass deleted
`const variant` from `Button` (it was referenced only inside a template literal), so every
page crashed with `variant is not defined`. Fixed in `lithe-boilerplate`'s
`src/components/ui/Button.tsx` by inlining the expression (a block-bodied arrow did not help).

## Honest limits

1. **Not a volumetric (L3/L4) defence.** If the link or kernel is saturated before
   packets reach Go, only an upstream CDN/scrubber helps. Put this behind one.
2. **Single machine test.** I could not generate a real distributed flood; pressure
   behaviour with many IPs was exercised by forcing capacity to 1, not by real
   multi-source load. Defaults (`CAPACITY=1000`, `RATE=2000/s`) are guesses:
   load-test and set them to ~70% of your measured knee.
3. **Behind a proxy you must set `APP_TRUSTED_PROXIES`** (production logs a warning if
   it is empty). Wrong CIDRs mean either every client looks like the proxy, or
   spoofable headers - the template defaults to trusting none.
4. **Bans are per exact IP**; users behind one NAT share fate if one of them
   misbehaves. Tokens themselves are bound to the /24 (/64), so roaming is fine.
5. **Per-instance state** (replay cache, strikes, budgets). Passes validate across
   instances (shared secret); feed `ExtraPressure` from shared load for fleet-wide difficulty.
6. **Non-browser API clients** must implement `GET/POST /_pow` or be exempted.
7. **GPU/ASIC attackers** pay less per hash than phones; this is economic scaling,
   not impossibility. Keep tcpguard, the per-IP limiter and a WAF as further layers.
8. **Cross-origin frontends**: shield replies come before the CORS middleware;
   fine for the same-origin design here, but a separate-origin SPA would not be able to read them.
9. **The nftables / sysctl / nginx / systemd files in `deploy/` were not executed here**
   (macOS host, no nginx/nft): I reviewed them but only `nginx -t` / `nft -c -f` on
   your Linux host will prove them. Treat them as hardened starting points; adjust the
   proxy ranges, ports and memory ceilings. **Volumetric attacks are only truly handled
   by upstream capacity** (CDN/scrubbing); nothing in this repo can substitute for that.

## Not done (worth considering)

- Redis-backed shared pressure, strikes and replay cache for multi-instance fleets.
- Reserved capacity lanes for authenticated sessions / operators.
- TLS-level protections (renegotiation, handshake limits) when terminating TLS in-process;
  and OS/network tuning (SYN cookies, conntrack), which are outside application code.


## Production-readiness additions (single-node complete, Redis optional)

| Concern | What exists | Verified |
|---|---|---|
| Restart = everyone logged out | Sessions in a 0700 file store, or Redis (`APP_REDIS_URL`) | Session survived a server restart (curl and real Chrome E2E); Redis store tested against a real Redis incl. 20-way contended counter |
| Data loss | Encrypted (AES-256-GCM), tamper-evident SQLite snapshots every 6h, retention, `-backup` / `-restore latest`, startup `quick_check` | Backup -> corrupt DB refused at start -> restore -> login works; wrong key / tampered file rejected |
| Redis outage | Fails closed in ~2s, readiness reports it | Killed Redis mid-run |
| Container | Multi-stage, distroless non-root, read-only rootfs, caps dropped, healthcheck, no published port, secrets as files, log rotation | Image built (frontend included); dev container healthy as uid 65532 on a read-only fs; production refuses to start without secrets |
| Secrets | `scripts/production-init.sh` | Generated all six secrets (0600) |
| Regressions | CI: gofmt, vet, race tests, govulncheck, Redis tests, Node tests, browser E2E, image healthcheck; Dependabot | `go vet`, `go test -race`, `govulncheck` (clean) and Node tests run locally; E2E 11/11 against real Chrome; the workflow itself has **not** run on GitHub |

Corrected along the way: the template's `make wasm` and README described compile-time key embedding
that no published `fh` version supports (the client pins keys at runtime from `/secure-config.json`);
`make wasm` now builds correctly and `make wasm-docker` gives a hermetic build.

**Not verified:** `docker compose up` with the generated secrets (the local Docker daemon became
unresponsive and was reset mid-test), so the compose file is only schema-validated (`docker compose config`);
the CI workflow on GitHub; behaviour under TLS termination by a real proxy; a restore drill on a production-sized database
(backups are read fully into memory when encrypted - fine for small databases, switch to streaming for multi-GB).
