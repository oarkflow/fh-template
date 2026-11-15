// Client half of the server's load-adaptive proof-of-work shield
// (internal/shield). Usage:
//
//   import { withShield } from "./pow.mjs";
//   const guarded = withShield(secureFetch);   // drop-in fetch replacement
//
// While the server is calm nothing changes. When it is under pressure and a
// request is refused (429 / network-level refusal), withShield asks GET /_pow
// for a puzzle, solves it locally (SHA-256 hashcash, a few ms to ~2s), posts
// the answer to /_pow to receive a signed pass cookie, then retries once.
// /_pow is plain same-origin HTTP so it works even when API calls travel in an
// encrypted envelope.

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Uint32Array(64);

// Synchronous SHA-256 of `bytes`; returns the 8 state words.
export function sha256Words(bytes) {
    const len = bytes.length;
    const padded = (((len + 9 + 63) >> 6) << 6);
    const buf = new Uint8Array(padded);
    buf.set(bytes);
    buf[len] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(padded - 8, Math.floor((len * 8) / 0x100000000));
    view.setUint32(padded - 4, (len * 8) >>> 0);
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
        h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    for (let off = 0; off < padded; off += 64) {
        for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
        for (let i = 16; i < 64; i++) {
            const a = W[i - 15], b = W[i - 2];
            const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
            const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
            W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let i = 0; i < 64; i++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7];
}

export function leadingZeroBits(words) {
    let n = 0;
    for (const w of words) {
        if (w === 0) { n += 32; continue; }
        return n + Math.clz32(w);
    }
    return n;
}

const enc = new TextEncoder();

// Finds counter such that SHA256(challenge + ":" + counter) has `bits`
// leading zero bits. Yields to the event loop every ~50k hashes so the page
// stays responsive; honours AbortSignal.
export async function solve(challenge, bits, signal) {
    for (let counter = 0; ; counter++) {
        if (leadingZeroBits(sha256Words(enc.encode(`${challenge}:${counter}`))) >= bits) {
            return `${challenge}.${counter}`;
        }
        if (counter % 50_000 === 49_999) {
            if (signal?.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
            await new Promise((r) => setTimeout(r, 0));
        }
    }
}

// Solves in parallel Web Workers (off the main thread, so the page never
// janks) and falls back to the main-thread solver where workers are
// unavailable or blocked.
export async function solveParallel(challenge, bits, signal) {
    const count = Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
    if (typeof Worker === "undefined") return solve(challenge, bits, signal);
    return new Promise((resolve, reject) => {
        const workers = [];
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            for (const w of workers) w.terminate();
            signal?.removeEventListener("abort", onAbort);
            fn(value);
        };
        const onAbort = () => finish(reject, signal.reason ?? new DOMException("aborted", "AbortError"));
        signal?.addEventListener("abort", onAbort, { once: true });
        const fallback = () => { if (!settled) solve(challenge, bits, signal).then((v) => finish(resolve, v), (e) => finish(reject, e)); };
        try {
            for (let i = 0; i < count; i++) {
                const worker = new Worker(new URL("./pow-worker.js", import.meta.url), { type: "module" });
                worker.onmessage = (event) => finish(resolve, event.data.solution);
                worker.onerror = () => { for (const w of workers) w.terminate(); workers.length = 0; fallback(); };
                worker.postMessage({ challenge, bits, start: i, step: count });
                workers.push(worker);
            }
        } catch {
            for (const w of workers) w.terminate();
            fallback();
        }
    });
}

// Obtains a pass cookie if the server currently demands one. Concurrent
// callers share one solve.
let inFlight = null;
export function ensurePass({ endpoint = "/_pow", fetchImpl = globalThis.fetch.bind(globalThis), signal, solver = solveParallel } = {}) {
    inFlight ??= (async () => {
        const res = await fetchImpl(endpoint, { credentials: "same-origin", cache: "no-store" });
        if (!res.ok) return false;
        const puzzle = await res.json();
        // bits === 0: pressure eased since the refusal, so no work is needed
        // and the caller should simply retry.
        if (!puzzle.bits) return true;
        const solution = await solver(puzzle.challenge, puzzle.bits, signal);
        const redeem = await fetchImpl(endpoint, {
            method: "POST", credentials: "same-origin", cache: "no-store", headers: { "X-FH-Pow": solution },
        });
        return redeem.status === 204;
    })().finally(() => { inFlight = null; });
    return inFlight;
}

const isShieldRefusal = (response) => response.status === 429 && response.headers.has("x-fh-challenge");

// Wraps a fetch-like function: when the shield refuses a request under load,
// solve once (shared across concurrent callers) and retry exactly once. The
// shield refuses before the request reaches any handler, so retrying a
// non-idempotent request is safe.
export function withShield(fetchLike, options = {}) {
    const plainFetch = options.plainFetch ?? globalThis.fetch.bind(globalThis);
    return async (input, init) => {
        const retryInput = input instanceof Request ? input.clone() : input;
        let response;
        try {
            response = await fetchLike(input, init);
            if (!isShieldRefusal(response)) return response;
        } catch (error) {
            if (init?.signal?.aborted) throw error;
            // A refusal may surface as an error when a transport cannot parse
            // the unencrypted 429; try to obtain a pass and retry.
        }
        const solved = await ensurePass({ endpoint: options.endpoint, fetchImpl: plainFetch, signal: init?.signal, solver: options.solver });
        if (!solved && response) return response;
        return fetchLike(retryInput, init);
    };
}
