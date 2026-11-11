<script lang="ts">
	// #276: BlockEditor's fixed formatting toolbar (Gutenberg-style). Sticky at the top of
	// the editing surface; acts on the selection through the editor controller: block type,
	// inline marks + link, text size, alignment, text colour, clear formatting. Block-level
	// settings apply to every eligible block in the selection (one undo step).
	import Icon from '$lib/components/Icon.svelte';
	import type { IconName } from '$lib/icons/glyphs.js';
	import { BRAND_SWATCHES, type Swatch } from '$lib/brand.js';
	import type { Align, TextSize } from '$lib/blocks.js';
	import type { TurnInto } from '$lib/editor/doc.js';
	import type { EditorController, FormatState } from '$lib/editor/setup.js';

	let {
		ctl,
		format,
		mergeTags = [],
		swatches = BRAND_SWATCHES,
		onLink
	}: {
		ctl: EditorController;
		format: FormatState | null;
		/** Merge tags to offer (`inner` = the text between the braces); empty = no button. */
		mergeTags?: { inner: string; desc: string }[];
		/** The text colour palette (the editor's `swatches` prop). */
		swatches?: Swatch[];
		/** Open the link editor for the selected text. */
		onLink: () => void;
	} = $props();

	type Mark = 'bold' | 'italic' | 'underline' | 'strike' | 'code';
	const MARKS: { mark: Mark; icon: IconName; title: string }[] = [
		{ mark: 'bold', icon: 'bold', title: 'Bold (Cmd/Ctrl+B)' },
		{ mark: 'italic', icon: 'italic', title: 'Italic (Cmd/Ctrl+I)' },
		{ mark: 'underline', icon: 'underline', title: 'Underline (Cmd/Ctrl+U)' },
		{ mark: 'strike', icon: 'strike', title: 'Strikethrough (Cmd/Ctrl+Shift+S)' },
		{ mark: 'code', icon: 'code', title: 'Code (Cmd/Ctrl+E)' }
	];
	const TYPES: { to: TurnInto; label: string }[] = [
		{ to: 'paragraph', label: 'Paragraph' },
		{ to: 'h1', label: 'Heading 1' },
		{ to: 'h2', label: 'Heading 2' },
		{ to: 'h3', label: 'Heading 3' },
		{ to: 'display', label: 'Display heading' },
		{ to: 'quote', label: 'Quote' },
		{ to: 'bullet', label: 'Bulleted list' },
		{ to: 'numbered', label: 'Numbered list' },
		{ to: 'callout', label: 'Callout' }
	];
	/** Shown only while the selection is one of them (they stay in the slash menu). */
	const EXTRA_TYPES: { to: TurnInto; label: string }[] = [
		{ to: 'eyebrow', label: 'Eyebrow' },
		{ to: 'steps', label: 'Steps' }
	];
	const SIZES: { value: TextSize | 'md'; label: string }[] = [
		{ value: 'sm', label: 'Small' },
		{ value: 'md', label: 'Default size' },
		{ value: 'lg', label: 'Large' },
		{ value: 'xl', label: 'Extra large' }
	];
	const ALIGNS: { value: Align; icon: IconName; title: string }[] = [
		{ value: 'left', icon: 'align-left', title: 'Align left (Cmd/Ctrl+Shift+L)' },
		{ value: 'center', icon: 'align-center', title: 'Align center (Cmd/Ctrl+Shift+E)' },
		{ value: 'right', icon: 'align-right', title: 'Align right (Cmd/Ctrl+Shift+R)' }
	];

	let open = $state<'color' | 'merge' | null>(null);
	let root = $state<HTMLDivElement | undefined>();

	const f = $derived(format);
	const turn = $derived(f?.turn ?? null);
	const extra = $derived(EXTRA_TYPES.find((t) => t.to === turn));

	/** Buttons keep the editor's focus and selection (selects can't, they refocus after). */
	const keep = (e: MouseEvent) => e.preventDefault();

	function pickType(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value;
		if (v && v !== 'mixed') ctl.turnSelection(v as TurnInto);
	}
	function pickSize(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value;
		if (v === 'md') ctl.setTextSize(null);
		else if (v === 'sm' || v === 'lg' || v === 'xl') ctl.setTextSize(v);
	}
	function pickColor(hex: string | null) {
		ctl.setTextColor(hex);
		open = null;
	}
	function toggle(which: 'color' | 'merge') {
		open = open === which ? null : which;
		// Phone width: the bar scrolls horizontally (overflow clips absolute children), so
		// popovers go position: fixed just under the bar. Measure where that is.
		if (open && root) root.style.setProperty('--fmt-pop-top', `${root.getBoundingClientRect().bottom + 6}px`);
	}
	function onWindowDown(e: MouseEvent) {
		if (open && root && !root.contains(e.target as Node)) open = null;
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.stopPropagation();
			open = null;
			ctl.focus();
		}
	}
</script>

<svelte:window onmousedown={onWindowDown} />

<div class="be-fmt" role="toolbar" aria-label="Formatting" tabindex="-1" bind:this={root} onkeydown={onKey} onscroll={() => (open = null)}>
	<select class="fmt-select type" aria-label="Block type" title="Block type" value={turn ?? ''} disabled={!turn} onchange={pickType}>
		{#if !turn}<option value="">Block type</option>{/if}
		{#if turn === 'mixed'}<option value="mixed" disabled>Mixed</option>{/if}
		{#each TYPES as t (t.to)}<option value={t.to}>{t.label}</option>{/each}
		{#if extra}<option value={extra.to}>{extra.label}</option>{/if}
	</select>

	<span class="sep" aria-hidden="true"></span>

	<div class="grp" role="group" aria-label="Text style">
		{#each MARKS as m (m.mark)}
			{@const on = !!f?.marks.includes(m.mark)}
			<button type="button" class="fb" class:on aria-pressed={on} title={m.title} aria-label={m.title} disabled={!f?.canMark} onmousedown={keep} onclick={() => ctl.toggleMark(m.mark)}>
				<Icon name={m.icon} size={16} />
			</button>
		{/each}
		<button type="button" class="fb" class:on={!!f?.href} aria-pressed={!!f?.href} title="Link" aria-label="Link" disabled={!f?.textSel} onmousedown={keep} onclick={onLink}>
			<Icon name="link" size={16} />
		</button>
	</div>

	<span class="sep" aria-hidden="true"></span>

	<label class="size" title="Text size">
		<Icon name="text-size" size={16} />
		<select class="fmt-select" aria-label="Text size" value={f?.size ?? ''} disabled={!f?.size} onchange={pickSize}>
			{#if !f?.size}<option value="">Size</option>{/if}
			{#if f?.size === 'mixed'}<option value="mixed" disabled>Mixed</option>{/if}
			{#each SIZES as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
		</select>
	</label>

	<div class="grp" role="group" aria-label="Alignment">
		{#each ALIGNS as a (a.value)}
			{@const on = f?.align === a.value}
			<button type="button" class="fb" class:on aria-pressed={on} title={a.title} aria-label={a.title} disabled={!f?.align} onmousedown={keep} onclick={() => ctl.setAlign(a.value)}>
				<Icon name={a.icon} size={16} />
			</button>
		{/each}
	</div>

	<div class="pop-wrap">
		<button
			type="button"
			class="fb color"
			title={f?.textSel ? 'Colour of the selected text' : 'Text colour of the block'}
			aria-label="Text colour"
			aria-haspopup="true"
			aria-expanded={open === 'color'}
			disabled={!f?.canColor}
			onmousedown={keep}
			onclick={() => toggle('color')}
		>
			<Icon name="palette" size={16} />
			<span class="chip" style:background={f?.color ?? 'transparent'} class:empty={!f?.color}></span>
		</button>
		{#if open === 'color'}
			<div class="fmt-pop swatches" role="group" aria-label="Text colour">
				<button type="button" class="sw auto" class:on={!f?.color} aria-pressed={!f?.color} title="Default colour" aria-label="Default colour" onmousedown={keep} onclick={() => pickColor(null)}>A</button>
				{#each swatches as s (s.key)}
					{@const on = f?.color?.toLowerCase() === s.hex.toLowerCase()}
					<button type="button" class="sw" class:on aria-pressed={on} title={s.label} aria-label={s.label} style:background={s.hex} onmousedown={keep} onclick={() => pickColor(s.hex)}></button>
				{/each}
			</div>
		{/if}
	</div>

	{#if mergeTags.length}
		<div class="pop-wrap">
			<button type="button" class="fb" title="Insert a merge tag" aria-label="Insert a merge tag" aria-haspopup="true" aria-expanded={open === 'merge'} disabled={!f?.canMark} onmousedown={keep} onclick={() => toggle('merge')}>
				<Icon name="merge-tag" size={16} />
			</button>
			{#if open === 'merge'}
				<div class="fmt-pop merge" role="group" aria-label="Merge tags">
					{#each mergeTags as t (t.inner)}
						<button
							type="button"
							class="mt"
							title={t.desc}
							onmousedown={keep}
							onclick={() => {
								ctl.insertMergeTag(t.inner);
								open = null;
							}}>{`{{${t.inner}}}`}</button
						>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<button type="button" class="fb" title="Clear formatting" aria-label="Clear formatting" disabled={!f} onmousedown={keep} onclick={() => ctl.clearFormatting()}>
		<Icon name="clear-format" size={16} />
	</button>
</div>

<style>
	/* Sticks under the app header while the editing surface scrolls; spans the canvas's
	   left gutter so it reads as the surface's own bar. Scrolls sideways on phones. */
	.be-fmt {
		position: sticky;
		top: var(--be-sticky-top, 0px);
		z-index: 4;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px;
		margin: 0 0 var(--space-m) calc(-1 * var(--be-gutter, 0px));
		padding: var(--space-xxs);
		border-radius: var(--radius-s);
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--border-shadow-s), var(--shadow-s);
		font-family: var(--font-ui, inherit);
	}
	/* #270's Design panel is a sticky bar above the canvas at these widths: sit below it. */
	@container (max-width: 819px) {
		.be-fmt {
			top: calc(var(--be-sticky-top, 0px) + 52px);
		}
	}
	@media (max-width: 768px) {
		.be-fmt {
			top: var(--be-sticky-top, 0px);
		}
	}
	.grp {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	.sep {
		width: 1px;
		align-self: stretch;
		margin: 4px 2px;
		background: var(--border);
	}
	.fb {
		position: relative;
		min-width: 32px;
		height: 32px;
		padding: 0 var(--space-xs);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 2px;
		color: var(--text);
		background: transparent;
		border: none;
		border-radius: var(--radius-xs);
		font-size: var(--size-s);
	}
	.fb:hover:not(:disabled),
	.fb.on {
		filter: none;
		background: var(--bg);
	}
	.fb.on {
		box-shadow: inset 0 0 0 var(--border-s) var(--neutral-4);
	}
	.fb:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.fmt-select {
		height: 32px;
		padding: 0 var(--space-xs);
		font-size: var(--size-s);
		border-radius: var(--radius-xs);
	}
	.fmt-select.type {
		min-width: 9.5rem;
	}
	.size {
		display: inline-flex;
		align-items: center;
		gap: var(--space-xxs);
		padding-left: var(--space-xxs);
		color: var(--muted);
	}
	.chip {
		position: absolute;
		left: 8px;
		right: 8px;
		bottom: 4px;
		height: 3px;
		border-radius: 2px;
	}
	.chip.empty {
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.pop-wrap {
		position: relative;
		display: inline-flex;
	}
	.fmt-pop {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 6;
		padding: var(--space-xs);
		border-radius: var(--radius-s);
		background: var(--surface);
		box-shadow: var(--border-shadow-s), var(--shadow-m);
	}
	.swatches {
		display: grid;
		grid-template-columns: repeat(7, 26px);
		gap: var(--space-xxs);
	}
	.sw {
		width: 26px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
	}
	.sw.auto {
		background: var(--surface);
		color: var(--text);
		font-size: var(--size-xs);
		font-weight: 700;
	}
	.sw.on {
		outline: 2px solid var(--text);
		outline-offset: 2px;
	}
	.merge {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		min-width: 220px;
		max-height: 260px;
		overflow: auto;
	}
	.mt {
		text-align: left;
		padding: var(--space-xxs) var(--space-xs);
		border: none;
		border-radius: var(--radius-xs);
		background: transparent;
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--size-xs);
	}
	.mt:hover {
		filter: none;
		background: var(--bg);
	}
	/* Phone width: one horizontally scrolling row instead of ~4 wrapped rows (~140px). */
	@media (max-width: 640px) {
		.be-fmt {
			flex-wrap: nowrap;
			overflow-x: auto;
			overflow-y: hidden;
			max-width: 100%;
			overscroll-behavior-x: contain;
			-webkit-overflow-scrolling: touch;
			scroll-snap-type: x proximity;
			scrollbar-width: none;
		}
		.be-fmt::-webkit-scrollbar {
			display: none;
		}
		.be-fmt > :global(*) {
			flex-shrink: 0;
			scroll-snap-align: start;
		}
		.fmt-select.type {
			min-width: 0;
			width: 110px;
		}
		.size .fmt-select {
			width: 96px;
		}
		/* The scroller clips absolute children: pin popovers under the bar instead. */
		.fmt-pop {
			position: fixed;
			top: var(--fmt-pop-top, 120px);
			left: var(--space-m, 16px);
			right: auto;
			max-width: calc(100vw - 2 * var(--space-m, 16px));
		}
	}
</style>
