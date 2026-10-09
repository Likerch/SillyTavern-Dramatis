// Stable, non-cryptographic string hash for file names (card avatars and chat ids → `dramatis-…-<hash>`).
// Ported from Maestro src/domain/hash.ts: it runs over the UTF-8 bytes, so the result does not depend on the engine.

/** Calls `visit` with every UTF-8 byte of `text` without allocating a buffer. Lone surrogates become U+FFFD. */
function forEachUtf8Byte(text: string, visit: (byte: number) => void): void {
    for (let i = 0; i < text.length; i++) {
        let code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
            if (next >= 0xdc00 && next <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                i++;
            } else {
                code = 0xfffd;
            }
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            code = 0xfffd;
        }
        if (code < 0x80) {
            visit(code);
        } else if (code < 0x800) {
            visit(0xc0 | (code >> 6));
            visit(0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
            visit(0xe0 | (code >> 12));
            visit(0x80 | ((code >> 6) & 0x3f));
            visit(0x80 | (code & 0x3f));
        } else {
            visit(0xf0 | (code >> 18));
            visit(0x80 | ((code >> 12) & 0x3f));
            visit(0x80 | ((code >> 6) & 0x3f));
            visit(0x80 | (code & 0x3f));
        }
    }
}

/** 53-bit hash (cyrb53 by bryc, public domain) over UTF-8 bytes. */
export function hash53(text: string, seed = 0): number {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    forEachUtf8Byte(text, (byte) => {
        h1 = Math.imul(h1 ^ byte, 2654435761);
        h2 = Math.imul(h2 ^ byte, 1597334677);
    });
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Short stable id for any string: the 53-bit hash in base 36 (1–11 chars of [0-9a-z]). */
export function stableHash(text: string): string {
    return hash53(text).toString(36);
}
