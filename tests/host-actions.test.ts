// #5: host actions — the host app's own actions in the selection bubble and the slash menu,
// the context they get (the selection, the document, replace / insert) and the held range.
// The logic is plain TS on an EditorState (a stand-in view, no DOM); the bubble is rendered
// on the server and the BlockEditor wiring is read raw, like the other component tests.
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { history, undo } from 'prosemirror-history';
import type { DecorationSet } from 'prosemirror-view';
import type { Node as PMNodeT } from 'prosemirror-model';
import type { Block, ColumnsBlock, Inline, SectionBlock } from '../src/lib/blocks';
import { blocksToDoc, docToBlocks, type PMNode } from '../src/lib/editor/doc';
import { schema } from '../src/lib/editor/schema';
import {
	HELD_CLASS,
	heldOpen,
	heldSelectionKey,
	heldSelectionPlugin,
	openHostSession,
	runHostAction,
	selectionInfo,
	type HostView
} from '../src/lib/editor/host-actions';
import { hostSlashItems, menuMatches } from '../src/lib/editor/menu';
import { builtinShortcuts, headingShortcut, hostShortcut, shortcutMatches } from '../src/lib/editor/shortcuts';
import { selBarVisible } from '../src/lib/editor/quiet';
import SelectionBubble from '../src/lib/components/SelectionBubble.svelte';
import type { SelectionAction, SelectionContext, SlashHostAction } from '../src/lib/index';

const raw = import.meta.glob(['../src/lib/components/BlockEditor.svelte', '../src/lib/components/SelectionBubble.svelte'], {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;
const src = (suffix: string) => {
	const key = Object.keys(raw).find((k) => k.endsWith(suffix));
	if (!key) throw new Error(`missing ${suffix}`);
	return raw[key];
};
const script = (s: string) => (s.match(/<script[\s\S]*?<\/script>/g) ?? []).join('\n');
const markup = (s: string) => s.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');

const p = (id: string, text: string): Block => ({ id, type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const DOC: Block[] = [
	p('a', 'Hello world'),
	{ id: 'h', type: 'heading', level: 2, text: 'Title', content: [{ type: 'text', text: 'Title' }] },
	p('b', 'Second line'),
	{ id: 'col', type: 'columns', cells: [[p('c1', 'Left cell')], [p('c2', 'Right cell')]] },
	{ id: 's', type: 'section', bg: '#ffffff', padding: 'lg', width: 'full', blocks: [p('s1', 'In section'), p('s2', 'More')] }
];

/** A stand-in for the editor view: applies transactions and records focus. */
class TestView implements HostView {
	state: EditorState;
	focused = false;
	constructor(blocks: Block[] = DOC) {
		this.state = EditorState.create({ doc: schema.nodeFromJSON(blocksToDoc(blocks)), plugins: [history(), heldSelectionPlugin()] });
	}
	dispatch = (tr: Transaction) => {
		this.state = this.state.apply(tr);
	};
	focus() {
		this.focused = true;
	}
	select(from: number, to = from) {
		this.dispatch(this.state.tr.setSelection(TextSelection.create(this.state.doc, from, to)));
		return this;
	}
	blocks(): Block[] {
		return docToBlocks(this.state.doc.toJSON() as PMNode);
	}
}

/** Where `text` sits (within one text node). */
function find(doc: PMNodeT, text: string): { from: number; to: number } {
	let at = -1;
	doc.descendants((n, pos) => {
		const i = at < 0 && n.isText ? n.text!.indexOf(text) : -1;
		if (i >= 0) at = pos + i;
		return at < 0;
	});
	if (at < 0) throw new Error(`missing ${text}`);
	return { from: at, to: at + text.length };
}

/** A view with `text` selected. */
function selecting(text: string, blocks: Block[] = DOC) {
	const v = new TestView(blocks);
	const r = find(v.state.doc, text);
	return v.select(r.from, r.to);
}

const cells = (v: TestView) => (v.blocks()[3] as ColumnsBlock).cells;
const section = (v: TestView) => v.blocks()[4] as SectionBlock;
const ids = (list: Block[]) => list.map((b) => b.id);

describe('the selection a host action gets', () => {
	it('a partial selection inside one block: text, inline runs and the block cut to it', () => {
		const v = selecting('world');
		const s = openHostSession(v);
		expect(s.selection).toEqual({
			text: 'world',
			inline: [{ type: 'text', text: 'world' }],
			blocks: [{ id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'world' }] }],
			partial: true
		});
		expect(s.document).toEqual(v.blocks());
		expect(s.document).toHaveLength(5);
	});

	it('a whole block: not partial, the block itself', () => {
		const s = openHostSession(selecting('Title'));
		expect(s.selection.partial).toBe(false);
		expect(s.selection.inline).toEqual([{ type: 'text', text: 'Title' }]);
		expect(s.selection.blocks).toEqual([DOC[1]]);
	});

	it('a selection across several blocks: no inline runs, every block cut to the selection', () => {
		const v = new TestView();
		v.select(find(v.state.doc, 'world').from, find(v.state.doc, 'Second').to);
		const { selection } = openHostSession(v);
		expect(selection.text).toBe('world\nTitle\nSecond');
		expect(selection.inline).toBeNull();
		expect(selection.partial).toBe(true);
		expect(selection.blocks).toEqual([
			{ id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'world' }] },
			DOC[1],
			{ id: 'b', type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }
		]);
	});

	it('several whole blocks are not partial', () => {
		const v = new TestView();
		v.select(find(v.state.doc, 'Hello world').from, find(v.state.doc, 'Second line').to);
		const { selection } = openHostSession(v);
		expect(selection.partial).toBe(false);
		expect(ids(selection.blocks)).toEqual(['a', 'h', 'b']);
	});

	it('inside a column cell: the cell is the container', () => {
		const { selection } = openHostSession(selecting('Left cell'));
		expect(selection).toEqual({ text: 'Left cell', inline: [{ type: 'text', text: 'Left cell' }], blocks: [p('c1', 'Left cell')], partial: false });
	});

	it('merge tags read as {{tag}} and line breaks as \\n', () => {
		const v = new TestView([{ id: 'm', type: 'paragraph', content: [{ type: 'text', text: 'Hi ' }, { type: 'mergeTag', tag: 'first_name' }, { type: 'hardBreak' }, { type: 'text', text: 'there' }] }]);
		const doc = v.state.doc;
		expect(selectionInfo(doc, 1, doc.content.size - 1).text).toBe('Hi {{first_name}}\nthere');
	});

	it('an empty caret (the slash menu) has no text and no blocks', () => {
		const v = new TestView();
		const s = openHostSession(v.select(find(v.state.doc, 'Hello').to));
		expect(s.selection).toEqual({ text: '', inline: [], blocks: [], partial: true });
	});
});

describe('replaceSelection', () => {
	it('inline runs replace the selected text, sanitised marks kept', () => {
		const v = selecting('world');
		const s = openHostSession(v);
		expect(s.replaceSelection([{ type: 'text', text: 'WORLD', marks: [{ type: 'bold' }] }])).toBe(true);
		expect(v.blocks()[0]).toEqual({
			id: 'a',
			type: 'paragraph',
			content: [
				{ type: 'text', text: 'Hello ' },
				{ type: 'text', text: 'WORLD', marks: [{ type: 'bold' }] }
			]
		});
		expect(heldSelectionKey.getState(v.state)).toBeNull();
	});

	it('inline runs over a whole heading keep it a heading', () => {
		const v = selecting('Title');
		openHostSession(v).replaceSelection([{ type: 'text', text: 'TITLE' }]);
		expect(v.blocks()[1]).toEqual({ id: 'h', type: 'heading', level: 2, text: 'TITLE', content: [{ type: 'text', text: 'TITLE' }] });
	});

	it('blocks replace the whole blocks the selection covers', () => {
		const v = new TestView();
		v.select(find(v.state.doc, 'Hello world').from, find(v.state.doc, 'Second line').to);
		expect(openHostSession(v).replaceSelection([p('n', 'New'), p('n2', 'Two')])).toBe(true);
		expect(ids(v.blocks())).toEqual(['n', 'n2', 'col', 's']);
	});

	it('blocks over part of a block split it', () => {
		const v = selecting('world');
		openHostSession(v).replaceSelection([p('n', 'New')]);
		const out = v.blocks();
		expect(out.slice(0, 2)).toEqual([
			{ id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }] },
			p('n', 'New')
		]);
		expect(ids(out).slice(-4)).toEqual(['h', 'b', 'col', 's']);
	});

	it('inside a column cell: inline text, and blocks (columns in a cell give their blocks)', () => {
		const v = selecting('Right');
		openHostSession(v).replaceSelection([{ type: 'text', text: 'RIGHT' }]);
		expect(cells(v)[1]).toEqual([p('c2', 'RIGHT cell')]);

		const w = selecting('Left cell');
		const ok = openHostSession(w).replaceSelection([
			{ id: 'x', type: 'heading', level: 3, text: 'Hi', content: [{ type: 'text', text: 'Hi' }] },
			{ id: 'y', type: 'columns', cells: [[p('z', 'nested')], []] }
		]);
		expect(ok).toBe(true);
		expect(cells(w)[0].map((b) => [b.id, b.type])).toEqual([
			['x', 'heading'],
			['z', 'paragraph']
		]);
		expect(ids(cells(w)[1])).toEqual(['c2']);
	});

	it('inside a section: a section in the content gives its blocks', () => {
		const v = selecting('In section');
		openHostSession(v).replaceSelection([
			{ id: 'q2', type: 'section', bg: '#000000', padding: 'lg', width: 'full', blocks: [p('q', 'Inner')] },
			p('r', 'After')
		]);
		expect(ids(section(v).blocks)).toEqual(['q', 'r', 's2']);
		expect(v.blocks()).toHaveLength(5);
	});

	it('never leaves a cell empty', () => {
		const v = selecting('Left cell');
		expect(openHostSession(v).replaceSelection([{ id: 'gone', type: 'nothing' } as unknown as Block])).toBe(true);
		expect(cells(v)[0]).toHaveLength(1);
		expect(cells(v)[0][0].type).toBe('paragraph');
	});

	it('sanitises: a javascript: link is dropped, an unknown block type too', () => {
		const v = selecting('world');
		openHostSession(v).replaceSelection([{ type: 'text', text: 'x', marks: [{ type: 'link', href: 'javascript:alert(1)' }] }]);
		expect(v.blocks()[0]).toEqual(p('a', 'Hello x'));

		const w = selecting('Second line');
		openHostSession(w).replaceSelection([
			{ id: 'evil', type: 'script', text: 'alert(1)' },
			{ id: 'btn', type: 'button', label: 'Go', href: 'javascript:alert(1)', align: 'left' }
		] as unknown as Block[]);
		const out = w.blocks();
		expect(ids(out)).toEqual(['a', 'h', 'btn', 'col', 's']);
		expect(out[2]).toMatchObject({ type: 'button', href: '' });
		expect(JSON.stringify(out)).not.toContain('javascript');
		expect(JSON.stringify(out)).not.toContain('script');
	});

	it('one undo restores the selection’s content', () => {
		const cases: [string, Inline[] | Block[]][] = [
			['world', [{ type: 'text', text: 'WORLD' }]],
			['In section', [p('n', 'New'), p('n2', 'Two')]],
			['Left cell', [p('n', 'New')]]
		];
		for (const [text, content] of cases) {
			const v = selecting(text);
			const before = v.blocks();
			expect(openHostSession(v).replaceSelection(content)).toBe(true);
			expect(v.blocks()).not.toEqual(before);
			expect(undo(v.state, v.dispatch)).toBe(true);
			expect(v.blocks(), text).toEqual(before);
		}
	});

	it('follows the range through edits made since the action opened', () => {
		const v = selecting('world');
		const s = openHostSession(v);
		v.dispatch(v.state.tr.insertText('Oh, ', 1));
		const r = find(v.state.doc, 'world');
		// Typed right after the range: stays out of it.
		v.dispatch(v.state.tr.insertText('!', r.to));
		expect(s.replaceSelection([{ type: 'text', text: 'WORLD' }])).toBe(true);
		expect(v.blocks()[0]).toEqual(p('a', 'Oh, Hello WORLD!'));
	});

	it('a deleted range returns false and changes nothing', () => {
		const v = selecting('world');
		const s = openHostSession(v);
		const r = find(v.state.doc, 'Hello world');
		v.dispatch(v.state.tr.delete(r.from, r.to));
		const before = v.state.doc;
		expect(s.replaceSelection([{ type: 'text', text: 'WORLD' }])).toBe(false);
		expect(s.insertAfterSelection([p('n', 'New')])).toBe(false);
		expect(v.state.doc.eq(before)).toBe(true);
	});

	it('a newer action makes the older one stale; a used one is spent', () => {
		const v = selecting('world');
		const older = openHostSession(v);
		const r = find(v.state.doc, 'Title');
		const newer = openHostSession(v.select(r.from, r.to));
		expect(older.replaceSelection([{ type: 'text', text: 'X' }])).toBe(false);
		expect(newer.replaceSelection([{ type: 'text', text: 'Y' }])).toBe(true);
		expect(newer.replaceSelection([{ type: 'text', text: 'Z' }])).toBe(false);
		expect(v.blocks()[0]).toEqual(DOC[0]);
		expect(v.blocks()[1]).toMatchObject({ text: 'Y' });
	});

	it('refuses something that is not a list', () => {
		const v = selecting('world');
		expect(openHostSession(v).replaceSelection('WORLD' as unknown as Block[])).toBe(false);
		expect(v.blocks()[0]).toEqual(DOC[0]);
	});
});

describe('insertAfterSelection', () => {
	it('inserts after the selected block, in its column cell or its section', () => {
		const v = selecting('world');
		expect(openHostSession(v).insertAfterSelection([p('i', 'Inserted')])).toBe(true);
		expect(ids(v.blocks())).toEqual(['a', 'i', 'h', 'b', 'col', 's']);

		const w = selecting('Left');
		openHostSession(w).insertAfterSelection([p('i', 'Inserted'), { id: 'cc', type: 'columns', cells: [[p('k', 'kept')], []] }]);
		expect(ids(cells(w)[0])).toEqual(['c1', 'i', 'k']);

		const x = selecting('In');
		openHostSession(x).insertAfterSelection([p('i', 'Inserted')]);
		expect(ids(section(x).blocks)).toEqual(['s1', 'i', 's2']);
	});

	it('after the last block of a selection across several, as one undo step', () => {
		const v = new TestView();
		v.select(find(v.state.doc, 'world').from, find(v.state.doc, 'Second').to);
		const before = v.blocks();
		expect(openHostSession(v).insertAfterSelection([p('i', 'Inserted')])).toBe(true);
		expect(ids(v.blocks())).toEqual(['a', 'h', 'b', 'i', 'col', 's']);
		undo(v.state, v.dispatch);
		expect(v.blocks()).toEqual(before);
	});

	it('nothing usable to insert returns false', () => {
		const v = selecting('world');
		expect(openHostSession(v).insertAfterSelection([{ id: 'x', type: 'nope' } as unknown as Block])).toBe(false);
		expect(v.blocks()).toEqual(new TestView().blocks());
	});
});

describe('the held selection', () => {
	const decos = (v: TestView) => {
		const plugin = heldSelectionKey.get(v.state)!;
		const set = plugin.props.decorations!.call(plugin, v.state) as DecorationSet | null;
		return (set?.find() ?? []).map((d) => [d.from, d.to]);
	};

	it('is highlighted while the action is open; close() ends that and keeps the range', () => {
		expect(HELD_CLASS).toBe('be-held-selection');
		const v = selecting('world');
		const r = find(v.state.doc, 'world');
		expect(decos(v)).toEqual([]);
		const s = openHostSession(v);
		expect(heldOpen(v.state)).toBe(true);
		expect(decos(v)).toEqual([[r.from, r.to]]);
		s.close();
		expect(heldOpen(v.state)).toBe(false);
		expect(decos(v)).toEqual([]);
		expect(s.replaceSelection([{ type: 'text', text: 'WORLD' }])).toBe(true);
	});

	it('restoreFocus selects the range again and focuses the editor', () => {
		const v = selecting('Title');
		const r = find(v.state.doc, 'Title');
		const s = openHostSession(v);
		v.select(1);
		s.restoreFocus();
		expect(v.focused).toBe(true);
		expect([v.state.selection.from, v.state.selection.to]).toEqual([r.from, r.to]);
		expect(heldOpen(v.state)).toBe(false);
	});

	it('an empty caret draws nothing', () => {
		const v = new TestView();
		openHostSession(v.select(3));
		expect(heldOpen(v.state)).toBe(true);
		expect(decos(v)).toEqual([]);
	});

	it('hides the selection bubble', () => {
		const base = { edit: true, textSel: true, linkEditing: false, menu: false, focus: true, dismissed: false };
		expect(selBarVisible(base)).toBe(true);
		expect(selBarVisible({ ...base, held: false })).toBe(true);
		expect(selBarVisible({ ...base, held: true })).toBe(false);
	});
});

describe('host slash actions', () => {
	const shout: SlashHostAction = { id: 'shout', label: 'Shout', title: 'Upper-case it', icon: 'bold', onSelect: () => {} };
	const other: SlashHostAction = { id: 'note', label: 'Note', onSelect: () => {} };

	it('are listed as entries matched by label only', () => {
		const items = hostSlashItems([shout, other]);
		expect(items.map((i) => [i.id, i.label, i.hint, i.icon])).toEqual([
			['host:shout', 'Shout', 'Upper-case it', 'bold'],
			['host:note', 'Note', '', undefined]
		]);
		expect(items[0].action).toEqual({ kind: 'host', host: shout });
		expect(items.filter((i) => menuMatches(i, 'sho')).map((i) => i.id)).toEqual(['host:shout']);
		expect(items.filter((i) => menuMatches(i, 'upper'))).toEqual([]);
		expect(items.filter((i) => menuMatches(i, ''))).toHaveLength(2);
	});

	it('picking one removes the typed /query, then calls onSelect at the caret', () => {
		const v = new TestView([p('a', 'Hi /sho')]);
		const q = find(v.state.doc, '/sho');
		v.select(q.to);
		const onSelect = vi.fn((ctx: SelectionContext) => ctx);
		const anchorOf = vi.fn((from: number, to: number) => ({ top: from, left: to, bottom: 0 }));
		runHostAction(v, { ...shout, onSelect }, anchorOf, q);
		expect(v.blocks()).toEqual([p('a', 'Hi ')]);
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(anchorOf).toHaveBeenCalledWith(q.from, q.from);
		const ctx = onSelect.mock.calls[0][0];
		expect(ctx.anchor).toEqual({ top: q.from, left: q.from, bottom: 0 });
		expect(ctx.selection).toEqual({ text: '', inline: [], blocks: [], partial: true });
		expect(ctx.replaceSelection([{ type: 'text', text: 'LOUD' }])).toBe(true);
		expect(v.blocks()).toEqual([p('a', 'Hi LOUD')]);
	});

	it('in an empty line, blocks take the line', () => {
		const v = new TestView([p('a', 'Hi'), p('e', '/sho')]);
		const q = find(v.state.doc, '/sho');
		v.select(q.to);
		const onSelect = vi.fn((ctx: SelectionContext) => ctx);
		runHostAction(v, { ...shout, onSelect }, () => ({ top: 0, left: 0, bottom: 0 }), q);
		const ctx = onSelect.mock.calls[0][0];
		expect(ctx.selection.partial).toBe(false);
		ctx.replaceSelection([p('n', 'New')]);
		expect(ids(v.blocks())).toEqual(['a', 'n']);
	});

	it('an onSelect that throws ends the highlight', () => {
		const v = selecting('world');
		const boom: SelectionAction = {
			id: 'boom',
			label: 'Boom',
			onSelect: () => {
				throw new Error('boom');
			}
		};
		expect(() => runHostAction(v, boom, () => ({ top: 0, left: 0, bottom: 0 }))).toThrow('boom');
		expect(heldOpen(v.state)).toBe(false);
	});
});

describe('host action shortcuts', () => {
	it('keeps a free Mod+… shortcut', () => {
		expect(hostShortcut({ id: 's1', shortcut: 'Mod+Shift+U' }, true)).toBe('Mod+Shift+U');
		expect(hostShortcut({ id: 's1', shortcut: 'Mod+Shift+U' }, false)).toBe('Mod+Shift+U');
		expect(hostShortcut({ id: 's2' }, true)).toBeNull();
	});

	it('ignores a built-in shortcut (per platform) or one without a modifier, warning once', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(hostShortcut({ id: 'w1', shortcut: 'Mod+B' }, true)).toBeNull();
		expect(hostShortcut({ id: 'w1', shortcut: 'Mod+B' }, false)).toBeNull();
		expect(hostShortcut({ id: 'w1', shortcut: 'mod+b' }, true)).toBeNull();
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn.mock.calls[0][0]).toContain('Mod+B');
		// Headings are ⌘⌥N on a Mac and Ctrl+Shift+N elsewhere.
		expect(hostShortcut({ id: 'w2', shortcut: 'Mod+Alt+2' }, true)).toBeNull();
		expect(hostShortcut({ id: 'w2', shortcut: 'Mod+Alt+2' }, false)).toBe('Mod+Alt+2');
		expect(hostShortcut({ id: 'w3', shortcut: 'Shift+K' }, true)).toBeNull();
		expect(hostShortcut({ id: 'w4', shortcut: 'Hyper+K' }, true)).toBeNull();
		expect(builtinShortcuts(true)).toContain(headingShortcut(1, true));
		expect(builtinShortcuts(false)).toContain('Mod+Shift+F');
		warn.mockRestore();
	});

	it('matches key events with ⌘ on a Mac and Ctrl elsewhere, by key or physical key', () => {
		type Mods = { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean };
		const ev = (key: string, code: string, mods: Mods) => ({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
		expect(shortcutMatches(ev('U', 'KeyU', { metaKey: true, shiftKey: true }), 'Mod+Shift+U', true)).toBe(true);
		expect(shortcutMatches(ev('U', 'KeyU', { ctrlKey: true, shiftKey: true }), 'Mod+Shift+U', false)).toBe(true);
		expect(shortcutMatches(ev('U', 'KeyU', { ctrlKey: true, shiftKey: true }), 'Mod+Shift+U', true)).toBe(false);
		expect(shortcutMatches(ev('u', 'KeyU', { metaKey: true }), 'Mod+Shift+U', true)).toBe(false);
		// ⌥ changes the character; the physical key still matches.
		expect(shortcutMatches(ev('ß', 'KeyS', { metaKey: true, altKey: true }), 'Mod+Alt+S', true)).toBe(true);
	});
});

describe('the selection bubble', () => {
	const noop = () => {};
	const bubble = (props: Record<string, unknown> = {}) =>
		render(SelectionBubble, { props: { ctl: {} as never, format: null, top: 0, left: 0, onLink: noop, onClose: noop, ...props } }).body;
	const shout: SelectionAction = { id: 'shout', label: 'Shout', title: 'Upper-case it', icon: 'bold', shortcut: 'Mod+Shift+U', onSelect: noop };

	it('renders exactly as before without host actions', () => {
		const html = bubble();
		expect(bubble({ actions: [] })).toBe(html);
		expect(html).not.toContain('sb host');
	});

	it('host actions come first, icon and label, with their own divider and a shortcut hint', () => {
		const html = bubble({ actions: [shout, { id: 'plain', label: 'Plain', onSelect: noop }] });
		const first = html.indexOf('aria-label="Upper-case it"');
		expect(first).toBeGreaterThan(-1);
		expect(html.indexOf('aria-label="Plain"')).toBeGreaterThan(first);
		expect(html.indexOf('aria-label="Bold')).toBeGreaterThan(html.indexOf('aria-label="Plain"'));
		expect(html).toMatch(/title="Upper-case it \((⌘⇧U|Ctrl\+Shift\+U)\)"/);
		expect(html).toContain('<span>Shout</span>');
		expect(html).toContain('<span>Plain</span>');
		// Scoped styles add a hash class after the component's own.
		const sep = html.search(/class="sep[ "]/);
		expect(sep).toBeGreaterThan(html.indexOf('<span>Plain</span>'));
		expect(sep).toBeLessThan(html.indexOf('aria-label="Bold'));
	});

	it('host buttons are plain buttons (Tab reaches them) that call onAction', () => {
		const b = src('components/SelectionBubble.svelte');
		expect(markup(b)).toMatch(/<button type="button" class="sb host" title=\{actionHint\(a\)\} aria-label=\{a\.title \?\? a\.label\} onclick=\{\(\) => onAction\(a\)\}>/);
		expect(script(b)).toContain('actions = []');
	});
});

describe('BlockEditor wiring', () => {
	const be = src('components/BlockEditor.svelte');

	it('hands the bubble its actions, lists the slash ones in their own group, and hides the bubble while one is open', () => {
		expect(markup(be)).toMatch(/<SelectionBubble [^>]*actions=\{selectionActions\}[^>]*onAction=\{\(a\) => runHostAction\(a\)\}/);
		expect(script(be)).toContain('[...blockItems, ...hostItems, ...mergeItems]');
		expect(script(be)).toContain('hostSlashItems(slashActions)');
		expect(script(be)).toContain('pool.filter((i) => menuMatches(i, q))');
		expect(markup(be)).toContain('<li class="mi-group" aria-hidden="true">Actions</li>');
		expect(script(be)).toContain('held: ui.held');
		expect(script(be)).toMatch(/if \(item\.action\.kind === 'host'\) runHostAction\(item\.action\.host, \{ from: m\.from, to: m\.to \}\);/);
	});

	it('a host shortcut runs before the menus and keymaps, only on a text selection', () => {
		const onKey = be.slice(be.indexOf('function onKey('), be.indexOf('async function uploadImage'));
		expect(onKey).toContain('if (hostShortcutKey(e)) return true;');
		const fn = be.slice(be.indexOf('function hostShortcutKey('), be.indexOf('function onKey('));
		expect(fn).toContain('!ui.format?.textSel');
		expect(fn).toContain('hostShortcut(x, isMac)');
	});
});
