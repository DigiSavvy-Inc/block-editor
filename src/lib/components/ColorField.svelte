<script lang="ts">
	// #270: one colour control for the editor's Design panel: brand swatches, a hex field
	// (validated with normalizeHex) and an optional "Auto" (= unset). With `against`, it
	// shows the contrast ratio and warns below `min`.
	// #275: compact: one row (label, then a swatch button with the hex); the swatches, hex
	// field, native picker and contrast readout open in a popover under the row.
	import { tick } from 'svelte';
	import { BRAND_SWATCHES, MIN_CONTRAST, contrastRatio, normalizeHex, type Swatch } from '$lib/brand.js';

	let {
		label,
		value = null,
		auto = true,
		autoLabel = 'Auto',
		against = null,
		min = MIN_CONTRAST,
		/** What the contrast is measured against, for the warning text. */
		againstLabel = 'the background',
		swatches = BRAND_SWATCHES,
		onchange
	}: {
		label: string;
		value?: string | null;
		auto?: boolean;
		autoLabel?: string;
		/** The colour this one is read on (or the colour read on this one). */
		against?: string | null;
		min?: number;
		againstLabel?: string;
		/** The swatch palette (the editor's `swatches` prop). */
		swatches?: Swatch[];
		onchange: (hex: string | null) => void;
	} = $props();

	const uid = $props.id();
	let draft = $state('');
	$effect.pre(() => {
		draft = value ?? '';
	});
	const current = $derived(normalizeHex(value));
	const ratio = $derived(current && against && normalizeHex(against) ? contrastRatio(current, normalizeHex(against)) : null);
	const low = $derived(ratio !== null && ratio < min);

	let open = $state(false);
	let above = $state(false);
	let root = $state<HTMLDivElement | undefined>();
	let btn = $state<HTMLButtonElement | undefined>();
	let pop = $state<HTMLDivElement | undefined>();

	/** The nearest scrolling ancestor (the Design panel / phone sheet), else the viewport. */
	function scrollBox(el: HTMLElement): DOMRect {
		for (let p = el.parentElement; p; p = p.parentElement) {
			const o = getComputedStyle(p).overflowY;
			if (o === 'auto' || o === 'scroll') return p.getBoundingClientRect();
		}
		return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
	}

	async function show() {
		open = true;
		above = false;
		await tick();
		if (!pop || !btn) return;
		// Flip above the row when it doesn't fit below but does above (panel or viewport).
		const box = scrollBox(btn);
		const b = btn.getBoundingClientRect();
		const h = pop.offsetHeight;
		const bottom = Math.min(box.bottom, window.innerHeight);
		const top = Math.max(box.top, 0);
		above = b.bottom + h + 8 > bottom && b.top - h - 8 >= top;
		await tick();
		pop.scrollIntoView?.({ block: 'nearest' });
		(pop.querySelector<HTMLButtonElement>('.sw.on, .auto.on') ?? pop.querySelector<HTMLElement>('button, input'))?.focus();
	}
	function hide(refocus = true) {
		if (!open) return;
		open = false;
		if (refocus) btn?.focus();
	}
	function pick(hex: string | null) {
		onchange(hex);
		hide();
	}
	function commitHex(v: string): boolean {
		const t = v.trim();
		const h = normalizeHex(t);
		if (!t && auto) onchange(null);
		else if (h) onchange(h);
		else return false;
		return true;
	}

	// Outside click closes (focus stays wherever the click put it).
	$effect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => {
			if (root && !root.contains(e.target as Node)) hide(false);
		};
		document.addEventListener('pointerdown', onDown, true);
		return () => document.removeEventListener('pointerdown', onDown, true);
	});

	/** Arrow keys move between the swatches (Tab works too). */
	function swatchKeys(e: KeyboardEvent) {
		const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
		if (!keys.includes(e.key)) return;
		const list = [...((e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
		const i = list.indexOf(document.activeElement as HTMLButtonElement);
		if (i < 0) return;
		e.preventDefault();
		const n = list.length;
		const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
		list[next]?.focus();
	}
</script>

<div class="cf" bind:this={root}>
	<div class="row">
		<span class="lbl" id="{uid}-l">{label}</span>
		<button
			type="button"
			class="trigger"
			class:low
			bind:this={btn}
			aria-haspopup="dialog"
			aria-expanded={open}
			aria-controls="{uid}-p"
			aria-labelledby="{uid}-l {uid}-v"
			onclick={() => (open ? hide() : show())}
		>
			<span class="chip" class:unset={!current} style={current ? `background:${current}` : ''}></span>
			<span class="val" id="{uid}-v">{current ?? autoLabel}</span>
		</button>
	</div>
	{#if low && !open}<span class="ratio low">Low contrast ({ratio?.toFixed(2)}:1)</span>{/if}
	{#if open}
		<div
			class="pop"
			class:above
			id="{uid}-p"
			role="dialog"
			aria-label="{label} colour"
			tabindex="-1"
			bind:this={pop}
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					hide();
				}
			}}
		>
			<div class="swatches" role="group" aria-label={label}>
				{#if auto}
					<button type="button" class="auto" class:on={!current} aria-pressed={!current} onkeydown={swatchKeys} onclick={() => pick(null)}>{autoLabel}</button>
				{/if}
				{#each swatches as s (s.key)}
					<button
						type="button"
						class="sw"
						class:on={current === s.hex}
						style="background:{s.hex}"
						title="{s.label} {s.hex}"
						aria-label="{label}: {s.label} {s.hex}"
						aria-pressed={current === s.hex}
						onkeydown={swatchKeys}
						onclick={() => pick(s.hex)}
					></button>
				{/each}
			</div>
			<div class="custom">
				<input
					class="hex"
					value={draft}
					aria-label="{label} hex colour"
					placeholder={auto ? autoLabel : '#1a9ec4'}
					oninput={(e) => (draft = e.currentTarget.value)}
					onchange={(e) => commitHex(e.currentTarget.value)}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							if (commitHex(e.currentTarget.value)) hide();
						}
					}}
				/>
				<input
					type="color"
					class="native"
					value={current ?? '#ffffff'}
					aria-label="{label}: pick any colour"
					onchange={(e) => {
						const h = normalizeHex(e.currentTarget.value);
						if (h) onchange(h);
					}}
				/>
			</div>
			{#if draft.trim() && !normalizeHex(draft)}<span class="bad">Use a hex colour like #1a9ec4.</span>{/if}
			{#if ratio !== null}
				<span class="ratio" class:low>
					Contrast {ratio.toFixed(2)}:1 against {againstLabel}{#if low} — below {min}:1, may be hard to read{/if}
				</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.cf {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-xxs);
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-xs);
		min-height: 32px;
	}
	.lbl {
		min-width: 0;
		font-size: var(--size-s);
		line-height: var(--line-s);
		color: var(--text);
	}
	.trigger {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: var(--space-xs);
		max-width: 60%;
		padding: var(--space-xxs) var(--space-xs) var(--space-xxs) var(--space-xxs);
		font-size: var(--size-xs);
		line-height: var(--line-xs);
		color: var(--text);
		background: var(--bg);
		border: none;
		border-radius: var(--radius-s);
		box-shadow: 0 0 0 var(--border-s) var(--border);
	}
	.trigger:hover {
		filter: none;
		box-shadow: 0 0 0 var(--border-s) var(--neutral-6);
	}
	.trigger[aria-expanded='true'] {
		box-shadow: 0 0 0 2px var(--text);
	}
	.trigger.low {
		box-shadow: 0 0 0 var(--border-s) var(--danger);
	}
	.chip {
		flex: none;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-xs);
		box-shadow: inset 0 0 0 var(--border-s) var(--neutral-4);
	}
	/* Unset: a checkerboard, like "no colour" in Gutenberg. */
	.chip.unset {
		background: repeating-conic-gradient(#d0d7de 0% 25%, #ffffff 0% 50%) 50% / 10px 10px;
	}
	.val {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
	}
	.pop {
		position: absolute;
		top: calc(100% + var(--space-xxs));
		left: 0;
		right: 0;
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		padding: var(--space-s);
		background: var(--surface);
		border-radius: var(--radius-m);
		box-shadow: var(--border-shadow-s), var(--shadow-m);
	}
	.pop.above {
		top: auto;
		bottom: calc(100% + var(--space-xxs));
	}
	.swatches {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-xs);
	}
	.sw {
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: 50%;
		box-shadow: inset 0 0 0 var(--border-s) var(--neutral-4);
	}
	.sw.on {
		outline: 2px solid var(--text);
		outline-offset: 2px;
	}
	.auto {
		height: 24px;
		padding: 0 var(--space-xs);
		font-size: var(--size-xs);
		color: var(--text);
		background: var(--bg);
		border: none;
		border-radius: var(--radius-xs);
		box-shadow: 0 0 0 var(--border-s) var(--border);
	}
	.auto.on {
		box-shadow: 0 0 0 2px var(--text);
	}
	.custom {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
	}
	.hex {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--size-xs);
	}
	.native {
		flex: none;
		width: 36px;
		height: 32px;
		padding: 2px;
		border: none;
		border-radius: var(--radius-xs);
		box-shadow: 0 0 0 var(--border-s) var(--border);
		background: var(--bg);
		cursor: pointer;
	}
	.bad {
		font-size: var(--size-xs);
		line-height: var(--line-xs);
		color: var(--danger);
	}
	.ratio {
		font-size: var(--size-xs);
		line-height: var(--line-xs);
		color: var(--muted);
	}
	.ratio.low {
		color: var(--danger);
	}
</style>
