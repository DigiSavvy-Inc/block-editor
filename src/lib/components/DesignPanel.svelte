<script module lang="ts">
	/** A snapshot of a selected node's attrs (BlockEditor re-reads it after every transaction). */
	export type Snap = { pos: number; type: string; attrs: Record<string, unknown>; childCount: number };

	export const TYPE_LABEL: Record<string, string> = {
		paragraph: 'Text',
		heading: 'Heading',
		eyebrow: 'Eyebrow',
		bullet_list: 'Bulleted list',
		ordered_list: 'Numbered list',
		quote: 'Quote',
		callout: 'Callout',
		milestones: 'Milestones',
		image: 'Image',
		button: 'Button',
		divider: 'Divider',
		spacer: 'Spacer',
		content_area: 'Content area'
	};

	/** Collapsed groups, remembered across pages (localStorage; fails quietly). */
	const STORE_KEY = 'ds-design-groups';
</script>

<script lang="ts">
	// #275: the editor's Design panel (moved out of BlockEditor, #270), laid out like the
	// Gutenberg block inspector: collapsible groups in a fixed order — the selected block's
	// Settings, then Colour, Typography, Dimensions, Layout, Border and (templates) Email —
	// each holding every control for the selection (block, columns, section) that fits it.
	import { onMount, type Snippet } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ColorField from '$lib/components/ColorField.svelte';
	import {
		BUTTON_RADII,
		CANVAS_FONT_SIZES,
		CANVAS_LINE_HEIGHTS,
		CANVAS_PADDINGS,
		CANVAS_RADII,
		CANVAS_WIDTHS,
		COLUMN_GAPS,
		EMAIL_FONTS,
		PAD_MAX,
		SECTION_RADII,
		SHOW_ON,
		SHOW_ON_LABELS,
		SPACE_BELOW,
		SPACER_MAX,
		canvasIsSet,
		clampImageWidthPct,
		cleanHref,
		cleanImageUrl,
		sanitizeCanvas,
		type EmailCanvas
	} from '$lib/blocks.js';
	import { BRAND_LOGOS, autoTextColor, normalizeHex } from '$lib/brand.js';
	import { FOCAL_POINTS, IMAGE_RATIOS, type FocalPoint, type ImageRatio } from '$lib/image-crop.js';

	let {
		block,
		section,
		columns,
		setDesign,
		setNode,
		uploadInto,
		cropTo,
		cropping = false,
		setMilestoneCount,
		uploadError = '',
		canUpload = true,
		showOnControl = false,
		canvas = $bindable<EmailCanvas | undefined>(undefined)
	}: {
		/** The selected block (not a section / columns), the section and columns around it. */
		block: Snap | null;
		section: Snap | null;
		columns: Snap | null;
		setDesign: (s: Snap, patch: Record<string, unknown>) => void;
		setNode: (s: Snap, attrs: Record<string, unknown>) => void;
		uploadInto: (pos: number, file: File) => void;
		/** #497: crop the image to a ratio (from its original); null = back to the original. */
		cropTo: (s: Snap, ratio: ImageRatio | null, focal: FocalPoint | null) => void;
		cropping?: boolean;
		setMilestoneCount: (pos: number, n: number) => void;
		uploadError?: string;
		/** False when the host passed no `upload`: no file picker and no crop (a crop is
		 *  saved as a new uploaded file). Images are set by URL. */
		canUpload?: boolean;
		/** #498: web page templates — offer "Show on" (all pages / issue pages / archive list). */
		showOnControl?: boolean;
		/** The template's email canvas; undefined = no Typography / Email groups. */
		canvas?: EmailCanvas;
	} = $props();

	/** A segmented control's option value. */
	type Val = string | number;
	const des = (s: Snap | null) => ((s?.attrs.design as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
	const bd = $derived(des(block));
	const sd = $derived(des(section));
	const cd = $derived(des(columns));
	const ba = $derived(block?.attrs ?? {});
	const sa = $derived(section?.attrs ?? {});
	const t = $derived(block?.type ?? '');

	const ALIGN_TYPES = new Set(['heading', 'paragraph', 'eyebrow', 'quote', 'callout', 'milestones', 'bullet_list', 'ordered_list', 'image', 'button']);
	const blockAlign = $derived(t === 'button' ? String(ba.align ?? 'left') : ((bd.align as string | undefined) ?? ''));
	function setAlign(a: string | null) {
		if (!block) return;
		if (block.type === 'button') setNode(block, { align: a ?? 'left' });
		else setDesign(block, { align: a });
	}
	/** The background the selected block sits on (its section's, else the card). */
	const blockBg = $derived(normalizeHex(sa.bg) || '#ffffff');
	const secText = $derived(section ? normalizeHex(sa.color) || autoTextColor(normalizeHex(sa.bg) || '#ffffff') : '#1f2328');

	const FOCAL_LABEL: Record<FocalPoint, string> = {
		tl: 'Top left',
		tc: 'Top',
		tr: 'Top right',
		ml: 'Left',
		mc: 'Centre',
		mr: 'Right',
		bl: 'Bottom left',
		bc: 'Bottom',
		br: 'Bottom right'
	};

	let padLinked = $state(true);
	const customPad = $derived(sd.padTop !== undefined || sd.padBottom !== undefined || sd.padX !== undefined);
	const PRESET_PAD: Record<string, [number, number]> = { sm: [16, 20], md: [28, 28], lg: [40, 36] };
	function setPad(key: 'padTop' | 'padBottom' | 'padX', raw: string) {
		if (!section) return;
		const n = Math.min(PAD_MAX, Math.max(0, Math.round(Number(raw) || 0)));
		setDesign(section, padLinked ? { padTop: n, padBottom: n, padX: n } : { [key]: n });
	}
	function toggleCustomPad(on: boolean) {
		if (!section) return;
		if (!on) return setDesign(section, { padTop: null, padBottom: null, padX: null });
		const [py, px] = PRESET_PAD[String(sa.padding)] ?? PRESET_PAD.lg;
		padLinked = py === px;
		setDesign(section, { padTop: py, padBottom: py, padX: px });
	}

	function setCanvas(patch: Partial<Record<keyof EmailCanvas, unknown>>) {
		if (!canvas) return;
		const next: Record<string, unknown> = { ...canvas };
		for (const [k, v] of Object.entries(patch)) {
			if (v === null || v === undefined || v === '') delete next[k];
			else next[k] = v;
		}
		canvas = sanitizeCanvas(next);
	}
	const fontOf = (key: string | undefined) => EMAIL_FONTS.find((f) => f.key === key)?.stack ?? EMAIL_FONTS[0].stack;

	// Which groups have anything for this selection.
	const hasSettings = $derived(t === 'image' || t === 'button' || t === 'milestones');
	const hasColour = $derived(['button', 'divider', 'heading', 'eyebrow'].includes(t) || !!section);
	const hasDims = $derived((!!block && t !== 'content_area') || !!columns || !!section);
	const hasLayout = $derived(ALIGN_TYPES.has(t) || !!columns || !!section);
	const hasBorder = $derived(t === 'button' || !!section);
	const hasShowOn = $derived(showOnControl && ((!!block && t !== 'content_area') || !!columns || !!section));

	let collapsed = $state<Record<string, boolean>>({});
	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
			if (saved && typeof saved === 'object') collapsed = saved;
		} catch {
			/* private mode / junk: everything open */
		}
	});
	function toggle(key: string) {
		collapsed = { ...collapsed, [key]: !collapsed[key] };
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify(collapsed));
		} catch {
			/* not persisted */
		}
	}
</script>

{#snippet group(key: string, title: string, body: Snippet)}
	<section class="grp" aria-labelledby="dp-{key}-h">
		<h3 class="grp-h" id="dp-{key}-h">
			<button type="button" aria-expanded={!collapsed[key]} aria-controls="dp-{key}" onclick={() => toggle(key)}>
				<span>{title}</span>
				<Icon name={collapsed[key] ? 'chevron-down' : 'chevron-up'} size={16} />
			</button>
		</h3>
		{#if !collapsed[key]}
			<div class="grp-b" id="dp-{key}">{@render body()}</div>
		{/if}
	</section>
{/snippet}

{#snippet seg(label: string, options: readonly (readonly [Val, string])[], isOn: (v: Val) => boolean, set: (v: Val) => void, cls = '')}
	<div class="ctl">
		<span class="sub">{label}</span>
		<div class="seg {cls}" role="group" aria-label={label}>
			{#each options as [v, l] (v)}
				<button type="button" class:on={isOn(v)} aria-pressed={isOn(v)} onclick={() => set(v)}>{l}</button>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet settingsBody()}
	{#if block && t === 'image'}
		{@const pb = block}
		{#if canUpload}
		<label class="file">
			<span class="secondary-btn">Upload image</span>
			<input
				type="file"
				accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
				onchange={(e) => {
					const f = (e.currentTarget as HTMLInputElement).files?.[0];
					if (f) uploadInto(pb.pos, f);
				}}
			/>
		</label>
		{/if}
		{#if uploadError}<span class="bad">{uploadError}</span>{/if}
		<label class="fld">Image URL <input value={String(ba.src ?? '')} placeholder="https://…" onchange={(e) => setNode(pb, { src: e.currentTarget.value.trim(), ratio: null, origSrc: null, focal: null })} /></label>
		{#if BRAND_LOGOS.length}
		{@render seg('Brand logo', BRAND_LOGOS.map((l) => [l.src, l.label] as const), (v) => ba.src === v, (v) => setNode(pb, { src: v, alt: ba.alt || 'DigiSavvy', ratio: null, origSrc: null, focal: null }), 'stack')}
		{/if}
		<label class="fld">Alt text <input value={String(ba.alt ?? '')} placeholder="Describe the image" onchange={(e) => setNode(pb, { alt: e.currentTarget.value })} /></label>
		<label class="fld">Link <input value={String(ba.href ?? '')} placeholder="https://… (optional)" onchange={(e) => setNode(pb, { href: e.currentTarget.value.trim() })} /></label>
		{#if ba.href && !cleanHref(ba.href)}<span class="bad">Use https:// or mailto:. The image won't be linked.</span>{/if}
		{@render seg('Style', [['plain', 'Plain'], ['chip', 'Logo chip']] as const, (v) => (v === 'chip') === (ba.style === 'chip'), (v) => setNode(pb, { style: v === 'chip' ? 'chip' : null }))}
		<label class="fld">Text beside the image <input value={String(ba.beside ?? '')} maxlength="80" placeholder="Optional, e.g. a wordmark" onchange={(e) => setNode(pb, { beside: e.currentTarget.value.trim() })} /></label>
	{:else if block && t === 'button'}
		{@const pb = block}
		<label class="fld">Label <input value={String(ba.label ?? '')} placeholder="Learn more" onchange={(e) => setNode(pb, { label: e.currentTarget.value })} /></label>
		<label class="fld">URL <input value={String(ba.href ?? '')} placeholder="https://… or {'{{field:url}}'}" onchange={(e) => setNode(pb, { href: e.currentTarget.value.trim() })} /></label>
		{#if !ba.href}<span class="bad">Add a link: a button without one won't be shown.</span>
		{:else if !cleanHref(ba.href)}<span class="bad">Use https://, mailto: or a merge tag. This button won't be shown.</span>{/if}
		<label class="fld">Text link beside it <input value={String(ba.linkLabel ?? '')} placeholder="Optional, e.g. or reply to this email" onchange={(e) => setNode(pb, { linkLabel: e.currentTarget.value })} /></label>
		{#if ba.linkLabel}
			<label class="fld">Text link URL <input value={String(ba.linkHref ?? '')} placeholder="https://… or {'{{field:url}}'}" onchange={(e) => setNode(pb, { linkHref: e.currentTarget.value.trim() })} /></label>
			{#if !cleanHref(ba.linkHref)}<span class="bad">Add a valid link (https://, mailto: or a merge tag): the text link won't be shown without one.</span>{/if}
		{/if}
	{:else if block && t === 'milestones'}
		{@const pb = block}
		{@render seg('Items', [[2, '2'], [3, '3'], [4, '4']] as const, (n) => pb.childCount === n, (n) => setMilestoneCount(pb.pos, Number(n)))}
		<label class="check"><input type="checkbox" checked={ba.rule !== false} onchange={(e) => setNode(pb, { rule: e.currentTarget.checked })} /> Thick rule above</label>
	{/if}
{/snippet}

{#snippet colourBody()}
	{#if block && t === 'button'}
		{@const pb = block}
		<ColorField label="Button" value={(bd.bg as string) ?? null} against={blockBg} min={3} againstLabel="the background" onchange={(h) => setDesign(pb, { bg: h })} />
		<ColorField label="Button text" value={(bd.fg as string) ?? null} against={normalizeHex(bd.bg) || (section ? secText : '#2563eb')} againstLabel="the button" onchange={(h) => setDesign(pb, { fg: h })} />
		{#if ba.linkLabel}
			<ColorField label="Text link" value={(bd.linkColor as string) ?? null} against={blockBg} againstLabel="the background" onchange={(h) => setDesign(pb, { linkColor: h })} />
		{/if}
	{:else if block && t === 'divider'}
		{@const pb = block}
		<ColorField label="Divider" value={(bd.color as string) ?? null} against={blockBg} min={1.5} againstLabel="the background" onchange={(h) => setDesign(pb, { color: h })} />
	{:else if block && t === 'heading'}
		{@const pb = block}
		<ColorField label="Heading" value={(bd.color as string) ?? null} against={blockBg} againstLabel="the background" onchange={(h) => setDesign(pb, { color: h })} />
	{:else if block && t === 'eyebrow'}
		{@const pb = block}
		{@render seg('Eyebrow label', [['text', 'Text colour'], ['accent', 'Accent']] as const, (v) => (v === 'accent') === (ba.tone === 'accent'), (v) => setNode(pb, { tone: v === 'accent' ? 'accent' : null }))}
	{/if}
	{#if section}
		{@const ps = section}
		<ColorField label="Section background" value={String(sa.bg ?? '#ffffff')} auto={false} onchange={(h) => h && setNode(ps, { bg: h })} />
		<div class="ctl">
			<ColorField label="Section text" value={(sa.color as string | null) ?? null} against={normalizeHex(sa.bg) || '#ffffff'} againstLabel="the background" onchange={(h) => setNode(ps, { color: h })} />
			{#if !sa.color}<span class="hint">Auto: {secText === '#000000' ? 'black' : 'white'}, whichever reads better.</span>{/if}
		</div>
		<div class="ctl">
			<ColorField label="Section accent" value={(sd.accent as string) ?? null} against={normalizeHex(sa.bg) || '#ffffff'} min={3} againstLabel="the background" onchange={(h) => setDesign(ps, { accent: h })} />
			<span class="hint">Eyebrow rule, step circles, milestones rule and dividers.</span>
		</div>
		<label class="fld">Section background image
			<input value={String(sd.bgImage ?? '')} placeholder="https://… (optional)" onchange={(e) => setDesign(ps, { bgImage: e.currentTarget.value.trim() || null })} />
		</label>
		{#if sd.bgImage && !cleanImageUrl(sd.bgImage)}<span class="bad">Use an https:// image URL without spaces, quotes or brackets.</span>
		{:else if sd.bgImage}<span class="hint">The background colour shows wherever the image doesn't load.</span>{/if}
	{/if}
{/snippet}

{#snippet typeBody()}
	{#if canvas}
		{@const cv = canvas}
		<p class="hint">For the whole email. Clients without the font use the next one in its stack.</p>
		<div class="ctl">
			<span class="sub">Body font</span>
			<div class="fonts" role="group" aria-label="Body font">
				{#each EMAIL_FONTS as f (f.key)}
					{@const on = (cv.font ?? 'system') === f.key}
					<button type="button" class:on aria-pressed={on} style="font-family:{f.stack}" onclick={() => setCanvas({ font: f.key === 'system' ? null : f.key })}>{f.label}</button>
				{/each}
			</div>
		</div>
		<div class="ctl">
			<span class="sub">Heading font</span>
			<div class="fonts" role="group" aria-label="Heading font">
				<button type="button" class:on={!cv.headingFont} aria-pressed={!cv.headingFont} style="font-family:{fontOf(cv.font)}" onclick={() => setCanvas({ headingFont: null })}>Same as body</button>
				{#each EMAIL_FONTS as f (f.key)}
					{@const on = cv.headingFont === f.key}
					<button type="button" class:on aria-pressed={on} style="font-family:{f.stack};font-weight:700" onclick={() => setCanvas({ headingFont: f.key })}>{f.label}</button>
				{/each}
			</div>
		</div>
		{@render seg('Font size', CANVAS_FONT_SIZES.map((f) => [f, `${f}px`] as const), (f) => (cv.fontSize ?? 16) === f, (f) => setCanvas({ fontSize: f === 16 ? null : f }))}
		{@render seg('Line height', CANVAS_LINE_HEIGHTS.map((l) => [l, String(l)] as const), (l) => (cv.lineHeight ?? 1.6) === l, (l) => setCanvas({ lineHeight: l === 1.6 ? null : l }))}
	{/if}
{/snippet}

{#snippet dimsBody()}
	{#if block && t === 'image'}
		{@const pb = block}
		<label class="fld">
			<span>Width: {ba.widthPct ? `${ba.widthPct}%` : ba.width ? `${ba.width}px` : 'Full'} <span class="hint">(or drag the image's right edge)</span></span>
			<input type="range" min="10" max="100" step="5" value={Number(ba.widthPct ?? 100)} aria-label="Image width (%)" onchange={(e) => setNode(pb, { widthPct: clampImageWidthPct(e.currentTarget.value) ?? null, width: null })} />
		</label>
		{#if ba.src && canUpload}
			{@const ratio = (ba.ratio as ImageRatio | null) ?? null}
			{@const focal = (ba.focal as FocalPoint | null) ?? 'mc'}
			{@render seg('Aspect ratio', [['orig', 'Original'] as const, ...IMAGE_RATIOS.map((r) => [r, r] as const)], (v) => (v === 'orig' ? !ratio : ratio === v), (v) => {
				if (cropping) return;
				if (v === 'orig') {
					if (ratio) cropTo(pb, null, null);
				} else if (v !== ratio) cropTo(pb, v as ImageRatio, focal);
			}, 'wrap3')}
			{#if ratio}
				<div class="fld">
					<span>Crop position</span>
					<div class="focal" role="group" aria-label="Crop position">
						{#each FOCAL_POINTS as f (f)}
							<button
								type="button"
								class:on={focal === f}
								aria-pressed={focal === f}
								aria-label={FOCAL_LABEL[f]}
								title={FOCAL_LABEL[f]}
								disabled={cropping}
								onclick={() => f !== focal && cropTo(pb, ratio, f)}
							></button>
						{/each}
					</div>
				</div>
			{/if}
			{#if cropping}<span class="hint" role="status">Cropping…</span>{/if}
			<span class="hint">The crop is saved as a new image, so it looks the same in every inbox.</span>
		{/if}
	{:else if block && t === 'button'}
		{@const pb = block}
		{@render seg('Button size', [['sm', 'S'], ['md', 'M'], ['lg', 'L']] as const, (v) => (bd.btnSize ?? 'md') === v, (v) => setDesign(pb, { btnSize: v === 'md' ? null : v }))}
		<label class="check"><input type="checkbox" checked={bd.full === true} onchange={(e) => setDesign(pb, { full: e.currentTarget.checked ? true : null })} /> Full width</label>
	{:else if block && t === 'spacer'}
		{@const pb = block}
		{@render seg('Height', [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']] as const, (v) => bd.px === undefined && ba.size === v, (v) => {
			setDesign(pb, { px: null });
			setNode(pb, { size: v });
		})}
		<label class="fld">Custom height (px, 0–{SPACER_MAX})
			<input type="number" min="0" max={SPACER_MAX} value={bd.px ?? ''} placeholder="Preset" onchange={(e) => setDesign(pb, { px: e.currentTarget.value === '' ? null : Math.min(SPACER_MAX, Math.max(0, Math.round(Number(e.currentTarget.value) || 0))) })} />
		</label>
	{:else if block && t === 'divider'}
		{@const pb = block}
		{@render seg('Thickness', [1, 2, 3, 4].map((n) => [n, `${n}px`] as const), (n) => (bd.thickness ?? 1) === n, (n) => setDesign(pb, { thickness: n === 1 ? null : n }))}
		{@render seg('Divider width', [['full', 'Full'], ['short', '25%']] as const, (v) => (v === 'short') === (bd.short === true), (v) => setDesign(pb, { short: v === 'short' ? true : null }))}
	{/if}
	{#if block && t !== 'spacer' && t !== 'content_area'}
		{@const pb = block}
		{@render seg('Space below', [[-1, 'Auto'] as const, ...SPACE_BELOW.map((v) => [v, String(v)] as const)], (v) => (v === -1 ? bd.spaceBelow === undefined : bd.spaceBelow === v), (v) => setDesign(pb, { spaceBelow: v === -1 ? null : v }))}
	{/if}
	{#if columns}
		{@const pc = columns}
		{@render seg('Column gap', COLUMN_GAPS.map((g) => [g, `${g}px`] as const), (g) => (cd.gap ?? 12) === g, (g) => setDesign(pc, { gap: g === 12 ? null : g }))}
	{/if}
	{#if section}
		{@const ps = section}
		{@render seg('Section padding', [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']] as const, (v) => !customPad && sa.padding === v, (v) => {
			setDesign(ps, { padTop: null, padBottom: null, padX: null });
			setNode(ps, { padding: v });
		})}
		<label class="check"><input type="checkbox" checked={customPad} onchange={(e) => toggleCustomPad(e.currentTarget.checked)} /> Custom padding (px)</label>
		{#if customPad}
			<label class="check"><input type="checkbox" bind:checked={padLinked} /> Same on all sides</label>
			<div class="pads">
				<label class="fld">Top <input type="number" min="0" max={PAD_MAX} value={sd.padTop ?? ''} onchange={(e) => setPad('padTop', e.currentTarget.value)} /></label>
				<label class="fld">Bottom <input type="number" min="0" max={PAD_MAX} value={sd.padBottom ?? ''} onchange={(e) => setPad('padBottom', e.currentTarget.value)} /></label>
				<label class="fld">Sides <input type="number" min="0" max={PAD_MAX} value={sd.padX ?? ''} onchange={(e) => setPad('padX', e.currentTarget.value)} /></label>
			</div>
		{/if}
	{/if}
{/snippet}

{#snippet layoutBody()}
	{#if block && ALIGN_TYPES.has(t)}
		{@render seg('Alignment', [...(t === 'button' ? [] : [['', 'Auto'] as const]), ['left', 'Left'] as const, ['center', 'Centre'] as const, ['right', 'Right'] as const], (a) => blockAlign === a, (a) => setAlign(a ? String(a) : null))}
	{/if}
	{#if columns}
		{@const pc = columns}
		{@render seg('Column alignment', [['top', 'Top'], ['middle', 'Middle']] as const, (v) => (v === 'middle') === (cd.valign === 'middle'), (v) => setDesign(pc, { valign: v === 'middle' ? 'middle' : null }))}
		<label class="check"><input type="checkbox" checked={cd.stack !== false} onchange={(e) => setDesign(pc, { stack: e.currentTarget.checked ? null : false })} /> Stack columns on mobile</label>
	{/if}
	{#if section}
		{@const ps = section}
		{@render seg('Section width', [['full', 'Full bleed'], ['inset', 'Inset']] as const, (v) => sa.width === v, (v) => setNode(ps, { width: v }))}
		{@render seg('Section alignment', [['left', 'Left'], ['center', 'Centred']] as const, (v) => (v === 'center') === (sa.align === 'center'), (v) => setNode(ps, { align: v === 'center' ? 'center' : null }))}
	{/if}
{/snippet}

{#snippet borderBody()}
	{#if block && t === 'button'}
		{@const pb = block}
		{@render seg('Button corners', BUTTON_RADII.map((r) => [r, r === 999 ? 'Pill' : r === 0 ? 'Square' : `${r}px`] as const), (r) => (bd.radius ?? 8) === r, (r) => setDesign(pb, { radius: r === 8 ? null : r }))}
	{/if}
	{#if section}
		{@const ps = section}
		{@render seg('Section corners', [[-1, 'Auto'] as const, ...SECTION_RADII.map((r) => [r, `${r}px`] as const)], (r) => (r === -1 ? sd.radius === undefined : sd.radius === r), (r) => setDesign(ps, { radius: r === -1 ? null : r }))}
		<ColorField label="Section border" autoLabel="None" value={(sd.borderColor as string) ?? null} onchange={(h) => setDesign(ps, { borderColor: h, borderWidth: h ? (sd.borderWidth ?? 1) : null })} />
		{#if sd.borderColor}
			{@render seg('Border width', [1, 2, 3, 4].map((w) => [w, `${w}px`] as const), (w) => (sd.borderWidth ?? 1) === w, (w) => setDesign(ps, { borderWidth: w }))}
		{/if}
	{/if}
{/snippet}

{#snippet emailBody()}
	{#if canvas}
		{@const cv = canvas}
		<p class="hint">The card and backdrop around this template's emails.</p>
		<ColorField label="Backdrop" autoLabel="White" value={cv.backdrop ?? null} onchange={(h) => setCanvas({ backdrop: h })} />
		<ColorField label="Body text" value={cv.text ?? null} against="#ffffff" againstLabel="the white card" onchange={(h) => setCanvas({ text: h })} />
		<ColorField label="Links" value={cv.link ?? null} against="#ffffff" againstLabel="the white card" onchange={(h) => setCanvas({ link: h })} />
		{@render seg('Card width', CANVAS_WIDTHS.map((w) => [w, `${w}`] as const), (w) => cv.width === w, (w) => setCanvas({ width: cv.width === w ? null : w }))}
		{@render seg('Card corners', CANVAS_RADII.map((r) => [r, `${r}px`] as const), (r) => (cv.radius ?? 0) === r, (r) => setCanvas({ radius: r === 0 ? null : r }))}
		{@render seg('Card padding', [[-1, 'Auto'] as const, ...CANVAS_PADDINGS.map((p) => [p, p === 0 ? 'None' : `${p}px`] as const)], (p) => (p === -1 ? cv.padding === undefined : cv.padding === p), (p) => setCanvas({ padding: p === -1 ? null : p }))}
		{#if canvasIsSet(cv)}<button type="button" class="secondary small" onclick={() => (canvas = {})}>Reset to the classic layout</button>{/if}
	{/if}
{/snippet}

{#snippet showOnSelect(s: Snap, label: string)}
	{@const cur = String(des(s).showOn ?? '')}
	<label class="fld">{label}
		<select value={cur} onchange={(e) => setDesign(s, { showOn: e.currentTarget.value || null })}>
			<option value="">All pages</option>
			{#each SHOW_ON as k (k)}<option value={k}>{SHOW_ON_LABELS[k]} only</option>{/each}
		</select>
	</label>
{/snippet}

{#snippet showOnBody()}
	{#if block && t !== 'content_area'}{@render showOnSelect(block, `Show this ${(TYPE_LABEL[t] ?? 'block').toLowerCase()} on`)}{/if}
	{#if columns}{@render showOnSelect(columns, 'Show the columns on')}{/if}
	{#if section}{@render showOnSelect(section, 'Show the section on')}{/if}
	<span class="hint">The archive list is /newsletter; issue pages are each newsletter.</span>
{/snippet}

<div class="dp">
	{#if block || section || columns}
		<p class="sel">
			{#if block}{TYPE_LABEL[block.type] ?? 'Block'}{:else if section}Section{:else}Columns{/if}{#if block && columns}&nbsp;·&nbsp;in columns{/if}{#if (block || columns) && section}&nbsp;·&nbsp;in a section{/if}
		</p>
	{:else}
		<p class="hint">Click a block to see its settings. Click a section's padding to select the section.</p>
	{/if}
	{#if block && t === 'content_area'}<p class="hint">The campaign's content goes here.</p>{/if}

	{#if hasSettings}{@render group('settings', TYPE_LABEL[t] ?? 'Settings', settingsBody)}{/if}
	{#if hasColour}{@render group('colour', 'Colour', colourBody)}{/if}
	{#if canvas !== undefined}{@render group('type', 'Typography', typeBody)}{/if}
	{#if hasDims}{@render group('dims', 'Dimensions', dimsBody)}{/if}
	{#if hasLayout}{@render group('layout', 'Layout', layoutBody)}{/if}
	{#if hasBorder}{@render group('border', 'Border', borderBody)}{/if}
	{#if hasShowOn}{@render group('showon', 'Show on', showOnBody)}{/if}
	{#if canvas !== undefined}{@render group('email', 'Email', emailBody)}{/if}
</div>

<style>
	/* #275: one rhythm everywhere: 12px between rows, 20px between groups. */
	.dp {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.sel {
		margin: 0;
		font-size: var(--size-s);
		line-height: var(--line-s);
		font-weight: var(--weight-ui-heavy);
		color: var(--text);
	}
	.grp {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-top: var(--space-s);
		box-shadow: inset 0 var(--border-s) 0 var(--border);
	}
	.grp-h {
		margin: 0;
	}
	.grp-h button {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-xs);
		padding: 0;
		font-size: var(--size-s);
		line-height: var(--line-s);
		font-weight: var(--weight-ui-heavy);
		color: var(--text);
		background: transparent;
		border: none;
	}
	.grp-h button:hover {
		filter: none;
	}
	.grp-b {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.ctl {
		display: flex;
		flex-direction: column;
		gap: var(--space-xxs);
		min-width: 0;
	}
	.sub {
		font-size: var(--size-xs);
		line-height: var(--line-xs);
		color: var(--muted);
	}
	/* Segmented controls: full width, equal segments, own row. */
	.seg {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		gap: 2px;
		width: 100%;
		padding: 2px;
		border-radius: var(--radius-s);
		box-shadow: 0 0 0 var(--border-s) var(--border);
		background: var(--bg);
	}
	.seg.stack {
		grid-auto-flow: row;
	}
	.seg.wrap3 {
		grid-auto-flow: row;
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	/* #497: 3×3 crop-position picker. */
	.focal {
		display: grid;
		grid-template-columns: repeat(3, 24px);
		gap: 4px;
		width: max-content;
		padding: 4px;
		border-radius: var(--radius-s);
		box-shadow: 0 0 0 var(--border-s) var(--border);
		background: var(--bg);
	}
	.focal button {
		width: 24px;
		height: 24px;
		padding: 0;
		border-radius: var(--radius-s);
		background: var(--surface);
		box-shadow: inset 0 0 0 var(--border-s) var(--border);
	}
	.focal button.on {
		background: var(--btn-primary-bg);
		box-shadow: none;
	}
	.seg button,
	.fonts button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		padding: var(--space-xxs) 2px;
		font-size: var(--size-xs);
		line-height: var(--line-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--muted);
		background: transparent;
		border: none;
		border-radius: var(--radius-xs);
	}
	.seg button:hover,
	.fonts button:hover {
		filter: none;
		color: var(--text);
	}
	.seg button.on,
	.fonts button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-s);
	}
	.fonts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-xxs);
	}
	.fonts button {
		justify-content: flex-start;
		padding: var(--space-xs);
		font-size: var(--size-s);
		line-height: var(--line-s);
		color: var(--text);
		background: var(--bg);
		box-shadow: 0 0 0 var(--border-s) var(--border);
	}
	.fonts button.on {
		box-shadow: 0 0 0 2px var(--text);
	}
	.fld {
		display: flex;
		flex-direction: column;
		gap: var(--space-xxs);
		font-size: var(--size-xs);
		line-height: var(--line-xs);
		color: var(--muted);
		min-width: 0;
	}
	.fld input,
	.fld select {
		width: 100%;
		font-size: var(--size-s);
	}
	.check {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		font-size: var(--size-s);
		line-height: var(--line-s);
	}
	.file input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.secondary-btn {
		display: inline-block;
		padding: var(--space-xxs) var(--space-s);
		font-size: var(--size-s);
		line-height: var(--line-s);
		color: var(--text);
		border-radius: var(--radius-xs);
		box-shadow: 0 0 0 var(--border-s) var(--border);
		cursor: pointer;
	}
	.file:focus-within .secondary-btn {
		outline: 2px solid var(--color-1);
	}
	.bad {
		font-size: var(--size-xs);
		line-height: var(--line-xs);
		color: var(--danger);
	}
	.hint {
		margin: 0;
		font-size: var(--size-xs);
		line-height: var(--line-xs);
		color: var(--muted);
	}
	.pads {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-xs);
	}
	.small {
		align-self: flex-start;
		font-size: var(--size-xs);
	}
</style>
