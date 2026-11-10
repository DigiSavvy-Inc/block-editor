// Package port: the app's editorial-template case is not here (app-only seed template).
import { describe, it, expect } from 'vitest';
import {
	sanitizeBlocks,
	renderBlocksEmailHtml,
	renderBlocksEmailText,
	renderPageHtml,
	blocksAreEmpty,
	countContentAreas,
	keepFirstContentArea,
	type Block
} from '../src/lib/blocks';
import { blocksToMarkdown, upgradeLegacyBlocks } from '../src/lib/blocks-markdown';
import { blocksToDoc, docToBlocks, convertBlock } from '../src/lib/editor/doc';
import { schema } from '../src/lib/editor/schema';
import { autoTextColor, contrastRatio, normalizeHex, BRAND, BRAND_SWATCHES } from '../src/lib/brand';

// #262: design blocks (section, eyebrow, display heading, milestones, steps, button +
// link, image chip) and the shared brand palette.

const t = (text: string) => [{ type: 'text' as const, text }];

describe('brand palette', () => {
	it('normalises hex and rejects junk', () => {
		expect(normalizeHex('#1A9EC4')).toBe('#1a9ec4');
		expect(normalizeHex('abc')).toBe('#aabbcc');
		for (const bad of ['red', '#12345', '#ggg', 'url(x)', '#1a9ec4;color:red', 42, null]) expect(normalizeHex(bad)).toBe('');
	});
	it('picks black text on teal, white on ink', () => {
		expect(autoTextColor(BRAND.teal)).toBe('#000000');
		expect(autoTextColor(BRAND.ink)).toBe('#ffffff');
		expect(contrastRatio('#ffffff', BRAND.teal)).toBeCloseTo(3.12, 1);
		expect(contrastRatio('#000000', BRAND.teal)).toBeGreaterThan(4.5);
	});
	it('exposes the brand swatches', () => {
		expect(BRAND_SWATCHES.map((s) => [s.label, s.hex])).toEqual([
			['Warm ink', '#15130e'],
			['Deep teal', '#066971'],
			['Teal', '#0ab5c2'],
			['Brand cyan', '#1a9ec4'],
			['Ivory', '#f5f3ed'],
			['Warm surface', '#ece8de'],
			['Cream', '#f3efe6'],
			['Warm gray', '#544e44'],
			['Warm brown', '#6a5e4e'],
			['CTA coral', '#ce423b'],
			['Gold', '#fcb900'],
			['White', '#ffffff']
		]);
		// Swatch hexes are already normalised, so the picker's on-state matches them.
		for (const s of BRAND_SWATCHES) expect(normalizeHex(s.hex)).toBe(s.hex);
		// Auto text stays readable on every guideline background.
		for (const s of BRAND_SWATCHES) expect(contrastRatio(s.hex, autoTextColor(s.hex))).toBeGreaterThanOrEqual(4.5);
		expect(autoTextColor('#15130e')).toBe('#ffffff');
		expect(autoTextColor('#f5f3ed')).toBe('#000000');
	});
});

describe('sanitiser', () => {
	it('keeps a valid section and drops bad hex', () => {
		const [s] = sanitizeBlocks([
			{ id: 's', type: 'section', bg: '#1A9EC4', color: 'javascript:alert(1)', padding: 'xl', width: 'weird', align: 'center', blocks: [{ id: 'p', type: 'paragraph', content: t('Hi') }] }
		]);
		expect(s).toEqual({ id: 's', type: 'section', bg: '#1a9ec4', padding: 'lg', width: 'full', align: 'center', blocks: [{ id: 'p', type: 'paragraph', content: t('Hi') }] });
		const [bad] = sanitizeBlocks([{ id: 'b', type: 'section', bg: 'red;background:url(x)', blocks: [] }]);
		expect(bad).toMatchObject({ type: 'section', bg: '#ffffff' });
		expect(bad).not.toHaveProperty('color');
	});
	it('never nests sections: an inner section (or one in a cell) is flattened to its children', () => {
		const out = sanitizeBlocks([
			{
				id: 'outer',
				type: 'section',
				bg: '#191919',
				blocks: [
					{ id: 'inner', type: 'section', bg: '#ffffff', blocks: [{ id: 'p1', type: 'paragraph', content: t('a') }] },
					{ id: 'cols', type: 'columns', cells: [[{ id: 'cs', type: 'section', bg: '#fff', blocks: [{ id: 'p2', type: 'paragraph', content: t('b') }] }], []] }
				]
			}
		]);
		expect(out).toHaveLength(1);
		const s = out[0] as Extract<Block, { type: 'section' }>;
		expect(s.blocks.map((b) => b.id)).toEqual(['p1', 'cols']);
		expect((s.blocks[1] as Extract<Block, { type: 'columns' }>).cells[0].map((b) => b.id)).toEqual(['p2']);
	});
	it('allows a content area inside a section, never inside a cell', () => {
		const out = sanitizeBlocks([{ id: 's', type: 'section', bg: '#fff', blocks: [{ id: 'c', type: 'content' }, { id: 'k', type: 'columns', cells: [[{ id: 'c2', type: 'content' }], []] }] }]);
		expect(countContentAreas(out)).toBe(1);
		expect(sanitizeBlocks([{ id: 's', type: 'section', bg: '#fff', blocks: [{ id: 'c', type: 'content' }] }], { allowContent: false })).toEqual([
			{ id: 's', type: 'section', bg: '#ffffff', padding: 'lg', width: 'full', blocks: [] }
		]);
	});
	it('keeps only the first content area, sections included', () => {
		const blocks = sanitizeBlocks([
			{ id: 's', type: 'section', bg: '#fff', blocks: [{ id: 'c1', type: 'content' }] },
			{ id: 'c2', type: 'content' }
		]);
		expect(countContentAreas(blocks)).toBe(2);
		expect(countContentAreas(keepFirstContentArea(blocks))).toBe(1);
		expect((keepFirstContentArea(blocks)[0] as Extract<Block, { type: 'section' }>).blocks[0].id).toBe('c1');
	});
	it('eyebrow, display heading, steps, milestones, button link, image chip', () => {
		const out = sanitizeBlocks([
			{ id: 'e', type: 'eyebrow', content: t('Label'), tone: 'accent' },
			{ id: 'e2', type: 'eyebrow', content: t('X'), tone: 'neon' },
			{ id: 'h', type: 'heading', level: 3, size: 'display', content: t('Big') },
			{ id: 'h2', type: 'heading', level: 2, size: 'huge', content: t('Not') },
			{ id: 'l', type: 'list', ordered: true, style: 'steps', items: [t('a')] },
			{ id: 'l2', type: 'list', ordered: false, style: 'steps', items: [t('a')] },
			{ id: 'm', type: 'milestones', items: [{ title: t('Nov 1'), label: t('Kickoff') }, 'junk', { title: [{ type: 'text', text: 'x', marks: [{ type: 'link', href: 'javascript:alert(1)' }] }] }, {}, {}, {}], rule: false },
			{ id: 'm2', type: 'milestones', items: [] },
			{ id: 'b', type: 'button', label: 'Go', href: 'https://a.test', align: 'left', linkLabel: 'or here', linkHref: 'https://b.test' },
			{ id: 'b2', type: 'button', label: 'Go', href: 'https://a.test', align: 'left', linkLabel: 'bad', linkHref: 'javascript:alert(1)' },
			{ id: 'i', type: 'image', src: 'https://x.test/a.png', alt: '', style: 'chip', beside: '  Digi\nSavvy  ' },
			{ id: 'i2', type: 'image', src: 'https://x.test/a.png', alt: '', style: 'round' }
		]);
		const by = Object.fromEntries(out.map((b) => [b.id, b])) as Record<string, any>;
		expect(by.e.tone).toBe('accent');
		expect(by.e2).not.toHaveProperty('tone');
		expect(by.h).toMatchObject({ level: 1, size: 'display' });
		expect(by.h2).not.toHaveProperty('size');
		expect(by.l.style).toBe('steps');
		expect(by.l2).not.toHaveProperty('style');
		expect(by.m.items).toHaveLength(4);
		expect(by.m.rule).toBe(false);
		expect(by.m.items[1]).toEqual({ title: [], label: [] });
		expect(by.m.items[2].title).toEqual([{ type: 'text', text: 'x' }]);
		expect(by.m2.items).toHaveLength(2);
		expect(by.m2.rule).toBe(true);
		expect(by.b).toMatchObject({ linkLabel: 'or here', linkHref: 'https://b.test' });
		expect(by.b2).not.toHaveProperty('linkLabel');
		expect(by.b2).not.toHaveProperty('linkHref');
		expect(by.i).toMatchObject({ style: 'chip', beside: 'Digi Savvy' });
		expect(by.i2).not.toHaveProperty('style');
	});
});

const SECTION: Block = {
	id: 'hero',
	type: 'section',
	bg: '#1a9ec4',
	padding: 'lg',
	width: 'full',
	blocks: [
		{ id: 'e', type: 'eyebrow', content: t('BFCM Readiness Review') },
		{ id: 'h', type: 'heading', level: 1, size: 'display', text: 'Big headline', content: t('Big headline') },
		{ id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'Read ' }, { type: 'text', text: 'this', marks: [{ type: 'link', href: 'https://x.test' }] }] }
	]
};
const MILESTONES: Block = {
	id: 'm',
	type: 'milestones',
	rule: true,
	items: [
		{ title: t('Nov 1'), label: t('Audit') },
		{ title: t('Nov 8'), label: t('Fixes') },
		{ title: t('Nov 15'), label: t('Load test') },
		{ title: t('Nov 28'), label: t('BFCM') }
	]
};
const STEPS: Block = { id: 's', type: 'list', ordered: true, style: 'steps', items: [t('First'), t('Second'), t('Third')] };
const BUTTON_LINK: Block = { id: 'b', type: 'button', label: 'Book a call', href: 'https://example.com/book/', align: 'left', linkLabel: 'or reply', linkHref: 'mailto:hello@example.com' };

describe('email renderer', () => {
	it('renders a section as a bulletproof table (bgcolor + inline style), auto black text on teal', () => {
		const html = renderBlocksEmailHtml([SECTION]);
		expect(html).toContain('bgcolor="#1a9ec4"');
		expect(html).toContain('background-color:#1a9ec4');
		expect(html).toContain('color:#000000');
		expect(html).toContain('class="ds-display" style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:48px');
		expect(html).toContain('<a href="https://x.test" style="color:#000000;text-decoration:underline;">this</a>');
		expect(html).not.toMatch(/display:(grid|flex)/);
		expect(html).toMatchSnapshot();
	});
	it('milestones: inline-block cells with fixed max widths and a thick rule', () => {
		const html = renderBlocksEmailHtml([MILESTONES]);
		expect(html.match(/class="ds-ms"/g)).toHaveLength(4);
		expect(html).toContain('border-top:4px solid #191919');
		expect(html).toMatchSnapshot();
	});
	it('steps: one table row per item, outlined accent circles, hairlines between items only', () => {
		const html = renderBlocksEmailHtml([STEPS]);
		expect(html.match(/<tr>/g)).toHaveLength(3);
		expect(html.match(/border:2px solid #1a9ec4;border-radius:50%/g)).toHaveLength(3);
		expect(html.match(/border-top:1px solid #e3e3e3/g)).toHaveLength(4); // rows 2 and 3, both cells
		expect(html).not.toContain('<ol');
		expect(html).toMatchSnapshot();
	});
	it('button + text link: two inline-blocks that stack when narrow', () => {
		const html = renderBlocksEmailHtml([BUTTON_LINK]);
		expect(html).toContain('class="ds-cta"');
		expect(html).toContain('class="ds-cta-link"');
		expect(html).toContain('href="mailto:hello@example.com"');
		expect(html).toMatchSnapshot();
	});
	it('a button in a section takes the section colours', () => {
		const html = renderBlocksEmailHtml([{ ...SECTION, blocks: [{ id: 'b', type: 'button', label: 'Go', href: 'https://a.test', align: 'left' }] } as Block]);
		expect(html).toContain('background:#000000;border-radius:8px');
		expect(html).toContain('color:#1a9ec4;text-decoration:none');
	});
	it('image chip: white rounded padded box', () => {
		const html = renderBlocksEmailHtml([{ id: 'i', type: 'image', src: 'https://x.test/logo.png', alt: 'Logo', width: 48, style: 'chip', beside: 'DigiSavvy' }]);
		expect(html).toContain('bgcolor="#ffffff" style="background-color:#ffffff;border-radius:12px;padding:12px 16px;"');
		expect(html).toContain('width="48"');
		expect(html).toContain('>DigiSavvy</td>');
	});
	it('button <a> carries a non-zero line-height (standalone and with a text link)', () => {
		for (const b of [BUTTON_LINK, { ...BUTTON_LINK, linkLabel: undefined, linkHref: undefined } as Block]) {
			const html = renderBlocksEmailHtml([b]);
			const a = html.match(/<a href="https:\/\/example\.com\/book[^"]*" style="([^"]*)"/)![1];
			const lh = a.match(/line-height:([^;]+)/)?.[1];
			expect(lh).toBeTruthy();
			expect(parseFloat(lh!)).toBeGreaterThan(0);
		}
	});
	it('text inside font-size:0;line-height:0 wrappers resets both', () => {
		for (const block of [BUTTON_LINK, MILESTONES]) {
			const html = renderBlocksEmailHtml([block]);
			const start = html.indexOf('font-size:0;line-height:0;');
			expect(start).toBeGreaterThan(-1);
			// Every element inside the wrapper that holds text directly declares both.
			const re = /<(a|div|td|span)\b[^>]*style="([^"]*)"[^>]*>([^<]+)</g;
			let m: RegExpExecArray | null;
			let n = 0;
			while ((m = re.exec(html.slice(start)))) {
				if (!m[3].trim()) continue;
				n++;
				expect(m[2]).toMatch(/font-size:(?!0[;"])\d/);
				expect(m[2]).toMatch(/line-height:(?!0[;"])\d/);
			}
			expect(n).toBeGreaterThan(0);
		}
	});
	it('a centred section centres the image + wordmark table with auto margins', () => {
		const header: Block = {
			id: 'hdr',
			type: 'section',
			bg: '#000000',
			padding: 'md',
			width: 'full',
			align: 'center',
			blocks: [{ id: 'logo', type: 'image', src: 'https://x.test/logo.png', alt: 'Logo', width: 48, beside: 'DigiSavvy' }]
		};
		const html = renderBlocksEmailHtml([header]);
		expect(html).toMatch(/<table [^>]*width="100%" bgcolor=/);
		expect(html).toMatch(/<table [^>]*align="center" style="margin:0 auto 16px;"><tr><td valign="middle">/);
		expect(html).toContain('>DigiSavvy</td>');
		// Not centred → no auto margins.
		const left = renderBlocksEmailHtml([{ ...header, align: undefined } as Block]);
		expect(left).toContain('style="margin:0 0 16px;"><tr><td valign="middle">');
		expect(left).not.toContain('margin:0 auto 16px');
	});
	it('a centred section centres a plain image (no beside) with auto margins on the img', () => {
		const sec: Block = {
			id: 'hdr',
			type: 'section',
			bg: '#000000',
			padding: 'md',
			width: 'full',
			align: 'center',
			blocks: [{ id: 'logo', type: 'image', src: 'https://x.test/logo.png', alt: 'Logo', width: 180 }]
		};
		const html = renderBlocksEmailHtml([sec]);
		expect(html).toMatch(/<td [^>]*align="center"[^>]*text-align:center;/);
		expect(html).toContain('<img src="https://x.test/logo.png" alt="Logo" width="180" style="display:block;margin:0 auto;width:100%;max-width:180px;');
		const left = renderBlocksEmailHtml([{ ...sec, align: undefined } as Block]);
		expect(left).toContain('style="display:block;width:100%;max-width:180px;');
	});
	it('old blocks outside a section render exactly as before', () => {
		const old: Block[] = [
			{ id: 'h', type: 'heading', level: 2, text: 'Hi', content: t('Hi') },
			{ id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', href: 'https://x.test' }] }] },
			{ id: 'l', type: 'list', ordered: true, items: [t('a')] },
			{ id: 'b', type: 'button', label: 'Go', href: 'https://a.test', align: 'center' },
			{ id: 'i', type: 'image', src: 'https://x.test/a.png', alt: 'a' }
		];
		expect(renderBlocksEmailHtml(old)).toBe(
			[
				`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;line-height:1.25;margin:0 0 14px;">Hi</div>`,
				`<p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;margin:0 0 16px;"><a href="https://x.test" style="color:#2563eb;text-decoration:underline;">x</a></p>`,
				`<ol style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;margin:0 0 16px;padding-left:22px;"><li style="margin:0 0 8px;">a</li></ol>`,
				`<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:8px auto 18px;"><tr><td style="background:#2563eb;border-radius:8px;font-size:16px;line-height:20px;"><a href="https://a.test" style="display:inline-block;padding:11px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;">Go</a></td></tr></table>`,
				// #329: an image now gets a paragraph's 16px below by default.
				`<div style="margin:0 0 16px;"><img src="https://x.test/a.png" alt="a" width="600" style="display:block;width:100%;max-width:600px;height:auto;border-radius:6px;"></div>`
			].join('\n')
		);
	});
	it('plain text covers the new blocks', () => {
		const text = renderBlocksEmailText([SECTION, MILESTONES, STEPS, BUTTON_LINK]);
		expect(text).toContain('BFCM Readiness Review');
		expect(text).toContain('Nov 1 — Audit');
		expect(text).toContain('1. First');
		expect(text).toContain('or reply: mailto:hello@example.com');
	});
});

describe('page renderer + markdown export', () => {
	it('renders sections and design blocks for hosted pages', () => {
		const html = renderPageHtml('T', [SECTION, MILESTONES, STEPS, BUTTON_LINK]);
		expect(html).toContain('<section class="b-sec full" style="background:#1a9ec4;color:#000000;');
		expect(html).toContain('<h1 class="b-display">Big headline</h1>');
		expect(html).toContain('class="b-eyebrow"');
		expect(html).toContain('class="b-ms rule" style="--n:4"');
		expect(html).toContain('<ol class="b-steps">');
		expect(html).toContain('<a class="b-link" href="mailto:hello@example.com">or reply</a>');
	});
	it('exports markdown for body_md', () => {
		const md = blocksToMarkdown([SECTION, MILESTONES, STEPS, BUTTON_LINK]);
		expect(md).toContain('# Big headline');
		expect(md).toContain('- **Nov 1** Audit');
		expect(md).toContain('[Book a call](https://example.com/book/) · [or reply](mailto:hello@example.com)');
	});
	it('empty checks look inside sections', () => {
		expect(blocksAreEmpty([{ id: 's', type: 'section', bg: '#fff', padding: 'lg', width: 'full', blocks: [{ id: 'p', type: 'paragraph', content: [] }] }])).toBe(true);
		expect(blocksAreEmpty([SECTION])).toBe(false);
	});
	it('upgrades legacy markdown inside sections', () => {
		const [s] = upgradeLegacyBlocks([{ id: 's', type: 'section', bg: '#fff', padding: 'lg', width: 'full', blocks: [{ id: 't', type: 'text', md: '## Hi' }] }]);
		expect((s as Extract<Block, { type: 'section' }>).blocks[0]).toMatchObject({ type: 'heading', level: 2 });
	});
});

describe('editor document', () => {
	it('round-trips every design block through ProseMirror JSON and fits the schema', () => {
		const blocks = sanitizeBlocks([
			SECTION,
			MILESTONES,
			STEPS,
			BUTTON_LINK,
			{ id: 'i', type: 'image', src: 'https://x.test/a.png', alt: '', style: 'chip', beside: 'Wordmark' },
			{ id: 'e', type: 'eyebrow', content: t('Hi'), tone: 'accent' },
			{ id: 'sec2', type: 'section', bg: '#ffffff', color: '#333333', padding: 'sm', width: 'inset', blocks: [{ id: 'c', type: 'content' }, { id: 'k', type: 'columns', cells: [[{ id: 'p2', type: 'paragraph', content: t('a') }], [{ id: 'p3', type: 'paragraph', content: t('b') }]] }] }
		]);
		const doc = blocksToDoc(blocks);
		expect(() => schema.nodeFromJSON(doc).check()).not.toThrow();
		expect(docToBlocks(doc)).toEqual(blocks);
	});
	it('the schema refuses a section inside a section', () => {
		const inner = { type: 'section', attrs: { bg: '#fff' }, content: [{ type: 'paragraph' }] };
		expect(() => schema.nodeFromJSON({ type: 'doc', content: [{ type: 'section', attrs: { bg: '#000' }, content: [inner] }] }).check()).toThrow();
	});
	it('turn into display / eyebrow / steps keeps the text', () => {
		const p: Block = { id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] };
		expect(convertBlock(p, 'display')).toMatchObject({ type: 'heading', level: 1, size: 'display' });
		expect(convertBlock(p, 'eyebrow')).toMatchObject({ type: 'eyebrow' });
		expect(convertBlock(p, 'steps')).toMatchObject({ type: 'list', ordered: true, style: 'steps', items: [t('a'), t('b')] });
	});
});
