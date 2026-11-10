// Icon.svelte's attribute math (#209), kept in plain TS so tests can check it without
// compiling a component.
import { GLYPHS, type IconName } from './glyphs.js';

/** Sizes the set is drawn for. Anything else still renders (e.g. 14px in a pill). */
export type IconSize = 16 | 20 | 24 | 32;

/** Stroke width per rendered size: thinner when small, heavier when large. */
export function strokeWidthFor(size: number): number {
	if (size <= 16) return 1.5;
	if (size >= 32) return 2;
	return 1.75;
}

/** Root `<svg>` attributes. A label makes the icon an image; without one it's decorative. */
export function iconAttrs(size: number, label?: string, strokeWidth?: number) {
	return {
		viewBox: '0 0 24 24',
		width: size,
		height: size,
		fill: 'none',
		stroke: 'currentColor',
		'stroke-linecap': 'round' as const,
		'stroke-linejoin': 'round' as const,
		'stroke-width': strokeWidth ?? strokeWidthFor(size),
		'aria-hidden': label ? undefined : ('true' as const),
		role: label ? ('img' as const) : undefined
	};
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The same SVG Icon.svelte renders, as a string (tests, non-Svelte callers). */
export function iconSvg(name: IconName, size = 20, label?: string, strokeWidth?: number): string {
	const inner = GLYPHS[name];
	if (inner === undefined) throw new Error(`unknown icon: ${name}`);
	const attrs = Object.entries(iconAttrs(size, label, strokeWidth))
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => `${k}="${esc(String(v))}"`)
		.join(' ');
	return `<svg ${attrs}>${label ? `<title>${esc(label)}</title>` : ''}${inner}</svg>`;
}
