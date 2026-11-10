// Browser-side AVIF conversion (#496). Email clients can't show AVIF, so an AVIF file
// never reaches storage: it is decoded with createImageBitmap and re-encoded on a
// canvas as WebP (alpha kept), else JPEG. Anything else is returned untouched.

export const AVIF_CONVERT_ERROR = "This browser can't convert AVIF; please upload PNG, JPG or WebP.";
export const AVIF_CONVERT_ERROR_NO_JPEG = "This browser can't convert AVIF; please upload PNG or WebP.";

const QUALITY = 0.9;

type Canvas2D = {
	getContext(id: '2d'): { drawImage(img: ImageBitmap, x: number, y: number): void } | null;
};

function makeCanvas(w: number, h: number): { canvas: Canvas2D; toBlob: (type: string) => Promise<Blob | null> } {
	if (typeof OffscreenCanvas !== 'undefined') {
		const c = new OffscreenCanvas(w, h);
		return {
			canvas: c as unknown as Canvas2D,
			toBlob: (type) =>
				c.convertToBlob({ type, quality: QUALITY }).then(
					(b) => (b && b.type === type ? b : null),
					() => null
				)
		};
	}
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return {
		canvas: c as unknown as Canvas2D,
		toBlob: (type) =>
			new Promise((resolve) =>
				c.toBlob((b) => resolve(b && b.type === type ? b : null), type, QUALITY)
			)
	};
}

function renamed(name: string, ext: string): string {
	const base = name.replace(/\.[^./\\]*$/, '') || 'image';
	return `${base}.${ext}`;
}

/** True for an AVIF file (by type, or by extension when the browser leaves the type blank). */
export function isAvif(file: { type: string; name: string }): boolean {
	return file.type === 'image/avif' || (!file.type && /\.avif$/i.test(file.name));
}

/**
 * Returns the file to upload: the same file unless it is AVIF, then a WebP (or JPEG
 * when WebP can't be encoded and `jpegFallback` isn't false) re-encode. Rejects with a
 * user-facing message when the browser can't decode or encode it.
 */
export async function prepareImageForUpload(
	file: File,
	opts: { jpegFallback?: boolean } = {}
): Promise<File> {
	if (!isAvif(file)) return file;
	const jpegFallback = opts.jpegFallback !== false;
	const message = jpegFallback ? AVIF_CONVERT_ERROR : AVIF_CONVERT_ERROR_NO_JPEG;
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		throw new Error(message);
	}
	try {
		const { canvas, toBlob } = makeCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error(message);
		ctx.drawImage(bitmap, 0, 0);
		const webp = await toBlob('image/webp');
		if (webp) return new File([webp], renamed(file.name, 'webp'), { type: 'image/webp' });
		if (jpegFallback) {
			const jpeg = await toBlob('image/jpeg');
			if (jpeg) return new File([jpeg], renamed(file.name, 'jpg'), { type: 'image/jpeg' });
		}
		throw new Error(message);
	} catch {
		throw new Error(message);
	} finally {
		bitmap.close?.();
	}
}

/**
 * For a plain form `<input type="file">`: swaps a chosen AVIF for its converted file in
 * place, so the form posts WebP/JPEG. Returns an error message, or '' when fine.
 */
export async function convertFileInput(
	input: HTMLInputElement,
	opts: { jpegFallback?: boolean } = {}
): Promise<string> {
	const file = input.files?.[0];
	if (!file || !isAvif(file)) return '';
	try {
		const out = await prepareImageForUpload(file, opts);
		const dt = new DataTransfer();
		dt.items.add(out);
		input.files = dt.files;
		return '';
	} catch (e) {
		input.value = '';
		return e instanceof Error ? e.message : AVIF_CONVERT_ERROR;
	}
}
