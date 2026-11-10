<script lang="ts">
	// One icon from the DS CRM glyph set (#209). Decorative by default (aria-hidden) — pass
	// `label` only when the icon stands alone with no visible text beside it.
	import { GLYPHS, type IconName } from '$lib/icons/glyphs.js';
	import { iconAttrs, type IconSize } from '$lib/icons/icon.js';

	let {
		name,
		size = 20,
		label,
		strokeWidth,
		class: className = ''
	}: { name: IconName; size?: IconSize | 14; label?: string; strokeWidth?: number; class?: string } = $props();

	const attrs = $derived(iconAttrs(size, label, strokeWidth));
</script>

<!-- @html is safe: GLYPHS is our own constant markup (src/lib/icons/glyphs.ts), never user input. -->
<svg class="icon {className}" {...attrs}>{#if label}<title>{label}</title>{/if}{@html GLYPHS[name]}</svg>

<style>
	.icon {
		display: inline-block;
		flex: none;
		vertical-align: -0.125em;
	}
</style>
