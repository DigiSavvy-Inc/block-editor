# @digisavvy/block-editor

A Notion-style block editor for emails and web pages, built with Svelte 5 and ProseMirror.
Type `/` for blocks, `{{` for merge tags, select text to format it. A Design panel edits
colours, spacing, alignment and (for emails) the canvas around the content. The document
is a JSON array of blocks, and the package ships the renderers that turn it into
email-safe HTML, plain text or a web page.

Extracted from DigiSavvy's internal email app.

## Install

From a git tag (builds on install):

```sh
npm i github:DigiSavvy-Inc/block-editor#v0.1.0
```

Once published to npm:

```sh
npm i @digisavvy/block-editor
```

`svelte` 5 is a peer dependency. The ProseMirror packages and `marked` are installed with it.

## Usage in SvelteKit

The editor posts its blocks as JSON in a hidden input, so it drops into an ordinary form.

```svelte
<script lang="ts">
	import BlockEditor, { type Block, type ImageUpload } from '@digisavvy/block-editor';
	import '@digisavvy/block-editor/styles.css';

	let { data } = $props();
	let blocks = $state<Block[]>(data.blocks);

	const upload: ImageUpload = async (file) => {
		const body = new FormData();
		body.append('file', file);
		const res = await fetch('/api/images', { method: 'POST', body });
		const j = await res.json().catch(() => ({}));
		if (!res.ok || !j.url) throw new Error(j.error ?? 'Upload failed.');
		return j.url;
	};
</script>

<form method="POST">
	<BlockEditor bind:blocks name="body_blocks" mergeTags={[{ tag: '{{first_name}}', desc: 'First name' }]} {upload} />
	<button>Save</button>
</form>
```

```ts
// +page.server.ts
import { parseBlocks, sanitizeBlocks } from '@digisavvy/block-editor/blocks';

export const actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const blocks = sanitizeBlocks(parseBlocks(String(form.get('body_blocks') ?? '')));
		// store JSON.stringify(blocks)
	}
};
```

Always sanitise on the server: the posted JSON is user input.

## Props

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `blocks` | `Block[]` (bindable) | `[]` | The document. Read once on mount, then written on every change. |
| `name` | `string` | `'body_blocks'` | Name of the hidden input holding `JSON.stringify(blocks)`. |
| `mergeTags` | `{ tag: string; desc: string }[]` | `[]` | Offered in the `{{` and `/` menus. `tag` is the full tag, e.g. `'{{first_name}}'`. Any `{{field:…}}` typed in full is accepted too. |
| `target` | `'email' \| 'page'` | `'email'` | `'page'` hides merge tags and per-block visibility rules. |
| `allowContentArea` | `boolean` | `false` | Offer the "Content area" block (a template slot; renders as `CONTENT_PLACEHOLDER` in email). With `target="page"` it also shows the per-block "Show on" control. |
| `placeholder` | `string` | `"Start writing, or type '/' for blocks"` | Empty-document hint. |
| `preview` | `(blocks: Block[]) => Promise<string>` | none | Enables the Desktop / Mobile (and, for email, Dark) preview. Resolve to a full HTML document; it is shown in a sandboxed iframe. |
| `canvas` | `EmailCanvas` (bindable) | `undefined` | The email canvas (width, backdrop, fonts, padding, corners). Set it, even to `{}`, to show the Typography and Email groups in the Design panel. |
| `canvasName` | `string` | `'canvas'` | Name of the hidden input holding the canvas JSON (only rendered when `canvas` is set). |
| `onready` | `(blocks: Block[]) => void` | none | Called once after mount with the normalised blocks (useful as an unsaved-changes baseline). |
| `upload` | `ImageUpload` | none | Stores an image file. See below. |

## Image upload

```ts
type ImageUpload = (file: File) => Promise<string>;
```

The editor never talks to a server. When the user uploads an image (the Design panel's
"Upload image" button, an image file pasted or dropped into the editor, or an
aspect-ratio crop, which is saved as a new WebP or JPEG file), it calls `upload(file)`
and stores the URL you resolve to as the image's `src`.

- Resolve to an absolute `http(s)` URL. Blocks keep only `http(s)` image URLs, so a
  `blob:` or `data:` URL shows in the editor but is dropped from the saved blocks.
- Reject to fail. An `Error`'s message is shown in the Design panel's image settings;
  otherwise, or if you resolve to an empty value, the message is "Upload failed.".
- AVIF files are converted to WebP (else JPEG) in the browser first. Other files arrive
  untouched, so size and type limits are yours to enforce.
- Cropping fetches the original image in the browser, so it must be same-origin or served
  with CORS headers.

Without `upload` the editor still works: images are added by URL, the "Upload image"
button and the aspect-ratio / crop controls are hidden, a pasted image file is not
uploaded, and a dropped one is ignored.

## Styles and tokens

Import `@digisavvy/block-editor/styles.css` once. It declares default values for the
CSS custom properties the components read, in light and dark, plus base styles for the
buttons, fields and links inside the editor (scoped to its root, `.ds-block-editor`).

The tokens use `:where(:root)`, so any value you set on `:root` or an ancestor of the
editor wins. Dark mode follows `prefers-color-scheme`, unless `<html data-theme="light">`
or `<html data-theme="dark">` forces one. The editing canvas stays white in both modes,
like the email it edits.

| Group | Tokens |
| --- | --- |
| Spacing | `--space-xxs` `--space-xs` `--space-s` `--space-m` `--space-l` `--space-xl` |
| Type | `--size-xs` `--size-s` `--size-m` `--line-xs` `--line-s` `--line-m` `--letter-spacing-m` `--tracking-l` `--font-ui` `--font-mono` `--weight-ui-regular` `--weight-ui-medium` `--weight-ui-heavy` |
| Shape | `--radius-xs` `--radius-s` `--radius-m` `--border-s` `--border-l` `--shadow-s` `--shadow-m` `--border-default-color` `--border-shadow-s` `--focus-halo` |
| Motion | `--motion-duration` `--motion-easing` `--motion-press-distance` |
| Palette | `--color-1` `--color-1-transparent` `--neutral-1` … `--neutral-10` `--neutral-4-transparent` `--error` |
| Roles | `--bg` `--surface` `--surface-subtle` `--text` `--muted` `--border` `--danger` `--link` `--link-hover` `--link-underline` `--link-underline-thickness` `--link-underline-thickness-hover` `--link-underline-offset` `--btn-primary-bg` `--btn-primary-hover` `--btn-primary-active` `--btn-primary-text` `--btn-secondary-hover` |
| Host layout | `--header-h` `--sticky-actions-top` `--sticky-actions-bottom` |

`--font-ui` defaults to Inter, then the system font; the package ships no font files.

Host layout: the formatting toolbar and the Design panel stick below
`--header-h` + `--sticky-actions-top` while you scroll, and on phones the Design panel is a
bottom sheet above `--sticky-actions-bottom`. They default to `0px`. If your page has a
fixed header or a sticky action bar, set them to those heights.

Write mode (Cmd/Ctrl+Shift+F) sets `data-write-mode` on `<html>` while it is on (and
`data-write-mode-exit` briefly as it ends). Hide your own page chrome with it, for example
`html[data-write-mode] .site-header { display: none; }`.

The editor remembers a few per-browser preferences in `localStorage`: `ds-write-mode`,
`ds-write-prefs` and `ds-design-groups`.

## Server-side: `@digisavvy/block-editor/blocks`

The data layer has no Svelte, DOM or ProseMirror dependency. It runs in Node, a
Cloudflare Worker or any server runtime.

```ts
import {
	parseBlocks,
	sanitizeBlocks,
	parseCanvas,
	renderBlocksEmailHtml,
	renderBlocksEmailText,
	renderPageHtml,
	blocksToMarkdown,
	evaluateConditionals,
	buildCondCtx
} from '@digisavvy/block-editor/blocks';

const blocks = sanitizeBlocks(parseBlocks(row.body_blocks));
const canvas = parseCanvas(row.canvas);

const html = renderBlocksEmailHtml(blocks, canvas); // inner HTML, table-based, ~600px
const text = renderBlocksEmailText(blocks); // plain-text part
const page = renderPageHtml('Title', blocks); // a full HTML document for the web

// Per recipient: resolve visibility rules ({{#if}} … {{/if}}) and {{field:…}} tags.
const ctx = buildCondCtx('vip,customer', JSON.stringify({ city: 'Berlin' }));
const personal = evaluateConditionals(html, ctx, { mode: 'html' });
```

`renderBlocksEmailHtml` returns the email body, not a whole message: wrap it in your own
document (doctype, `<head>`, preheader, footer, unsubscribe link). Other merge tags such
as `{{first_name}}` are left in place; fill them with `applyMergeTokens(html, 'html', resolve)`.

Also exported: the block types, `markdownToBlocks`, `upgradeLegacyBlocks`, `blocksAreEmpty`,
`renderPageBlocks`, the canvas helpers (`sanitizeCanvas`, `canvasIsSet`, `canvasPadding`),
the merge-tag and condition helpers, and `normalizeHex` / `contrastRatio` / `autoTextColor`.

## Without Svelte

The component is a Svelte 5 component; any page can mount it with Svelte's `mount()`. You
still need a bundler that compiles `.svelte` files (for example Vite with
`@sveltejs/vite-plugin-svelte`).

```ts
import { mount, unmount } from 'svelte';
import BlockEditor from '@digisavvy/block-editor';
import '@digisavvy/block-editor/styles.css';

const editor = mount(BlockEditor, {
	target: document.querySelector('#editor')!,
	props: {
		blocks: [],
		name: 'body_blocks',
		onready: (blocks) => console.log('ready', blocks)
	}
});
// The current blocks are in <input type="hidden" name="body_blocks"> inside the editor.
// Later: unmount(editor);
```

## Development

```sh
npm install
npm run dev       # demo at src/routes
npm run check     # svelte-check
npm test          # vitest
npm run package   # builds dist/ with svelte-package
npm run lint:pkg  # publint
```

## Built on

- [ProseMirror](https://prosemirror.net/) by Marijn Haverbeke and contributors, MIT License.
- [marked](https://marked.js.org/), MIT License.
- [Svelte](https://svelte.dev/), MIT License.

## License

License: not yet decided. All rights reserved until a license is added.
