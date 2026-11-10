import { describe, it, expect } from 'vitest';
import { sanitizeBlocks, renderBlocksEmailHtml, renderPageHtml, type Block } from '../src/lib/blocks';
import { docToBlocks, blocksToDoc } from '../src/lib/editor/doc';
import { cleanFocal, cleanRatio, cropFetchUrl, cropOutputSize, cropRect, cropSource } from '../src/lib/image-crop';

// #497: aspect-ratio presets on image blocks (crop baked into a new file).

describe('cropRect', () => {
	it('crops a landscape source to 1:1, centred', () => {
		expect(cropRect(1200, 800, '1:1')).toEqual({ x: 200, y: 0, w: 800, h: 800 });
	});
	it('crops a portrait source to 16:9, centred', () => {
		expect(cropRect(900, 1600, '16:9')).toEqual({ x: 0, y: 547, w: 900, h: 506 });
	});
	it('keeps the whole image when it already has the ratio', () => {
		expect(cropRect(1600, 900, '16:9')).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
	});
	it('handles 9:16, 4:3 and 3:2', () => {
		expect(cropRect(1920, 1080, '9:16')).toEqual({ x: 656, y: 0, w: 608, h: 1080 });
		expect(cropRect(1000, 1000, '4:3')).toEqual({ x: 0, y: 125, w: 1000, h: 750 });
		expect(cropRect(1000, 1000, '3:2')).toEqual({ x: 0, y: 167, w: 1000, h: 667 });
	});
	it('anchors at the focal point and stays inside the source', () => {
		expect(cropRect(1200, 800, '1:1', 'tl')).toEqual({ x: 0, y: 0, w: 800, h: 800 });
		expect(cropRect(1200, 800, '1:1', 'mr')).toEqual({ x: 400, y: 0, w: 800, h: 800 });
		expect(cropRect(800, 1200, '1:1', 'bc')).toEqual({ x: 0, y: 400, w: 800, h: 800 });
		// A vertical anchor on a horizontal-only crop has nothing to move.
		expect(cropRect(1200, 800, '1:1', 'bl')).toEqual({ x: 0, y: 0, w: 800, h: 800 });
		// Junk focal = centre.
		expect(cropRect(1200, 800, '1:1', 'zz' as never)).toEqual({ x: 200, y: 0, w: 800, h: 800 });
		for (const f of ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'] as const) {
			const r = cropRect(333, 777, '16:9', f);
			expect(r.x).toBeGreaterThanOrEqual(0);
			expect(r.y).toBeGreaterThanOrEqual(0);
			expect(r.x + r.w).toBeLessThanOrEqual(333);
			expect(r.y + r.h).toBeLessThanOrEqual(777);
		}
	});
	it('never returns an empty rect for tiny sources', () => {
		const r = cropRect(1, 1, '16:9');
		expect(r.w).toBeGreaterThanOrEqual(1);
		expect(r.h).toBeGreaterThanOrEqual(1);
	});
});

describe('cropOutputSize', () => {
	it('caps the long edge at 1600 and never upscales', () => {
		expect(cropOutputSize({ w: 3200, h: 1800 })).toEqual({ w: 1600, h: 900 });
		expect(cropOutputSize({ w: 1080, h: 1920 })).toEqual({ w: 900, h: 1600 });
		expect(cropOutputSize({ w: 400, h: 300 })).toEqual({ w: 400, h: 300 });
	});
});

describe('vocabulary', () => {
	it('accepts only the presets and the eight off-centre anchors', () => {
		expect(cleanRatio('16:9')).toBe('16:9');
		expect(cleanRatio('2:1')).toBeUndefined();
		expect(cleanFocal('tl')).toBe('tl');
		expect(cleanFocal('mc')).toBeUndefined();
		expect(cleanFocal('xx')).toBeUndefined();
	});
	it('re-crops from origSrc, not from a previous crop', () => {
		expect(cropSource({ src: 'https://a/crop1.webp', origSrc: 'https://a/orig.jpg' })).toBe('https://a/orig.jpg');
		expect(cropSource({ src: 'https://a/orig.jpg', origSrc: null })).toBe('https://a/orig.jpg');
		// Switching ratio twice: each crop stores the same origSrc, so the next source is unchanged.
		let attrs: Record<string, unknown> = { src: 'https://a/orig.jpg' };
		const first = cropSource(attrs);
		attrs = { src: 'https://a/crop-1x1.webp', origSrc: first, ratio: '1:1' };
		const second = cropSource(attrs);
		attrs = { src: 'https://a/crop-16x9.webp', origSrc: second, ratio: '16:9' };
		expect(cropSource(attrs)).toBe('https://a/orig.jpg');
	});
});

describe('cropFetchUrl', () => {
	const here = 'http://localhost:5173';
	it('fetches the app\'s own media same-origin, whatever host the URL names', () => {
		const key = '0f8fad5b-d9cb-469f-a165-70867728950e.png';
		expect(cropFetchUrl(`https://media.example.com/img/${key}`, here)).toBe(`/img/${key}`);
		expect(cropFetchUrl(`https://x.workers.dev/img/${key.replace('.png', '.webp')}?v=1`, here)).toBe(
			`/img/${key.replace('.png', '.webp')}`
		);
	});
	it('fetches a branding logo same-origin', () => {
		expect(cropFetchUrl('https://media.example.com/img/branding/logo-dark.png', here)).toBe('/img/branding/logo-dark.png');
	});
	it('leaves truly external images and non-media paths alone', () => {
		expect(cropFetchUrl('https://example.com/photo.jpg', here)).toBe('https://example.com/photo.jpg');
		expect(cropFetchUrl('https://example.com/img/not-a-key.png', here)).toBe('https://example.com/img/not-a-key.png');
	});
	it('leaves relative and junk strings unchanged', () => {
		expect(cropFetchUrl('/img/whatever.png', here)).toBe('/img/whatever.png');
		expect(cropFetchUrl('not a url', here)).toBe('not a url');
		expect(cropFetchUrl('', here)).toBe('');
	});
});

describe('image block schema', () => {
	const img = (extra: Record<string, unknown>) =>
		sanitizeBlocks([{ id: 'i', type: 'image', src: 'https://x.test/crop.webp', alt: 'A', ...extra }])[0] as Extract<Block, { type: 'image' }>;

	it('keeps ratio, origSrc and an off-centre focal', () => {
		const b = img({ ratio: '4:3', origSrc: 'https://x.test/orig.jpg', focal: 'tr' });
		expect(b).toMatchObject({ ratio: '4:3', origSrc: 'https://x.test/orig.jpg', focal: 'tr' });
	});
	it('drops a bad ratio, a bad origSrc, a centre focal, or a ratio without its original', () => {
		expect(img({ ratio: '5:4', origSrc: 'https://x.test/o.jpg' })).not.toHaveProperty('ratio');
		const bad = img({ ratio: '1:1', origSrc: 'javascript:alert(1)' });
		expect(bad).not.toHaveProperty('ratio');
		expect(bad).not.toHaveProperty('origSrc');
		expect(img({ ratio: '1:1', origSrc: 'https://x.test/a"b.jpg' })).not.toHaveProperty('origSrc');
		expect(img({ ratio: '1:1', origSrc: 'https://x.test/o.jpg', focal: 'mc' })).not.toHaveProperty('focal');
		expect(img({ ratio: '1:1' })).not.toHaveProperty('ratio');
	});
	it('round-trips through the editor document', () => {
		const blocks = sanitizeBlocks([{ id: 'i', type: 'image', src: 'https://x.test/c.webp', alt: 'A', ratio: '1:1', origSrc: 'https://x.test/o.jpg', focal: 'bl' }]);
		expect(docToBlocks(blocksToDoc(blocks))).toEqual(blocks);
		const plain = sanitizeBlocks([{ id: 'j', type: 'image', src: 'https://x.test/o.jpg', alt: 'A' }]);
		expect(docToBlocks(blocksToDoc(plain))).toEqual(plain);
	});
	it('renderers use src only (output identical with or without the crop fields)', () => {
		const plain: Block[] = [{ id: 'i', type: 'image', src: 'https://x.test/c.webp', alt: 'A', widthPct: 50 }];
		const cropped: Block[] = [{ ...(plain[0] as Extract<Block, { type: 'image' }>), ratio: '16:9', origSrc: 'https://x.test/o.jpg', focal: 'tl' }];
		expect(renderBlocksEmailHtml(cropped)).toBe(renderBlocksEmailHtml(plain));
		expect(renderPageHtml('T', cropped)).toBe(renderPageHtml('T', plain));
		expect(renderBlocksEmailHtml(cropped)).not.toContain('o.jpg');
	});
});
