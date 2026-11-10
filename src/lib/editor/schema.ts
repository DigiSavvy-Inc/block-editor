// #250: the ProseMirror schema behind BlockEditor. Mirrors the Block model in
// $lib/blocks one-to-one (see ./doc.ts for the conversion). Pasted HTML is parsed
// through these rules only, so anything outside the schema (styles, classes, fonts,
// tables, scripts) is dropped on paste.
import { Schema, type NodeSpec, type MarkSpec, type Node as PMNode } from 'prosemirror-model';
import { cleanHref } from '$lib/blocks.js';
import { autoTextColor, normalizeHex } from '$lib/brand.js';
import { isMergeToken } from '$lib/merge-tags.js';

// #270: `design` = the block's design attributes (align, spaceBelow, colours… — see
// DESIGN_KEYS in $lib/blocks) as one plain object; painted by the editor's decorations.
const blockAttrs = { id: { default: null }, visibility: { default: null }, design: { default: null } };

/** Atom blocks round-trip their attrs through copy/paste as one JSON data attribute. */
function atomDom(name: string) {
	return {
		toDOM: (node: PMNode) => ['div', { 'data-pm-block': name, 'data-attrs': JSON.stringify(node.attrs) }] as const,
		parse: {
			tag: `div[data-pm-block="${name}"]`,
			getAttrs: (dom: HTMLElement) => {
				try {
					return JSON.parse(dom.getAttribute('data-attrs') ?? '{}');
				} catch {
					return {};
				}
			}
		}
	};
}

const image = atomDom('image');
const button = atomDom('button');
const spacer = atomDom('spacer');
const contentArea = atomDom('content_area');

const nodes: Record<string, NodeSpec> = {
	doc: { content: 'block+' },
	paragraph: {
		group: 'block cellblock secblock',
		content: 'inline*',
		attrs: blockAttrs,
		parseDOM: [{ tag: 'p' }],
		toDOM: () => ['p', 0]
	},
	heading: {
		group: 'block cellblock secblock',
		content: 'inline*',
		defining: true,
		// #262: size 'display' = the hero headline (level 1).
		attrs: { ...blockAttrs, level: { default: 2 }, size: { default: null } },
		parseDOM: [
			{ tag: 'h1.pm-display', attrs: { level: 1, size: 'display' } },
			{ tag: 'h1', attrs: { level: 1 } },
			{ tag: 'h2', attrs: { level: 2 } },
			{ tag: 'h3', attrs: { level: 3 } },
			{ tag: 'h4', attrs: { level: 3 } },
			{ tag: 'h5', attrs: { level: 3 } },
			{ tag: 'h6', attrs: { level: 3 } }
		],
		toDOM: (n) => (n.attrs.size === 'display' ? ['h1', { class: 'pm-display' }, 0] : [`h${n.attrs.level}`, 0])
	},
	// #262: short accent rule + small bold uppercase label.
	eyebrow: {
		group: 'block cellblock secblock',
		content: 'inline*',
		defining: true,
		attrs: { ...blockAttrs, tone: { default: null } },
		parseDOM: [{ tag: 'div.pm-eyebrow', getAttrs: (dom: HTMLElement) => ({ tone: dom.getAttribute('data-tone') === 'accent' ? 'accent' : null }) }],
		toDOM: (n) => ['div', { class: 'pm-eyebrow', 'data-tone': n.attrs.tone ?? 'text' }, 0]
	},
	// #262: 2–4 { title, label } items, optional thick top rule.
	milestones: {
		group: 'block cellblock secblock',
		content: 'milestone{2,4}',
		attrs: { ...blockAttrs, rule: { default: true } },
		parseDOM: [{ tag: 'div.pm-milestones', getAttrs: (dom: HTMLElement) => ({ rule: dom.getAttribute('data-rule') !== 'false' }) }],
		toDOM: (n) => ['div', { class: 'pm-milestones', 'data-rule': String(!!n.attrs.rule), 'data-n': String(n.childCount) }, 0]
	},
	milestone: {
		content: 'milestone_title milestone_label',
		isolating: true,
		parseDOM: [{ tag: 'div.pm-milestone' }],
		toDOM: () => ['div', { class: 'pm-milestone' }, 0]
	},
	milestone_title: {
		content: 'inline*',
		defining: true,
		parseDOM: [{ tag: 'div.pm-ms-title' }],
		toDOM: () => ['div', { class: 'pm-ms-title' }, 0]
	},
	milestone_label: {
		content: 'inline*',
		defining: true,
		parseDOM: [{ tag: 'div.pm-ms-label' }],
		toDOM: () => ['div', { class: 'pm-ms-label' }, 0]
	},
	// #262: a coloured band holding blocks (never another section). Attrs round-trip a
	// copy through data-attrs; the inline style only paints the editor.
	section: {
		group: 'block',
		content: 'secblock+',
		attrs: { ...blockAttrs, bg: { default: '#ffffff' }, color: { default: null }, padding: { default: 'lg' }, width: { default: 'full' }, align: { default: null } },
		parseDOM: [
			{
				tag: 'div.pm-section',
				getAttrs: (dom: HTMLElement) => {
					try {
						return JSON.parse(dom.getAttribute('data-attrs') ?? '{}');
					} catch {
						return {};
					}
				}
			}
		],
		toDOM: (n) => {
			const bg = normalizeHex(n.attrs.bg) || '#ffffff';
			const color = normalizeHex(n.attrs.color) || autoTextColor(bg);
			return [
				'div',
				{
					class: 'pm-section',
					'data-pad': String(n.attrs.padding),
					'data-width': String(n.attrs.width),
					'data-align': n.attrs.align === 'center' ? 'center' : 'left',
					'data-attrs': JSON.stringify({ bg: n.attrs.bg, color: n.attrs.color, padding: n.attrs.padding, width: n.attrs.width, align: n.attrs.align, design: n.attrs.design }),
					style: `background:${bg};color:${color};--sec-fg:${color};--sec-bg:${bg}`
				},
				0
			];
		}
	},
	bullet_list: {
		group: 'block cellblock secblock',
		content: 'list_item+',
		attrs: blockAttrs,
		parseDOM: [{ tag: 'ul' }],
		toDOM: () => ['ul', 0]
	},
	ordered_list: {
		group: 'block cellblock secblock',
		content: 'list_item+',
		// #262: style 'steps' = outlined circle numbers + hairlines.
		attrs: { ...blockAttrs, style: { default: null } },
		parseDOM: [{ tag: 'ol', getAttrs: (dom: HTMLElement) => ({ style: dom.classList.contains('pm-steps') ? 'steps' : null }) }],
		toDOM: (n) => (n.attrs.style === 'steps' ? ['ol', { class: 'pm-steps' }, 0] : ['ol', 0])
	},
	list_item: {
		content: 'paragraph',
		defining: true,
		parseDOM: [{ tag: 'li' }],
		toDOM: () => ['li', 0]
	},
	quote: {
		group: 'block cellblock secblock',
		content: 'inline*',
		defining: true,
		attrs: blockAttrs,
		parseDOM: [{ tag: 'blockquote' }],
		toDOM: () => ['blockquote', 0]
	},
	callout: {
		group: 'block cellblock secblock',
		content: 'inline*',
		defining: true,
		attrs: blockAttrs,
		parseDOM: [{ tag: 'div.pm-callout' }],
		toDOM: () => ['div', { class: 'pm-callout' }, 0]
	},
	divider: {
		group: 'block cellblock secblock',
		atom: true,
		selectable: true,
		attrs: blockAttrs,
		parseDOM: [{ tag: 'hr' }],
		toDOM: () => ['hr']
	},
	image: {
		group: 'block cellblock secblock',
		atom: true,
		selectable: true,
		draggable: true,
		attrs: {
			...blockAttrs,
			src: { default: '' },
			alt: { default: '' },
			href: { default: '' },
			width: { default: null },
			widthPct: { default: null },
			style: { default: null },
			beside: { default: '' },
			ratio: { default: null },
			origSrc: { default: null },
			focal: { default: null }
		},
		parseDOM: [
			image.parse,
			{
				tag: 'img[src]',
				getAttrs: (dom: HTMLElement) => {
					const src = dom.getAttribute('src') ?? '';
					return /^https?:\/\//i.test(src) ? { src, alt: dom.getAttribute('alt') ?? '' } : false;
				}
			}
		],
		toDOM: image.toDOM
	},
	button: {
		group: 'block cellblock secblock',
		atom: true,
		selectable: true,
		attrs: { ...blockAttrs, label: { default: '' }, href: { default: '' }, align: { default: 'left' }, linkLabel: { default: '' }, linkHref: { default: '' } },
		parseDOM: [button.parse],
		toDOM: button.toDOM
	},
	spacer: {
		group: 'block cellblock secblock',
		atom: true,
		selectable: true,
		attrs: { ...blockAttrs, size: { default: 'md' } },
		parseDOM: [spacer.parse],
		toDOM: spacer.toDOM
	},
	content_area: {
		group: 'block secblock',
		atom: true,
		selectable: true,
		attrs: blockAttrs,
		parseDOM: [contentArea.parse],
		toDOM: contentArea.toDOM
	},
	columns: {
		group: 'block secblock',
		content: 'column{2,3}',
		attrs: blockAttrs,
		parseDOM: [{ tag: 'div.pm-columns' }],
		toDOM: (n) => ['div', { class: 'pm-columns', 'data-cols': String(n.childCount) }, 0]
	},
	column: {
		content: 'cellblock+',
		isolating: true,
		parseDOM: [{ tag: 'div.pm-column' }],
		toDOM: () => ['div', { class: 'pm-column' }, 0]
	},
	text: { group: 'inline' },
	merge_tag: {
		group: 'inline',
		inline: true,
		atom: true,
		selectable: true,
		attrs: { tag: { default: '' } },
		leafText: (n) => `{{${n.attrs.tag}}}`,
		parseDOM: [
			{
				tag: 'span[data-merge-tag]',
				getAttrs: (dom: HTMLElement) => {
					const tag = dom.getAttribute('data-merge-tag') ?? '';
					return isMergeToken(tag) ? { tag } : false;
				}
			}
		],
		toDOM: (n) => ['span', { class: 'pm-merge', 'data-merge-tag': n.attrs.tag }, `{{${n.attrs.tag}}}`]
	},
	hard_break: {
		group: 'inline',
		inline: true,
		selectable: false,
		parseDOM: [{ tag: 'br' }],
		toDOM: () => ['br']
	}
};

const boldWeight = (v: string) => /^(bold(er)?|[5-9]\d\d)$/.test(v) && null;

const marks: Record<string, MarkSpec> = {
	link: {
		attrs: { href: {} },
		inclusive: false,
		parseDOM: [
			{
				tag: 'a[href]',
				getAttrs: (dom: HTMLElement) => {
					const href = cleanHref(dom.getAttribute('href'));
					return href ? { href } : false;
				}
			}
		],
		toDOM: (m) => ['a', { href: m.attrs.href, rel: 'noopener noreferrer nofollow' }, 0]
	},
	bold: {
		parseDOM: [
			{ tag: 'strong' },
			// Google Docs wraps whole documents in <b style="font-weight:normal">.
			{ tag: 'b', getAttrs: (dom: HTMLElement) => dom.style.fontWeight !== 'normal' && null },
			{ style: 'font-weight', getAttrs: (v: string) => boldWeight(v) }
		],
		toDOM: () => ['strong', 0]
	},
	italic: {
		parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
		toDOM: () => ['em', 0]
	},
	underline: {
		parseDOM: [{ tag: 'u' }, { style: 'text-decoration', getAttrs: (v: string) => /underline/.test(v) && null }],
		toDOM: () => ['u', 0]
	},
	strike: {
		parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration', getAttrs: (v: string) => /line-through/.test(v) && null }],
		toDOM: () => ['s', 0]
	},
	code: {
		parseDOM: [{ tag: 'code' }],
		toDOM: () => ['code', 0]
	},
	// #276: inline text colour (a normalised hex). Parsed only from the editor's own copy
	// markup, so pasted documents never bring their colours along.
	textColor: {
		attrs: { color: {} },
		parseDOM: [
			{
				tag: 'span[data-text-color]',
				getAttrs: (dom: HTMLElement) => {
					const color = normalizeHex(dom.getAttribute('data-text-color'));
					return color ? { color } : false;
				}
			}
		],
		toDOM: (m) => {
			const color = normalizeHex(m.attrs.color) || '#000000';
			return ['span', { 'data-text-color': color, style: `color:${color}` }, 0];
		}
	}
};

export const schema = new Schema({ nodes, marks });
