import { describe, it, expect } from 'vitest';
import { renderPageHtml, renderBlocksEmailHtml, parseBlocks, type Block } from '../src/lib/blocks';

const blocks: Block[] = [
	{ id: '1', type: 'heading', level: 1, text: 'Hello <world> & "you"' },
	{ id: '2', type: 'text', md: 'Some **bold** text with {{first_name}}' },
	{ id: '3', type: 'image', src: 'https://example.com/pic.png', alt: 'A <pic>' },
	{ id: '4', type: 'button', label: 'Go', href: 'https://example.com', align: 'center' },
	{ id: '5', type: 'divider' },
	{ id: '6', type: 'spacer', size: 'lg' },
	{
		id: '7',
		type: 'columns',
		cells: [
			[{ id: '7a', type: 'text', md: 'left cell' }],
			[{ id: '7b', type: 'text', md: 'right cell' }],
			[{ id: '7c', type: 'button', label: 'Hi', href: 'https://x.co', align: 'left' }]
		]
	}
];

describe('renderPageHtml', () => {
	const html = renderPageHtml('My <Page>', blocks);

	it('escapes title and headings', () => {
		expect(html).toContain('<title>My &lt;Page&gt;</title>');
		expect(html).toContain('<h1>Hello &lt;world&gt; &amp; &quot;you&quot;</h1>');
	});

	it('renders markdown text and keeps merge tags intact', () => {
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('{{first_name}}');
	});

	it('renders image with escaped alt, button, and 3-col grid', () => {
		expect(html).toContain('alt="A &lt;pic&gt;"');
		expect(html).toContain('class="btn" href="https://example.com"');
		expect(html).toContain('cols cols-3');
		expect(html).toContain('left cell');
	});

	it('is a complete responsive document', () => {
		expect(html).toContain('<!doctype html>');
		expect(html).toContain('viewport');
		expect(html).toContain('@media (max-width:600px)');
	});
});

describe('renderBlocksEmailHtml', () => {
	const html = renderBlocksEmailHtml(blocks);

	it('uses table/inline-block layout, never CSS grid', () => {
		expect(html).not.toContain('display:grid');
		expect(html).toContain('display:inline-block');
		expect(html).toContain('role="presentation"'); // button table
	});

	it('escapes content and keeps merge tags', () => {
		expect(html).toContain('Hello &lt;world&gt;');
		expect(html).toContain('{{first_name}}');
	});

	it('sizes 3 columns to fit 600px', () => {
		expect(html).toContain('max-width:188px'); // floor(600/3) - 12
	});
});

describe('URL safety', () => {
	it('drops javascript: URLs in buttons and images', () => {
		const evil: Block[] = [
			{ id: 'a', type: 'button', label: 'x', href: 'javascript:alert(1)', align: 'left' },
			{ id: 'b', type: 'image', src: 'javascript:alert(1)', alt: 'x' }
		];
		const page = renderPageHtml('t', evil);
		const email = renderBlocksEmailHtml(evil);
		expect(page).not.toContain('javascript:');
		expect(email).not.toContain('javascript:');
	});
});

describe('parseBlocks', () => {
	it('parses valid JSON, tolerates junk', () => {
		expect(parseBlocks(JSON.stringify(blocks)).length).toBe(7);
		expect(parseBlocks('not json')).toEqual([]);
		expect(parseBlocks('{"a":1}')).toEqual([]);
		expect(parseBlocks(null)).toEqual([]);
	});
});
