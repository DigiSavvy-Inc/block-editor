// Package port: the app's HelpPanel.svelte assertions are not here (app-only file).
// #476: select text and paste a link to link it (URLs, bare domains, emails, merge tags),
// and Cmd/Ctrl+K left free for the site-wide search (#477).
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { history, undo } from 'prosemirror-history';
import type { Block } from '../src/lib/blocks';
import { blocksToDoc } from '../src/lib/editor/doc';
import { schema } from '../src/lib/editor/schema';
import { linkRangeAt } from '../src/lib/editor/link-range';
import { pastedHref, pasteLinkTr } from '../src/lib/editor/paste-link';
import blockEditor from '../src/lib/components/BlockEditor.svelte?raw';
import formatToolbar from '../src/lib/components/FormatToolbar.svelte?raw';

describe('pastedHref', () => {
	it('keeps full URLs, www and mailto (whitespace trimmed)', () => {
		expect(pastedHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
		expect(pastedHref('  http://example.com \n')).toBe('http://example.com');
		expect(pastedHref('www.example.com/x')).toBe('https://www.example.com/x');
		expect(pastedHref('mailto:hi@example.com')).toBe('mailto:hi@example.com');
	});

	it('turns bare domains into https links', () => {
		expect(pastedHref('example.com')).toBe('https://example.com');
		expect(pastedHref('digisavvy.com/talk')).toBe('https://digisavvy.com/talk');
		expect(pastedHref('example.com/path?x=1')).toBe('https://example.com/path?x=1');
		expect(pastedHref('sub.example.co.uk/a')).toBe('https://sub.example.co.uk/a');
	});

	it('turns an email address into mailto', () => {
		expect(pastedHref('name@example.com')).toBe('mailto:name@example.com');
		expect(pastedHref('first.last+tag@mail.example.co.uk')).toBe('mailto:first.last+tag@mail.example.co.uk');
	});

	it('accepts a single merge tag the link box accepts', () => {
		expect(pastedHref('{{field:url}}')).toBe('{{field:url}}');
		expect(pastedHref('{{field:booking_link}}')).toBe('{{field:booking_link}}');
		expect(pastedHref('{{#if tag:hot}}')).toBeNull();
		expect(pastedHref('{{field:url}} more')).toBeNull();
		expect(pastedHref('{{a}}{{b}}')).toBeNull();
	});

	it('leaves numbers, versions, file names and prose as text', () => {
		for (const t of ['1.5', 'v2.0', 'file.txt.', 'file.txt', 'logo.png', 'photo.jpg', 'report.pdf', 'data.csv', 'README.md', '10.0.0.1', 'hello world', 'example.com is great', 'a@b', '@handle', 'user@example', 'example', '', '.com', 'example.c']) {
			expect(pastedHref(t), t).toBeNull();
		}
	});
});

const blocks: Block[] = [
	{
		id: 'p',
		type: 'paragraph',
		content: [
			{ type: 'text', text: 'Go ' },
			{ type: 'text', text: 'Example', marks: [{ type: 'link', href: 'https://old.example/' }] },
			{ type: 'text', text: ' talk now' }
		]
	} as Block
];

// "Go " = 1..4, "Example" = 4..11, " talk now" = 11..20.
function stateWith(from: number, to: number) {
	const doc = schema.nodeFromJSON(blocksToDoc(blocks));
	const state = EditorState.create({ doc, plugins: [history()] });
	return state.apply(state.tr.setSelection(TextSelection.create(doc, from, to)));
}

describe('pasteLinkTr', () => {
	it('links the selected text to a bare domain', () => {
		const s = stateWith(12, 16); // "talk"
		const tr = pasteLinkTr(s, 'digisavvy.com/talk');
		expect(tr).not.toBeNull();
		const next = s.apply(tr!);
		expect(next.doc.textContent).toBe(s.doc.textContent);
		expect(linkRangeAt(next.doc, 14)).toEqual({ from: 12, to: 16, href: 'https://digisavvy.com/talk' });
	});

	it('replaces an existing link href without stacking marks, in one undo step', () => {
		const s = stateWith(4, 11);
		const next = s.apply(pasteLinkTr(s, 'name@example.com')!);
		let links = 0;
		next.doc.nodesBetween(4, 11, (n) => {
			if (n.isText) links = Math.max(links, n.marks.filter((m) => m.type === schema.marks.link).length);
		});
		expect(links).toBe(1);
		expect(linkRangeAt(next.doc, 7)).toEqual({ from: 4, to: 11, href: 'mailto:name@example.com' });
		const back: EditorState[] = [];
		undo(next, (t) => back.push(next.apply(t)));
		expect(linkRangeAt(back[0].doc, 7)?.href).toBe('https://old.example/');
	});

	it('does nothing without a selection or for plain text', () => {
		expect(pasteLinkTr(stateWith(14, 14), 'https://example.com')).toBeNull();
		expect(pasteLinkTr(stateWith(12, 16), 'v2.0')).toBeNull();
		expect(pasteLinkTr(stateWith(12, 16), 'hello there')).toBeNull();
	});
});

describe('Cmd/Ctrl+K is free (#477)', () => {
	it('has no K binding in the editor and no shortcut in the toolbar', () => {
		expect(blockEditor).not.toMatch(/key\.toLowerCase\(\) === 'k'/);
		expect(blockEditor).not.toMatch(/e\.key === 'k'/);
		expect(formatToolbar).not.toContain('Cmd/Ctrl+K');
	});

	it('mentions the paste trick in the hint row and help', () => {
		expect(blockEditor).toContain('select text and paste a link to link it');
	});
});
