import { describe, expect, it } from 'vitest';
import {
    cleanForAnalysis,
    isCkDumpBody,
    isHtmlElementName,
    isImagePost,
    stripCkDumps,
    stripDesTrackerJson,
    stripHtml,
    stripMechanicsBlock,
    stripNaiPlaceholders,
    stripOffscreenBlock,
} from '../../src/domain/text-clean';

describe('text-clean', () => {
    it('strips a leading DES tracker block, fenced or bare, and keeps other JSON', () => {
        const fenced = '```json\n{"infoBox": {"location": "трактир"}}\n```\nИльва молчит.';
        expect(stripDesTrackerJson(fenced)).toBe('Ильва молчит.');
        expect(stripDesTrackerJson('{"characterThoughts": [{"name": "Ильва"}]} Ильва молчит.')).toBe('Ильва молчит.');
        expect(stripDesTrackerJson('{"quests": [broken} Текст')).toBe('Текст');
        expect(stripDesTrackerJson('```json\n{"other": 1}\n```\nТекст')).toContain('"other"');
        expect(stripDesTrackerJson('{"a": 1} Текст')).toBe('{"a": 1} Текст');
        expect(stripDesTrackerJson('Просто текст')).toBe('Просто текст');
        expect(stripDesTrackerJson('')).toBe('');
    });

    it('strips HTML but keeps BunnyMo tags, decodes entities', () => {
        expect(stripHtml('<p>Она <b>кивает</b>.</p><!-- x --><style>.a{}</style>')).toBe('\nОна кивает.\n');
        expect(stripHtml('<SPECIES:ELF> &lt;3 &#1046; &amp;')).toBe('<SPECIES:ELF> <3 Ж &');
        expect(isHtmlElementName('DIV')).toBe(true);
        expect(isHtmlElementName('my-element')).toBe(true);
        expect(isHtmlElementName('INTJ-U')).toBe(false);
    });

    it('strips CK dumps, NAI placeholders and the mechanics block', () => {
        const dump = 'Текст\n\n<BunnyMoTags>\nИльва:\n• TRAIT: GRIM\n</BunnyMoTags>';
        expect(stripCkDumps(dump)).toBe('Текст');
        expect(isCkDumpBody('<TRAIT:GRIM>')).toBe(false);
        expect(stripCkDumps('<BunnyMoTags><TRAIT:GRIM></BunnyMoTags>')).toContain('<TRAIT:GRIM>');
        expect(stripNaiPlaceholders('Она [nai:img:abc] кивает.\n[nai:img:x]')).toBe('Она кивает.\n');
        expect(stripMechanicsBlock('Текст <mechanics>hp: -2</mechanics> дальше')).toBe('Текст  дальше');
        expect(stripMechanicsBlock('Текст\n```mechanics\nhp: -2\n```\n')).toBe('Текст\n\n');
    });

    it('cleans a whole message and skips picture posts', () => {
        expect(
            cleanForAnalysis({
                mes: '```json\n{"infoBox": {}}\n```\n<p>Ильва   молчит.</p>\n\n\n\nКонец [nai:img:1]',
                extra: {},
            }),
        ).toBe('Ильва   молчит.\n\nКонец');
        expect(cleanForAnalysis({ mes: 'prompt', extra: { nai_studio: {} } })).toBe('');
        expect(isImagePost({ mes: 'tags', extra: { media: [{ nai_studio: { prompt: 'tags' } }] } })).toBe(true);
        expect(isImagePost({ mes: 'story', extra: { media: [{ nai_studio: { prompt: 'tags' } }] } })).toBe(false);
        expect(cleanForAnalysis('plain')).toBe('plain');
        expect(cleanForAnalysis(42)).toBe('');
    });
});

describe('text-clean — Maestro’s scene split block', () => {
    it('drops the <offscreen> block of what happens elsewhere, escaped, bracketed or left open', () => {
        const reply = 'Ильва молчит.\n<offscreen>Лиза торгуется с контрабандистами в порту.</offscreen>';
        expect(stripOffscreenBlock(reply).trim()).toBe('Ильва молчит.');
        expect(stripOffscreenBlock('А. &lt;offscreen&gt;Б.&lt;/offscreen&gt; В.')).toBe('А.  В.');
        expect(stripOffscreenBlock('А. [offscreen]Б.[/offscreen]')).toBe('А. ');
        expect(stripOffscreenBlock('А. <OFFSCREEN class="x">Б. обрыв')).toBe('А. ');
        expect(stripOffscreenBlock('Off-screen talk, offscreenish words.')).toBe(
            'Off-screen talk, offscreenish words.',
        );
    });

    it('takes another tag when asked, and only plain words for tags', () => {
        expect(stripOffscreenBlock('А. <around>Б.</around>', ['around'])).toBe('А. ');
        expect(stripOffscreenBlock('А. <around>Б.</around>', ['a(b'])).toBe('А. <around>Б.</around>');
    });

    it('leaves the block out of the story text for analysis', () => {
        const message = { mes: 'Лиза ушла.\n\n<offscreen>Лиза вернулась домой и легла спать.</offscreen>' };
        expect(cleanForAnalysis(message)).toBe('Лиза ушла.');
        expect(cleanForAnalysis('А.<around>Б.</around>', { offscreenTags: ['around'] })).toBe('А.');
    });
});
