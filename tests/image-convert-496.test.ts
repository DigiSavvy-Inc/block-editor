// Package port: the app's /api/media route cases are not here (the package has no server).
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	prepareImageForUpload,
	isAvif,
	AVIF_CONVERT_ERROR,
	AVIF_CONVERT_ERROR_NO_JPEG
} from '../src/lib/image-convert';

/** Stubs createImageBitmap + OffscreenCanvas; `encodes` = the types convertToBlob can produce. */
function stubCanvas(encodes: string[], decode: 'ok' | 'throw' = 'ok') {
	const drawn: unknown[] = [];
	vi.stubGlobal('createImageBitmap', async () => {
		if (decode === 'throw') throw new Error('decode failed');
		return { width: 4, height: 3, close() {} };
	});
	vi.stubGlobal(
		'OffscreenCanvas',
		class {
			constructor(
				public width: number,
				public height: number
			) {}
			getContext() {
				return { drawImage: (img: unknown) => drawn.push(img) };
			}
			async convertToBlob(o: { type: string; quality: number }) {
				// Like a browser that can't encode the type: falls back to PNG.
				return new Blob(['x'], { type: encodes.includes(o.type) ? o.type : 'image/png' });
			}
		}
	);
	return drawn;
}

afterEach(() => vi.unstubAllGlobals());

const avif = () => new File(['avif-bytes'], 'photo.avif', { type: 'image/avif' });

describe('prepareImageForUpload (#496)', () => {
	it('returns a non-AVIF file unchanged', async () => {
		const f = new File(['png'], 'a.png', { type: 'image/png' });
		expect(await prepareImageForUpload(f)).toBe(f);
		const w = new File(['webp'], 'a.webp', { type: 'image/webp' });
		expect(await prepareImageForUpload(w)).toBe(w);
	});

	it('detects AVIF by type or by extension when the type is blank', () => {
		expect(isAvif({ type: 'image/avif', name: 'x' })).toBe(true);
		expect(isAvif({ type: '', name: 'x.AVIF' })).toBe(true);
		expect(isAvif({ type: 'image/webp', name: 'x.avif' })).toBe(false);
	});

	it('converts AVIF to a .webp File', async () => {
		const drawn = stubCanvas(['image/webp', 'image/jpeg']);
		const out = await prepareImageForUpload(avif());
		expect(out).toBeInstanceOf(File);
		expect(out.type).toBe('image/webp');
		expect(out.name).toBe('photo.webp');
		expect(drawn).toHaveLength(1);
	});

	it('falls back to JPEG when WebP cannot be encoded', async () => {
		stubCanvas(['image/jpeg']);
		const out = await prepareImageForUpload(avif());
		expect(out.type).toBe('image/jpeg');
		expect(out.name).toBe('photo.jpg');
	});

	it('rejects with the user-facing message when decoding throws', async () => {
		stubCanvas(['image/webp'], 'throw');
		await expect(prepareImageForUpload(avif())).rejects.toThrow(AVIF_CONVERT_ERROR);
	});

	it('rejects when neither WebP nor JPEG can be encoded', async () => {
		stubCanvas([]);
		await expect(prepareImageForUpload(avif())).rejects.toThrow(AVIF_CONVERT_ERROR);
	});

	it('skips the JPEG fallback when asked (logo)', async () => {
		stubCanvas(['image/jpeg']);
		await expect(prepareImageForUpload(avif(), { jpegFallback: false })).rejects.toThrow(AVIF_CONVERT_ERROR_NO_JPEG);
	});
});
