import { describe, it, expect } from 'vitest';
import { renderBlocksEmailHtml, renderPageHtml, headingSpaceAbove, type Block } from '../src/lib/blocks';

// #329: headings get default space above (H1 32 / H2 28 / H3 22) except when they open
// their container or follow a heading / eyebrow; images get 16px below by default.

const t = (text: string) => [{ type: 'text' as const, text }];
const IMG: Block = { id: 'i', type: 'image', src: 'https://x.test/a.png', alt: 'a' };
const h = (level: 1 | 2 | 3, id = `h${level}`): Block => ({ id, type: 'heading', level, text: 'Title', content: t('Title') });
const P: Block = { id: 'p', type: 'paragraph', content: t('Body') };
const EYEBROW: Block = { id: 'e', type: 'eyebrow', content: t('Label') };

/** The heading div's margin in the email output (first heading found). */
const headingMargin = (html: string) => html.match(/font-weight:700;line-height:1\.25;margin:([^;]+);/)?.[1];

describe('headingSpaceAbove', () => {
	it('defaults by level after a non-heading block', () => {
		expect(headingSpaceAbove(h(1), P)).toBe(32);
		expect(headingSpaceAbove(h(2), IMG)).toBe(28);
		expect(headingSpaceAbove(h(3), P)).toBe(22);
	});
	it('is 0 first in a container, after a heading or eyebrow, and for display headings', () => {
		expect(headingSpaceAbove(h(2))).toBe(0);
		expect(headingSpaceAbove(h(2), h(1, 'a'))).toBe(0);
		expect(headingSpaceAbove(h(2), EYEBROW)).toBe(0);
		expect(headingSpaceAbove({ ...h(1), size: 'display' } as Block, P)).toBe(0);
	});
});

describe('email renderer', () => {
	it('heading after an image gets space above; the image gets 16px below', () => {
		const html = renderBlocksEmailHtml([IMG, h(2)]);
		expect(html).toContain('<div style="margin:0 0 16px;"><img src="https://x.test/a.png"');
		expect(headingMargin(html)).toBe('28px 0 14px');
	});
	it('image spaceBelow still replaces the default', () => {
		expect(renderBlocksEmailHtml([{ ...IMG, spaceBelow: 0 } as Block])).toContain('<div style="margin:0 0 0px;"><img');
	});
	it('first heading of the body has no space above', () => {
		expect(headingMargin(renderBlocksEmailHtml([h(1), P]))).toBe('0 0 14px');
	});
	it('first heading in a section or column has no space above', () => {
		const section: Block = { id: 's', type: 'section', bg: '#ffffff', padding: 'md', width: 'full', blocks: [h(2), P] } as Block;
		expect(headingMargin(renderBlocksEmailHtml([P, section]))).toBe('0 0 14px');
		const cols: Block = { id: 'c', type: 'columns', cells: [[h(3), P], [P, h(3, 'x')]] } as Block;
		const html = renderBlocksEmailHtml([cols]);
		const margins = [...html.matchAll(/line-height:1\.25;margin:([^;]+);/g)].map((m) => m[1]);
		expect(margins).toEqual(['0 0 14px', '22px 0 14px']);
	});
	it('heading after a heading or an eyebrow stays tight', () => {
		const html = renderBlocksEmailHtml([P, EYEBROW, h(1), h(2, 'b')]);
		const margins = [...html.matchAll(/line-height:1\.25;margin:([^;]+);/g)].map((m) => m[1]);
		expect(margins).toEqual(['0 0 14px', '0 0 14px']);
	});
});

describe('page renderer', () => {
	it('carries the same rules in its CSS', () => {
		const html = renderPageHtml('T', [IMG, h(2)]);
		expect(html).toContain('h2 { font-size:22px; line-height:1.3; margin:28px 0 12px; }');
		expect(html).toContain(':is(.page, .b-sec, .col) > :is(h1, h2, h3):first-child');
		expect(html).toContain(':is(h1, h2, h3, .b-eyebrow) + :is(h1, h2, h3) { margin-top:0; }');
		expect(html).toContain('.b-img { margin:0 0 16px; }');
	});
});
