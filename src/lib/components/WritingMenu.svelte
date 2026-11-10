<script lang="ts">
	// #525: Write mode's Writing preferences — drafting face (Sans / Serif) and Focus
	// paragraph. A small popover in the editor bar; BlockEditor owns and saves `prefs`
	// (localStorage `ds-write-prefs`). Escape / an outside click / the button close it.
	import Icon from '$lib/components/Icon.svelte';
	import type { WritePrefs } from '$lib/write-prefs.js';

	let {
		prefs,
		onchange,
		open = $bindable(false)
	}: { prefs: WritePrefs; onchange: (next: WritePrefs) => void; open?: boolean } = $props();

	let root = $state<HTMLDivElement | undefined>();
	const popId = `wm-${Math.random().toString(36).slice(2, 8)}`;

	function onDocPointer(e: PointerEvent) {
		if (open && root && !root.contains(e.target as Node | null)) open = false;
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			// Close only the popover; Write mode sees it still open and stays on.
			open = false;
			if (root?.contains(document.activeElement)) (root.querySelector('.wm-btn') as HTMLButtonElement | null)?.focus();
		}
	}
</script>

<svelte:document onpointerdown={onDocPointer} />
<svelte:window onkeydown={onKey} />

<div class="wm" bind:this={root}>
	<button type="button" class="wm-btn" class:on={open} aria-expanded={open} aria-controls={popId} onclick={() => (open = !open)}>
		<Icon name="text" size={16} /> Writing
	</button>
	{#if open}
		<div class="wm-pop" id={popId} role="dialog" aria-label="Writing preferences">
			<div class="wm-row" role="radiogroup" aria-label="Drafting face">
				<span class="wm-label">Face</span>
				<div class="wm-seg">
					<button type="button" role="radio" aria-checked={prefs.font === 'sans'} class:on={prefs.font === 'sans'} onclick={() => onchange({ ...prefs, font: 'sans' })}>Sans</button>
					<button type="button" role="radio" aria-checked={prefs.font === 'serif'} class:on={prefs.font === 'serif'} class="serif" onclick={() => onchange({ ...prefs, font: 'serif' })}>Serif</button>
				</div>
			</div>
			<label class="wm-row wm-switch">
				<span class="wm-label">Focus paragraph</span>
				<input type="checkbox" role="switch" checked={prefs.focus} onchange={(e) => onchange({ ...prefs, focus: e.currentTarget.checked })} />
			</label>
			<p class="wm-note">Editor only: your email keeps its own fonts.</p>
		</div>
	{/if}
</div>

<style>
	.wm {
		position: relative;
	}
	.wm-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-xxs);
		padding: var(--space-xxs) var(--space-s);
		font-size: var(--size-s);
		line-height: var(--line-s);
		color: var(--muted);
		background: var(--bg);
		border: none;
		border-radius: var(--radius-s);
		box-shadow: 0 0 0 var(--border-s) var(--border);
	}
	.wm-btn:hover,
	.wm-btn.on {
		filter: none;
		color: var(--text);
	}
	.wm-pop {
		position: absolute;
		top: calc(100% + var(--space-xxs));
		left: 0;
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
		width: 240px;
		padding: var(--space-s);
		background: var(--surface);
		border-radius: var(--radius-m);
		box-shadow: var(--border-shadow-s), var(--shadow-m);
	}
	.wm-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-s);
		font-size: var(--size-s);
	}
	.wm-label {
		color: var(--text);
	}
	.wm-seg {
		display: inline-flex;
		border-radius: var(--radius-s);
		box-shadow: 0 0 0 var(--border-s) var(--border);
		overflow: hidden;
	}
	.wm-seg button {
		padding: var(--space-xxs) var(--space-s);
		font-size: var(--size-s);
		color: var(--muted);
		background: var(--bg);
		border: none;
		border-radius: 0;
	}
	.wm-seg button.serif {
		font-family: Georgia, Charter, 'Iowan Old Style', serif;
	}
	.wm-seg button.on {
		color: var(--text);
		background: var(--surface-subtle);
		font-weight: var(--weight-ui-medium);
	}
	.wm-switch {
		cursor: pointer;
	}
	.wm-note {
		margin: 0;
		font-size: var(--size-xs);
		color: var(--muted);
	}
</style>
