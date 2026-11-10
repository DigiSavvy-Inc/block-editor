// #497: aspect-ratio presets for image blocks. The crop is baked into a new image file
// (email clients can't do `object-fit`), so the renderers keep rendering `src` as before;
// the block also keeps `origSrc` (the uncropped image) so every re-crop starts from it.
// Pure maths + vocabulary here (client- and server-safe); `cropImageToBlob` runs in the
// browser only.

export const IMAGE_RATIOS = ['1:1', '4:3', '3:2', '16:9', '9:16'] as const;
export type ImageRatio = (typeof IMAGE_RATIOS)[number];

/** Where the crop anchors: t/m/b (row) + l/c/r (column). Unset = 'mc' (centre). */
export const FOCAL_POINTS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'] as const;
export type FocalPoint = (typeof FOCAL_POINTS)[number];

/** The long edge of a cropped file is capped at this many pixels. */
export const CROP_MAX_EDGE = 1600;

export function cleanRatio(v: unknown): ImageRatio | undefined {
	return (IMAGE_RATIOS as readonly unknown[]).includes(v) ? (v as ImageRatio) : undefined;
}

/** A stored focal point; the centre and junk come back undefined (not stored). */
export function cleanFocal(v: unknown): FocalPoint | undefined {
	return v !== 'mc' && (FOCAL_POINTS as readonly unknown[]).includes(v) ? (v as FocalPoint) : undefined;
}

/** width ÷ height of a ratio. */
export function ratioValue(r: ImageRatio): number {
	const [w, h] = r.split(':').map(Number);
	return w / h;
}

export type CropRect = { x: number; y: number; w: number; h: number };

/** The largest rect of `ratio` inside a `width`×`height` source, anchored at `focal`
 *  (centre by default). Integer pixels, always inside the source. */
export function cropRect(width: number, height: number, ratio: ImageRatio, focal?: FocalPoint | null): CropRect {
	const W = Math.max(1, Math.round(width));
	const H = Math.max(1, Math.round(height));
	const r = ratioValue(ratio);
	let w = W;
	let h = H;
	if (W / H > r) w = Math.min(W, Math.max(1, Math.round(H * r)));
	else h = Math.min(H, Math.max(1, Math.round(W / r)));
	const f = cleanFocal(focal) ?? 'mc';
	const fy = f[0] === 't' ? 0 : f[0] === 'b' ? 1 : 0.5;
	const fx = f[1] === 'l' ? 0 : f[1] === 'r' ? 1 : 0.5;
	const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));
	return { x: clamp((W - w) * fx, W - w), y: clamp((H - h) * fy, H - h), w, h };
}

/** The output size for a crop rect: same shape, long edge ≤ `maxEdge`, never upscaled. */
export function cropOutputSize(rect: { w: number; h: number }, maxEdge = CROP_MAX_EDGE): { w: number; h: number } {
	const scale = Math.min(1, maxEdge / Math.max(rect.w, rect.h));
	return { w: Math.max(1, Math.round(rect.w * scale)), h: Math.max(1, Math.round(rect.h * scale)) };
}

/** The image every crop starts from: the original upload, else the current src. */
export function cropSource(attrs: { src?: unknown; origSrc?: unknown }): string {
	const o = typeof attrs.origSrc === 'string' ? attrs.origSrc : '';
	return o || (typeof attrs.src === 'string' ? attrs.src : '');
}

/** The URL `cropImageToBlob` fetches. The app's own media (`/img/<uuid>.<ext>`, the
 *  branding logos under `/img/branding/`) is absolute on PUBLIC_BASE_URL, which can be a
 *  different origin from the one the editor is open on (local dev, a workers.dev preview);
 *  `/img/*` sends no CORS headers, so fetch just the path, same-origin. Anything else is
 *  returned unchanged (a truly external image still needs CORS), as is a URL already on
 *  `pageOrigin` or one that isn't absolute. */
export function cropFetchUrl(src: string, pageOrigin: string): string {
	let url: URL;
	try {
		url = new URL(src);
	} catch {
		return src;
	}
	if (url.origin === pageOrigin) return src;
	const p = url.pathname;
	if (/^\/img\/[a-f0-9-]{36}\.(png|jpg|gif|webp)$/.test(p) || /^\/img\/branding\/[^/]+$/.test(p)) return p;
	return src;
}

/** Browser only: fetch `src`, crop it to `ratio` at `focal`, and encode WebP 0.9
 *  (JPEG when the browser can't encode WebP). Throws with a readable message. */
export async function cropImageToBlob(src: string, ratio: ImageRatio, focal?: FocalPoint | null): Promise<File> {
	let bitmap: ImageBitmap;
	try {
		const res = await fetch(cropFetchUrl(src, location.origin), { mode: 'cors' });
		if (!res.ok) throw new Error();
		bitmap = await createImageBitmap(await res.blob());
	} catch {
		throw new Error("Couldn't load this image to crop it. Upload the file here first, then pick a ratio.");
	}
	const rect = cropRect(bitmap.width, bitmap.height, ratio, focal);
	const out = cropOutputSize(rect);
	const canvas = document.createElement('canvas');
	canvas.width = out.w;
	canvas.height = out.h;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error("This browser can't crop images.");
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, out.w, out.h);
	bitmap.close();
	const encode = (type: string) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.9));
	let blob = await encode('image/webp');
	if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg');
	if (!blob) throw new Error("This browser can't crop images.");
	const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
	return new File([blob], `crop-${ratio.replace(':', 'x')}.${ext}`, { type: blob.type });
}
