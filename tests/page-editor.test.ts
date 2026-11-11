// #261: the editor side of landing pages: the editor document round trip of upgraded
// pages, image width through the editor, keyboard block moves and paste cleanup.
// Package port: the app's /pages routes, public page and compose / template cases are not
// here (app-only server code). `opened` stands in for the app's load step.
import { describe, it, expect } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { parseBlocks, renderPageHtml, sanitizeBlocks, type Block } from '../src/lib/blocks';
import { upgradeLegacyBlocks } from '../src/lib/blocks-markdown';
import { blocksToDoc, docToBlocks } from '../src/lib/editor/doc';
import { schema } from '../src/lib/editor/schema';
import { arrowBlock, currentBlockPos, moveBlock, moveBlockTr } from '../src/lib/editor/commands';
import { cleanPastedHtml } from '../src/lib/editor/paste';
import { GOOGLE_DOCS, NOTION, WORD } from './fixtures/paste-fixtures';

/** What a host hands the editor for a stored page: parsed, sanitised, legacy text upgraded. */
const opened = (json: string): Block[] => upgradeLegacyBlocks(sanitizeBlocks(parseBlocks(json), { allowContent: false }));
/** What a host stores from the editor's posted JSON. */
const stored = (json: string): Block[] => sanitizeBlocks(parseBlocks(json), { allowContent: false });
const viaEditor = (blocks: Block[]) => docToBlocks(blocksToDoc(blocks) as never, { allowContent: false });

// A page saved by an older builder: markdown text blocks, inside columns too.
const OLD_PAGE: Block[] = [
	{ id: 'h', type: 'heading', level: 1, text: 'Welcome' },
	{ id: 't1', type: 'text', md: 'Thanks for **signing up**. Read [the guide](https://example.com/guide).\n\n- one\n- two' },
	{ id: 'img', type: 'image', src: 'https://cdn.example.com/a.png', alt: 'A', href: 'https://example.com', width: 300 },
	{ id: 'b', type: 'button', label: 'Book a call', href: 'https://example.com/book', align: 'center' },
	{ id: 'd', type: 'divider' },
	{ id: 's', type: 'spacer', size: 'lg' },
	{ id: 'c', type: 'columns', cells: [[{ id: 'c1', type: 'text', md: '## Left\n\nleft text' }], [{ id: 'c2', type: 'text', md: 'right *text*' }]] }
];

describe('editor round trip of pages', () => {
	it('stored → editor → stored is stable and renders the same', () => {
		const rich = opened(JSON.stringify(OLD_PAGE));
		const edited = viaEditor(rich);
		expect(edited.map((b) => b.id)).toEqual(rich.map((b) => b.id));
		const saved = stored(JSON.stringify(edited));
		expect(saved).toEqual(edited);
		expect(opened(JSON.stringify(saved))).toEqual(saved);
		expect(viaEditor(saved)).toEqual(saved);
		expect(renderPageHtml('P', saved)).toBe(renderPageHtml('P', rich));
	});

	it('every page block survives the editor; a content area does not', () => {
		const all: Block[] = [
			{ id: 'h3', type: 'heading', level: 3, text: 'Small', content: [{ type: 'text', text: 'Small' }] },
			{ id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'Hi', marks: [{ type: 'underline' }] }] },
			{ id: 'l', type: 'list', ordered: true, items: [[{ type: 'text', text: 'a' }]] },
			{ id: 'q', type: 'quote', content: [{ type: 'text', text: 'quoted' }] },
			{ id: 'co', type: 'callout', content: [{ type: 'text', text: 'note' }] },
			{ id: 'i', type: 'image', src: 'https://cdn.example.com/b.png', alt: 'B', href: 'https://example.com', widthPct: 50 },
			{ id: 'b', type: 'button', label: 'Go', href: 'https://example.com', align: 'right' },
			{ id: 'd', type: 'divider' },
			{ id: 's', type: 'spacer', size: 'sm' },
			{
				id: 'c',
				type: 'columns',
				cells: ['x', 'y', 'z'].map((t) => [{ id: t, type: 'paragraph', content: [{ type: 'text', text: t }] }] as Block[])
			},
			{ id: 'ca', type: 'content' }
		];
		const saved = stored(JSON.stringify(all));
		expect(saved.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'quote', 'callout', 'image', 'button', 'divider', 'spacer', 'columns']);
		expect(viaEditor(saved)).toEqual(saved);
	});

	it('image width (%) survives the editor', () => {
		const img: Block = { id: 'i', type: 'image', src: 'https://cdn.example.com/a.png', alt: 'A', widthPct: 50 };
		expect(docToBlocks(blocksToDoc([img]) as never)).toEqual([img]);
	});
});

// --- keyboard block moves -----------------------------------------------------------
const p = (text: string, id: string) => schema.nodes.paragraph.create({ id }, text ? schema.text(text) : null);
function stateOf(nodes: ReturnType<typeof p>[]) {
	return EditorState.create({ schema, doc: schema.nodes.doc.create(null, nodes) });
}
const ids = (s: EditorState) => s.doc.content.content.map((n) => n.attrs.id);
function run(state: EditorState, cmd: ReturnType<typeof moveBlock>) {
	let next = state;
	const ok = cmd(state, (tr) => (next = state.apply(tr)));
	return { ok, state: next };
}

describe('block-move commands', () => {
	const base = () => {
		const s = stateOf([p('one', 'a'), schema.nodes.button.create({ id: 'b', label: 'Go', href: 'https://example.com' }), p('three', 'c')]);
		// Cursor inside "three", after "th".
		return s.apply(s.tr.setSelection(TextSelection.create(s.doc, s.doc.content.size - 4)));
	};

	it('Cmd/Ctrl+Shift+↑ moves the current block up and keeps the cursor in it', () => {
		const { ok, state } = run(base(), moveBlock(-1));
		expect(ok).toBe(true);
		expect(ids(state)).toEqual(['a', 'c', 'b']);
		expect(state.selection.$from.parent.attrs.id).toBe('c');
		expect(state.selection.$from.parentOffset).toBe(2);
		const again = run(state, moveBlock(-1)).state;
		expect(ids(again)).toEqual(['c', 'a', 'b']);
		expect(run(again, moveBlock(-1)).ok).toBe(false); // already first
	});

	it('Cmd/Ctrl+Shift+↓ moves a selected atom down', () => {
		const s0 = base();
		const s = s0.apply(s0.tr.setSelection(NodeSelection.create(s0.doc, 5))); // the button
		expect(currentBlockPos(s)).toBe(5);
		const { state } = run(s, moveBlock(1));
		expect(ids(state)).toEqual(['a', 'c', 'b']);
		expect((state.selection as NodeSelection).node.type.name).toBe('button');
		expect(run(state, moveBlock(1)).ok).toBe(false); // already last
	});

	it('moves stay inside a column cell', () => {
		const cols = schema.nodes.columns.create({ id: 'cols' }, [
			schema.nodes.column.create(null, [p('x', 'x'), p('y', 'y')]),
			schema.nodes.column.create(null, [p('z', 'z')])
		]);
		const s0 = EditorState.create({ schema, doc: schema.nodes.doc.create(null, [cols]) });
		const yPos = 1 + 1 + p('x', 'x').nodeSize; // doc > columns > column > [x][y]
		const tr = moveBlockTr(s0, yPos, -1)!;
		const cell = tr.doc.child(0).child(0);
		expect(cell.content.content.map((n) => n.attrs.id)).toEqual(['y', 'x']);
		expect(moveBlockTr(s0.apply(tr), 2, -1)).toBeNull(); // y is first in its cell now
		expect(moveBlockTr(s0.apply(tr), 0, 1)).toBeNull(); // the columns block is the only top-level block
	});

	it('↑/↓ from a selected atom steps onto the neighbouring block', () => {
		const s0 = base();
		const s = s0.apply(s0.tr.setSelection(NodeSelection.create(s0.doc, 5)));
		const down = run(s, arrowBlock(1)).state;
		expect(down.selection).toBeInstanceOf(TextSelection);
		expect(down.selection.$from.parent.attrs.id).toBe('c');
		expect(down.selection.$from.parentOffset).toBe(0);
		const up = run(s, arrowBlock(-1)).state;
		expect(up.selection.$from.parent.attrs.id).toBe('a');
		expect(up.selection.$from.parentOffset).toBe(3);

		// Atom next to an atom: the neighbour is selected (no text to land in).
		const t0 = stateOf([schema.nodes.divider.create({ id: 'd' }), schema.nodes.image.create({ id: 'i', src: 'https://cdn.example.com/a.png' })]);
		const t = t0.apply(t0.tr.setSelection(NodeSelection.create(t0.doc, 0)));
		const next = run(t, arrowBlock(1));
		expect(next.ok).toBe(true);
		expect((next.state.selection as NodeSelection).node.type.name).toBe('image');
		// Last block: left to the gap cursor.
		expect(run(next.state, arrowBlock(1)).ok).toBe(false);
	});

	it('dragging the last block out of a cell leaves the cell (and the columns) in place', () => {
		const cols = schema.nodes.columns.create({ id: 'cols' }, [
			schema.nodes.column.create(null, [p('x', 'x')]),
			schema.nodes.column.create(null, [p('z', 'z')])
		]);
		const s0 = EditorState.create({ schema, doc: schema.nodes.doc.create(null, [cols, p('end', 'e')]) });
		// What ProseMirror's drop does for a moved block: delete the dragged selection, insert at the target.
		const xPos = 2; // doc > columns(0) > column(1) > x(2)
		const node = s0.doc.nodeAt(xPos)!;
		const tr = s0.tr.setSelection(NodeSelection.create(s0.doc, xPos));
		tr.deleteSelection();
		tr.insert(tr.mapping.map(s0.doc.content.size), node);
		const doc = tr.doc;
		doc.check();
		expect(doc.child(0).type.name).toBe('columns');
		expect(doc.child(0).childCount).toBe(2);
		expect(doc.child(0).child(1).textContent).toBe('z');
		expect(doc.lastChild!.attrs.id).toBe('x');
	});
});

// --- paste cleanup ------------------------------------------------------------------

describe('paste cleanup', () => {
	const noJunk = (html: string) => {
		expect(html).not.toMatch(/\sstyle=/i);
		expect(html).not.toMatch(/\sclass=/i);
		expect(html).not.toMatch(/<\/?(span|font|o:p|meta|style|b|i)\b/i);
		expect(html).not.toMatch(/font-family|mso-|docs-internal|Calibri|Arial/i);
	};

	it('Google Docs: styled spans become marks, the bold wrapper and link underline go', () => {
		const out = cleanPastedHtml(GOOGLE_DOCS);
		noJunk(out);
		expect(out).toBe(
			'<h1>Launch plan</h1>' +
				'<p>We ship <strong>Monday</strong> and <em>celebrate</em> <u>after</u>, <s>not before</s>.</p>' +
				'<ul><li><p>First</p></li><li><p>Second <a href="https://example.com/x">link</a></p></li></ul>' +
				'<p><br></p>'
		);
	});

	it('Notion: classes and inline styles go, structure stays', () => {
		const out = cleanPastedHtml(NOTION);
		noJunk(out);
		expect(out).toBe(
			'<h2>Notes</h2><p>Plain and <strong>bold</strong> and <code>code</code>.</p><blockquote>Quoted</blockquote><ol><li>One</li><li>Two</li></ol>'
		);
	});

	it('Word: Office markup goes and list paragraphs become lists', () => {
		const out = cleanPastedHtml(WORD);
		noJunk(out);
		expect(out).toBe(
			'<div>\n<p>Dear <strong>team</strong>,<em> thanks</em></p>\n' +
				'<ul><li>Apples</li>\n<li>Pears</li></ul>\n' +
				'<ol><li>Step one</li></ol>\n' +
				'</div>'
		);
	});

	it('keeps the editor’s own copy markup (atoms, merge tags, callouts)', () => {
		const own = '<p>Hi <span class="pm-merge" data-merge-tag="first_name">{{first_name}}</span></p><div class="pm-callout">Note</div><div data-pm-block="button" data-attrs="{&quot;label&quot;:&quot;Go&quot;}"></div>';
		expect(cleanPastedHtml(own)).toBe(
			'<p>Hi <span data-merge-tag="first_name" class="pm-merge">{{first_name}}</span></p><div class="pm-callout">Note</div><div data-pm-block="button" data-attrs="{&quot;label&quot;:&quot;Go&quot;}"></div>'
		);
	});

	it('drops scripts, styles and comments', () => {
		const out = cleanPastedHtml('<style>p{color:red}</style><!--x--><p onclick="evil()">a<script>alert(1)</script></p>');
		expect(out).toBe('<p>a</p>');
	});
});
