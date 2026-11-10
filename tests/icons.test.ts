import { describe, it, expect } from 'vitest';
import { GLYPHS, ICON_NAMES } from '../src/lib/icons/glyphs';
import { iconAttrs, iconSvg, strokeWidthFor } from '../src/lib/icons/icon';

// #209: the custom glyph set wired through Icon.svelte.
describe('icon glyphs', () => {
	it('every name renders without throwing and carries no script', () => {
		expect(ICON_NAMES.length).toBeGreaterThan(0);
		for (const name of ICON_NAMES) {
			const svg = iconSvg(name);
			expect(svg.startsWith('<svg ')).toBe(true);
			expect(svg.toLowerCase()).not.toContain('<script');
		}
	});

	it('glyph markup is only path/circle/rect/line/polyline/polygon elements', () => {
		const allowed = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon']);
		for (const name of ICON_NAMES) {
			const markup: string = GLYPHS[name];
			const tags = [...markup.matchAll(/<\s*\/?\s*([a-zA-Z][\w:-]*)/g)].map((m) => m[1]);
			expect(tags.length, name).toBeGreaterThan(0);
			for (const t of tags) expect(allowed.has(t), `${name}: <${t}>`).toBe(true);
			// No event handlers, hrefs or styles sneaking in through attributes.
			expect(/\son\w+=|href|style=|javascript:/i.test(markup), name).toBe(false);
		}
	});

	it('names are kebab-case', () => {
		for (const name of ICON_NAMES) expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
	});

	it('stroke width per size', () => {
		expect(strokeWidthFor(16)).toBe(1.5);
		expect(strokeWidthFor(20)).toBe(1.75);
		expect(strokeWidthFor(24)).toBe(1.75);
		expect(strokeWidthFor(32)).toBe(2);
		expect(iconAttrs(16)['stroke-width']).toBe(1.5);
		expect(iconAttrs(32, undefined, 1.25)['stroke-width']).toBe(1.25);
		expect(iconSvg('menu', 24)).toContain('stroke-width="1.75"');
		expect(iconSvg('menu', 24)).toContain('width="24" height="24"');
	});

	it('decorative unless labelled', () => {
		const plain = iconSvg('close', 16);
		expect(plain).toContain('aria-hidden="true"');
		expect(plain).not.toContain('role=');
		const labelled = iconSvg('close', 16, 'Close <x>');
		expect(labelled).not.toContain('aria-hidden');
		expect(labelled).toContain('role="img"');
		expect(labelled).toContain('<title>Close &lt;x&gt;</title>');
	});
});
