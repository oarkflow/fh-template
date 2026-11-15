// Loaded before the application bundle. Wraps globalThis.fetch so that any
// request the DDoS shield refuses under load (429 + X-FH-Challenge) is
// transparently retried after a one-off, off-thread proof of work. The
// application and the secure-fetch transport need no changes. /_pow itself
// uses the original fetch, so there is no recursion.
import { withShield } from "./pow.mjs";

if (typeof globalThis.fetch === "function" && !globalThis.__fhShield) {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.__fhShield = true;
    globalThis.fetch = withShield(originalFetch, { plainFetch: originalFetch });
}
