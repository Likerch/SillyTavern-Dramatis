// Tiny pure helpers shared by the domain rules (relations, mood, reputation, scene…).
import type { Stance } from './model';

export function clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) return min;
    return Math.min(max, Math.max(min, value));
}

/** 0 … 1; NaN and garbage count as 0. */
export function clamp01(value: number): number {
    return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}

/** Rounds and clamps any number onto the −3 … +3 stance ladder. */
export function clampStance(value: number): Stance {
    return clamp(Math.round(Number.isFinite(value) ? value : 0), -3, 3) as Stance;
}

/** Rounds away float noise (0.1 + 0.2) so stored deltas stay readable. */
export function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/**
 * Comparable form of story words: lower case, ё → е, punctuation and quotes dropped, spaces collapsed.
 * «Трактир „Рог“, зал» and "трактир рог — зал" become the same string.
 */
export function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** `base`, or `base-2`, `base-3`… — the first one not in `taken`. */
export function uniqueId(base: string, taken: Iterable<string>): string {
    const used = new Set(taken);
    if (!used.has(base)) return base;
    for (let n = 2; ; n++) {
        const id = `${base}-${n}`;
        if (!used.has(id)) return id;
    }
}
