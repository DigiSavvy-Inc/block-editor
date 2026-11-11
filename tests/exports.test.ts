// The public entry points. `./blocks` (src/lib/data.ts) must stay importable without a
// DOM or Svelte: it is what a server or a Cloudflare Worker imports.
import { describe, expect, it } from 'vitest';
import * as data from '../src/lib/data';

describe('@digisavvy/block-editor/blocks', () => {
	it('exports the AVIF conversion helpers (0.2.0)', () => {
		expect(typeof data.convertFileInput).toBe('function');
		expect(typeof data.prepareImageForUpload).toBe('function');
		expect(data.AVIF_CONVERT_ERROR).toMatch(/AVIF/);
		expect(data.AVIF_CONVERT_ERROR_NO_JPEG).toMatch(/AVIF/);
		expect(data.isAvif({ type: 'image/avif', name: 'a.bin' })).toBe(true);
		expect(data.isAvif({ type: '', name: 'photo.AVIF' })).toBe(true);
		expect(data.isAvif({ type: 'image/png', name: 'a.avif' })).toBe(false);
	});

	it('passes non-AVIF files through untouched (no browser APIs needed)', async () => {
		const f = new File(['x'], 'a.png', { type: 'image/png' });
		expect(await data.prepareImageForUpload(f)).toBe(f);
	});

	it('still exports the palette and colour helpers', () => {
		expect(data.BRAND_SWATCHES.length).toBeGreaterThan(0);
		expect(data.normalizeHex('ABC')).toBe('#aabbcc');
		expect(data.autoTextColor('#000000')).toBe('#ffffff');
	});
});
