// @digisavvy/block-editor/blocks: the pure data layer. No Svelte, no DOM, no ProseMirror:
// safe to import in a server, a Cloudflare Worker or any other JavaScript runtime.
//
// - The block model and its types, parseBlocks / sanitizeBlocks, the email canvas helpers.
// - Renderers: renderBlocksEmailHtml / renderBlocksEmailText (table-based email markup)
//   and renderPageBlocks / renderPageHtml (semantic HTML + CSS for a hosted page).
// - Markdown: markdownToBlocks / blocksToMarkdown / upgradeLegacyBlocks.
// - Merge tags ({{first_name}}) and visibility conditions ({{#if tag:x}}) helpers.
// - The default swatch palette, colour helpers, and browser-only AVIF conversion helpers.
export * from './blocks.js';
export { markdownToBlocks, blocksToMarkdown, upgradeLegacyBlocks } from './blocks-markdown.js';
export * from './merge-tags.js';
export * from './conditionals.js';
export { BRAND_SWATCHES, MIN_CONTRAST, autoTextColor, contrastRatio, normalizeHex, type BrandLogo, type Swatch } from './brand.js';
export { IMAGE_RATIOS, FOCAL_POINTS, type ImageRatio, type FocalPoint } from './image-crop.js';
// Browser-side AVIF → WebP/JPEG conversion for a host's own file inputs. Importing is safe
// anywhere; calling needs a browser (createImageBitmap, a canvas).
export {
	AVIF_CONVERT_ERROR,
	AVIF_CONVERT_ERROR_NO_JPEG,
	convertFileInput,
	isAvif,
	prepareImageForUpload
} from './image-convert.js';
