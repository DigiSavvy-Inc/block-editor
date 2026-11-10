// #473: the link preview popover — the link range around a caret, unlink of the whole
// range, and the caret-in-link state behind `ui.linkAt`.
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { history, undo } from 'prosemirror-history';
import type { Block } from '../src/lib/blocks';
import { blocksToDoc } from '../src/lib/editor/doc';
import { schema } from '../src/lib/editor/schema';
import { hrefHasMergeTag, linkAtSelection, linkRangeAt, shortHref, unlinkTr } from '../src/lib/editor/link-range';

const link = (href: string) => ({ type: 'link', href });

/** One paragraph: "Go " + [Example](a) + [ docs](b) + " now" + [{{field:url}}](tag). */
const blocks: Block[] = [
	{
		id: 'p',
		type: 'paragraph',
		content: [
			{ type: 'text', text: 'Go ' },
			{ type: 'text', text: 'Example', marks: [link('https://example.com/a')] },
			{ type: 'text', text: ' docs', marks: [link('https://example.com/b'), { type: 'bold' }] },
			{ type: 'text', text: ' now ' },
			{ type: 'text', text: 'Mine', marks: [link('{{field:url}}')] }
		]
	} as Block
];

function stateAt(pos: number | null = null) {
	const doc = schema.nodeFromJSON(blocksToDoc(blocks));
	const state = EditorState.create({ doc, plugins: [history()] });
	return pos === null ? state : state.apply(state.tr.setSelection(TextSelection.create(doc, pos)));
}

// Paragraph content starts at 1: "Go " = 1..4, "Example" = 4..11, " docs" = 11..16,
// " now " = 16..21, "Mine" = 21..25.
const A = { from: 4, to: 11, href: 'https://example.com/a' };
const B = { from: 11, to: 16, href: 'https://example.com/b' };
const TAG = { from: 21, to: 25, href: '{{field:url}}' };

describe('linkRangeAt', () => {
	const doc = stateAt().doc;

	it('finds the whole link from its start, middle and end', () => {
		expect(linkRangeAt(doc, 4)).toEqual(A);
		expect(linkRangeAt(doc, 7)).toEqual(A);
		expect(linkRangeAt(doc, 10)).toEqual(A);
		expect(linkRangeAt(doc, 25)).toEqual(TAG);
	});

	it('keeps adjacent links with different hrefs apart', () => {
		// At the boundary the link before the caret wins; just inside the next one it is that one.
		expect(linkRangeAt(doc, 11)).toEqual(A);
		expect(linkRangeAt(doc, 12)).toEqual(B);
		expect(linkRangeAt(doc, 16)).toEqual(B);
	});

	it('is null outside any link', () => {
		expect(linkRangeAt(doc, 1)).toBeNull();
		expect(linkRangeAt(doc, 2)).toBeNull();
		expect(linkRangeAt(doc, 18)).toBeNull();
	});

	it('spans text nodes split by other marks when the link is the same', () => {
		const split = schema.nodeFromJSON(
			blocksToDoc([
				{
					id: 'q',
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'ab', marks: [link('https://x.test/')] },
						{ type: 'text', text: 'cd', marks: [link('https://x.test/'), { type: 'italic' }] },
						{ type: 'text', text: 'ef' }
					]
				} as Block
			])
		);
		expect(linkRangeAt(split, 2)).toEqual({ from: 1, to: 5, href: 'https://x.test/' });
		expect(linkRangeAt(split, 6)).toBeNull();
	});
});

describe('linkAtSelection (ui.linkAt)', () => {
	it('is set when an empty caret is inside a link and null outside', () => {
		expect(linkAtSelection(stateAt(7))).toEqual(A);
		expect(linkAtSelection(stateAt(13))).toEqual(B);
		expect(linkAtSelection(stateAt(2))).toBeNull();
		expect(linkAtSelection(stateAt(19))).toBeNull();
	});

	it('is null for a non-empty selection (the bubble rules apply then)', () => {
		const s = stateAt();
		const sel = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 5, 8)));
		expect(linkAtSelection(sel)).toBeNull();
	});

	it('returns a merge-tag href as-is', () => {
		const at = linkAtSelection(stateAt(23));
		expect(at?.href).toBe('{{field:url}}');
		expect(hrefHasMergeTag(at!.href)).toBe(true);
		expect(hrefHasMergeTag('mailto:hi@example.com')).toBe(false);
		expect(shortHref(at!.href)).toBe('{{field:url}}');
	});
});

describe('unlinkTr', () => {
	it('removes the link from the whole range in one undo step and keeps the caret', () => {
		const s = stateAt(7);
		const tr = unlinkTr(s, A);
		expect(tr.steps.length).toBe(1);
		const next = s.apply(tr);
		expect(next.selection.from).toBe(7);
		expect(next.doc.rangeHasMark(A.from, A.to, schema.marks.link)).toBe(false);
		// The neighbouring link is untouched.
		expect(linkRangeAt(next.doc, 13)).toEqual(B);
		const back: EditorState[] = [];
		undo(next, (t) => back.push(next.apply(t)));
		expect(linkRangeAt(back[0].doc, 7)).toEqual(A);
	});
});

describe('shortHref', () => {
	it('truncates long URLs at 45 characters with an ellipsis', () => {
		const long = 'https://example.com/a/very/long/path/that/keeps/going?utm_source=x';
		const out = shortHref(long);
		expect(out.length).toBe(45);
		expect(out.endsWith('…')).toBe(true);
		expect(shortHref('https://example.com')).toBe('https://example.com');
	});
});
