// #270: editor design controls: design attributes survive the editor document, "turn
// into" keeps the shared design, and the editor's initial selection skips a leading image.
// Package port: the app's canvas sanitiser / renderer / template assembly cases are not
// here; the editorial seed template is replaced by an equivalent header section.
import { describe, it, expect } from 'vitest';
import { NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import { sanitizeBlocks, type Block } from '../src/lib/blocks';
import { blocksToDoc, docToBlocks, convertBlock } from '../src/lib/editor/doc';
import { schema } from '../src/lib/editor/schema';
import { initialSelection } from '../src/lib/editor/commands';

const t = (text: string) => [{ type: 'text' as const, text }];

describe('editor round trip', () => {
	it('design attributes survive blocks → editor document → blocks', () => {
		const blocks = sanitizeBlocks([
			{ id: 'h', type: 'heading', level: 2, text: 'x', content: t('x'), color: '#0b1f3a', align: 'center', spaceBelow: 32 },
			{ id: 'b', type: 'button', label: 'Go', href: 'https://example.com', align: 'right', bg: '#0b1f3a', fg: '#fcb900', radius: 4, btnSize: 'sm', full: true },
			{ id: 'd', type: 'divider', color: '#ce423b', thickness: 2, short: true },
			{ id: 'sp', type: 'spacer', size: 'md', px: 40 },
			{ id: 'c', type: 'columns', gap: 0, valign: 'middle', stack: false, cells: [[{ id: 'i', type: 'image', src: 'https://example.com/x.png', alt: '', align: 'right' }], [{ id: 'q', type: 'paragraph', content: t('y') }]] },
			{ id: 's', type: 'section', bg: '#fcb900', padding: 'md', width: 'inset', align: 'center', padTop: 8, padBottom: 48, padX: 24, radius: 16, borderColor: '#0b1f3a', borderWidth: 2, accent: '#ce423b', bgImage: 'https://example.com/bg.jpg', blocks: [{ id: 'e', type: 'eyebrow', content: t('Label'), align: 'left' }] }
		]);
		const doc = blocksToDoc(blocks);
		expect(() => schema.nodeFromJSON(doc).check()).not.toThrow();
		expect(docToBlocks(doc)).toEqual(blocks);
	});
	it('"turn into" keeps alignment and space below, drops type-only design', () => {
		const h: Block = { id: 'h', type: 'heading', level: 2, text: 'x', content: t('x'), color: '#0b1f3a', align: 'center', spaceBelow: 8 };
		// #276: text colour (and size) belong to every text block now, so they carry over…
		const p = sanitizeBlocks([convertBlock(h, 'paragraph')])[0];
		expect(p).toMatchObject({ type: 'paragraph', align: 'center', spaceBelow: 8, color: '#0b1f3a' });
		// …except into an eyebrow, which has neither.
		const e = sanitizeBlocks([convertBlock(h, 'eyebrow')])[0];
		expect(e).toMatchObject({ type: 'eyebrow', align: 'center', spaceBelow: 8 });
		expect(e).not.toHaveProperty('color');
	});
});

describe('initial selection (clicking a header logo)', () => {
	it('does not start as a hidden node selection on a leading image', () => {
		// A header section holding only a logo. ProseMirror's default start selection is
		// that image, so the first click on it was a no-op.
		const blocks = sanitizeBlocks([
			{ id: 'hdr', type: 'section', bg: '#ffffff', padding: 'sm', width: 'full', blocks: [{ id: 'logo', type: 'image', src: 'https://example.com/logo.png', alt: 'Logo' }] },
			{ id: 'p', type: 'paragraph', content: t('Hello') }
		]);
		const doc = schema.nodeFromJSON(blocksToDoc(blocks));
		expect(doc.firstChild?.type.name).toBe('section');
		expect(doc.firstChild?.childCount).toBe(1);
		expect(doc.firstChild?.firstChild?.type.name).toBe('image');
		expect(Selection.atStart(doc)).toBeInstanceOf(NodeSelection);
		const sel = initialSelection(doc);
		expect(sel).toBeInstanceOf(TextSelection);
		expect(sel.$from.parent.isTextblock).toBe(true);
	});
	it('falls back to the default when there is no text at all', () => {
		const doc = schema.nodeFromJSON(blocksToDoc(sanitizeBlocks([{ id: 'i', type: 'image', src: 'https://example.com/x.png', alt: '' }])));
		expect(initialSelection(doc).eq(Selection.atStart(doc))).toBe(true);
	});
});
