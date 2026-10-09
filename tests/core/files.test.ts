import { beforeEach, describe, expect, it } from 'vitest';
import { FILE_PREFIX, assertFileName, createFileStore, makeFileName, utf8ToBase64 } from '../../src/core/files';
import { stableHash } from '../../src/core/hash';
import { memoryLogger, mockHost } from '../helpers/fakes';
import { installStMock } from '../helpers/st-mock';
import type { StMock } from '../helpers/st-mock';

let mock: StMock;

beforeEach(() => {
    mock = installStMock();
});

describe('file names', () => {
    it('keeps the dramatis- prefix and hashes the key', () => {
        expect(makeFileName('card', 'Марта.png')).toBe(`${FILE_PREFIX}card-${stableHash('Марта.png')}.json`);
        expect(makeFileName('dramatis-index')).toBe('dramatis-index.json');
        expect(makeFileName('a b/c')).toBe('dramatis-a_b_c.json');
        expect(stableHash('chat-1')).toMatch(/^[0-9a-z]{1,11}$/);
        expect(stableHash('chat-1')).toBe(stableHash('chat-1'));
        expect(stableHash('chat-1')).not.toBe(stableHash('chat-2'));
    });

    it('rejects names without the prefix or with unsafe characters', () => {
        expect(() => assertFileName('maestro-x.json')).toThrow();
        expect(() => assertFileName('dramatis-../x.json')).toThrow();
        expect(() => assertFileName('dramatis-ok.json')).not.toThrow();
    });

    it('encodes UTF-8 as base64', () => {
        expect(Buffer.from(utf8ToBase64('ёлка'), 'base64').toString('utf8')).toBe('ёлка');
    });
});

describe('createFileStore', () => {
    it('writes through the upload endpoint and reads back', async () => {
        const files = createFileStore(mockHost(), memoryLogger());
        await files.write('dramatis-test.json', { name: 'Марта', n: 1 });
        expect(JSON.parse(mock.files.get('dramatis-test.json')!)).toEqual({ name: 'Марта', n: 1 });
        expect(await files.read('dramatis-test.json')).toEqual({ name: 'Марта', n: 1 });
    });

    it('returns null for a missing file and caches the answer until a fresh read', async () => {
        const files = createFileStore(mockHost(), memoryLogger());
        expect(await files.read('dramatis-none.json')).toBeNull();
        mock.files.set('dramatis-none.json', '{"a":1}');
        expect(await files.read('dramatis-none.json')).toBeNull();
        expect(await files.read('dramatis-none.json', { fresh: true })).toEqual({ a: 1 });
    });

    it('gives every reader its own copy', async () => {
        const files = createFileStore(mockHost(), memoryLogger());
        await files.write('dramatis-x.json', { list: [1] });
        const first = await files.read<{ list: number[] }>('dramatis-x.json');
        first!.list.push(2);
        expect(await files.read('dramatis-x.json')).toEqual({ list: [1] });
    });

    it('treats invalid JSON as absent and removes files', async () => {
        const log = memoryLogger();
        const files = createFileStore(mockHost(), log);
        mock.files.set('dramatis-bad.json', '{oops');
        expect(await files.read('dramatis-bad.json')).toBeNull();
        expect(log.lines.some((line) => line.level === 'warn')).toBe(true);

        await files.write('dramatis-gone.json', {});
        await files.remove('dramatis-gone.json');
        expect(mock.files.has('dramatis-gone.json')).toBe(false);
        expect(await files.read('dramatis-gone.json')).toBeNull();
    });

    it('builds file names with the contract method', () => {
        const files = createFileStore(mockHost(), memoryLogger());
        expect(files.fileName('card', 'a.png')).toBe(makeFileName('card', 'a.png'));
    });
});
