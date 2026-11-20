// #5: host actions — the host app's own actions in the selection bubble and the slash menu.
// The editor holds the range an action opened on (mapped through every later transaction,
// highlighted while the host's own UI has focus) and hands the host a session to read the
// selection and replace it. The package adds no action of its own. Only prosemirror
// state/model/view and no DOM at import time, so it runs in the test pool on a plain
// EditorState; BlockEditor imports its types only (the editor chunk stays lazy).
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Fragment, Slice, type Node as PMNodeT } from 'prosemirror-model';
import { closeHistory } from 'prosemirror-history';
import { sanitizeBlocks, sanitizeInline, type Block, type Inline } from '$lib/blocks.js';
import type { IconName } from '$lib/icons/glyphs.js';
import { schema } from './schema.js';
import { blockFromPM, blockToPM, docToBlocks, inlineFromPM, inlineToPM, type PMNode } from './doc.js';
import { isContainer, type BlockRef } from './commands.js';

// --- Public types ---------------------------------------------------------------------

/** What the action opened on. */
export type HostSelection = {
	/** Plain text: blocks on their own lines, a line break as `\n`, a merge tag as `{{tag}}`. */
	text: string;
	/** The selected runs when the selection sits inside one text block, else null. */
	inline: Inline[] | null;
	/** The selected content as sanitised blocks; a block selected in part is cut to the
	 *  selection. Empty for an empty selection (the slash menu). */
	blocks: Block[];
	/** True when the selection does not cover whole blocks (a caret in an empty block does). */
	partial: boolean;
};

/** Handed to `onSelect`. Every method acts on the range the action opened on, mapped through
 *  any edit since, even while focus is in the host's own UI. */
export type SelectionContext = {
	selection: HostSelection;
	/** The whole document. */
	document: Block[];
	/** The selection's box relative to the editor canvas (px), to place a popover. */
	anchor: { top: number; left: number; bottom: number };
	/** Sanitise and put `content` in place of the range, one undo step. Inline runs replace
	 *  the text (a heading stays a heading); blocks replace the blocks the range covers
	 *  whole, else go in at the range. False, and nothing changes, when the range is gone
	 *  (deleted, already replaced, or a newer action opened). */
	replaceSelection(content: Inline[] | Block[]): boolean;
	/** Sanitise and insert blocks after the last selected block, one undo step. */
	insertAfterSelection(blocks: Block[]): boolean;
	/** Focus the editor with the range selected again; ends the highlight. */
	restoreFocus(): void;
	/** End the highlight without moving focus. */
	close(): void;
};

/** A host action in the selection bubble. `shortcut` (`Mod+…` notation) runs it on a
 *  non-empty text selection; one the editor already uses is ignored. */
export type SelectionAction = {
	id: string;
	label: string;
	icon?: IconName;
	/** Tooltip and accessible name; defaults to `label`. */
	title?: string;
	shortcut?: string;
	onSelect: (ctx: SelectionContext) => void;
};

/** A host action in the slash menu: opens on the caret once the typed `/query` is removed. */
export type SlashHostAction = Omit<SelectionAction, 'shortcut'>;

/** The context without `anchor`, which the component adds (it knows the canvas). */
export type HostSession = Omit<SelectionContext, 'anchor'>;

// --- The held range -------------------------------------------------------------------

/** The range a host action opened on. `open` = highlighted (the host's UI is up). */
export type HeldRange = { id: number; from: number; to: number; open: boolean };

export const heldSelectionKey = new PluginKey<HeldRange | null>('be-held-selection');
export const HELD_CLASS = 'be-held-selection';

/** The range through an edit; null once it is deleted. The ends stay inside, so text typed
 *  right before or after the range stays out of it. */
function mapHeld(h: HeldRange, tr: Transaction): HeldRange | null {
	if (h.from === h.to) {
		const r = tr.mapping.mapResult(h.from);
		return r.deletedAcross ? null : { ...h, from: r.pos, to: r.pos };
	}
	const from = tr.mapping.map(h.from, 1);
	const to = tr.mapping.map(h.to, -1);
	return to > from ? { ...h, from, to } : null;
}

/** Keeps the held range mapped and draws it (`be-held-selection`) while the action is open.
 *  Focus back in the editor (a click, or `restoreFocus`) ends the highlight. */
export function heldSelectionPlugin() {
	return new Plugin<HeldRange | null>({
		key: heldSelectionKey,
		state: {
			init: () => null,
			apply(tr, held) {
				const meta = tr.getMeta(heldSelectionKey) as HeldRange | null | undefined;
				if (meta !== undefined) return meta;
				return held && tr.docChanged ? mapHeld(held, tr) : held;
			}
		},
		props: {
			decorations(state) {
				const h = heldSelectionKey.getState(state);
				if (!h?.open || h.from >= h.to) return null;
				return DecorationSet.create(state.doc, [Decoration.inline(h.from, h.to, { class: HELD_CLASS })]);
			},
			handleDOMEvents: {
				focus(view) {
					const h = heldSelectionKey.getState(view.state);
					if (h?.open) view.dispatch(view.state.tr.setMeta(heldSelectionKey, { ...h, open: false }));
					return false;
				}
			}
		}
	});
}

/** A host action is open (its highlight is up): the selection bubble stays hidden. */
export const heldOpen = (state: EditorState): boolean => !!heldSelectionKey.getState(state)?.open;

// --- Reading a range ------------------------------------------------------------------

/** Where a block sits, which decides what may go there (the schema's nesting rules). */
type Where = 'top' | 'section' | 'cell';
const whereOf = (n: PMNodeT): Where => (n.type === schema.nodes.section ? 'section' : n.type === schema.nodes.column ? 'cell' : 'top');

/** First position of a block's text, or the block's own start when it opens with an atom. */
function startEdge({ pos, node }: BlockRef): number {
	let n = node;
	let p = pos;
	while (!n.isTextblock) {
		if (n.isAtom || !n.firstChild) return p;
		p += 1;
		n = n.firstChild;
	}
	return p + 1;
}

/** Last position of a block's text, or the block's own end when it closes with an atom. */
function endEdge({ pos, node }: BlockRef): number {
	let n = node;
	let p = pos + node.nodeSize;
	while (!n.isTextblock) {
		if (n.isAtom || !n.lastChild) return p;
		p -= 1;
		n = n.lastChild;
	}
	return p - 1;
}

/** The blocks a range touches, at the level of the deepest container (document, section or
 *  column cell) holding both ends, and whether it covers them whole. */
type Span = { container: PMNodeT; start: number; refs: BlockRef[]; whole: boolean };

function rangeSpan(doc: PMNodeT, from: number, to: number): Span {
	const $from = doc.resolve(from);
	let d = $from.sharedDepth(to);
	while (d > 0 && !isContainer($from.node(d))) d--;
	const container = $from.node(d);
	const start = $from.start(d);
	let refs: BlockRef[] = [];
	container.forEach((node, offset) => {
		const pos = start + offset;
		if (pos + node.nodeSize > from && pos < to) refs.push({ pos, node });
	});
	// A range ending at the very start of a block's text (or starting at the very end of
	// one) does not select that block.
	if (refs.length > 1 && to <= startEdge(refs[refs.length - 1])) refs = refs.slice(0, -1);
	if (refs.length > 1 && from >= endEdge(refs[0])) refs = refs.slice(1);
	const first = refs[0];
	const last = refs[refs.length - 1];
	return { container, start, refs, whole: !!first && from <= startEdge(first) && to >= endEdge(last) };
}

const leafText = (n: PMNodeT): string => (n.type === schema.nodes.hard_break ? '\n' : (n.type.spec.leafText?.(n) ?? ''));

function fragmentJSON(f: Fragment): PMNode[] {
	const out: PMNode[] = [];
	f.forEach((n) => out.push(n.toJSON() as PMNode));
	return out;
}

/** What a host action sees of the range `from`–`to`. */
export function selectionInfo(doc: PMNodeT, from: number, to: number): HostSelection {
	const $from = doc.resolve(from);
	const $to = doc.resolve(to);
	const span = rangeSpan(doc, from, to);
	const inline = $from.sameParent($to) && $from.parent.inlineContent ? inlineFromPM(fragmentJSON($from.parent.content.cut($from.parentOffset, $to.parentOffset))) : null;
	let blocks: Block[] = [];
	const first = span.refs[0];
	const last = span.refs[span.refs.length - 1];
	if (from < to && first) {
		const cut = span.container.content.cut(Math.max(from, first.pos) - span.start, Math.min(to, last.pos + last.node.nodeSize) - span.start);
		blocks = sanitizeBlocks(fragmentJSON(cut).map(blockFromPM).filter((b): b is Block => !!b));
	}
	return { text: doc.textBetween(from, to, '\n', leafText), inline, blocks, partial: !span.whole };
}

// --- Changing a range -----------------------------------------------------------------

/** Host blocks → nodes that may sit in `where`. Outside the top level a section gives its
 *  blocks (the sanitiser's nesting rule); in a column cell a columns block gives its cells'
 *  blocks. A content area is never added. */
function fitNodes(content: unknown, where: Where): PMNodeT[] {
	const flat = (list: Block[]): Block[] =>
		list.flatMap((b): Block[] => {
			if (b.type === 'section' && where !== 'top') return flat(b.blocks);
			if (b.type === 'columns' && where === 'cell') return flat(b.cells.flatMap((c) => c));
			return [b];
		});
	return flat(sanitizeBlocks(content, { allowContent: false }))
		.flatMap(blockToPM)
		.map((j) => schema.nodeFromJSON(j));
}

const INLINE_TYPES = new Set(['text', 'mergeTag', 'hardBreak']);

/** Inline runs rather than blocks (a `text` run carries `text`; a legacy `text` block, `md`).
 *  An empty list counts as inline: it deletes the range. */
function isInlineList(content: unknown[]): boolean {
	return content.every((n) => {
		const r = n && typeof n === 'object' ? (n as Record<string, unknown>) : null;
		return !!r && typeof r.type === 'string' && INLINE_TYPES.has(r.type) && (r.type !== 'text' || typeof r.text === 'string');
	});
}

/** The cursor at the end of what went in. */
function caretAt(tr: Transaction, pos: number): Transaction {
	return tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), -1));
}

function replaceBlocks(state: EditorState, from: number, to: number, content: unknown[]): Transaction {
	const span = rangeSpan(state.doc, from, to);
	const nodes = fitNodes(content, whereOf(span.container));
	const first = span.refs[0];
	const last = span.refs[span.refs.length - 1];
	if (span.whole && first) {
		const a = first.pos;
		const b = last.pos + last.node.nodeSize;
		// A document, section or cell is never left empty.
		const all = a === span.start && b === span.start + span.container.content.size;
		const tr = state.tr.replaceWith(a, b, nodes.length || !all ? nodes : [schema.nodes.paragraph.create()]);
		return caretAt(tr, tr.mapping.map(b));
	}
	// Part of a block: ProseMirror splits it around the new blocks, as a paste does.
	const tr = nodes.length ? state.tr.replaceRange(from, to, new Slice(Fragment.from(nodes), 0, 0)) : state.tr.delete(from, to);
	return caretAt(tr, tr.mapping.map(to));
}

function replaceInline(state: EditorState, from: number, to: number, content: unknown[]): Transaction {
	const runs = sanitizeInline(content);
	// The range starts or ends between blocks: the text becomes a paragraph.
	if (!state.doc.resolve(from).parent.inlineContent || !state.doc.resolve(to).parent.inlineContent) return replaceBlocks(state, from, to, [{ type: 'paragraph', content: runs }]);
	const tr = state.tr.replaceWith(from, to, (inlineToPM(runs) ?? []).map((j) => schema.nodeFromJSON(j)));
	return caretAt(tr, tr.mapping.map(to));
}

/** Replace `from`–`to` with host content (sanitised) in one transaction that is its own
 *  undo step. Null when it cannot apply. */
export function replaceRangeTr(state: EditorState, from: number, to: number, content: Inline[] | Block[]): Transaction | null {
	if (!Array.isArray(content)) return null;
	try {
		return closeHistory(isInlineList(content) ? replaceInline(state, from, to, content) : replaceBlocks(state, from, to, content));
	} catch {
		// A fit the schema refuses: nothing changes.
		return null;
	}
}

/** Insert host blocks (sanitised) after the last block the range touches — a child of the
 *  document, a section or a column cell — as one undo step. Null when nothing fits. */
export function insertAfterRangeTr(state: EditorState, from: number, to: number, blocks: Block[]): Transaction | null {
	if (!Array.isArray(blocks)) return null;
	const span = rangeSpan(state.doc, from, to);
	const last = span.refs[span.refs.length - 1];
	if (!last) return null;
	try {
		const nodes = fitNodes(blocks, whereOf(span.container));
		if (!nodes.length) return null;
		const at = last.pos + last.node.nodeSize;
		const tr = state.tr.insert(at, nodes);
		return closeHistory(caretAt(tr, tr.mapping.map(at)));
	} catch {
		return null;
	}
}

// --- The session ----------------------------------------------------------------------

/** What a session needs of the editor view (an EditorView, or a stand-in in tests). */
export type HostView = { readonly state: EditorState; dispatch(tr: Transaction): void; focus(): void };

let lastHold = 0;

/** Hold the view's selection for a host action (an earlier hold goes stale) and return the
 *  session the host acts through. */
export function openHostSession(view: HostView): HostSession {
	const { from, to } = view.state.selection;
	const doc = view.state.doc;
	const id = ++lastHold;
	view.dispatch(view.state.tr.setMeta(heldSelectionKey, { id, from, to, open: true }));
	/** This session's range, mapped to now; null once used, deleted or replaced by a newer hold. */
	const held = (): HeldRange | null => {
		const h = heldSelectionKey.getState(view.state);
		return h && h.id === id ? h : null;
	};
	const apply = (tr: Transaction | null): boolean => {
		if (!tr) return false;
		view.dispatch(tr.setMeta(heldSelectionKey, null));
		return true;
	};
	const unhighlight = (h: HeldRange, tr: Transaction) => view.dispatch(tr.setMeta(heldSelectionKey, { ...h, open: false }));
	return {
		selection: selectionInfo(doc, from, to),
		document: docToBlocks(doc.toJSON() as PMNode),
		replaceSelection(content) {
			const h = held();
			return !!h && apply(replaceRangeTr(view.state, h.from, h.to, content));
		},
		insertAfterSelection(blocks) {
			const h = held();
			return !!h && apply(insertAfterRangeTr(view.state, h.from, h.to, blocks));
		},
		restoreFocus() {
			const h = held();
			if (h) {
				const { doc: now, tr } = view.state;
				unhighlight(h, tr.setSelection(TextSelection.between(now.resolve(h.from), now.resolve(h.to))));
			}
			view.focus();
		},
		close() {
			const h = held();
			if (h?.open) unhighlight(h, view.state.tr);
		}
	};
}

/** Run a host action on the view's selection; from the slash menu, once the typed `/query`
 *  at `clear` is removed. `anchorOf` places the range in canvas coordinates. If `onSelect`
 *  throws, the highlight ends. */
export function runHostAction(
	view: HostView,
	action: SlashHostAction,
	anchorOf: (from: number, to: number) => SelectionContext['anchor'],
	clear?: { from: number; to: number }
): void {
	if (clear) view.dispatch(view.state.tr.delete(clear.from, clear.to));
	const { from, to } = view.state.selection;
	const session = openHostSession(view);
	try {
		action.onSelect({ ...session, anchor: anchorOf(from, to) });
	} catch (err) {
		session.close();
		throw err;
	}
}
