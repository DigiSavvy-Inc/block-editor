import { describe, it, expect } from 'vitest';
import {
	sanitizeBlocks,
	renderBlocksEmailHtml,
	renderBlocksEmailText,
	blocksAreEmpty,
	type Block
} from '../src/lib/blocks';
import { markdownToBlocks, blocksToMarkdown } from '../src/lib/blocks-markdown';
import { docToBlocks, blocksToDoc, type PMNode } from '../src/lib/editor/doc';
import { schema } from '../src/lib/editor/schema';

// #250: the visual editor's model — conversions, sanitiser, renderer.

/** Strip ids (fresh UUIDs on import) so fixtures compare by content. */
function noIds(blocks: Block[]): unknown {
	return JSON.parse(JSON.stringify(blocks, (k, v) => (k === 'id' ? undefined : v)));
}

const rich: Block[] = [
	{ id: 'h1', type: 'heading', level: 1, text: 'Hi {{first_name}}', content: [{ type: 'text', text: 'Hi ' }, { type: 'mergeTag', tag: 'first_name' }] },
	{
		id: 'p1',
		type: 'paragraph',
		content: [
			{ type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] },
			{ type: 'text', text: 'link', marks: [{ type: 'link', href: 'https://example.com/?a=1&b={{email}}' }, { type: 'italic' }] },
			{ type: 'hardBreak' },
			{ type: 'mergeTag', tag: 'company.name|your team', marks: [{ type: 'underline' }] },
			{ type: 'text', text: ' code', marks: [{ type: 'strike' }, { type: 'code' }] }
		],
		visibility: { kind: 'tag', name: 'vip' }
	},
	{ id: 'l1', type: 'list', ordered: true, items: [[{ type: 'text', text: 'one' }], [{ type: 'mergeTag', tag: 'field:Report URL' }]] },
	{ id: 'q1', type: 'quote', content: [{ type: 'text', text: 'quoted' }] },
	{ id: 'c1', type: 'callout', content: [{ type: 'text', text: 'note' }] },
	{ id: 'd1', type: 'divider' },
	{ id: 'i1', type: 'image', src: 'https://cdn.test/a.png', alt: 'A', href: 'https://x.test', width: 300 },
	{ id: 'b1', type: 'button', label: 'Go', href: '{{field:report_url}}', align: 'right' },
	{ id: 's1', type: 'spacer', size: 'lg' },
	{
		id: 'col',
		type: 'columns',
		cells: [
			[{ id: 'cp', type: 'paragraph', content: [{ type: 'text', text: 'left' }] }],
			[{ id: 'cb', type: 'button', label: 'B', href: 'mailto:a@b.co', align: 'center' }]
		]
	}
];

describe('docToBlocks ∘ blocksToDoc', () => {
	it('round-trips every block type, mark and merge tag', () => {
		const doc = blocksToDoc(rich);
		expect(docToBlocks(doc)).toEqual(rich);
	});

	it('produces a document the ProseMirror schema accepts unchanged', () => {
		const doc = blocksToDoc(rich);
		const node = schema.nodeFromJSON(doc);
		node.check();
		expect(node.toJSON()).toEqual(doc);
		expect(blocksToDoc(docToBlocks(node.toJSON() as PMNode))).toEqual(doc);
	});

	it('an empty document is one empty paragraph', () => {
		expect(blocksToDoc([])).toEqual({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: null, visibility: null } }] });
		expect(blocksAreEmpty(docToBlocks(blocksToDoc([])))).toBe(true);
	});

	it('opens a legacy markdown text block as rich blocks', () => {
		const doc = blocksToDoc([{ id: 't', type: 'text', md: '## Hey\n\nSome **b**' }]);
		expect(doc.content!.map((n) => n.type)).toEqual(['heading', 'paragraph']);
		expect(doc.content![0].attrs!.id).toBe('t');
	});
});

describe('markdownToBlocks', () => {
	it('converts headings, marks, lists, quotes, rules and images', () => {
		const md = [
			'# Title',
			'### Small',
			'Hello **bold *both*** and `code` ~~gone~~ <u>under</u>',
			'line two',
			'- a',
			'- b',
			'1. x',
			'> quoted',
			'---',
			'[![Logo](https://cdn.test/l.png)](https://home.test)'
		].join('\n\n');
		expect(noIds(markdownToBlocks(md))).toEqual([
			{ type: 'heading', level: 1, text: 'Title', content: [{ type: 'text', text: 'Title' }] },
			{ type: 'heading', level: 3, text: 'Small', content: [{ type: 'text', text: 'Small' }] },
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'Hello ' },
					{ type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
					{ type: 'text', text: 'both', marks: [{ type: 'bold' }, { type: 'italic' }] },
					{ type: 'text', text: ' and ' },
					{ type: 'text', text: 'code', marks: [{ type: 'code' }] },
					{ type: 'text', text: ' ' },
					{ type: 'text', text: 'gone', marks: [{ type: 'strike' }] },
					{ type: 'text', text: ' ' },
					{ type: 'text', text: 'under', marks: [{ type: 'underline' }] }
				]
			},
			{ type: 'paragraph', content: [{ type: 'text', text: 'line two' }] },
			{ type: 'list', ordered: false, items: [[{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b' }]] },
			{ type: 'list', ordered: true, items: [[{ type: 'text', text: 'x' }]] },
			{ type: 'quote', content: [{ type: 'text', text: 'quoted' }] },
			{ type: 'divider' },
			{ type: 'image', src: 'https://cdn.test/l.png', alt: 'Logo', href: 'https://home.test' }
		]);
	});

	it('keeps single line breaks as hard breaks (breaks: true, like sends)', () => {
		expect(noIds(markdownToBlocks('one\ntwo'))).toEqual([
			{ type: 'paragraph', content: [{ type: 'text', text: 'one' }, { type: 'hardBreak' }, { type: 'text', text: 'two' }] }
		]);
	});

	it('turns raw HTML into plain text, never markup', () => {
		const blocks = markdownToBlocks('<script>alert(1)</script>\n\nHi <img src=x onerror=alert(1)> there');
		const html = renderBlocksEmailHtml(blocks);
		expect(html).not.toContain('<script');
		expect(html).not.toContain('<img');
	});
});

describe('merge tags are preserved exactly', () => {
	const tags = ['first_name', 'name', 'email', 'company', 'field:Report URL', 'company.hours_30d|0', 'company.name|your team', '#if tag:hot', 'else', '/if'];
	it('markdown → blocks → markdown keeps every tag byte-for-byte', () => {
		const md = tags.map((t) => `x {{${t}}} y`).join('\n\n');
		const blocks = markdownToBlocks(md);
		const atoms = blocks.flatMap((b) => (b.type === 'paragraph' ? b.content : [])).filter((n) => n.type === 'mergeTag');
		expect(atoms.map((a) => (a as { tag: string }).tag)).toEqual(tags);
		expect(blocksToMarkdown(blocks)).toBe(md);
	});

	it('keeps tags inside link targets', () => {
		const blocks = markdownToBlocks('[Report]({{field:report_url}}) and [x](https://a.test/?e={{email}})');
		const html = renderBlocksEmailHtml(blocks);
		expect(html).toContain('href="{{field:report_url}}"');
		expect(html).toContain('href="https://a.test/?e={{email}}"');
	});

	it('renders atoms as literal tags for personalize()', () => {
		const html = renderBlocksEmailHtml(rich);
		expect(html).toContain('Hi {{first_name}}');
		expect(html).toContain('{{company.name|your team}}');
		expect(renderBlocksEmailText(rich)).toContain('{{field:Report URL}}');
	});
});

describe('sanitizeBlocks', () => {
	it('drops javascript: links and buttons, keeps the text', () => {
		const out = sanitizeBlocks([
			{ id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', href: 'javascript:alert(1)' }] }] },
			{ id: 'b', type: 'button', label: 'x', href: 'JaVaScRiPt:alert(1)', align: 'left' },
			{ id: 'c', type: 'image', src: 'javascript:alert(1)', alt: '' },
			{ id: 'd', type: 'paragraph', content: [{ type: 'text', text: 'd', marks: [{ type: 'link', href: 'data:text/html,<script>' }] }] }
		]);
		expect(out[0]).toEqual({ id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'click' }] });
		expect(out[1]).toMatchObject({ href: '' });
		expect(out[2]).toMatchObject({ src: '' });
		expect(out[3]).toEqual({ id: 'd', type: 'paragraph', content: [{ type: 'text', text: 'd' }] });
		expect(renderBlocksEmailHtml(out)).not.toMatch(/javascript:|data:/i);
	});

	it('escapes <script> in text and strips unknown types, marks and attributes', () => {
		const out = sanitizeBlocks([
			{ id: 'x', type: 'html', html: '<script>alert(1)</script>' },
			{
				id: 'p',
				type: 'paragraph',
				onclick: 'alert(1)',
				style: 'color:red',
				content: [
					{ type: 'text', text: '<script>alert(1)</script>', marks: [{ type: 'font', attrs: { family: 'Comic' } }, { type: 'bold', style: 'x' }] },
					{ type: 'rawHtml', html: '<b>x</b>' },
					{ type: 'mergeTag', tag: 'not a tag<script>' }
				]
			},
			{ id: 'bad id"><', type: 'divider' }
		]);
		expect(out).toHaveLength(2);
		expect(out[0]).toEqual({
			id: 'p',
			type: 'paragraph',
			content: [
				{ type: 'text', text: '<script>alert(1)</script>', marks: [{ type: 'bold' }] },
				{ type: 'text', text: '{{not a tag<script>}}' }
			]
		});
		expect(out[1].id).toMatch(/^[\w-]+$/);
		const html = renderBlocksEmailHtml(out);
		expect(html).not.toContain('<script');
		expect(html).toContain('&lt;script&gt;');
		expect(html).not.toContain('onclick');
	});

	it('drops the content area and nested columns outside templates', () => {
		const out = sanitizeBlocks(
			[{ id: 'c', type: 'content' }, { id: 'k', type: 'columns', cells: [[{ id: 'n', type: 'columns', cells: [[], []] }], []] }],
			{ allowContent: false }
		);
		expect(out).toEqual([{ id: 'k', type: 'columns', cells: [[], []] }]);
	});
});

describe('email renderer', () => {
	const html = renderBlocksEmailHtml(rich);
	it('is table/inline-style based, never CSS classes for layout', () => {
		expect(html).not.toContain('display:grid');
		expect(html).toContain('role="presentation"');
		expect(html).toMatch(/<p style="font-family:[^"]+;font-size:16px;line-height:1.6;margin:0 0 16px;">/);
		expect(html).toContain('<ol style=');
		expect(html).toContain('<blockquote style=');
		expect(html).toContain('align="right"');
		expect(html).toContain('width="300"');
	});
	it('wraps visibility in conditional markers', () => {
		expect(html).toMatch(/\{\{#if tag:vip\}\}<p[\s\S]*?<\/p>\{\{\/if\}\}/);
		expect(renderBlocksEmailText(rich)).toMatch(/\{\{#if tag:vip\}\}[\s\S]*\{\{\/if\}\}/);
	});
	it('matches the snapshot', () => {
		expect(html).toMatchSnapshot();
	});
});
