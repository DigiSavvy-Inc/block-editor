// #250: ProseMirror JSON ↔ Block[] (the stored model). Pure functions on plain JSON —
// no DOM and no prosemirror imports — so they run in the Workers test pool. The node
// and mark names match ./schema.ts.
import { DESIGN_KEYS, sanitizeBlocks, sanitizeInline, inlinePlainText, type Block, type Inline, type InlineMark, type Visibility } from '$lib/blocks.js';
import { markdownToBlocks } from '$lib/blocks-markdown.js';
import type { FocalPoint, ImageRatio } from '$lib/image-crop.js';

export type PMMark = { type: string; attrs?: Record<string, unknown> };
export type PMNode = {
	type: string;
	attrs?: Record<string, unknown>;
	content?: PMNode[];
	text?: string;
	marks?: PMMark[];
};

const vis = (a: Record<string, unknown> | undefined) => (a?.visibility as Visibility | null | undefined) ?? undefined;
const idOf = (a: Record<string, unknown> | undefined) => (typeof a?.id === 'string' ? a.id : crypto.randomUUID());

function inlineFromPM(nodes: PMNode[] | undefined): Inline[] {
	const out: Inline[] = [];
	for (const n of nodes ?? []) {
		const marks = n.marks?.map((m) =>
			m.type === 'link' ? { type: 'link', href: String(m.attrs?.href ?? '') } : m.type === 'textColor' ? { type: 'textColor', color: String(m.attrs?.color ?? '') } : { type: m.type }
		) as
			| InlineMark[]
			| undefined;
		if (n.type === 'text') out.push({ type: 'text', text: n.text ?? '', marks });
		else if (n.type === 'merge_tag') out.push({ type: 'mergeTag', tag: String(n.attrs?.tag ?? ''), marks });
		else if (n.type === 'hard_break') out.push({ type: 'hardBreak' });
	}
	return sanitizeInline(out);
}

/** #270: the `design` attr's known keys (values are checked by the sanitiser). */
function designOf(a: Record<string, unknown> | undefined): Record<string, unknown> {
	const d = a?.design;
	if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
	const out: Record<string, unknown> = {};
	for (const k of DESIGN_KEYS) if ((d as Record<string, unknown>)[k] !== undefined && (d as Record<string, unknown>)[k] !== null) out[k] = (d as Record<string, unknown>)[k];
	return out;
}

/** #270: a block's design fields → the `design` attr (null when none). Section bg /
 *  colour / align and button align have their own attrs. */
export function designAttr(b: Block): Record<string, unknown> | null {
	const out: Record<string, unknown> = {};
	for (const k of DESIGN_KEYS) {
		if ((b.type === 'section' && (k === 'bg' || k === 'color' || k === 'align')) || (b.type === 'button' && k === 'align')) continue;
		const v = (b as Record<string, unknown>)[k];
		if (v !== undefined) out[k] = v;
	}
	return Object.keys(out).length ? out : null;
}

export function blockFromPM(n: PMNode): Block | null {
	const b = blockFromPMBase(n);
	if (!b) return null;
	// Design fields first, so the node's own attrs (section bg, button align…) win.
	return { ...designOf(n.attrs), ...b } as Block;
}

function blockFromPMBase(n: PMNode): Block | null {
	const a = n.attrs;
	const base = { id: idOf(a), ...(vis(a) ? { visibility: vis(a) } : {}) };
	switch (n.type) {
		case 'paragraph':
			return { ...base, type: 'paragraph', content: inlineFromPM(n.content) };
		case 'heading': {
			const content = inlineFromPM(n.content);
			if (a?.size === 'display') return { ...base, type: 'heading', level: 1, text: inlinePlainText(content), content, size: 'display' };
			const level = a?.level === 1 || a?.level === 3 ? a.level : 2;
			return { ...base, type: 'heading', level, text: inlinePlainText(content), content };
		}
		case 'bullet_list':
		case 'ordered_list':
			return {
				...base,
				type: 'list',
				ordered: n.type === 'ordered_list',
				items: (n.content ?? []).map((li) => inlineFromPM(li.content?.[0]?.content)),
				...(n.type === 'ordered_list' && a?.style === 'steps' ? { style: 'steps' as const } : {})
			};
		case 'eyebrow':
			return { ...base, type: 'eyebrow', content: inlineFromPM(n.content), ...(a?.tone === 'accent' ? { tone: 'accent' as const } : {}) };
		case 'milestones':
			return {
				...base,
				type: 'milestones',
				rule: a?.rule !== false,
				items: (n.content ?? []).map((m) => ({ title: inlineFromPM(m.content?.[0]?.content), label: inlineFromPM(m.content?.[1]?.content) }))
			};
		case 'section':
			return {
				...base,
				type: 'section',
				bg: String(a?.bg ?? ''),
				...(a?.color ? { color: String(a.color) } : {}),
				padding: a?.padding === 'sm' || a?.padding === 'md' ? a.padding : 'lg',
				width: a?.width === 'inset' ? 'inset' : 'full',
				...(a?.align === 'center' ? { align: 'center' as const } : {}),
				blocks: (n.content ?? []).map(blockFromPM).filter((b): b is Block => !!b)
			};
		case 'quote':
		case 'callout':
			return { ...base, type: n.type, content: inlineFromPM(n.content) };
		case 'divider':
			return { ...base, type: 'divider' };
		case 'image':
			return {
				...base,
				type: 'image',
				src: String(a?.src ?? ''),
				alt: String(a?.alt ?? ''),
				...(a?.href ? { href: String(a.href) } : {}),
				...(a?.widthPct ? { widthPct: Number(a.widthPct) } : a?.width ? { width: Number(a.width) } : {}),
				...(a?.style === 'chip' ? { style: 'chip' as const } : {}),
				...(a?.beside ? { beside: String(a.beside) } : {}),
				...(a?.ratio && a?.origSrc ? { ratio: a.ratio as ImageRatio, origSrc: String(a.origSrc), ...(a?.focal ? { focal: a.focal as FocalPoint } : {}) } : {})
			};
		case 'button':
			return {
				...base,
				type: 'button',
				label: String(a?.label ?? ''),
				href: String(a?.href ?? ''),
				align: a?.align === 'center' || a?.align === 'right' ? a.align : 'left',
				...(a?.linkLabel || a?.linkHref ? { linkLabel: String(a.linkLabel ?? ''), linkHref: String(a.linkHref ?? '') } : {})
			};
		case 'spacer':
			return { ...base, type: 'spacer', size: a?.size === 'sm' || a?.size === 'lg' ? a.size : 'md' };
		case 'content_area':
			return { ...base, type: 'content' };
		case 'columns':
			return {
				...base,
				type: 'columns',
				cells: (n.content ?? []).map((col) => (col.content ?? []).map(blockFromPM).filter((b): b is Block => !!b))
			};
		default:
			return null;
	}
}

/** Editor document JSON → sanitised blocks. */
export function docToBlocks(doc: PMNode, opts: { allowContent?: boolean } = {}): Block[] {
	const blocks = (doc.content ?? []).map(blockFromPM).filter((b): b is Block => !!b);
	return sanitizeBlocks(blocks, opts);
}

// ---------------------------------------------------------------------------

function marksToPM(marks: InlineMark[] | undefined): PMMark[] | undefined {
	if (!marks?.length) return undefined;
	return marks.map((m) => (m.type === 'link' ? { type: 'link', attrs: { href: m.href } } : m.type === 'textColor' ? { type: 'textColor', attrs: { color: m.color } } : { type: m.type }));
}

function inlineToPM(nodes: Inline[]): PMNode[] | undefined {
	const out: PMNode[] = [];
	for (const n of nodes) {
		const marks = n.type === 'hardBreak' ? undefined : marksToPM(n.marks);
		if (n.type === 'text') out.push(marks ? { type: 'text', marks, text: n.text } : { type: 'text', text: n.text });
		else if (n.type === 'mergeTag') out.push(marks ? { type: 'merge_tag', attrs: { tag: n.tag }, marks } : { type: 'merge_tag', attrs: { tag: n.tag } });
		else out.push({ type: 'hard_break' });
	}
	return out.length ? out : undefined;
}

function withContent(node: PMNode, content: PMNode[] | undefined): PMNode {
	return content ? { ...node, content } : node;
}

export function blockToPM(b: Block): PMNode[] {
	const attrs = { id: b.id, visibility: b.visibility ?? null, design: designAttr(b) };
	switch (b.type) {
		case 'paragraph':
		case 'quote':
		case 'callout':
			return [withContent({ type: b.type, attrs }, inlineToPM(b.content))];
		case 'heading':
			return [
				withContent(
					{ type: 'heading', attrs: { ...attrs, level: b.size === 'display' ? 1 : b.level, size: b.size ?? null } },
					inlineToPM(b.content ?? (b.text ? [{ type: 'text', text: b.text }] : []))
				)
			];
		case 'eyebrow':
			return [withContent({ type: 'eyebrow', attrs: { ...attrs, tone: b.tone ?? null } }, inlineToPM(b.content))];
		case 'milestones':
			return [
				{
					type: 'milestones',
					attrs: { ...attrs, rule: b.rule },
					content: b.items.slice(0, 4).map((it) => ({
						type: 'milestone',
						content: [withContent({ type: 'milestone_title' }, inlineToPM(it.title)), withContent({ type: 'milestone_label' }, inlineToPM(it.label))]
					}))
				}
			];
		case 'section': {
			const inner = b.blocks.flatMap((c) => (c.type === 'section' ? [] : blockToPM(c)));
			return [
				{
					type: 'section',
					attrs: { ...attrs, bg: b.bg, color: b.color ?? null, padding: b.padding, width: b.width, align: b.align ?? null },
					content: inner.length ? inner : [{ type: 'paragraph', attrs: { id: null, visibility: null, design: null } }]
				}
			];
		}
		case 'text': {
			// Legacy markdown blocks open as rich blocks (the first keeps the id/visibility).
			const converted = markdownToBlocks(b.md);
			if (converted.length === 0) return [{ type: 'paragraph', attrs }];
			return converted.flatMap((c, i) => blockToPM(i === 0 ? { ...c, id: b.id, ...(b.visibility ? { visibility: b.visibility } : {}) } : c));
		}
		case 'list':
			return [
				{
					type: b.ordered ? 'ordered_list' : 'bullet_list',
					attrs: b.ordered ? { ...attrs, style: b.style ?? null } : attrs,
					content: (b.items.length ? b.items : [[]]).map((it) => ({
						type: 'list_item',
						content: [withContent({ type: 'paragraph', attrs: { id: null, visibility: null, design: null } }, inlineToPM(it))]
					}))
				}
			];
		case 'divider':
			return [{ type: 'divider', attrs }];
		case 'image':
			return [
				{
					type: 'image',
					attrs: { ...attrs, src: b.src, alt: b.alt, href: b.href ?? '', width: b.width ?? null, widthPct: b.widthPct ?? null, style: b.style ?? null, beside: b.beside ?? '', ratio: b.ratio ?? null, origSrc: b.origSrc ?? null, focal: b.focal ?? null }
				}
			];
		case 'button':
			return [{ type: 'button', attrs: { ...attrs, label: b.label, href: b.href, align: b.align, linkLabel: b.linkLabel ?? '', linkHref: b.linkHref ?? '' } }];
		case 'spacer':
			return [{ type: 'spacer', attrs: { ...attrs, size: b.size } }];
		case 'content':
			return [{ type: 'content_area', attrs }];
		case 'columns':
			return [
				{
					type: 'columns',
					attrs,
					content: b.cells.map((cell) => {
						const inner = cell.flatMap((c) => (c.type === 'columns' || c.type === 'content' || c.type === 'section' ? [] : blockToPM(c)));
						return { type: 'column', content: inner.length ? inner : [{ type: 'paragraph', attrs: { id: null, visibility: null, design: null } }] };
					})
				}
			];
	}
}

export type TurnInto = 'paragraph' | 'h1' | 'h2' | 'h3' | 'display' | 'eyebrow' | 'bullet' | 'numbered' | 'steps' | 'quote' | 'callout';

/** Split inline content at hard breaks (list items ↔ lines). */
function splitLines(content: Inline[]): Inline[][] {
	const out: Inline[][] = [[]];
	for (const n of content) {
		if (n.type === 'hardBreak') out.push([]);
		else out[out.length - 1].push(n);
	}
	return out;
}

/** The block's text as one inline run (list items joined by hard breaks). */
function contentOf(b: Block): Inline[] | null {
	switch (b.type) {
		case 'paragraph':
		case 'quote':
		case 'callout':
		case 'eyebrow':
			return b.content;
		case 'heading':
			return b.content ?? [{ type: 'text', text: b.text }];
		case 'list':
			return b.items.flatMap((it, i) => (i ? [{ type: 'hardBreak' } as Inline, ...it] : it));
		default:
			return null;
	}
}

/** "Turn into" for a text block: keeps the text, id and visibility. Non-text blocks
 *  come back unchanged. */
export function convertBlock(b: Block, to: TurnInto): Block {
	const content = contentOf(b);
	if (!content) return b;
	// #270: alignment and space below survive a "turn into"; #276: so do text size and
	// colour (an eyebrow has neither).
	const base = {
		id: b.id,
		...(b.visibility ? { visibility: b.visibility } : {}),
		...('align' in b && b.align && b.type !== 'button' ? { align: b.align } : {}),
		...(b.spaceBelow !== undefined ? { spaceBelow: b.spaceBelow } : {}),
		...(to !== 'eyebrow' && 'textSize' in b && b.textSize ? { textSize: b.textSize } : {}),
		...(to !== 'eyebrow' && 'color' in b && b.color && b.type !== 'divider' ? { color: b.color } : {})
	};
	switch (to) {
		case 'paragraph':
		case 'quote':
		case 'callout':
			return { ...base, type: to, content: sanitizeInline(content) };
		case 'h1':
		case 'h2':
		case 'h3': {
			const c = sanitizeInline(content);
			return { ...base, type: 'heading', level: Number(to[1]) as 1 | 2 | 3, text: inlinePlainText(c), content: c };
		}
		case 'display': {
			const c = sanitizeInline(content);
			return { ...base, type: 'heading', level: 1, text: inlinePlainText(c), content: c, size: 'display' };
		}
		case 'eyebrow':
			return { ...base, type: 'eyebrow', content: sanitizeInline(content) };
		case 'bullet':
		case 'numbered':
			return { ...base, type: 'list', ordered: to === 'numbered', items: splitLines(content).map(sanitizeInline) };
		case 'steps':
			return { ...base, type: 'list', ordered: true, items: splitLines(content).map(sanitizeInline), style: 'steps' };
	}
}

/** Blocks → editor document JSON (always at least one paragraph). */
export function blocksToDoc(blocks: Block[]): PMNode {
	const content = blocks.flatMap(blockToPM);
	return { type: 'doc', content: content.length ? content : [{ type: 'paragraph', attrs: { id: null, visibility: null } }] };
}
