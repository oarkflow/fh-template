// Worker half of pow.mjs: searches counters start, start+step, ... so several
// workers cover disjoint slices of the space.
import { leadingZeroBits, sha256Words } from "./pow.mjs";

const enc = new TextEncoder();
self.onmessage = (event) => {
    const { challenge, bits, start, step } = event.data;
    for (let counter = start; ; counter += step) {
        if (leadingZeroBits(sha256Words(enc.encode(`${challenge}:${counter}`))) >= bits) {
            self.postMessage({ solution: `${challenge}.${counter}` });
            return;
        }
    }
};
