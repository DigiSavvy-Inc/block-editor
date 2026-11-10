// #473: the link preview popover. Finds the whole `link` mark around a caret and
// removes it. Only prosemirror-state/model (no view), so it runs in the test pool.
import type { Node as PMNodeT, Mark } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { schema } from './schema.js';

export type LinkRange = { from: number; to: number; href: string };

/** The link around `pos`: the run of siblings carrying the same link mark (same href).
 *  At a boundary the character before the caret wins, then the one after it, so the
 *  start and the end of a link both count as inside it. Null when neither is linked. */
export function linkRangeAt(doc: PMNodeT, pos: number): LinkRange | null {
	const $pos = doc.resolve(pos);
	const parent = $pos.parent;
	if (!parent.inlineContent) return null;
	const offset = $pos.parentOffset;
	const start = $pos.start();
	// Child index + start offset of every inline child.
	const starts: number[] = [];
	let acc = 0;
	parent.forEach((child) => {
		starts.push(acc);
		acc += child.nodeSize;
	});
	const linkOf = (i: number): Mark | null => (i >= 0 && i < parent.childCount ? (schema.marks.link.isInSet(parent.child(i).marks) ?? null) : null);
	// The child the caret is inside (or right after), and the one right after it.
	let before = -1;
	let after = -1;
	for (let i = 0; i < parent.childCount; i++) {
		const s = starts[i];
		const e = s + parent.child(i).nodeSize;
		if (s < offset && offset < e) before = after = i;
		else if (e === offset) before = i;
		else if (s === offset) after = i;
	}
	const index = linkOf(before) ? before : linkOf(after) ? after : -1;
	if (index < 0) return null;
	const mark = linkOf(index)!;
	let first = index;
	let last = index;
	while (linkOf(first - 1)?.eq(mark)) first--;
	while (linkOf(last + 1)?.eq(mark)) last++;
	return { from: start + starts[first], to: start + starts[last] + parent.child(last).nodeSize, href: String(mark.attrs.href) };
}

/** The link the popover shows: only for an empty text selection inside a link. */
export function linkAtSelection(state: EditorState): LinkRange | null {
	const sel = state.selection;
	if (!sel.empty || !(sel instanceof TextSelection) || !sel.$from.parent.isTextblock) return null;
	return linkRangeAt(state.doc, sel.from);
}

/** Remove the link mark from the whole range: one transaction, the selection untouched. */
export function unlinkTr(state: EditorState, range: { from: number; to: number }): Transaction {
	return state.tr.removeMark(range.from, range.to, schema.marks.link);
}

/** The href as the popover prints it: whole when short, else cut with an ellipsis. */
export function shortHref(href: string, max = 45): string {
	return href.length <= max ? href : `${href.slice(0, max - 1)}…`;
}

/** A merge-tag href has no fixed URL, so "Open link" is off for it. */
export const hrefHasMergeTag = (href: string) => href.includes('{{');
