import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { leadingZeroBits, sha256Words, solve, withShield } from "./pow.mjs";

const hex = (words) => words.map((w) => (w >>> 0).toString(16).padStart(8, "0")).join("");

test("sha256 matches node:crypto across padding boundaries", () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
        const input = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
        assert.equal(hex(sha256Words(input)), createHash("sha256").update(input).digest("hex"), `len ${n}`);
    }
});

test("solve satisfies the server's check", async () => {
    const solution = await solve("abc.def", 12);
    const dot = solution.lastIndexOf(".");
    const digest = createHash("sha256").update(`${solution.slice(0, dot)}:${solution.slice(dot + 1)}`).digest();
    let zeros = 0;
    for (const byte of digest) { if (byte === 0) { zeros += 8; continue; } zeros += Math.clz32(byte) - 24; break; }
    assert.ok(zeros >= 12);
    assert.equal(leadingZeroBits([0, 0x00ffffff]), 40);
});

test("withShield solves once and retries after a 429", async () => {
    let apiCalls = 0, redeemed = false;
    const api = async () => (++apiCalls === 1 ? new Response("", { status: 429, headers: { "X-FH-Challenge": "c" } }) : new Response("ok"));
    const plain = async (url, init) => {
        if (init?.method === "POST") { redeemed = true; return new Response(null, { status: 204 }); }
        return Response.json({ bits: 8, challenge: "c.h" });
    };
    const res = await withShield(api, { plainFetch: plain, solver: solve })("/api/x");
    assert.equal(await res.text(), "ok");
    assert.ok(redeemed);
    assert.equal(apiCalls, 2);
});

test("withShield ignores an ordinary 429 (no challenge header)", async () => {
    let calls = 0;
    const api = async () => { calls++; return new Response("slow down", { status: 429 }); };
    const res = await withShield(api, { plainFetch: async () => { throw new Error("must not solve"); } })("/api/x");
    assert.equal(res.status, 429);
    assert.equal(calls, 1);
});

test("concurrent refusals share one solve", async () => {
    let solves = 0, apiCalls = 0;
    const api = async () => (++apiCalls <= 3 ? new Response("", { status: 429, headers: { "X-FH-Challenge": "c" } }) : new Response("ok"));
    const plain = async (url, init) => (init?.method === "POST" ? new Response(null, { status: 204 }) : Response.json({ bits: 8, challenge: "c.h" }));
    const solver = async (c, b) => { solves++; await new Promise((r) => setTimeout(r, 20)); return solve(c, b); };
    const guarded = withShield(api, { plainFetch: plain, solver });
    const results = await Promise.all([guarded("/a"), guarded("/b"), guarded("/c")]);
    assert.deepEqual(await Promise.all(results.map((r) => r.text())), ["ok", "ok", "ok"]);
    assert.equal(solves, 1);
});
