// Ladder words of the scales the sheet edits (sliders show a word, not only a number; docs/model.md П6).
import type { HexacoAxis } from '../../domain/model';
import { hexacoPole, pressureLabel } from '../../domain/ladders';
import type { Gender } from '../../domain/ladders';
import type { SheetCtx } from './types';

function bucket(value: number, edges: readonly number[]): number {
    let index = 0;
    for (const edge of edges) if (value >= edge) index++;
    return index;
}

export interface Words {
    /** −2 … +2 generic (attachment). */
    level(value: number): string;
    /** HEXACO axis: the pole words, «скорее …» at ±1. */
    hexaco(axis: HexacoAxis, value: number): string;
    baseline(value: number): string;
    liking(value: number): string;
    /** 0 … 3: tolerance, dependence, sensitization. */
    three(value: number): string;
    want(value: number): string;
    pressure(value: number, gender?: Gender): string;
    proactivity(value: number): string;
    corruption(value: number): string;
    selfControl(value: number): string;
    choosiness(value: number): string;
    intensity(value: number): string;
    amount(value: number): string;
}

export function words(ctx: SheetCtx): Words {
    const t = ctx.t;
    const scale = (name: string, value: number) => t(`sheet.scale.${name}.${Math.round(value)}`);
    return {
        level: (value) => scale('level', value),
        hexaco: (axis, value) => {
            if (value === 0) return t('sheet.scale.level.0');
            const pole = hexacoPole(axis, value, ctx.lang, 1);
            return Math.abs(value) >= 2 ? pole : t('sheet.scale.rather', { word: pole });
        },
        baseline: (value) => scale('baseline', value),
        liking: (value) => scale('liking', value),
        three: (value) => scale('three', value),
        want: (value) => scale('want', value),
        pressure: (value, gender) => pressureLabel(value, ctx.lang, gender),
        proactivity: (value) => `${Math.round(value)} — ${t(`sheet.scale.proactivity.${bucket(value, [3, 5, 7, 9])}`)}`,
        corruption: (value) =>
            `${Math.round(value)} — ${t(`sheet.scale.corruption.${bucket(value, [1, 3, 5, 7, 10])}`)}`,
        selfControl: (value) => scale('selfControl', value),
        choosiness: (value) => scale('choosiness', value),
        intensity: (value) => scale('intensity', value),
        amount: (value) => scale('amount', value),
    };
}
