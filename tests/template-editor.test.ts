// #255: the editor side of templates: upgraded legacy blocks (with a content area) round
// trip through the editor document, and docToBlocks honours `allowContent`.
// Package port: the app's template routes, preview endpoint and send assembly are not
// here (app-only server code). `opened` stands in for the app's load step.
import { describe, it, expect } from 'vitest';
import { parseBlocks, sanitizeBlocks, type Block } from '../src/lib/blocks';
import { upgradeLegacyBlocks } from '../src/lib/blocks-markdown';
import { blocksToDoc, docToBlocks } from '../src/lib/editor/doc';

const opened = (json: string, allowContent: boolean): Block[] =>
	upgradeLegacyBlocks(sanitizeBlocks(parseBlocks(json), { allowContent }));
const stored = (json: string, allowContent: boolean): Block[] => sanitizeBlocks(parseBlocks(json), { allowContent });

// The pre-#255 shape: markdown inside text blocks, a content area in the middle.
const OLD_BLOCKS = [
	{ id: 'h1', type: 'heading', level: 1, text: 'Example news' },
	{ id: 't1', type: 'text', md: 'Hello **{{first_name}}**, see [our site](https://example.com).' },
	{ id: 'c1', type: 'content' },
	{ id: 't2', type: 'text', md: 'Thanks for reading', visibility: { kind: 'tag', name: 'vip' } }
];

describe('editor round trip of templates', () => {
	it('editor doc → stored JSON → editor is stable, content area and visibility kept', () => {
		const rich = opened(JSON.stringify(OLD_BLOCKS), true);
		// The editor normalises once on mount (a plain heading gains `content`) …
		const viaEditor = docToBlocks(blocksToDoc(rich) as never, { allowContent: true });
		expect(viaEditor.map((b) => b.id)).toEqual(rich.map((b) => b.id));
		expect(viaEditor.map((b) => b.type)).toEqual(['heading', 'paragraph', 'content', 'paragraph']);
		expect(viaEditor[3].visibility).toEqual({ kind: 'tag', name: 'vip' });
		// … then save → load → editor is stable.
		const saved = stored(JSON.stringify(viaEditor), true);
		expect(saved).toEqual(viaEditor);
		const reopened = opened(JSON.stringify(saved), true);
		expect(reopened).toEqual(viaEditor);
		expect(docToBlocks(blocksToDoc(reopened) as never, { allowContent: true })).toEqual(viaEditor);
	});

	it('drops content areas when not allowed', () => {
		const doc = [{ id: 'a', type: 'content' }, { id: 'p', type: 'paragraph', content: [] }, { id: 'b', type: 'content' }];
		expect(docToBlocks(blocksToDoc(doc as Block[]) as never, { allowContent: false }).map((b) => b.type)).toEqual(['paragraph']);
	});
});
