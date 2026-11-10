// #276: the fixed formatting toolbar — text size, block / inline text colour, right
// alignment and the multi-block commands behind the toolbar.
import { describe, it, expect } from 'vitest';
import { EditorState, NodeSelection, TextSelection, type Command } from 'prosemirror-state';
import { history, undo } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { sanitizeBlocks, renderBlocksEmailHtml, renderPageHtml, type Block } from '../src/lib/blocks';
import { blocksToMarkdown } from '../src/lib/blocks-markdown';
import { blocksToDoc, docToBlocks } from '../src/lib/editor/doc';
import { schema } from '../src/lib/editor/schema';
import { cleanPastedHtml } from '../src/lib/editor/paste';
import { clearFormatting, formatState, selectedBlocks, setAlign, setTextColor, setTextSize, turnSelectionInto } from '../src/lib/editor/commands';

const para = (text: string, extra: Record<string, unknown> = {}): Block => ({ id: `p${text.length}`, type: 'paragraph', content: [{ type: 'text', text }], ...extra }) as Block;

describe('sanitize: text size, block colour, textColor mark', () => {
	it('keeps sm / lg / xl on text blocks and drops anything else', () => {
		const out = sanitizeBlocks([
			{ id: 'a', type: 'paragraph', content: [], textSize: 'lg' },
			{ id: 'b', type: 'heading', level: 2, text: 'H', textSize: 'xl' },
			{ id: 'c', type: 'list', ordered: false, items: [[]], textSize: 'sm' },
			{ id: 'd', type: 'quote', content: [], textSize: 'huge' },
			{ id: 'e', type: 'callout', content: [], textSize: 'md' },
			{ id: 'f', type: 'divider', textSize: 'lg' }
		]);
		expect(out.map((b) => ('textSize' in b ? b.textSize : undefined))).toEqual(['lg', 'xl', 'sm', undefined, undefined, undefined]);
	});

	it('normalises a block colour on body text blocks and drops junk', () => {
		const out = sanitizeBlocks([
			{ id: 'a', type: 'paragraph', content: [], color: '#CE423B' },
			{ id: 'b', type: 'callout', content: [], color: 'abc' },
			{ id: 'c', type: 'quote', content: [], color: 'red; background:url(x)' }
		]);
		expect(out.map((b) => ('color' in b ? b.color : undefined))).toEqual(['#ce423b', '#aabbcc', undefined]);
	});

	it('textColor marks keep a normalised hex only, in mark order', () => {
		const [b] = sanitizeBlocks([
			{
				id: 'a',
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'one', marks: [{ type: 'bold' }, { type: 'textColor', color: '#066971' }] },
					{ type: 'text', text: 'two', marks: [{ type: 'textColor', color: 'expression(alert(1))' }] },
					{ type: 'text', text: 'three', marks: [{ type: 'textColor' }] }
				]
			}
		]);
		expect(b.type === 'paragraph' && b.content).toEqual([
			{ type: 'text', text: 'one', marks: [{ type: 'textColor', color: '#066971' }, { type: 'bold' }] },
			{ type: 'text', text: 'twothree' }
		]);
	});
});

describe('rendering', () => {
	it('email: size, right alignment and colours as inline styles only', () => {
		const html = renderBlocksEmailHtml([
			para('Big', { textSize: 'lg', align: 'right', color: '#066971' }),
			{ id: 'h', type: 'heading', level: 1, text: 'Title', content: [{ type: 'text', text: 'Title' }], textSize: 'xl' },
			{ id: 'd', type: 'heading', level: 1, text: 'Hero', size: 'display', textSize: 'sm' },
			{ id: 'l', type: 'list', ordered: false, items: [[{ type: 'text', text: 'item' }]], textSize: 'sm', color: '#ce423b' },
			{ id: 'q', type: 'quote', content: [{ type: 'text', text: 'Q' }], color: '#15130e' },
			para('x', { content: [{ type: 'text', text: 'red', marks: [{ type: 'textColor', color: '#ce423b' }] }] })
		]);
		expect(html).toContain('font-size:18px;line-height:1.6;margin:0 0 16px;text-align:right;color:#066971;');
		expect(html).toContain('font-size:38px;font-weight:700');
		expect(html).toContain('font-size:36px;font-weight:800');
		expect(html).toMatch(/<ul style="[^"]*font-size:14px;[^"]*color:#ce423b;"/);
		expect(html).toMatch(/<blockquote style="[^"]*color:#57606a;[^"]*color:#15130e;"/);
		expect(html).toContain('<span style="color:#ce423b;">red</span>');
		expect(html).not.toMatch(/class="[^"]*(size|color)/);
	});

	it('email: unset size / colour render exactly as before', () => {
		const html = renderBlocksEmailHtml([para('Plain')]);
		expect(html).toBe('<p style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;margin:0 0 16px;">Plain</p>');
	});

	it('page: size and colour inline', () => {
		const html = renderPageHtml('T', [para('Big', { textSize: 'xl', align: 'right', color: '#066971' })]);
		expect(html).toContain('<p style="text-align:right;font-size:21px;color:#066971;">Big</p>');
	});

	it('markdown export ignores size and colour', () => {
		const md = blocksToMarkdown([para('x', { textSize: 'lg', color: '#066971', content: [{ type: 'text', text: 'hi', marks: [{ type: 'textColor', color: '#ce423b' }] }] })]);
		expect(md.trim()).toBe('hi');
	});

	it('round-trips through the editor document', () => {
		const blocks = sanitizeBlocks([para('x', { textSize: 'lg', color: '#066971', content: [{ type: 'text', text: 'hi', marks: [{ type: 'textColor', color: '#ce423b' }] }] })]);
		expect(docToBlocks(blocksToDoc(blocks))).toEqual(blocks);
	});

	it('pasted colours are dropped, the editor copy markup is kept', () => {
		expect(cleanPastedHtml('<p><span style="color:#ff0000">x</span></p>')).toBe('<p>x</p>');
		expect(cleanPastedHtml('<p><span data-text-color="#ce423b" style="color:#ce423b">x</span></p>')).toBe('<p><span data-text-color="#ce423b">x</span></p>');
	});
});

// --- commands ----------------------------------------------------------------------

const n = schema.nodes;
const p = (text: string, id: string) => n.paragraph.create({ id }, text ? schema.text(text) : null);

function stateOf(nodes: PMNode[]) {
	return EditorState.create({ schema, doc: n.doc.create(null, nodes), plugins: [history()] });
}
function run(state: EditorState, cmd: Command) {
	let next = state;
	const ok = cmd(state, (tr) => (next = next.apply(tr)));
	return { ok, state: next };
}
const designs = (s: EditorState) => s.doc.content.content.map((x) => x.attrs.design);

/** p(a) · image · divider · p(b), with text selected from "a" to "b". */
function mixed() {
	const s = stateOf([p('alpha', 'a'), n.image.create({ id: 'i', src: 'https://x.test/i.png' }), n.divider.create({ id: 'd' }), p('beta', 'b')]);
	return s.apply(s.tr.setSelection(TextSelection.create(s.doc, 2, s.doc.content.size - 2)));
}

describe('formatting commands', () => {
	it('align applies to every alignable block in the selection, skips the rest, undoes in one step', () => {
		const s0 = mixed();
		expect(selectedBlocks(s0).map((r) => r.node.type.name)).toEqual(['paragraph', 'image', 'divider', 'paragraph']);
		const { ok, state } = run(s0, setAlign('right'));
		expect(ok).toBe(true);
		expect(designs(state)).toEqual([{ align: 'right' }, { align: 'right' }, null, { align: 'right' }]);
		expect(formatState(state).align).toBe('right');
		// The text selection is kept.
		expect(state.selection.from).toBe(s0.selection.from);
		expect(state.selection.to).toBe(s0.selection.to);
		const back = run(state, undo).state;
		expect(back.doc.eq(s0.doc)).toBe(true);
	});

	it('align on a button sets its own align attr', () => {
		const s = stateOf([n.button.create({ id: 'btn', label: 'Go', href: 'https://x.test' })]);
		const s0 = s.apply(s.tr.setSelection(NodeSelection.create(s.doc, 0)));
		const { state } = run(s0, setAlign('center'));
		expect(state.doc.firstChild!.attrs.align).toBe('center');
		expect(state.selection instanceof NodeSelection).toBe(true);
	});

	it('text size skips atoms; mixed sizes read as mixed', () => {
		const s0 = mixed();
		const { state } = run(s0, setTextSize('xl'));
		expect(designs(state)).toEqual([{ textSize: 'xl' }, null, null, { textSize: 'xl' }]);
		expect(formatState(s0).size).toBe('md');
		const one = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
		const { state: s2 } = run(one, setTextSize(null));
		const all = s2.apply(s2.tr.setSelection(TextSelection.create(s2.doc, 2, s2.doc.content.size - 2)));
		expect(formatState(all).size).toBe('mixed');
	});

	it('colour: a text selection gets a mark, a cursor colours the block', () => {
		const s = stateOf([p('hello', 'a')]);
		const sel = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 3)));
		const marked = run(sel, setTextColor('#CE423B')).state;
		expect(marked.doc.firstChild!.firstChild!.marks.map((m) => [m.type.name, m.attrs.color])).toEqual([['textColor', '#ce423b']]);
		expect(formatState(marked).color).toBe('#ce423b');
		const cursor = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 3)));
		const block = run(cursor, setTextColor('#066971')).state;
		expect(block.doc.firstChild!.attrs.design).toEqual({ color: '#066971' });
		expect(run(block, setTextColor(null)).state.doc.firstChild!.attrs.design).toBeNull();
	});

	it('block type: adjacent paragraphs become one list; atoms are skipped', () => {
		const s0 = mixed();
		const { state } = run(s0, turnSelectionInto('bullet'));
		expect(state.doc.content.content.map((x) => x.type.name)).toEqual(['bullet_list', 'image', 'divider', 'bullet_list']);
		const s = stateOf([p('one', 'a'), p('two', 'b')]);
		const both = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, s.doc.content.size - 1)));
		const list = run(both, turnSelectionInto('numbered')).state;
		expect(list.doc.childCount).toBe(1);
		expect(list.doc.firstChild!.type.name).toBe('ordered_list');
		expect(list.doc.firstChild!.childCount).toBe(2);
		expect(run(list, undo).state.doc.eq(both.doc)).toBe(true);
	});

	it('block type: text → heading keeps the cursor and the block id', () => {
		const s = stateOf([p('hello', 'a')]);
		const s0 = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 4)));
		const { state } = run(s0, turnSelectionInto('h2'));
		expect(state.doc.firstChild!.type.name).toBe('heading');
		expect(state.doc.firstChild!.attrs.level).toBe(2);
		expect(state.doc.firstChild!.attrs.id).toBe('a');
		expect(state.selection.from).toBe(4);
		expect(formatState(state).turn).toBe('h2');
	});

	it('block type is disabled on an atom', () => {
		const s = stateOf([n.divider.create({ id: 'd' }), p('x', 'a')]);
		const s0 = s.apply(s.tr.setSelection(NodeSelection.create(s.doc, 0)));
		expect(formatState(s0).turn).toBeNull();
		expect(run(s0, turnSelectionInto('h1')).ok).toBe(false);
	});

	it('clear formatting drops marks, size and colour but keeps alignment', () => {
		const s = stateOf([n.paragraph.create({ id: 'a', design: { align: 'center', textSize: 'lg', color: '#066971' } }, schema.text('hey', [schema.marks.bold.create()]))]);
		const s0 = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 4)));
		const { state } = run(s0, clearFormatting);
		expect(state.doc.firstChild!.attrs.design).toEqual({ align: 'center' });
		expect(state.doc.firstChild!.firstChild!.marks).toEqual([]);
	});
});
