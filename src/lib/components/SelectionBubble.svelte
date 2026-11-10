<script lang="ts">
	// #524: the floating formatting bubble over a text selection (Medium-style). Acts through
	// the same editor controller + formatState as FormatToolbar (#276); in Write mode it is the
	// only formatting UI. Buttons keep the editor's selection (mousedown is prevented); Tab
	// from the doc reaches them, Escape closes the bubble.
	import Icon from '$lib/components/Icon.svelte';
	import type { IconName } from '$lib/icons/glyphs.js';
	import type { TurnInto } from '$lib/editor/doc.js';
	import type { EditorController, FormatState } from '$lib/editor/setup.js';

	let {
		ctl,
		format,
		top,
		left,
		onLink,
		onClose
	}: {
		ctl: EditorController;
		format: FormatState | null;
		/** Position relative to the canvas (px). */
		top: number;
		left: number;
		/** Open the existing link editor for the selection. */
		onLink: () => void;
		/** Escape: hide the bubble and return focus to the doc. */
		onClose: () => void;
	} = $props();

	type Mark = 'bold' | 'italic' | 'underline' | 'strike';
	const MARKS: { mark: Mark; icon: IconName; title: string }[] = [
		{ mark: 'bold', icon: 'bold', title: 'Bold (Cmd/Ctrl+B)' },
		{ mark: 'italic', icon: 'italic', title: 'Italic (Cmd/Ctrl+I)' },
		{ mark: 'underline', icon: 'underline', title: 'Underline (Cmd/Ctrl+U)' },
		{ mark: 'strike', icon: 'strike', title: 'Strikethrough (Cmd/Ctrl+Shift+S)' }
	];
	const TURNS: { to: TurnInto; label: string; title: string }[] = [
		{ to: 'h2', label: 'H2', title: 'Heading 2 (Cmd/Ctrl+Alt+2)' },
		{ to: 'h3', label: 'H3', title: 'Heading 3 (Cmd/Ctrl+Alt+3)' }
	];

	const f = $derived(format);
	const keep = (e: MouseEvent) => e.preventDefault();
	/** Pressing an active block type again turns it back into a paragraph. */
	function turn(to: TurnInto) {
		ctl.turnSelection(f?.turn === to ? 'paragraph' : to);
	}
	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.stopPropagation();
		onClose();
	}
</script>

<div class="be-pop be-selbar" role="toolbar" aria-label="Format selection" tabindex="-1" style="top:{top}px;left:{left}px" onmousedown={keep} onkeydown={onKey}>
	{#each MARKS as m (m.mark)}
		{@const on = !!f?.marks.includes(m.mark)}
		<button type="button" class="sb" class:on aria-pressed={on} title={m.title} aria-label={m.title} disabled={!f?.canMark} onclick={() => ctl.toggleMark(m.mark)}>
			<Icon name={m.icon} size={16} />
		</button>
	{/each}
	<button type="button" class="sb" class:on={!!f?.href} aria-pressed={!!f?.href} title="Link" aria-label="Link" disabled={!f?.textSel} onclick={onLink}>
		<Icon name="link" size={16} />
	</button>
	<span class="sep" aria-hidden="true"></span>
	{#each TURNS as t (t.to)}
		{@const on = f?.turn === t.to}
		<button type="button" class="sb txt" class:on aria-pressed={on} title={t.title} aria-label={t.title} disabled={!f?.turn} onclick={() => turn(t.to)}>{t.label}</button>
	{/each}
	<button type="button" class="sb" class:on={f?.turn === 'quote'} aria-pressed={f?.turn === 'quote'} title="Quote" aria-label="Quote" disabled={!f?.turn} onclick={() => turn('quote')}>
		<Icon name="quote" size={16} />
	</button>
	<span class="sep" aria-hidden="true"></span>
	<button type="button" class="sb" title="Clear formatting" aria-label="Clear formatting" disabled={!f} onclick={() => ctl.clearFormatting()}>
		<Icon name="clear-format" size={16} />
	</button>
</div>

<style>
	.be-selbar {
		position: absolute;
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: var(--space-xxs);
		border-radius: var(--radius-s);
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 0 0 var(--border-s) var(--border), var(--shadow-m);
		font-family: var(--font-ui, inherit);
		white-space: nowrap;
	}
	.sb {
		min-width: 30px;
		height: 30px;
		padding: 0 var(--space-xs);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text);
		background: transparent;
		border: none;
		border-radius: var(--radius-xs);
		font-size: var(--size-s);
	}
	.sb.txt {
		font-weight: 700;
	}
	.sb:hover:not(:disabled),
	.sb.on {
		filter: none;
		background: var(--bg);
	}
	.sb.on {
		box-shadow: inset 0 0 0 var(--border-s) var(--neutral-4);
	}
	.sb:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.sep {
		width: 1px;
		align-self: stretch;
		margin: 4px 2px;
		background: var(--border);
	}
</style>
