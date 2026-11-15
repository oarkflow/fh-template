// End-to-end smoke test: real server, real headless Chrome, real UI.
//
//   make e2e            (needs: go, a built web/public via `make frontend`, Chrome/Chromium)
//
// It proves the things unit tests cannot: the sign-in form renders, login works
// through the encrypted WASM transport, a protected call succeeds while the
// DDoS shield is forcing proof-of-work, the shield actually solved a puzzle,
// and the session survives a server restart (durable state).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.E2E_PORT ?? 18080);
const DEBUG_PORT = Number(process.env.E2E_CHROME_PORT ?? 19222);
const BASE = `http://localhost:${PORT}`;
const root = new URL("..", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "fh-e2e-"));
const env0 = Object.fromEntries(readFileSync(join(root, ".env.example"), "utf8").split("\n")
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^'|'$/g, "")]; }));
const serverEnv = {
  ...process.env, ...env0,
  APP_ENV: "development", APP_ADDR: `127.0.0.1:${PORT}`, APP_ORIGIN: BASE,
  APP_DATABASE_URL: `file:${join(work, "app.db")}?_pragma=foreign_keys(1)`, APP_STATE_DIR: join(work, "state"),
  APP_SHIELD_CAPACITY: "1", APP_SHIELD_MAX_BITS: "16", APP_RATE_LIMIT: "100000", APP_LOGIN_RATE_LIMIT: "1000",
};

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); if (!ok) throw new Error(`check failed: ${name} ${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server, chrome;
function startServer() {
  server = spawn(join(work, "server"), [], { cwd: root, env: serverEnv, stdio: ["ignore", "ignore", "pipe"] });
  server.stderr.on("data", () => {});
}
async function waitHealthy() {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch {} await sleep(250); }
  throw new Error("server did not become healthy");
}
function chromePath() {
  for (const p of [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) if (p && existsSync(p)) return p;
  throw new Error("Chrome/Chromium not found; set CHROME_BIN");
}

let ws, nextId = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++nextId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const page = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expr, what, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await page(expr)) return; } catch {} await sleep(250); } throw new Error(`timed out waiting for: ${what}`); };
const click = (text) => page(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==${JSON.stringify(text)});if(!b)return false;b.click();return true})()`);
const setInput = (type, value) => page(`(()=>{const el=document.querySelector('input[type=${type}]');if(!el)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);

async function shieldStats() {
  const r = await fetch(`${BASE}/_ops/shield`, { headers: { Authorization: `Bearer ${serverEnv.APP_OPERATIONS_TOKEN}` } });
  return r.json();
}

async function main() {
  const build = spawnSync("go", ["build", "-o", join(work, "server"), "./cmd/server"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) throw new Error("go build failed");
  if (!existsSync(join(root, "web/public/app.js"))) throw new Error("web/public/app.js missing: run `make frontend` first");

  startServer(); await waitHealthy();
  chrome = spawn(chromePath(), ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${join(work, "chrome")}`, "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).find((t) => t.type === "page"); } catch {} await sleep(250); }
  if (!target) throw new Error("could not attach to Chrome");
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  const jsErrors = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    if (d.method === "Runtime.exceptionThrown") jsErrors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text); };
  await send("Runtime.enable"); await send("Page.enable");

  await send("Page.navigate", { url: `${BASE}/` });
  await waitFor(`!!document.querySelector('input[type=password]')`, "sign-in form to render");
  check("sign-in form renders (no uncaught JS errors)", jsErrors.length === 0, jsErrors.join(" | "));

  await setInput("password", serverEnv.APP_LOGIN_PASSWORD);
  await page(`(()=>{const el=document.querySelector('input:not([type=password])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(serverEnv.APP_LOGIN_USER)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  check("clicked Sign in", await click("Sign in"));
  await waitFor(`document.body.innerText.includes('Signed in as')`, "signed-in state");
  check("login succeeds through the UI", true);

  await waitFor(`document.body.innerText.includes('AES-256-GCM') || document.body.innerText.includes('sessionId')`, "encrypted WASM session");
  check("encrypted WASM transport session established", true);
  check("clicked Load profile", await click("Load profile"));
  await waitFor(`document.body.innerText.includes('securePrincipal')`, "protected /api/me response");
  check("protected call succeeds over the encrypted transport", true);

  const stats = await shieldStats();
  check("DDoS shield challenged and the browser solved proof-of-work", stats.challenged >= 1 && stats.solved >= 1, JSON.stringify(stats));
  check("requests then rode the pass (no repeated puzzles)", stats.passed >= 1, JSON.stringify(stats));

  // Durable state: restart the server; the session cookie must still be valid.
  server.kill("SIGTERM"); await sleep(1500); startServer(); await waitHealthy();
  await send("Page.navigate", { url: `${BASE}/` });
  await waitFor(`document.body.innerText.includes('Signed in as')`, "session to survive a server restart");
  check("session survives a server restart", true);

  check("clicked Sign out", await click("Sign out"));
  await waitFor(`!!document.querySelector('input[type=password]')`, "return to sign-in after sign out");
  check("sign out returns to the sign-in form", true);
}

try { await main(); console.log(`\n${results.length} checks passed`); }
catch (e) { console.error(`\nE2E FAILED: ${e.message}`); process.exitCode = 1; }
finally {
  try { ws?.close(); } catch {}
  if (chrome) { const exited = new Promise((r) => chrome.once("exit", r)); chrome.kill(); await Promise.race([exited, sleep(3000)]); }
  server?.kill("SIGKILL");
  try { rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
}
