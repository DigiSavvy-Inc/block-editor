// #262: DigiSavvy brand palette for the design blocks (section colours, accents). One
// module shared by the editor's swatch picker, the block renderers and the editorial
// template seed. BRAND mirrors the tokens in src/app.css (--color-1…4, --neutral-*) and
// stays the renderers' fallback; the swatches follow the brand guidelines (#269).
// Client- AND server-safe.

export type Swatch = { key: string; label: string; hex: string };

export const BRAND = {
	teal: '#1a9ec4', // --color-1 (Antigua), the primary
	periwinkle: '#bdc8ea', // --color-2
	sage: '#b7d4cc', // --color-3
	peach: '#e8c7ab', // --color-4
	ink: '#191919', // --neutral-1 (dark)
	body: '#333333', // --neutral-9
	muted: '#737373', // --neutral-7
	hairline: '#e3e3e3', // --neutral-4
	white: '#ffffff',
	/** Text on teal is black, not white: white on #1a9ec4 is 3.12:1 (app.css). */
	onTeal: '#000000'
} as const;

/** The brand guidelines' palette (#269), named as the guidelines name them. */
export const GUIDE = {
	warmInk: '#15130e',
	deepTeal: '#066971',
	teal: '#0ab5c2',
	cyan: '#1a9ec4',
	ivory: '#f5f3ed',
	warmSurface: '#ece8de',
	cream: '#f3efe6',
	warmGray: '#544e44',
	warmBrown: '#6a5e4e',
	coral: '#ce423b',
	gold: '#fcb900',
	white: '#ffffff'
} as const;

export const BRAND_SWATCHES: Swatch[] = [
	{ key: 'warmInk', label: 'Warm ink', hex: GUIDE.warmInk },
	{ key: 'deepTeal', label: 'Deep teal', hex: GUIDE.deepTeal },
	{ key: 'teal', label: 'Teal', hex: GUIDE.teal },
	{ key: 'cyan', label: 'Brand cyan', hex: GUIDE.cyan },
	{ key: 'ivory', label: 'Ivory', hex: GUIDE.ivory },
	{ key: 'warmSurface', label: 'Warm surface', hex: GUIDE.warmSurface },
	{ key: 'cream', label: 'Cream', hex: GUIDE.cream },
	{ key: 'warmGray', label: 'Warm gray', hex: GUIDE.warmGray },
	{ key: 'warmBrown', label: 'Warm brown', hex: GUIDE.warmBrown },
	{ key: 'coral', label: 'CTA coral', hex: GUIDE.coral },
	{ key: 'gold', label: 'Gold', hex: GUIDE.gold },
	{ key: 'white', label: 'White', hex: GUIDE.white }
];

/** A logo offered by the image settings' "Brand logo" quick insert (the `brandLogos` prop).
 *  `src` is stored as the image URL; `alt` (else `label`) fills an empty alt text. */
export type BrandLogo = { key: string; label: string; src: string; alt?: string };

/** Email-safe sans stack for branded blocks (no serif, by design). */
export const BRAND_FONT = 'Inter,Helvetica,Arial,sans-serif';

/** `#abc` / `#aabbcc` (any case, optional `#`) → lowercase `#aabbcc`; anything else → ''. */
export function normalizeHex(v: unknown): string {
	if (typeof v !== 'string') return '';
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
	if (!m) return '';
	const h = m[1].toLowerCase();
	return '#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h);
}

function luminance(hex: string): number {
	const h = normalizeHex(hex) || '#000000';
	const ch = [1, 3, 5].map((i) => {
		const c = parseInt(h.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio between two hex colours (1–21). */
export function contrastRatio(a: string, b: string): number {
	const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (l1 + 0.05) / (l2 + 0.05);
}

/** The default text colour on a background: black or white, whichever contrasts more
 *  (so teal gets black, ink gets white). */
export function autoTextColor(bg: string): string {
	return contrastRatio(bg, '#000000') >= contrastRatio(bg, '#ffffff') ? '#000000' : '#ffffff';
}

/** Body text the picker should warn about (WCAG AA for normal text). */
export const MIN_CONTRAST = 4.5;
