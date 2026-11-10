// @digisavvy/block-editor: the Svelte component and its public types.
// The pure data layer (sanitise, render, markdown) is the `./blocks` entry point.
export { default, default as BlockEditor } from './components/BlockEditor.svelte';
export type { ImageUpload } from './upload.js';
export type {
	Align,
	Block,
	ColumnsBlock,
	EmailCanvas,
	EmailFontKey,
	Inline,
	InlineMark,
	MarkType,
	Milestone,
	SectionBlock,
	ShowOn,
	SpaceBelow,
	TextSize,
	Visibility
} from './blocks.js';
