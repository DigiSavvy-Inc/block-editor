// #261: block-level keyboard commands for BlockEditor. Only prosemirror-state/model, no
// view at import time, so they run in the test pool on a plain EditorState.
import { NodeSelection, Selection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNodeT, ResolvedPos } from 'prosemirror-model';
import { normalizeHex } from '$lib/brand.js';
import type { Align, TextSize } from '$lib/blocks.js';
import { schema } from './schema.js';
import { blockFromPM, blockToPM, convertBlock, type PMNode, type TurnInto } from './doc.js';

/** A "block" lives directly in the document, in a section (#262) or in a column cell. */
export const isContainer = (n: PMNodeT) => n.type === schema.nodes.doc || n.type === schema.nodes.section || n.type === schema.nodes.column;

/** Position of the block holding the selection (a selected block counts as itself). */
export function currentBlockPos(state: EditorState): number | null {
	const sel = state.selection;
	if (sel instanceof NodeSelection && isContainer(sel.$from.parent)) return sel.from;
	const $from: ResolvedPos = sel.$from;
	for (let d = $from.depth; d > 0; d--) if (isContainer($from.node(d - 1))) return $from.before(d);
	return null;
}

/** Swap the block at `pos` with its previous / next sibling in the same container. The
 *  selection moves with the block. Null at either end. */
export function moveBlockTr(state: EditorState, pos: number, dir: -1 | 1): Transaction | null {
	const node = state.doc.nodeAt(pos);
	if (!node) return null;
	const $p = state.doc.resolve(pos);
	const i = $p.index();
	const parent = $p.parent;
	if (!isContainer(parent) || (dir < 0 && i === 0) || (dir > 0 && i >= parent.childCount - 1)) return null;
	const to = dir < 0 ? pos - parent.child(i - 1).nodeSize : pos + parent.child(i + 1).nodeSize;
	const shift = to - pos;
	const sel = state.selection;
	const inside = sel.from >= pos && sel.to <= pos + node.nodeSize;
	const tr = state.tr.delete(pos, pos + node.nodeSize).insert(to, node);
	if (sel instanceof NodeSelection && sel.from === pos) tr.setSelection(NodeSelection.create(tr.doc, to));
	else if (inside && sel instanceof TextSelection) tr.setSelection(TextSelection.create(tr.doc, sel.anchor + shift, sel.head + shift));
	else tr.setSelection(NodeSelection.create(tr.doc, to));
	return tr.scrollIntoView();
}

/** Cmd/Ctrl+Shift+↑/↓: move the current block up / down among its siblings. */
export function moveBlock(dir: -1 | 1): Command {
	return (state, dispatch) => {
		const pos = currentBlockPos(state);
		const tr = pos === null ? null : moveBlockTr(state, pos, dir);
		if (!tr) return false;
		dispatch?.(tr);
		return true;
	};
}

/** The selection to land on when stepping from a block onto `node` at `pos`. */
function selectionInto(doc: PMNodeT, pos: number, node: PMNodeT, dir: -1 | 1): Selection {
	if (node.isAtom && NodeSelection.isSelectable(node)) return NodeSelection.create(doc, pos);
	if (node.isTextblock) return TextSelection.create(doc, dir > 0 ? pos + 1 : pos + node.nodeSize - 1);
	return Selection.near(doc.resolve(dir > 0 ? pos + 1 : pos + node.nodeSize - 1), dir);
}

/** ArrowUp / ArrowDown between blocks, including onto and off atom blocks (button,
 *  image, divider, spacer). From a selected atom the next block gets the cursor (or the
 *  selection, if it's another atom). From the first / last line of text, an adjacent
 *  atom is selected. Anything else falls through to ProseMirror and the gap cursor. */
export function arrowBlock(dir: -1 | 1): Command {
	return (state, dispatch, view) => {
		const sel = state.selection;
		if (sel instanceof NodeSelection && sel.node.isBlock && isContainer(sel.$from.parent)) {
			const $p = sel.$from;
			const i = $p.index();
			const parent = $p.parent;
			const j = i + dir;
			if (j < 0 || j >= parent.childCount) return false; // gap cursor / leave the cell
			const sib = parent.child(j);
			const at = dir > 0 ? sel.to : sel.from - sib.nodeSize;
			dispatch?.(state.tr.setSelection(selectionInto(state.doc, at, sib, dir)).scrollIntoView());
			return true;
		}
		if (!(sel instanceof TextSelection) || !sel.empty || !view?.endOfTextblock(dir < 0 ? 'up' : 'down')) return false;
		const $h = sel.$head;
		const edge = dir > 0 ? $h.after() : $h.before();
		const $e = state.doc.resolve(edge);
		const adj = dir > 0 ? $e.nodeAfter : $e.nodeBefore;
		if (!adj?.isAtom || !NodeSelection.isSelectable(adj)) return false;
		dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, dir > 0 ? edge : edge - adj.nodeSize)).scrollIntoView());
		return true;
	};
}

/** #270: where the cursor starts. ProseMirror's default (Selection.atStart) is a node
 *  selection when the document opens with an image, e.g. a header section holding just
 *  the logo. That selection is never drawn while the editor is blurred, and a first
 *  click on the logo then looked like "no change" and landed in the next text block.
 *  Start in the first text block instead; a document with no text keeps the default. */
export function initialSelection(doc: PMNodeT): Selection {
	return TextSelection.findFrom(doc.resolve(0), 1, true) ?? Selection.atStart(doc);
}

// --- #276: the formatting toolbar ------------------------------------------------------
// Block-level commands act on every eligible block the selection touches (one
// transaction, so one undo step) and skip the rest; marks act on the selected text.

/** Blocks that take an alignment (a button keeps it in its own `align` attr). */
export const ALIGN_NODES = new Set(['heading', 'paragraph', 'eyebrow', 'quote', 'callout', 'milestones', 'bullet_list', 'ordered_list', 'image', 'button']);
/** Blocks that take a text size and a block text colour. */
export const TEXT_NODES = new Set(['heading', 'paragraph', 'bullet_list', 'ordered_list', 'quote', 'callout']);
/** Blocks the type switcher converts. */
export const TURN_NODES = new Set([...TEXT_NODES, 'eyebrow']);
export const SIMPLE_MARKS = ['bold', 'italic', 'underline', 'strike', 'code'] as const;
export type SimpleMark = (typeof SIMPLE_MARKS)[number];

export type BlockRef = { pos: number; node: PMNodeT };

const isWrapper = (n: PMNodeT) => n.type === schema.nodes.section || n.type === schema.nodes.columns;

/** Every block the selection touches, in document order. Sections and columns are
 *  looked through (their child blocks count); a cursor counts its own block. */
export function selectedBlocks(state: EditorState): BlockRef[] {
	const { from, to } = state.selection;
	const out: BlockRef[] = [];
	state.doc.nodesBetween(from, to, (node, pos, parent) => {
		if (parent && isContainer(parent) && !isWrapper(node)) {
			out.push({ pos, node });
			return false;
		}
		return true;
	});
	if (!out.length) {
		const pos = currentBlockPos(state);
		const node = pos === null ? null : state.doc.nodeAt(pos);
		if (node && pos !== null && !isWrapper(node)) out.push({ pos, node });
	}
	return out;
}

const designOf = (n: PMNodeT): Record<string, unknown> => (n.attrs.design && typeof n.attrs.design === 'object' ? (n.attrs.design as Record<string, unknown>) : {});

function mergeDesign(n: PMNodeT, patch: Record<string, unknown>): Record<string, unknown> | null {
	const next = { ...designOf(n) };
	for (const [k, v] of Object.entries(patch)) {
		if (v === null || v === undefined) delete next[k];
		else next[k] = v;
	}
	return Object.keys(next).length ? next : null;
}

/** A node selection survives the attribute change as the same node selection. */
function keepNodeSelection(state: EditorState, tr: Transaction) {
	const sel = state.selection;
	if (sel instanceof NodeSelection && tr.doc.nodeAt(sel.from)) tr.setSelection(NodeSelection.create(tr.doc, sel.from));
}

/** Patch the attrs of every selected block of the given types. */
function blocksCommand(types: Set<string>, patch: (n: PMNodeT) => Record<string, unknown>): Command {
	return (state, dispatch) => {
		const refs = selectedBlocks(state).filter((r) => types.has(r.node.type.name));
		if (!refs.length) return false;
		if (dispatch) {
			const tr = state.tr;
			for (const { pos, node } of refs) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch(node) });
			keepNodeSelection(state, tr);
			dispatch(tr);
		}
		return true;
	};
}

/** Left / center / right on every alignable block (null = back to the default). */
export function setAlign(align: Align | null): Command {
	return blocksCommand(ALIGN_NODES, (n) => (n.type === schema.nodes.button ? { align: align ?? 'left' } : { design: mergeDesign(n, { align }) }));
}

/** S / L / XL on every text block (null = the default size). */
export function setTextSize(size: TextSize | null): Command {
	return blocksCommand(TEXT_NODES, (n) => ({ design: mergeDesign(n, { textSize: size }) }));
}

/** The block text colour on every text block (null = the default). */
export function setBlockColor(hex: string | null): Command {
	const color = hex ? normalizeHex(hex) || null : null;
	return blocksCommand(TEXT_NODES, (n) => ({ design: mergeDesign(n, { color }) }));
}

const hasTextSelection = (state: EditorState) => !state.selection.empty && !(state.selection instanceof NodeSelection);

/** Selected text → an inline `textColor` mark; otherwise the blocks' own colour. Back to
 *  the default with text selected clears both (the colour shown may be the block's). */
export function setTextColor(hex: string | null): Command {
	return (state, dispatch) => {
		if (!hasTextSelection(state)) return setBlockColor(hex)(state, dispatch);
		const color = hex ? normalizeHex(hex) : '';
		const { from, to } = state.selection;
		const tr = state.tr.removeMark(from, to, schema.marks.textColor);
		if (color) tr.addMark(from, to, schema.marks.textColor.create({ color }));
		else {
			for (const { pos, node } of selectedBlocks(state)) {
				if (TEXT_NODES.has(node.type.name) && designOf(node).color !== undefined) tr.setNodeMarkup(pos, undefined, { ...node.attrs, design: mergeDesign(node, { color: null }) });
			}
		}
		dispatch?.(tr);
		return true;
	};
}

/** Marks off the selected text (or the stored marks at a cursor), plus the text size and
 *  colour of the selected text blocks. Alignment stays. */
export const clearFormatting: Command = (state, dispatch) => {
	if (dispatch) {
		const tr = state.tr;
		if (hasTextSelection(state)) tr.removeMark(state.selection.from, state.selection.to);
		else tr.setStoredMarks([]);
		for (const { pos, node } of selectedBlocks(state)) {
			if (!TEXT_NODES.has(node.type.name)) continue;
			const design = mergeDesign(node, { textSize: null, color: null });
			if (JSON.stringify(design) !== JSON.stringify(node.attrs.design ?? null)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, design });
		}
		keepNodeSelection(state, tr);
		dispatch(tr);
	}
	return true;
};

const LIST_TARGETS = new Set<TurnInto>(['bullet', 'numbered', 'steps']);

/** Contiguous runs of sibling blocks (same container, adjacent). */
function siblingRuns(refs: BlockRef[]): BlockRef[][] {
	const runs: BlockRef[][] = [];
	for (const r of refs) {
		const run = runs[runs.length - 1];
		const last = run?.[run.length - 1];
		if (last && last.pos + last.node.nodeSize === r.pos) run.push(r);
		else runs.push([r]);
	}
	return runs;
}

/** The type switcher: convert every text block in the selection. Adjacent blocks turned
 *  into a list become one list. Atom blocks are skipped. */
export function turnSelectionInto(to: TurnInto): Command {
	return (state, dispatch) => {
		const refs = selectedBlocks(state).filter((r) => TURN_NODES.has(r.node.type.name));
		if (!refs.length) return false;
		if (!dispatch) return true;
		const tr = state.tr;
		let replaced = false;
		const groups = LIST_TARGETS.has(to) ? siblingRuns(refs) : refs.map((r) => [r]);
		// Last first, so earlier positions stay valid.
		for (const group of groups.reverse()) {
			const blocks = group.map((r) => blockFromPM(r.node.toJSON() as PMNode));
			if (blocks.some((b) => !b)) continue;
			const converted = blocks.map((b) => convertBlock(b!, to));
			let out = converted[0];
			if (out.type === 'list' && converted.length > 1) out = { ...out, items: converted.flatMap((c) => (c.type === 'list' ? c.items : [])) };
			const json = blockToPM(out);
			const first = group[0];
			const last = group[group.length - 1];
			const type = schema.nodes[json[0]?.type ?? ''];
			if (group.length === 1 && json.length === 1 && type?.isTextblock && first.node.isTextblock) {
				// Text block → text block: same content, so the cursor stays where it was.
				tr.setNodeMarkup(first.pos, type, json[0].attrs);
			} else {
				tr.replaceWith(first.pos, last.pos + last.node.nodeSize, json.map((j) => schema.nodeFromJSON(j)));
				replaced = true;
			}
		}
		if (replaced) {
			const { from, to: end, empty } = state.selection;
			const $a = tr.doc.resolve(tr.mapping.map(from, -1));
			if (empty) tr.setSelection(Selection.near(tr.doc.resolve(Math.min($a.pos + 1, tr.doc.content.size))));
			else tr.setSelection(TextSelection.between($a, tr.doc.resolve(tr.mapping.map(end, 1))));
		}
		dispatch(tr.scrollIntoView());
		return true;
	};
}

/** What the toolbar shows for a selection. `null` = disabled (nothing eligible);
 *  'mixed' = the eligible blocks disagree. */
export type FormatState = {
	turn: TurnInto | 'mixed' | null;
	marks: SimpleMark[];
	canMark: boolean;
	/** Non-empty text selected (a link needs one). */
	textSel: boolean;
	href: string | null;
	align: Align | 'mixed' | null;
	size: TextSize | 'md' | 'mixed' | null;
	color: string | null;
	canColor: boolean;
};

function turnOf(n: PMNodeT): TurnInto | null {
	switch (n.type.name) {
		case 'paragraph':
		case 'quote':
		case 'callout':
		case 'eyebrow':
			return n.type.name as TurnInto;
		case 'heading':
			return n.attrs.size === 'display' ? 'display' : n.attrs.level === 1 ? 'h1' : n.attrs.level === 3 ? 'h3' : 'h2';
		case 'bullet_list':
			return 'bullet';
		case 'ordered_list':
			return n.attrs.style === 'steps' ? 'steps' : 'numbered';
		default:
			return null;
	}
}

/** A block's effective alignment: its own, else its section's centring, else left. */
function alignOf(state: EditorState, r: BlockRef): Align {
	if (r.node.type === schema.nodes.button) return r.node.attrs.align === 'center' || r.node.attrs.align === 'right' ? r.node.attrs.align : 'left';
	const own = designOf(r.node).align;
	if (own === 'left' || own === 'center' || own === 'right') return own;
	const $p = state.doc.resolve(r.pos);
	for (let d = $p.depth; d >= 1; d--) if ($p.node(d).type === schema.nodes.section) return $p.node(d).attrs.align === 'center' ? 'center' : 'left';
	return 'left';
}

function common<T>(values: T[]): T | 'mixed' | null {
	if (!values.length) return null;
	return values.every((v) => v === values[0]) ? values[0] : 'mixed';
}

export function formatState(state: EditorState): FormatState {
	const sel = state.selection;
	const refs = selectedBlocks(state);
	const textSel = hasTextSelection(state);
	const atom = sel instanceof NodeSelection;
	const marks: SimpleMark[] = [];
	let href: string | null = null;
	let color: string | null = null;
	if (textSel) {
		for (const m of SIMPLE_MARKS) if (state.doc.rangeHasMark(sel.from, sel.to, schema.marks[m])) marks.push(m);
		state.doc.nodesBetween(sel.from, sel.to, (n) => {
			const l = n.marks.find((mk) => mk.type === schema.marks.link);
			if (l && href === null) href = String(l.attrs.href);
			const c = n.marks.find((mk) => mk.type === schema.marks.textColor);
			if (c && color === null) color = String(c.attrs.color);
		});
	} else if (!atom) {
		const here = state.storedMarks ?? sel.$from.marks();
		for (const m of SIMPLE_MARKS) if (here.some((mk) => mk.type === schema.marks[m])) marks.push(m);
		const c = here.find((mk) => mk.type === schema.marks.textColor);
		if (c) color = String(c.attrs.color);
	}
	const text = refs.filter((r) => TEXT_NODES.has(r.node.type.name));
	if (color === null) {
		const own = common(text.map((r) => String(designOf(r.node).color ?? '')));
		color = own && own !== 'mixed' ? own : null;
	}
	const sizes = text.map((r) => {
		const s = designOf(r.node).textSize;
		return s === 'sm' || s === 'lg' || s === 'xl' ? s : ('md' as const);
	});
	return {
		turn: common(refs.filter((r) => TURN_NODES.has(r.node.type.name)).map((r) => turnOf(r.node)!)),
		marks,
		canMark: textSel || (!atom && sel.$from.parent.inlineContent),
		textSel,
		href,
		align: common(refs.filter((r) => ALIGN_NODES.has(r.node.type.name)).map((r) => alignOf(state, r))),
		size: common(sizes),
		color,
		canColor: textSel || text.length > 0
	};
}
