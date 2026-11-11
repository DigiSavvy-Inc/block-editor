// 0.2.0: host props `brandLogos` (the image settings' "Brand logo" quick insert) and
// `swatches` (the colour palette). DesignPanel is rendered on the server (no DOM needed);
// the swatch plumbing through the components is read raw, like the other component tests.
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import DesignPanel, { type Snap } from '../src/lib/components/DesignPanel.svelte';
import { BRAND_SWATCHES, type BrandLogo, type Swatch } from '../src/lib/brand';

const raw = import.meta.glob(
	[
		'../src/lib/components/BlockEditor.svelte',
		'../src/lib/components/DesignPanel.svelte',
		'../src/lib/components/ColorField.svelte',
		'../src/lib/components/FormatToolbar.svelte'
	],
	{ query: '?raw', import: 'default', eager: true }
) as Record<string, string>;
const src = (suffix: string) => {
	const key = Object.keys(raw).find((k) => k.endsWith(suffix));
	if (!key) throw new Error(`missing ${suffix}`);
	return raw[key];
};
/** The component's <script> blocks, and its markup (scripts and styles removed). */
const script = (s: string) => (s.match(/<script[\s\S]*?<\/script>/g) ?? []).join('\n');
const markup = (s: string) => s.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');

const LOGOS: BrandLogo[] = [
	{ key: 'primary', label: 'Primary logo', src: 'https://cdn.example.com/logo.png', alt: 'Example Co' },
	{ key: 'mark', label: 'Logomark', src: 'https://cdn.example.com/mark.png' }
];
const image = (attrs: Record<string, unknown> = {}): Snap => ({ pos: 0, type: 'image', attrs: { src: '', alt: '', ...attrs }, childCount: 0 });
const noop = () => {};

function panel(props: Record<string, unknown> = {}) {
	return render(DesignPanel, {
		props: {
			block: image(),
			section: null,
			columns: null,
			setDesign: noop,
			setNode: noop,
			uploadInto: noop,
			cropTo: noop,
			setMilestoneCount: noop,
			...props
		}
	}).body;
}

describe('brandLogos', () => {
	it('hides the Brand logo control by default', () => {
		const html = panel();
		expect(html).toContain('Image URL');
		expect(html).not.toContain('Brand logo');
	});

	it('offers each logo by label when brandLogos is set', () => {
		const html = panel({ brandLogos: LOGOS });
		expect(html).toContain('aria-label="Brand logo"');
		expect(html).toContain('>Primary logo</button>');
		expect(html).toContain('>Logomark</button>');
	});

	it('marks the logo the image already uses as pressed', () => {
		const html = panel({ brandLogos: LOGOS, block: image({ src: LOGOS[1].src }) });
		expect(html).toMatch(/aria-pressed="true"[^>]*>Logomark</);
		expect(html).toMatch(/aria-pressed="false"[^>]*>Primary logo</);
	});

	it('quick insert sets the src, keeps an existing alt, else uses the logo alt / label', () => {
		const dp = src('components/DesignPanel.svelte');
		expect(script(dp)).toContain('brandLogos = []');
		expect(markup(dp)).toMatch(/setNode\(pb, \{ src: v, alt: ba\.alt \|\| logoAlt\(v\), ratio: null, origSrc: null, focal: null \}\)/);
		expect(script(dp)).toContain('l.alt ?? l.label');
	});

	it('BlockEditor passes brandLogos to the Design panel, default []', () => {
		const be = src('components/BlockEditor.svelte');
		expect(script(be)).toContain('brandLogos = []');
		expect(markup(be)).toMatch(/<DesignPanel[\s\S]*?\{brandLogos\}[\s\S]*?\/>/);
	});
});

describe('swatches', () => {
	it('defaults to BRAND_SWATCHES in every component that takes it', () => {
		for (const f of ['BlockEditor', 'DesignPanel', 'ColorField', 'FormatToolbar']) {
			expect(script(src(`components/${f}.svelte`)), f).toContain('swatches = BRAND_SWATCHES');
		}
	});

	it('the colour controls render the prop, not the built-in palette', () => {
		for (const f of ['ColorField', 'FormatToolbar']) {
			const m = markup(src(`components/${f}.svelte`));
			expect(m, f).toContain('{#each swatches as s (s.key)}');
			expect(m, f).not.toContain('BRAND_SWATCHES');
		}
	});

	it('BlockEditor threads swatches to the toolbar and the Design panel, which hands it to every ColorField', () => {
		const be = markup(src('components/BlockEditor.svelte'));
		expect(be).toMatch(/<FormatToolbar [^>]*\{swatches\}/);
		expect(be).toMatch(/<DesignPanel[\s\S]*?\{swatches\}[\s\S]*?\/>/);
		const dp = markup(src('components/DesignPanel.svelte'));
		const fields = dp.match(/<ColorField [^>]*>/g) ?? [];
		expect(fields.length).toBeGreaterThan(0);
		for (const f of fields) expect(f).toContain('{swatches}');
	});

	it('the default palette is a list of unique keys with valid hex values', () => {
		const pal: Swatch[] = BRAND_SWATCHES;
		expect(new Set(pal.map((s) => s.key)).size).toBe(pal.length);
		for (const s of pal) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
	});
});
