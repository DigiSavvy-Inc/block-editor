<script lang="ts">
	// Demo: the editor with sample blocks, an email / page toggle, an in-memory upload, a
	// light / dark switch, sample host actions (#5) and the live blocks JSON. Nothing here
	// touches the network.
	import BlockEditor, { type Block, type EmailCanvas, type ImageUpload, type Inline, type SelectionAction, type SelectionContext, type SlashHostAction } from '$lib/index.js';
	import { renderBlocksEmailHtml, renderPageHtml } from '$lib/data.js';
	import '$lib/styles.css';

	const text = (t: string) => [{ type: 'text' as const, text: t }];

	let blocks = $state<Block[]>([
		{ id: 'demo-eyebrow', type: 'eyebrow', content: text('Block editor demo') },
		{ id: 'demo-h1', type: 'heading', level: 1, text: 'Hello there', content: text('Hello there') },
		{
			id: 'demo-p1',
			type: 'paragraph',
			content: [...text('Hi '), { type: 'mergeTag', tag: 'first_name' }, ...text(', type '), { type: 'text', text: '/', marks: [{ type: 'code' }] }, ...text(' on an empty line to insert a block, or select text to format it.')]
		},
		{ id: 'demo-list', type: 'list', ordered: false, items: [text('Sections, columns, buttons and images'), text('Merge tags and per-recipient visibility (email target)')] },
		{ id: 'demo-toc', type: 'toc', levels: [2, 3], title: 'On this page' },
		{
			id: 'demo-section',
			type: 'section',
			bg: '#066971',
			padding: 'md',
			width: 'full',
			blocks: [
				{ id: 'demo-h2', type: 'heading', level: 2, text: 'A coloured section', content: text('A coloured section') },
				{ id: 'demo-p2', type: 'paragraph', content: text('Text colour picks black or white automatically for contrast.') },
				{ id: 'demo-btn', type: 'button', label: 'Call to action', href: 'https://example.com', align: 'left' }
			]
		},
		{ id: 'demo-h2b', type: 'heading', level: 2, text: 'Try it out', content: text('Try it out') },
		{ id: 'demo-h3a', type: 'heading', level: 3, text: 'Images', content: text('Images') },
		{ id: 'demo-p3', type: 'paragraph', content: text('Try the Image block: "Upload image" in the Design panel uses the demo\'s in-memory upload.') },
		{ id: 'demo-h3b', type: 'heading', level: 3, text: 'Table of contents', content: text('Table of contents') },
		{ id: 'demo-p4', type: 'paragraph', content: text('The list above follows the headings as you edit them. Select it to choose which levels it shows.') }
	]);
	let canvas = $state<EmailCanvas | undefined>({});
	let target = $state<'email' | 'page'>('email');
	let theme = $state<'system' | 'light' | 'dark'>('system');
	let uploadOn = $state(true);

	const mergeTags = [
		{ tag: '{{first_name}}', desc: 'First name' },
		{ tag: '{{last_name}}', desc: 'Last name' },
		{ tag: '{{email}}', desc: 'Email address' }
	];

	// In-memory upload: the file stays in this tab as an object URL. A real host uploads the
	// file and resolves to its public https URL. (The blocks keep only http(s) image URLs, so
	// an image uploaded here shows in the editor but has src "" in the JSON below.)
	const upload: ImageUpload = async (file) => {
		await new Promise((r) => setTimeout(r, 300));
		return URL.createObjectURL(file);
	};

	function preview(b: Block[]): Promise<string> {
		if (target === 'page') return Promise.resolve(renderPageHtml('Demo page', b));
		const inner = renderBlocksEmailHtml(b, canvas);
		return Promise.resolve(
			`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px;background:#f4f4f5"><div style="max-width:600px;margin:0 auto;background:#fff;padding:24px">${inner}</div></body></html>`
		);
	}

	// #5: sample host actions. "Shout" upper-cases the selection at once; "Hold" opens a
	// small panel (focus moves to its input, the selection stays highlighted); "Stamp" is a
	// slash entry.
	const upper = (runs: Inline[]): Inline[] => runs.map((r) => (r.type === 'text' ? { ...r, text: r.text.toUpperCase() } : r));
	function upperBlock(b: Block): Block {
		if (b.type === 'paragraph' || b.type === 'quote' || b.type === 'callout' || b.type === 'eyebrow') return { ...b, content: upper(b.content) };
		if (b.type === 'heading') return { ...b, text: b.text.toUpperCase(), ...(b.content ? { content: upper(b.content) } : {}) };
		if (b.type === 'list') return { ...b, items: b.items.map(upper) };
		return b;
	}
	const shout: SelectionAction = {
		id: 'shout',
		label: 'Shout',
		icon: 'heading',
		title: 'Upper-case the selection',
		shortcut: 'Mod+Shift+U',
		onSelect(ctx) {
			const { inline, blocks: sel, partial, text } = ctx.selection;
			if (inline) ctx.replaceSelection(upper(inline));
			else if (!partial) ctx.replaceSelection(sel.map(upperBlock));
			else ctx.replaceSelection([{ id: crypto.randomUUID(), type: 'paragraph', content: [{ type: 'text', text: text.toUpperCase() }] }]);
		}
	};

	let hold = $state.raw<{ ctx: SelectionContext; top: number; left: number } | null>(null);
	let holdText = $state('');
	const holdAction: SelectionAction = {
		id: 'hold',
		label: 'Hold',
		icon: 'edit',
		title: 'Replace or insert from a panel',
		onSelect(ctx) {
			// The anchor is relative to the editor canvas; the panel is fixed on the page.
			const c = document.querySelector('.be-canvas')?.getBoundingClientRect();
			hold = { ctx, top: (c?.top ?? 0) + ctx.anchor.bottom + 8, left: (c?.left ?? 0) + ctx.anchor.left };
			holdText = ctx.selection.text;
		}
	};
	function holdDone(act: 'replace' | 'insert' | 'cancel') {
		const ctx = hold?.ctx;
		hold = null;
		if (!ctx) return;
		if (act === 'replace') ctx.replaceSelection([{ type: 'text', text: holdText }]);
		else if (act === 'insert') ctx.insertAfterSelection([{ id: crypto.randomUUID(), type: 'paragraph', content: [{ type: 'text', text: holdText }] }]);
		ctx.restoreFocus();
	}

	const stamp: SlashHostAction = {
		id: 'stamp',
		label: 'Stamp',
		title: 'Insert a sample paragraph',
		onSelect(ctx) {
			ctx.replaceSelection([{ id: crypto.randomUUID(), type: 'paragraph', content: [{ type: 'text', text: 'Stamped' }] }]);
		}
	};

	$effect(() => {
		const html = document.documentElement;
		if (theme === 'system') delete html.dataset.theme;
		else html.dataset.theme = theme;
	});
</script>

<svelte:head>
	<title>@digisavvy/block-editor demo</title>
</svelte:head>

<main>
	<header>
		<h1>@digisavvy/block-editor</h1>
		<div class="controls">
			<label
				>Target
				<select bind:value={target}>
					<option value="email">Email</option>
					<option value="page">Web page</option>
				</select>
			</label>
			<label><input type="checkbox" bind:checked={uploadOn} /> Image upload</label>
			<label
				>Theme
				<select bind:value={theme}>
					<option value="system">System</option>
					<option value="light">Light</option>
					<option value="dark">Dark</option>
				</select>
			</label>
		</div>
	</header>

	{#key target}
		<BlockEditor
			bind:blocks
			bind:canvas
			{target}
			mergeTags={target === 'email' ? mergeTags : []}
			upload={uploadOn ? upload : undefined}
			{preview}
			placeholder="Start writing, or type '/' for blocks"
			selectionActions={[shout, holdAction]}
			slashActions={[stamp]}
		/>
	{/key}

	{#if hold}
		<!-- ds-block-editor: the editor's own button and field styles. -->
		<div class="hold ds-block-editor" role="dialog" aria-label="Hold" tabindex="-1" style="top:{hold.top}px;left:{hold.left}px">
			<input
				{@attach (el) => el.focus()}
				bind:value={holdText}
				aria-label="Text"
				onkeydown={(e) => {
					if (e.key === 'Escape') holdDone('cancel');
				}}
			/>
			<button type="button" onclick={() => holdDone('replace')}>Replace</button>
			<button type="button" class="secondary" onclick={() => holdDone('insert')}>Insert below</button>
			<button type="button" class="secondary" onclick={() => holdDone('cancel')}>Cancel</button>
		</div>
	{/if}

	<section class="json">
		<h2>blocks</h2>
		<pre>{JSON.stringify(blocks, null, 2)}</pre>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font-family: var(--font-ui);
	}
	main {
		max-width: 1100px;
		margin: 0 auto;
		padding: 24px 16px 64px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	h1 {
		margin: 0;
		font-size: 20px;
	}
	.controls {
		display: flex;
		gap: 16px;
	}
	label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
	}
	.hold {
		position: fixed;
		z-index: 50;
		display: flex;
		gap: 6px;
		padding: 8px;
		border-radius: 8px;
		background: var(--surface);
		box-shadow: 0 0 0 1px var(--border), var(--shadow-m);
	}
	.json h2 {
		font-size: 14px;
		margin: 0 0 8px;
		color: var(--muted);
	}
	pre {
		margin: 0;
		max-height: 420px;
		overflow: auto;
		padding: 12px;
		border-radius: 8px;
		background: var(--surface);
		box-shadow: 0 0 0 1px var(--border);
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.5;
	}
</style>
