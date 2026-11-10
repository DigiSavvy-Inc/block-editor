// #250: the client-side ProseMirror editor behind BlockEditor.svelte. Loaded lazily (a
// dynamic import from the component), so the prosemirror chunk only ships on pages
// that use the editor. All UI (menus, toolbar, handle, panels) is Svelte; this module
// owns the document, input rules, keymaps, paste handling and node views, and reports
// what the UI should show through `onUi`.
import { EditorState, NodeSelection, Plugin, PluginKey, Selection, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet, type NodeView } from 'prosemirror-view';
import type { Slice, Node as PMNodeT, MarkType } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { baseKeymap, chainCommands, setBlockType, toggleMark } from 'prosemirror-commands';
import { InputRule, inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { splitListItem, liftListItem } from 'prosemirror-schema-list';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { schema } from './schema.js';
import { blockFromPM, blockToPM, convertBlock, type PMNode, type TurnInto } from './doc.js';
import {
	moveBlock,
	moveBlockTr,
	arrowBlock,
	isContainer,
	initialSelection,
	setAlign,
	setTextSize,
	setTextColor,
	turnSelectionInto,
	clearFormatting,
	formatState,
	type FormatState
} from './commands.js';
import { cleanPastedHtml } from './paste.js';
import { linkAtSelection, unlinkTr } from './link-range.js';
import { pasteLinkTr } from './paste-link.js';
import { focusDimPlugin, setFocusDimTr } from './focus-dim.js';
import { SHOW_ON_LABELS, TEXT_SIZE_PX, clampImageWidthPct, cleanHref, cleanImageUrl, textSizeKind, type Align, type TextSize, type Visibility } from '$lib/blocks.js';
import { BRAND } from '$lib/brand.js';
import { isMergeToken } from '$lib/merge-tags.js';

export { schema };

type Rect = { left: number; top: number; bottom: number; right: number };

export type MenuState = { kind: 'slash' | 'merge'; query: string; from: number; to: number; rect: Rect };
export type BubbleState = { rect: Rect; active: string[]; href: string | null };
export type AtomState = { pos: number; type: string; attrs: Record<string, unknown>; rect: Rect };
/** #473: the link around an empty caret (the link preview popover). */
export type LinkAtState = { from: number; to: number; href: string; rect: Rect };
/** #276: `format` = what the fixed formatting toolbar shows for the selection. */
export type UiState = { menu: MenuState | null; bubble: BubbleState | null; atom: AtomState | null; format: FormatState | null; linkAt: LinkAtState | null };
export type { FormatState };

export type EditorOptions = {
	doc: PMNode;
	onChange: (doc: PMNode) => void;
	onUi: (ui: UiState) => void;
	/** Menu keyboard (↑↓ Enter Tab Esc) while a menu is open; true = handled. */
	onKey: (e: KeyboardEvent) => boolean;
	uploadImage: (file: File) => Promise<string | null>;
	/** False = the host has no image upload: pasted / dropped image files are not uploaded
	 *  and the empty image block only asks for a URL. Absent = uploads available. */
	canUpload?: () => boolean;
	placeholder?: string;
	/** Accessible name of the editing surface (default "Email body"). */
	label?: string;
};

const ID_TYPES = new Set([
	'paragraph',
	'heading',
	'bullet_list',
	'ordered_list',
	'quote',
	'callout',
	'divider',
	'image',
	'button',
	'spacer',
	'content_area',
	'columns',
	'section',
	'eyebrow',
	'milestones'
]);
const MS_FIELDS = new Set(['milestone_title', 'milestone_label']);
const ATOM_TYPES = new Set(['image', 'button', 'spacer', 'divider', 'content_area']);

const newId = () => crypto.randomUUID();

/** Every block node gets a unique id. A split copies attrs, so a duplicate id is a new
 *  block: it gets a fresh id and loses the copied visibility rule. */
function uniqueIds() {
	return new Plugin({
		appendTransaction(trs, _old, state) {
			if (!trs.some((t) => t.docChanged)) return null;
			const seen = new Set<string>();
			let tr: Transaction | null = null;
			state.doc.descendants((node, pos, parent) => {
				if (node.isTextblock && !ID_TYPES.has(node.type.name)) return false;
				if (ID_TYPES.has(node.type.name) && parent?.type.name !== 'list_item') {
					const id = node.attrs.id as string | null;
					if (!id || seen.has(id)) {
						tr ??= state.tr;
						tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: newId(), visibility: id ? null : node.attrs.visibility });
					} else seen.add(id);
				}
				return !node.isTextblock;
			});
			return tr ? (tr as Transaction).setMeta('addToHistory', false) : null;
		}
	});
}

/** `**bold**`, `*italic*`, `` `code` `` while typing. The match's last character is the
 *  one being typed (not in the doc yet). */
function markRule(re: RegExp, type: MarkType): InputRule {
	return new InputRule(re, (state, match, _start, end) => {
		const full = match[1];
		const inner = match[2];
		if (!inner) return null;
		const from = end - (full.length - 1);
		const marks = [...state.doc.resolve(from).marks().filter((m) => m.type !== type), type.create()];
		return state.tr.replaceWith(from, end, schema.text(inner, marks)).removeStoredMark(type);
	});
}

function rules() {
	const s = schema.nodes;
	return inputRules({
		rules: [
			textblockTypeInputRule(/^(#{1,3})\s$/, s.heading, (m) => ({ level: m[1].length })),
			wrappingInputRule(/^\s*([-*])\s$/, s.bullet_list),
			wrappingInputRule(/^(\d+)\.\s$/, s.ordered_list),
			textblockTypeInputRule(/^>\s$/, s.quote),
			new InputRule(/^---$/, (state, _m, start) => {
				const $s = state.doc.resolve(start);
				if ($s.parent.type !== s.paragraph) return null;
				const para = s.paragraph.create();
				const tr = state.tr.replaceWith($s.before(), $s.after(), [s.divider.create(), para]);
				return tr.setSelection(TextSelection.create(tr.doc, $s.before() + 2));
			}),
			markRule(/(\*\*([^*\s](?:[^*]*[^*\s])?)\*\*)$/, schema.marks.bold),
			markRule(/(?:^|[^*\w])(\*([^*\s](?:[^*]*[^*\s])?)\*)$/, schema.marks.italic),
			markRule(/(`([^`]+)`)$/, schema.marks.code),
			new InputRule(/\{\{([^{}]+)\}\}$/, (state, match, _start, end) => {
				if (!isMergeToken(match[1])) return null;
				const from = end - (match[0].length - 1);
				return state.tr.replaceWith(from, end, s.merge_tag.create({ tag: match[1] }, null, state.doc.resolve(from).marks()));
			})
		]
	});
}

/** Backspace at the start of a heading / quote / callout turns it back into text; at
 *  the start of a list item it lifts the item out. */
const backspaceToText: Command = (state, dispatch) => {
	const { $from, empty } = state.selection;
	if (!empty || $from.parentOffset !== 0) return false;
	const p = $from.parent;
	if ($from.node(-1)?.type === schema.nodes.list_item) return liftListItem(schema.nodes.list_item)(state, dispatch);
	if (p.type === schema.nodes.heading || p.type === schema.nodes.quote || p.type === schema.nodes.callout) {
		return setBlockType(schema.nodes.paragraph, { id: p.attrs.id, visibility: p.attrs.visibility })(state, dispatch);
	}
	return false;
};

/** #262: inside a milestone, Enter moves to the next field (title → label → next item)
 *  and Backspace at the start of a field never merges it into its neighbour. */
const milestoneEnter: Command = (state, dispatch) => {
	const { $from } = state.selection;
	if (!MS_FIELDS.has($from.parent.type.name)) return false;
	const next = Selection.findFrom(state.doc.resolve($from.after()), 1, true);
	if (next) dispatch?.(state.tr.setSelection(next).scrollIntoView());
	return true;
};
const milestoneBackspace: Command = (state, dispatch) => {
	const { $from, empty } = state.selection;
	if (!empty || $from.parentOffset !== 0 || !MS_FIELDS.has($from.parent.type.name)) return false;
	if ($from.parent.type === schema.nodes.milestone_label) dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, $from.before() - 1)));
	return true;
};

const hardBreak: Command = (state, dispatch) => {
	dispatch?.(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
	return true;
};

function keys() {
	const m = schema.marks;
	const li = schema.nodes.list_item;
	return keymap({
		'Mod-z': undo,
		'Shift-Mod-z': redo,
		'Mod-y': redo,
		'Mod-b': toggleMark(m.bold),
		'Mod-i': toggleMark(m.italic),
		'Mod-u': toggleMark(m.underline),
		'Mod-Shift-s': toggleMark(m.strike),
		'Mod-e': toggleMark(m.code),
		// #276: alignment and headings.
		'Mod-Shift-l': setAlign('left'),
		'Mod-Shift-e': setAlign('center'),
		'Mod-Shift-r': setAlign('right'),
		'Mod-Alt-1': turnSelectionInto('h1'),
		'Mod-Alt-2': turnSelectionInto('h2'),
		'Mod-Alt-3': turnSelectionInto('h3'),
		'Shift-Enter': hardBreak,
		ArrowUp: arrowBlock(-1),
		ArrowDown: arrowBlock(1),
		'Mod-Shift-ArrowUp': moveBlock(-1),
		'Mod-Shift-ArrowDown': moveBlock(1),
		Enter: chainCommands(milestoneEnter, splitListItem(li), liftListItem(li)),
		Backspace: chainCommands(undoInputRule, milestoneBackspace, backspaceToText)
	});
}

// --- Node views for the atoms (look like the email; edited in the Svelte panel) -----

function el(tag: string, cls: string, text?: string): HTMLElement {
	const e = document.createElement(tag);
	e.className = cls;
	if (text) e.textContent = text;
	return e;
}

function atomView(render: (node: PMNodeT, dom: HTMLElement) => void) {
	return (node: PMNodeT): NodeView => {
		const dom = el('div', `pm-atom pm-${node.type.name}`);
		dom.contentEditable = 'false';
		render(node, dom);
		return {
			dom,
			update(n) {
				if (n.type !== node.type) return false;
				dom.replaceChildren();
				render(n, dom);
				node = n;
				return true;
			},
			stopEvent: () => false,
			ignoreMutation: () => true
		};
	};
}

/** #261: the image, with a grip on its right edge that sets the width as a % of the
 *  column (10–100, whole percents). The width is written on release. */
function imageView(node: PMNodeT, view: EditorView, getPos: () => number | undefined, canUpload: () => boolean = () => true): NodeView {
	const dom = el('div', 'pm-atom pm-image');
	dom.contentEditable = 'false';
	let cur = node;
	function render() {
		dom.replaceChildren();
		if (!cur.attrs.src) {
			dom.appendChild(el('div', 'pm-placeholder', canUpload() ? 'Image: select it to upload a file or paste a URL' : 'Image: select it to paste a URL'));
			return;
		}
		const frame = el('div', 'pm-img-frame');
		if (cur.attrs.widthPct) frame.style.width = `${cur.attrs.widthPct}%`;
		else if (cur.attrs.width) frame.style.maxWidth = `${cur.attrs.width}px`;
		// #262: chip (white rounded box) and the wordmark beside the image.
		const fancy = cur.attrs.style === 'chip' || !!cur.attrs.beside;
		dom.classList.toggle('pm-img-row', fancy);
		if (fancy && !cur.attrs.widthPct && !cur.attrs.width) frame.style.maxWidth = '120px';
		frame.classList.toggle('pm-chip', cur.attrs.style === 'chip');
		const img = document.createElement('img');
		img.src = String(cur.attrs.src);
		img.alt = String(cur.attrs.alt ?? '');
		const grip = el('span', 'pm-resize');
		grip.title = 'Drag to resize';
		const badge = el('span', 'pm-size');
		for (const child of [img, grip, badge]) frame.appendChild(child);
		dom.appendChild(frame);
		if (cur.attrs.beside) dom.appendChild(el('span', 'pm-beside', String(cur.attrs.beside)));
		grip.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			grip.setPointerCapture(e.pointerId);
			const left = frame.getBoundingClientRect().left;
			const full = dom.getBoundingClientRect().width || 1;
			let pct = Math.round((frame.getBoundingClientRect().width / full) * 100);
			const onMove = (ev: PointerEvent) => {
				pct = clampImageWidthPct(((ev.clientX - left) / full) * 100) ?? 100;
				frame.style.width = `${pct}%`;
				frame.style.maxWidth = '';
				badge.textContent = `${pct}%`;
				frame.classList.add('resizing');
			};
			const onUp = () => {
				grip.removeEventListener('pointermove', onMove);
				grip.removeEventListener('pointerup', onUp);
				grip.removeEventListener('pointercancel', onUp);
				frame.classList.remove('resizing');
				const pos = getPos();
				if (pos === undefined) return;
				const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, widthPct: clampImageWidthPct(pct) ?? null, width: null });
				view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
			};
			grip.addEventListener('pointermove', onMove);
			grip.addEventListener('pointerup', onUp);
			grip.addEventListener('pointercancel', onUp);
		});
	}
	render();
	return {
		dom,
		update(n) {
			if (n.type !== cur.type) return false;
			cur = n;
			render();
			return true;
		},
		stopEvent: (e) => (e.target as HTMLElement | null)?.classList?.contains('pm-resize') ?? false,
		ignoreMutation: () => true
	};
}

/** #270: a node's design attr as a plain object ({} when unset). */
const design = (n: PMNodeT): Record<string, unknown> => (n.attrs.design && typeof n.attrs.design === 'object' ? (n.attrs.design as Record<string, unknown>) : {});
const BTN_SIZE_CSS = { sm: ['8px 16px', '14px'], lg: ['15px 30px', '18px'] } as const;

const nodeViews = {
	image: imageView,
	button: atomView((n, dom) => {
		const d = design(n);
		dom.style.textAlign = String(n.attrs.align ?? 'left');
		const btn = el('span', 'pm-btn', String(n.attrs.label || 'Button label'));
		// #270: colours, radius, size, full width (unset = the CSS defaults).
		if (typeof d.bg === 'string') btn.style.background = d.bg;
		if (typeof d.fg === 'string') btn.style.color = d.fg;
		if (typeof d.radius === 'number') btn.style.borderRadius = `${d.radius}px`;
		const sz = BTN_SIZE_CSS[d.btnSize as 'sm' | 'lg'];
		if (sz) {
			btn.style.padding = sz[0];
			btn.style.fontSize = sz[1];
		}
		if (d.full === true) {
			btn.style.display = 'block';
			btn.style.textAlign = 'center';
		}
		dom.appendChild(btn);
		// #262: the secondary text link beside it.
		if (n.attrs.linkLabel) {
			const link = el('span', 'pm-btn-link', String(n.attrs.linkLabel));
			if (typeof d.linkColor === 'string') link.style.color = d.linkColor;
			dom.appendChild(link);
		}
		// #261: a button without a usable link is skipped when the email / page renders.
		if (!cleanHref(n.attrs.href)) {
			const warn = el('span', 'pm-warn notice warn', n.attrs.href ? "Link isn't valid: this button won't be shown" : "No link: this button won't be shown");
			warn.setAttribute('role', 'note');
			dom.appendChild(warn);
		}
	}),
	spacer: atomView((n, dom) => {
		const px = design(n).px;
		dom.style.height = `${typeof px === 'number' ? px : ({ sm: 12, md: 28, lg: 56 }[String(n.attrs.size) as 'sm' | 'md' | 'lg'] ?? 28)}px`;
	}),
	divider: atomView((n, dom) => {
		const d = design(n);
		const hr = document.createElement('hr');
		if (typeof d.thickness === 'number') hr.style.borderTopWidth = `${d.thickness}px`;
		if (typeof d.color === 'string') hr.style.borderTopColor = d.color;
		if (d.short === true) hr.style.width = '25%';
		dom.appendChild(hr);
	}),
	content_area: atomView((_n, dom) => {
		dom.appendChild(el('div', 'pm-placeholder', 'Campaign content goes here'));
	})
};

// --- UI state reporting ---------------------------------------------------------------

const uiKey = new PluginKey<{ dismissed: number | null }>('be-ui');

function visLabel(v: Visibility | null): string | null {
	if (!v?.name) return null;
	if (v.kind === 'tag') return `Only if tagged ${v.name}`;
	if (v.kind === 'no-tag') return `Only if not tagged ${v.name}`;
	if (v.kind === 'field-exists') return `Only if ${v.name} is set`;
	return `Only if ${v.name} = ${v.value ?? ''}`;
}

/** #262: hints shown in empty design-block fields. */
const FIELD_PLACEHOLDER: Record<string, string> = { eyebrow: 'Eyebrow label', milestone_title: 'Title', milestone_label: 'Label' };

/** #270: how a block's design attr paints in the editor (alignment, space below,
 *  heading colour, section padding / radius / border / image / accent, columns gap and
 *  vertical alignment). Atoms paint the rest in their node views. */
function designDeco(node: PMNodeT): Record<string, string> | null {
	const d = design(node);
	const css: string[] = [];
	const attrs: Record<string, string> = {};
	const t = node.type.name;
	if (typeof d.align === 'string') {
		if (t === 'image') attrs['data-align'] = d.align;
		else if (t === 'eyebrow') css.push(d.align === 'center' ? 'margin-left:auto;margin-right:auto' : d.align === 'right' ? 'margin-left:auto;margin-right:0' : 'margin-left:0;margin-right:0');
		else css.push(`text-align:${d.align}`);
	}
	if (typeof d.spaceBelow === 'number') css.push(`margin-bottom:${d.spaceBelow}px`);
	// #276: text size and the block's text colour (headings had the colour already).
	const textKind = textSizeKind(t === 'bullet_list' || t === 'ordered_list' ? 'list' : t, node.attrs.level, node.attrs.size === 'display');
	if (textKind && typeof d.color === 'string') css.push(`color:${d.color}`);
	if (textKind && (d.textSize === 'sm' || d.textSize === 'lg' || d.textSize === 'xl')) css.push(`font-size:${TEXT_SIZE_PX[textKind][d.textSize]}px`);
	if (t === 'section') {
		if (typeof d.padTop === 'number') css.push(`padding-top:${d.padTop}px`);
		if (typeof d.padBottom === 'number') css.push(`padding-bottom:${d.padBottom}px`);
		if (typeof d.padX === 'number') css.push(`padding-left:${d.padX}px;padding-right:${d.padX}px`);
		if (typeof d.radius === 'number') css.push(`border-radius:${d.radius}px`);
		if (typeof d.borderColor === 'string') css.push(`border:${typeof d.borderWidth === 'number' ? d.borderWidth : 1}px solid ${d.borderColor}`);
		const img = cleanImageUrl(d.bgImage);
		if (img) css.push(`background-image:url(${img});background-size:cover;background-position:center`);
		if (typeof d.accent === 'string') css.push(`--acc:${d.accent}`);
	}
	if (t === 'columns') {
		if (typeof d.gap === 'number') css.push(`gap:${d.gap}px`);
		if (d.valign === 'middle') css.push('align-items:center');
	}
	if (css.length) attrs.style = css.join(';');
	return Object.keys(attrs).length ? attrs : null;
}

function decorations(placeholder: string) {
	return new Plugin({
		props: {
			decorations(state) {
				const decos: Decoration[] = [];
				const onlyEmpty = state.doc.childCount === 1 && state.doc.firstChild!.isTextblock && state.doc.firstChild!.content.size === 0;
				const { $from } = state.selection;
				state.doc.descendants((node, pos) => {
					const label = visLabel(node.attrs?.visibility as Visibility | null);
					if (label) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'pm-has-vis', 'data-vis': label }));
					const look = node.attrs?.design ? designDeco(node) : null;
					if (look) decos.push(Decoration.node(pos, pos + node.nodeSize, look));
					// #498: a web template block limited to one archive page gets a small badge.
					const showOn = (node.attrs?.design as Record<string, unknown> | null)?.showOn;
					if (showOn === 'issue' || showOn === 'index')
						decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'pm-show-on', 'data-show-on': SHOW_ON_LABELS[showOn] }));
					if (node.type === schema.nodes.paragraph && node.content.size === 0) {
						const here = $from.parent === node && state.selection.empty;
						if (here || onlyEmpty) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'pm-empty', 'data-placeholder': onlyEmpty ? placeholder : "Type '/' for blocks, '{{' for a merge tag" }));
					} else if (node.isTextblock && node.content.size === 0 && FIELD_PLACEHOLDER[node.type.name]) {
						decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'pm-empty', 'data-placeholder': FIELD_PLACEHOLDER[node.type.name] }));
					}
					return !node.isTextblock;
				});
				return DecorationSet.create(state.doc, decos);
			}
		}
	});
}

function rectAt(view: EditorView, from: number, to = from): Rect {
	const a = view.coordsAtPos(from);
	const b = to === from ? a : view.coordsAtPos(to);
	return { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
}

function computeUi(view: EditorView): UiState {
	const state = view.state;
	const sel = state.selection;
	const ui: UiState = { menu: null, bubble: null, atom: null, format: formatState(state), linkAt: null };
	const dismissed = uiKey.getState(state)?.dismissed ?? null;

	if (sel instanceof NodeSelection && ATOM_TYPES.has(sel.node.type.name)) {
		const dom = view.nodeDOM(sel.from) as HTMLElement | null;
		const r = dom?.getBoundingClientRect();
		ui.atom = {
			pos: sel.from,
			type: sel.node.type.name,
			attrs: { ...sel.node.attrs },
			rect: r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : rectAt(view, sel.from)
		};
		return ui;
	}

	const { $from } = sel;
	if (sel.empty && $from.parent.isTextblock) {
		const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
		const atEnd = $from.parentOffset === $from.parent.content.size;
		const slash = $from.parent.type === schema.nodes.paragraph && atEnd ? /^\/([\w ]{0,24})$/.exec(before) : null;
		const merge = /\{\{([\w:.|\- ]{0,40})$/.exec(before);
		const m = slash ?? merge;
		if (m) {
			const from = $from.pos - m[0].length;
			if (from !== dismissed) ui.menu = { kind: slash ? 'slash' : 'merge', query: m[1], from, to: $from.pos, rect: rectAt(view, $from.pos) };
		}
	}

	if (!sel.empty && sel instanceof TextSelection) {
		const active = Object.keys(schema.marks).filter((name) => state.doc.rangeHasMark(sel.from, sel.to, schema.marks[name]));
		let href: string | null = null;
		state.doc.nodesBetween(sel.from, sel.to, (n) => {
			const l = n.marks.find((mk) => mk.type === schema.marks.link);
			if (l && href === null) href = String(l.attrs.href);
		});
		ui.bubble = { rect: rectAt(view, sel.from, sel.to), active, href };
	}

	const link = linkAtSelection(state);
	if (link) ui.linkAt = { ...link, rect: rectAt(view, link.from, link.to) };
	return ui;
}

function uiPlugin(opts: EditorOptions) {
	return new Plugin<{ dismissed: number | null }>({
		key: uiKey,
		state: {
			init: () => ({ dismissed: null }),
			apply(tr, v) {
				const meta = tr.getMeta(uiKey) as { dismissed: number | null } | undefined;
				if (meta) return meta;
				return tr.docChanged && v.dismissed !== null ? { dismissed: tr.mapping.map(v.dismissed) } : v;
			}
		},
		props: {
			handleKeyDown: (_view, e) => opts.onKey(e),
			transformPastedHTML: cleanPastedHtml,
			handlePaste(view, e) {
				const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
				if (files.length && (opts.canUpload?.() ?? true)) {
					e.preventDefault();
					void insertUploaded(view, files[0], opts);
					return true;
				}
				// Selected text + pasted URL / domain / email / merge tag → link (#476).
				const tr = pasteLinkTr(view.state, e.clipboardData?.getData('text/plain') ?? '');
				if (!tr) return false;
				view.dispatch(tr);
				return true;
			},
			handleDrop(view, e) {
				const files = Array.from((e as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
				if (!files.length) return false;
				e.preventDefault();
				// No upload: swallow the drop (the browser would otherwise open the file).
				if (opts.canUpload?.() ?? true) void insertUploaded(view, files[0], opts);
				return true;
			}
		},
		view: () => ({ update: (view) => opts.onUi(computeUi(view)) })
	});
}

async function insertUploaded(view: EditorView, file: File, opts: EditorOptions) {
	const url = await opts.uploadImage(file);
	if (!url) return;
	const node = schema.nodes.image.create({ src: url, alt: '' });
	view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
}

// --- Controller -----------------------------------------------------------------------

/** `section` (#262) = position of the section holding the block (or the block itself). */
/** `columns` (#270) = position of the columns block holding the block (or the block itself). */
export type BlockInfo = { pos: number; node: PMNodeT; dom: HTMLElement; index: number; siblings: number; inCell: boolean; section: number | null; columns: number | null };

export type SlashAction =
	| { kind: 'turn'; to: TurnInto }
	| { kind: 'insert'; type: 'divider' | 'image' | 'button' | 'spacer' | 'content_area' | 'columns2' | 'columns3' | 'section' | 'milestones' }
	| { kind: 'merge'; tag: string };

/** Position of the block containing `pos`: the deepest id-carrying node whose parent is
 *  the document, a section or a column cell. `pos` right before such a block = itself. */
function blockPosAt(doc: PMNodeT, pos: number): number | null {
	const $p = doc.resolve(pos);
	const after = $p.nodeAfter;
	if (after && ID_TYPES.has(after.type.name) && isContainer($p.parent)) return pos;
	for (let d = $p.depth; d >= 1; d--) {
		if (ID_TYPES.has($p.node(d).type.name) && isContainer($p.node(d - 1))) return $p.before(d);
	}
	return null;
}

function emptyMilestone() {
	const n = schema.nodes;
	return n.milestone.create(null, [n.milestone_title.create(), n.milestone_label.create()]);
}

/** #270: a click on the block that is already the (node) selection while the editor is
 *  blurred. ProseMirror's mouseup sees "selection unchanged" and does nothing, so the
 *  browser's own focus caret (the first text after the block) gets read back instead
 *  and the click selects the wrong block. Focusing draws the node selection into the
 *  DOM first, and the re-dispatch lets the panel pick it up. */
function resyncStaleNodeSelection(v: EditorView, t: HTMLElement | null): boolean {
	const sel = v.state.selection;
	if (!t || v.hasFocus() || !(sel instanceof NodeSelection) || t.classList?.contains('pm-resize')) return false;
	const dom = v.nodeDOM(sel.from);
	if (!(dom instanceof Node) || !dom.contains(t)) return false;
	v.focus();
	v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, sel.from)));
	return true;
}

export function createEditor(mount: HTMLElement, opts: EditorOptions) {
	const doc = schema.nodeFromJSON(opts.doc);
	const state = EditorState.create({
		doc,
		selection: initialSelection(doc),
		plugins: [
			// First, so an open menu sees ↑↓ Enter Esc before the keymaps do.
			uiPlugin(opts),
			rules(),
			keys(),
			keymap(baseKeymap),
			history(),
			dropCursor({ color: '#2563eb', width: 2 }),
			gapCursor(),
			uniqueIds(),
			decorations(opts.placeholder ?? "Start writing, or type '/' for blocks"),
			focusDimPlugin()
		]
	});
	const view: EditorView = new EditorView(mount, {
		state,
		nodeViews: { ...nodeViews, image: (n, v, g) => imageView(n, v, g, () => opts.canUpload?.() ?? true) },
		attributes: { class: 'pm-doc', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': opts.label ?? 'Email body' },
		handleDOMEvents: {
			// #270: a click on a section's own padding (not a block inside it) selects the
			// section, so the Design panel shows its settings.
			mousedown(v, e) {
				const t = e.target as HTMLElement | null;
				if (resyncStaleNodeSelection(v, t)) return false;
				if (!t?.classList?.contains('pm-section')) return false;
				const pos = v.posAtDOM(t, 0) - 1;
				const node = pos >= 0 ? v.state.doc.nodeAt(pos) : null;
				if (node?.type !== schema.nodes.section) return false;
				e.preventDefault();
				v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, pos)));
				v.focus();
				return true;
			}
		},
		dispatchTransaction(tr) {
			const next = view.state.apply(tr);
			view.updateState(next);
			if (tr.docChanged) opts.onChange(next.doc.toJSON() as PMNode);
		}
	});

	const run = (cmd: Command) => {
		const ok = cmd(view.state, view.dispatch);
		view.focus();
		return ok;
	};

	function nodeFromBlockJSON(json: PMNode[]): PMNodeT[] {
		return json.map((j) => schema.nodeFromJSON(j));
	}

	function emptyCell() {
		return schema.nodes.column.create(null, schema.nodes.paragraph.create());
	}

	function atomFor(type: Extract<SlashAction, { kind: 'insert' }>['type']): PMNodeT {
		const n = schema.nodes;
		if (type === 'columns2' || type === 'columns3') return n.columns.create(null, Array.from({ length: type === 'columns2' ? 2 : 3 }, emptyCell));
		if (type === 'button') return n.button.create({ label: 'Learn more' });
		if (type === 'section') return n.section.create({ bg: BRAND.teal }, n.paragraph.create());
		if (type === 'milestones') return n.milestones.create(null, Array.from({ length: 4 }, emptyMilestone));
		return n[type].create();
	}

	/** Replace the block at `pos` with nodes, then put the cursor/selection sensibly. */
	function replaceBlock(tr: Transaction, pos: number, size: number, nodes: PMNodeT[], select: 'start' | 'node' | 'after') {
		tr.replaceWith(pos, pos + size, nodes);
		const first = nodes[0];
		if (select === 'node' && first.isAtom) tr.setSelection(NodeSelection.create(tr.doc, pos));
		else if (select === 'after') {
			const after = pos + nodes.reduce((s, x) => s + x.nodeSize, 0);
			tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(after + 1, tr.doc.content.size))));
		} else tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
		return tr;
	}

	return {
		view,
		destroy: () => view.destroy(),
		focus: () => view.focus(),
		dismissMenu(from: number) {
			view.dispatch(view.state.tr.setMeta(uiKey, { dismissed: from }));
		},

		/** Slash / merge menu pick: removes the typed trigger, then applies the item. */
		applyMenu(action: SlashAction, from: number, to: number) {
			const tr = view.state.tr.delete(from, to);
			if (action.kind === 'merge') {
				tr.replaceSelectionWith(schema.nodes.merge_tag.create({ tag: action.tag }), true);
				view.dispatch(tr.scrollIntoView());
				view.focus();
				return;
			}
			const $p = tr.doc.resolve(tr.selection.from);
			const para = $p.parent;
			const pos = $p.before();
			if (action.kind === 'turn') {
				const b = blockFromPM(para.toJSON() as PMNode);
				const converted = b ? convertBlock(b, action.to) : null;
				if (converted) replaceBlock(tr, pos, para.nodeSize, nodeFromBlockJSON(blockToPM(converted)), 'start');
			} else if (action.type === 'section' && $p.depth > 1) {
				// Sections don't nest (or go in a cell): add it after the top-level block.
				const top = $p.before(1) + $p.node(1).nodeSize;
				tr.insert(top, atomFor('section'));
				tr.setSelection(TextSelection.near(tr.doc.resolve(top + 1)));
			} else {
				const atom = atomFor(action.type);
				if (para.content.size === 0) {
					// The empty line becomes the block; keep a paragraph after it so typing can go on.
					const tail = $p.index(-1) === $p.node(-1).childCount - 1 ? [schema.nodes.paragraph.create()] : [];
					replaceBlock(tr, pos, para.nodeSize, [atom, ...tail], atom.isAtom ? 'node' : 'start');
				} else {
					tr.insert(pos + para.nodeSize, atom);
					if (atom.isAtom) tr.setSelection(NodeSelection.create(tr.doc, pos + para.nodeSize));
				}
			}
			view.dispatch(tr.scrollIntoView());
			view.focus();
		},

		toggleMark(name: 'bold' | 'italic' | 'underline' | 'strike' | 'code') {
			run(toggleMark(schema.marks[name]));
		},
		setLink(href: string | null) {
			const { from, to } = view.state.selection;
			const tr = view.state.tr.removeMark(from, to, schema.marks.link);
			const clean = href ? cleanHref(/^www\./i.test(href) ? `https://${href}` : href) : '';
			if (clean) tr.addMark(from, to, schema.marks.link.create({ href: clean }));
			view.dispatch(tr);
			view.focus();
			return !href || !!clean;
		},
		/** #473: unlink the whole link around the caret (one undo step, caret kept). */
		unlinkAt(range: { from: number; to: number }) {
			view.dispatch(unlinkTr(view.state, range));
			view.focus();
		},
		/** #473: select a range (the popover's Edit selects the whole link). */
		selectRange(range: { from: number; to: number }) {
			view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)));
			view.focus();
		},
		clearMarks() {
			const { from, to } = view.state.selection;
			view.dispatch(view.state.tr.removeMark(from, to));
			view.focus();
		},
		// #276: the fixed formatting toolbar (each is one transaction = one undo step).
		setAlign: (a: Align | null) => run(setAlign(a)),
		setTextSize: (s: TextSize | null) => run(setTextSize(s)),
		setTextColor: (hex: string | null) => run(setTextColor(hex)),
		turnSelection: (to: TurnInto) => run(turnSelectionInto(to)),
		clearFormatting: () => run(clearFormatting),
		/** #525: Write mode's focus paragraph — dim every top-level block but the current one. */
		setFocusDim(on: boolean) {
			const tr = setFocusDimTr(view.state, on);
			if (tr) view.dispatch(tr);
		},
		insertMergeTag(tag: string) {
			const node = schema.nodes.merge_tag.create({ tag }, null, view.state.selection.$from.marks());
			view.dispatch(view.state.tr.replaceSelectionWith(node, true).scrollIntoView());
			view.focus();
		},

		/** The block under a screen point: top level, or a block inside a column cell. */
		blockAt(x: number, y: number): BlockInfo | null {
			const box = view.dom.getBoundingClientRect();
			const hit = view.posAtCoords({ left: Math.min(Math.max(x, box.left + 8), box.right - 8), top: y });
			if (!hit) return null;
			const pos = blockPosAt(view.state.doc, hit.inside >= 0 ? hit.inside : hit.pos);
			return pos === null ? null : this.blockInfo(pos);
		},
		/** The block holding the selection (touch has no hover, so the handle follows it). */
		blockAtSelection(): BlockInfo | null {
			const pos = blockPosAt(view.state.doc, view.state.selection.from);
			return pos === null ? null : this.blockInfo(pos);
		},
		blockInfo(pos: number): BlockInfo | null {
			const node = view.state.doc.nodeAt(pos);
			const dom = view.nodeDOM(pos);
			if (!node || !(dom instanceof HTMLElement) || !ID_TYPES.has(node.type.name)) return null;
			const $p = view.state.doc.resolve(pos);
			let section: number | null = node.type === schema.nodes.section ? pos : null;
			for (let d = $p.depth; d >= 1 && section === null; d--) if ($p.node(d).type === schema.nodes.section) section = $p.before(d);
			let columns: number | null = node.type === schema.nodes.columns ? pos : null;
			for (let d = $p.depth; d >= 1 && columns === null; d--) if ($p.node(d).type === schema.nodes.columns) columns = $p.before(d);
			return { pos, node, dom, index: $p.index(), siblings: $p.parent.childCount, inCell: $p.parent.type === schema.nodes.column, section, columns };
		},
		/** The current node at `pos` (the block menu re-reads attrs after an edit). */
		nodeAt(pos: number): PMNodeT | null {
			return view.state.doc.nodeAt(pos);
		},
		/** #262: 2–4 milestone items; extra items are dropped from the end. */
		setMilestoneCount(pos: number, count: number) {
			const node = view.state.doc.nodeAt(pos);
			if (!node || node.type !== schema.nodes.milestones) return;
			const n = Math.min(4, Math.max(2, Math.round(count)));
			const items = Array.from({ length: n }, (_, i) => (i < node.childCount ? node.child(i) : emptyMilestone()));
			view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, node.type.create(node.attrs, items)));
		},

		/** Native drag of a whole block from its handle; ProseMirror's drop moves it. */
		startDrag(pos: number, e: DragEvent) {
			const info = this.blockInfo(pos);
			if (!info || !e.dataTransfer) return;
			const sel = NodeSelection.create(view.state.doc, pos);
			view.dispatch(view.state.tr.setSelection(sel));
			const slice = sel.content();
			e.dataTransfer.clearData();
			e.dataTransfer.setData('text/plain', info.node.textContent);
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setDragImage(info.dom, 0, 0);
			(view as unknown as { dragging: { slice: Slice; move: boolean } }).dragging = { slice, move: true };
		},

		turnInto(pos: number, to: TurnInto) {
			const node = view.state.doc.nodeAt(pos);
			if (!node) return;
			const b = blockFromPM(node.toJSON() as PMNode);
			if (!b) return;
			const nodes = nodeFromBlockJSON(blockToPM(convertBlock(b, to)));
			view.dispatch(replaceBlock(view.state.tr, pos, node.nodeSize, nodes, 'start').scrollIntoView());
			view.focus();
		},
		duplicate(pos: number) {
			const node = view.state.doc.nodeAt(pos);
			if (!node) return;
			const json = node.toJSON() as PMNode;
			const copy = schema.nodeFromJSON({ ...json, attrs: { ...json.attrs, id: null } });
			view.dispatch(view.state.tr.insert(pos + node.nodeSize, copy));
			view.focus();
		},
		remove(pos: number) {
			const node = view.state.doc.nodeAt(pos);
			if (!node) return;
			const $p = view.state.doc.resolve(pos);
			const tr = view.state.tr.delete(pos, pos + node.nodeSize);
			// A column cell / the document can't be left empty.
			if ($p.parent.childCount === 1) tr.insert(pos, schema.nodes.paragraph.create());
			view.dispatch(tr);
			view.focus();
		},
		move(pos: number, dir: -1 | 1) {
			const tr = moveBlockTr(view.state, pos, dir);
			if (tr) view.dispatch(tr);
			view.focus();
		},
		/** #270: merge into a block's design attr; a null / undefined value removes the key. */
		setDesign(pos: number, patch: Record<string, unknown>) {
			const node = view.state.doc.nodeAt(pos);
			if (!node) return;
			const next: Record<string, unknown> = { ...design(node) };
			for (const [k, v] of Object.entries(patch)) {
				if (v === null || v === undefined) delete next[k];
				else next[k] = v;
			}
			this.setAttrs(pos, { design: Object.keys(next).length ? next : null });
		},
		setAttrs(pos: number, attrs: Record<string, unknown>) {
			const node = view.state.doc.nodeAt(pos);
			if (!node) return;
			const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
			if (ATOM_TYPES.has(node.type.name)) tr.setSelection(NodeSelection.create(tr.doc, pos));
			view.dispatch(tr);
		},
		/** Image upload into an existing image block. */
		async uploadInto(pos: number, file: File) {
			const url = await opts.uploadImage(file);
			// A new image drops any crop of the old one (#497).
			if (url) this.setAttrs(pos, { src: url, ratio: null, origSrc: null, focal: null });
			return !!url;
		},
		selectAfter(pos: number) {
			const node = view.state.doc.nodeAt(pos);
			if (!node) return;
			const end = pos + node.nodeSize;
			const tr = view.state.tr;
			const $end = tr.doc.resolve(end);
			if ($end.nodeAfter?.isTextblock) tr.setSelection(TextSelection.create(tr.doc, end + 1));
			else {
				tr.insert(end, schema.nodes.paragraph.create());
				tr.setSelection(TextSelection.create(tr.doc, end + 1));
			}
			view.dispatch(tr.scrollIntoView());
			view.focus();
		}
	};
}

export type EditorController = ReturnType<typeof createEditor>;
