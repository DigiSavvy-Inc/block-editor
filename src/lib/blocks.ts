// Block-based builder (#56/#57): one JSON model, two render targets.
// - renderPageHtml(): semantic HTML + CSS grid for hosted pages (responsive for free).
// - renderBlocksEmailHtml(): table-based 600px hybrid markup — the only layout email
//   clients (Gmail/Outlook) render reliably; columns stack via media query.
// Client- AND server-safe (the builder previews with the same renderers the server uses).

import { formatTagCondition } from '$lib/conditionals.js';
import { isMergeToken, parseMarkdownPreservingMergeTags, parseMarkdownSafe } from '$lib/merge-tags.js';
import { BRAND, BRAND_FONT, autoTextColor, contrastRatio, normalizeHex } from '$lib/brand.js';
import { cleanFocal, cleanRatio, type FocalPoint, type ImageRatio } from '$lib/image-crop.js';

/** #270: columns gap (px), vertical alignment and stack-on-mobile (unset = stack). */
export type ColumnsBlock = { id: string; type: 'columns'; cells: Block[][]; gap?: 0 | 12 | 24 | 32; valign?: 'top' | 'middle'; stack?: false };

/** #262: a coloured band holding child blocks. Sections never nest (a section inside a
 *  section or a column cell is flattened); columns are allowed inside one. `color` unset
 *  = black or white, whichever contrasts more with `bg`.
 *  #270: custom padding (px, 0–96, each wins over the preset), corner radius, border,
 *  background image (`bg` stays the fallback colour) and an accent colour for the
 *  eyebrow rule, step circles, milestones rule and dividers inside it. */
export type SectionBlock = {
	id: string;
	type: 'section';
	bg: string;
	color?: string;
	padding: 'sm' | 'md' | 'lg';
	width: 'full' | 'inset';
	align?: 'center';
	blocks: Block[];
	padTop?: number;
	padBottom?: number;
	padX?: number;
	radius?: 0 | 8 | 16;
	borderColor?: string;
	borderWidth?: number;
	bgImage?: string;
	accent?: string;
};

/** #270: per-block alignment; a section's `align` is the default its children inherit. */
export type Align = 'left' | 'center' | 'right';
export const ALIGNS: readonly Align[] = ['left', 'center', 'right'];
/** #270: per-block space below (px), replacing the block's own bottom margin. */
export const SPACE_BELOW = [0, 8, 16, 24, 32, 48] as const;
export type SpaceBelow = (typeof SPACE_BELOW)[number];
/** #498: web page templates only — limit a block to the newsletter archive's issue pages or
 *  its index (archive list). Unset = every page. Email renderers ignore it. */
export const SHOW_ON = ['issue', 'index'] as const;
export type ShowOn = (typeof SHOW_ON)[number];
/** #498: the editor's names for them (Design panel + canvas badge). */
export const SHOW_ON_LABELS: Record<ShowOn, string> = { issue: 'Issue pages', index: 'Archive list' };
/** #276: per-block text size for text blocks (unset = the block's default size). */
export const TEXT_SIZES = ['sm', 'lg', 'xl'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
/** #276: fixed px per text size and block kind (`body` = paragraph, list, quote, callout).
 *  The `md` column is each kind's default in the email renderer. */
export const TEXT_SIZE_PX = {
	body: { sm: 14, md: 16, lg: 18, xl: 21 },
	h1: { sm: 22, md: 26, lg: 32, xl: 38 },
	h2: { sm: 17, md: 20, lg: 24, xl: 28 },
	h3: { sm: 15, md: 17, lg: 20, xl: 23 },
	display: { sm: 36, md: 48, lg: 56, xl: 64 }
} as const;
export type TextSizeKind = keyof typeof TEXT_SIZE_PX;
export const BUTTON_RADII = [0, 4, 8, 999] as const;
export const COLUMN_GAPS = [0, 12, 24, 32] as const;
export const SECTION_RADII = [0, 8, 16] as const;
/** Section custom padding range (px). */
export const PAD_MAX = 96;
/** Spacer custom height range (px). */
export const SPACER_MAX = 200;

/** #270: template-level email canvas. Unset keys = the classic shell's defaults; an
 *  empty canvas renders the email exactly as before. */
export type EmailCanvas = {
	backdrop?: string;
	width?: 560 | 600 | 640;
	radius?: 0 | 8 | 16;
	text?: string;
	link?: string;
	fontSize?: 15 | 16 | 17;
	/** Card inner padding (px); unset = the classic 32px 24px. 0 = sections run edge to edge. */
	padding?: 0 | 16 | 24;
	/** #275: body font (EMAIL_FONTS key); unset = the system sans stack. */
	font?: EmailFontKey;
	/** #275: heading font; unset = the body font. */
	headingFont?: EmailFontKey;
	/** #275: body line height; unset = 1.6. */
	lineHeight?: 1.4 | 1.6 | 1.8;
};
export const CANVAS_WIDTHS = [560, 600, 640] as const;
export const CANVAS_RADII = [0, 8, 16] as const;
export const CANVAS_FONT_SIZES = [15, 16, 17] as const;
export const CANVAS_PADDINGS = [0, 16, 24] as const;
export const CANVAS_LINE_HEIGHTS = [1.4, 1.6, 1.8] as const;
/** The system sans stack: the email's font when the canvas sets none. */
export const EMAIL_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/** #275: email-safe font presets for the canvas (stacks only, no web fonts: every
 *  client has these or falls back down the stack). */
export const EMAIL_FONTS = [
	{ key: 'system', label: 'System sans', stack: EMAIL_FONT },
	{ key: 'helvetica', label: 'Helvetica / Arial', stack: 'Helvetica,Arial,sans-serif' },
	{ key: 'georgia', label: 'Georgia (serif)', stack: "Georgia,'Times New Roman',Times,serif" },
	{ key: 'times', label: 'Times', stack: "'Times New Roman',Times,serif" },
	{ key: 'verdana', label: 'Verdana', stack: 'Verdana,Geneva,sans-serif' },
	{ key: 'trebuchet', label: 'Trebuchet', stack: "'Trebuchet MS','Lucida Grande',Tahoma,sans-serif" },
	{ key: 'courier', label: 'Courier (mono)', stack: "'Courier New',Courier,monospace" }
] as const;
export type EmailFontKey = (typeof EMAIL_FONTS)[number]['key'];
export const EMAIL_FONT_KEYS: readonly EmailFontKey[] = EMAIL_FONTS.map((f) => f.key);
/** The CSS font stack for a preset key (unknown / unset = the system sans stack). */
export const fontStack = (key: string | null | undefined): string => EMAIL_FONTS.find((f) => f.key === key)?.stack ?? EMAIL_FONT;
export type Milestone = { title: Inline[]; label: Inline[] };

/** Per-recipient visibility rule (#62) — compiled into {{#if}} markers in the EMAIL
 *  target and resolved per recipient at send time. Pages ignore visibility. */
export type Visibility = {
	kind: 'tag' | 'no-tag' | 'field-exists' | 'field-eq';
	name: string;
	value?: string;
};
type Vis = { visibility?: Visibility };

/** #250: rich inline content for text-bearing blocks (the visual editor's model).
 *  Marks are kept in MARK_ORDER; merge tags are atoms holding the text between the
 *  braces exactly as typed (`first_name`, `company.name|your team`, `#if tag:hot`). */
export type MarkType = 'bold' | 'italic' | 'underline' | 'strike' | 'code';
/** #276: `textColor` = an inline text colour (a normalised #rrggbb). */
export type InlineMark = { type: MarkType } | { type: 'link'; href: string } | { type: 'textColor'; color: string };
export type Inline =
	| { type: 'text'; text: string; marks?: InlineMark[] }
	| { type: 'mergeTag'; tag: string; marks?: InlineMark[] }
	| { type: 'hardBreak' };
export const MARK_ORDER = ['link', 'textColor', 'bold', 'italic', 'underline', 'strike', 'code'] as const;

type Al = { align?: Align }; // #270
/** #276: text size + block text colour (a heading carries both too). */
type Tx = { textSize?: TextSize; color?: string };
export type Block = (
	// `text` is the plain-text form; `content` (#250) wins when present.
	// #262: `size: 'display'` = the hero headline (stored with level 1). #270: `color`.
	| ({ id: string; type: 'heading'; level: 1 | 2 | 3; text: string; content?: Inline[]; size?: 'display' } & Al & Tx)
	| { id: string; type: 'text'; md: string } // legacy markdown block (templates, pages)
	| ({ id: string; type: 'paragraph'; content: Inline[] } & Al & Tx)
	// #262: `style: 'steps'` (ordered only) = outlined circle numbers + hairlines.
	| ({ id: string; type: 'list'; ordered: boolean; items: Inline[][]; style?: 'steps' } & Al & Tx)
	| ({ id: string; type: 'quote'; content: Inline[] } & Al & Tx)
	| ({ id: string; type: 'callout'; content: Inline[] } & Al & Tx)
	// `widthPct` (#261, 10–99, unset = full width) wins over the legacy pixel `width`.
	// #262: `style: 'chip'` = white rounded padded box (logos); `beside` = a short
	// wordmark shown to the right of the image.
	// #497: `ratio` = the aspect-ratio preset `src` was cropped to (a baked file), `origSrc`
	// = the uncropped image every re-crop starts from, `focal` = the crop anchor (unset =
	// centre). Renderers only ever use `src`.
	| ({
			id: string;
			type: 'image';
			src: string;
			alt: string;
			href?: string;
			width?: number;
			widthPct?: number;
			style?: 'chip';
			beside?: string;
			ratio?: ImageRatio;
			origSrc?: string;
			focal?: FocalPoint;
	  } & Al)
	// #262: an optional secondary text link on the same line (stacks on mobile).
	// #270: colours, radius, size, full width; unset = the auto-contrast default.
	| {
			id: string;
			type: 'button';
			label: string;
			href: string;
			align: Align;
			linkLabel?: string;
			linkHref?: string;
			bg?: string;
			fg?: string;
			radius?: 0 | 4 | 8 | 999;
			btnSize?: 'sm' | 'md' | 'lg';
			full?: true;
			linkColor?: string;
	  }
	| ({ id: string; type: 'eyebrow'; content: Inline[]; tone?: 'accent' } & Al) // #262
	| ({ id: string; type: 'milestones'; items: Milestone[]; rule: boolean } & Al) // #262: 2–4 items
	| SectionBlock
	// #270: colour, thickness (1–4px) and a short (25%) rule.
	| { id: string; type: 'divider'; color?: string; thickness?: number; short?: true }
	// #270: `px` = a custom height that wins over the preset.
	| { id: string; type: 'spacer'; size: 'sm' | 'md' | 'lg'; px?: number }
	| { id: string; type: 'content' } // template-only: where campaign content lands (#64)
	| ColumnsBlock
) &
	Vis & { spaceBelow?: SpaceBelow; showOn?: ShowOn };

/** #270: the design keys the editor keeps in one `design` node attr (the rest of a
 *  block's fields map to their own attrs). Section bg/color/align and button align are
 *  their own attrs, so they aren't listed. */
export const DESIGN_KEYS = [
	'align',
	'spaceBelow',
	'showOn',
	'textSize',
	'color',
	'bg',
	'fg',
	'radius',
	'btnSize',
	'full',
	'linkColor',
	'thickness',
	'short',
	'px',
	'gap',
	'valign',
	'stack',
	'padTop',
	'padBottom',
	'padX',
	'borderColor',
	'borderWidth',
	'bgImage',
	'accent'
] as const;

/** Substituted with the campaign's composed content at send time (#64). */
export const CONTENT_PLACEHOLDER = '%%CONTENT_AREA%%';

/** #261: an image's width as a share of its column. Rounded and clamped to 10–100;
 *  100 (full width) and junk come back undefined, so they aren't stored. */
export function clampImageWidthPct(v: unknown): number | undefined {
	if (v === null || v === undefined || v === '') return undefined;
	const n = Math.round(Number(v));
	if (!Number.isFinite(n)) return undefined;
	const c = Math.min(100, Math.max(10, n));
	return c === 100 ? undefined : c;
}

/** Parse stored blocks JSON defensively — malformed input renders as an empty page,
 *  never a crash. */
export function parseBlocks(json: string | null | undefined): Block[] {
	if (!json) return [];
	try {
		const v = JSON.parse(json);
		return Array.isArray(v) ? (v as Block[]) : [];
	} catch {
		return [];
	}
}

function esc(s: string): string {
	return s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/** Only http(s) (and mailto) URLs survive into href/src attributes. */
function safeUrl(u: string): string {
	const t = (u ?? '').trim();
	if (/^(https?:\/\/|mailto:)/i.test(t)) return esc(t);
	return '';
}

/** #250: a link/button target is http(s), mailto, or a URL that starts with a merge tag
 *  (`{{field:report_url}}`, filled per recipient — personalize() re-checks the value).
 *  Returns the trimmed raw value or '' (callers escape on output). */
export function cleanHref(u: unknown): string {
	const t = typeof u === 'string' ? u.trim() : '';
	if (!t || t.length > 2000 || /[\s<>"]/.test(t)) return '';
	if (/^(https?:\/\/|mailto:)/i.test(t)) return t;
	const lead = /^\{\{([^{}]+)\}\}/.exec(t);
	if (lead && isMergeToken(lead[1]) && !lead[1].startsWith('#if') && lead[1] !== 'else' && lead[1] !== '/if') return t;
	return '';
}

function md(s: string): string {
	return parseMarkdownPreservingMergeTags(s ?? '');
}

// ---------------------------------------------------------------------------
// Rich inline (#250)
// ---------------------------------------------------------------------------

const MARK_TAG: Record<MarkType, [string, string]> = {
	bold: ['<strong>', '</strong>'],
	italic: ['<em>', '</em>'],
	underline: ['<u>', '</u>'],
	strike: ['<s>', '</s>'],
	code: [
		'<code style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;background:#f4f4f5;padding:1px 5px;border-radius:4px;">',
		'</code>'
	]
};

function linkOf(n: Inline): string | null {
	if (n.type === 'hardBreak') return null;
	const l = n.marks?.find((m) => m.type === 'link');
	return l && l.type === 'link' ? l.href : null;
}

function inlineNodeHtml(n: Inline): string {
	if (n.type === 'hardBreak') return '<br>';
	let s = n.type === 'text' ? esc(n.text) : esc(`{{${n.tag}}}`);
	const marks = (n.marks ?? []).filter((m) => m.type !== 'link');
	for (let i = marks.length - 1; i >= 0; i--) {
		const m = marks[i];
		// #276: an inline colour is an inline style (email-safe); the hex is re-checked.
		if (m.type === 'textColor') {
			const hex = normalizeHex(m.color);
			if (hex) s = `<span style="color:${hex};">${s}</span>`;
			continue;
		}
		const [open, close] = MARK_TAG[m.type as MarkType];
		s = open + s + close;
	}
	return s;
}

/** Inline runs → HTML. Consecutive runs sharing a link become one `<a>`. Every text
 *  run is escaped; merge tags come out as literal `{{…}}` for personalize(). */
export function renderInlineHtml(nodes: Inline[], linkStyle = 'color:#2563eb;text-decoration:underline;'): string {
	let out = '';
	for (let i = 0; i < nodes.length; ) {
		const href = linkOf(nodes[i]);
		let j = i + 1;
		if (href !== null) while (j < nodes.length && linkOf(nodes[j]) === href) j++;
		const inner = nodes.slice(i, j).map(inlineNodeHtml).join('');
		const safe = href !== null ? cleanHref(href) : '';
		out += safe ? `<a href="${esc(safe)}"${linkStyle ? ` style="${linkStyle}"` : ''}>${inner}</a>` : inner;
		i = j;
	}
	return out;
}

/** Inline runs → plain text. A link whose text isn't its URL reads `text (url)`. */
export function renderInlineText(nodes: Inline[]): string {
	let out = '';
	for (let i = 0; i < nodes.length; ) {
		const href = linkOf(nodes[i]);
		let j = i + 1;
		if (href !== null) while (j < nodes.length && linkOf(nodes[j]) === href) j++;
		const inner = nodes
			.slice(i, j)
			.map((n) => (n.type === 'hardBreak' ? '\n' : n.type === 'text' ? n.text : `{{${n.tag}}}`))
			.join('');
		out += href !== null && cleanHref(href) && inner.trim() !== href ? `${inner} (${href})` : inner;
		i = j;
	}
	return out;
}

/** Plain text of a block's inline content (also a heading's `text`). */
export function inlinePlainText(nodes: Inline[]): string {
	return nodes.map((n) => (n.type === 'hardBreak' ? '\n' : n.type === 'text' ? n.text : `{{${n.tag}}}`)).join('');
}

function headingInline(b: Extract<Block, { type: 'heading' }>): string {
	return b.content ? renderInlineHtml(b.content) : esc(b.text);
}

// ---------------------------------------------------------------------------
// Sanitiser (#250): allowlist of block types, marks and attributes. Runs at save and
// again at render, so stored JSON can never carry raw HTML or a script URL.
// ---------------------------------------------------------------------------

const MAX_BLOCKS = 500;
const MAX_TEXT = 20_000;
const VIS_KINDS = new Set(['tag', 'no-tag', 'field-exists', 'field-eq']);
const SIMPLE_MARKS = new Set<string>(['bold', 'italic', 'underline', 'strike', 'code']);

const str = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').slice(0, max) : '');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// #270: design-attribute helpers. Enumerations keep only listed values; px ranges are
// rounded and clamped; colours go through normalizeHex (anything else is dropped).
function oneOf<T>(v: unknown, list: readonly T[]): T | undefined {
	return list.includes(v as T) ? (v as T) : undefined;
}
function clampInt(v: unknown, min: number, max: number): number | undefined {
	if (v === null || v === undefined || v === '' || typeof v === 'boolean') return undefined;
	const n = Math.round(Number(v));
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}
const hexOrUndef = (v: unknown) => normalizeHex(v) || undefined;
/** An image URL safe inside an attribute AND a CSS url(): http(s), no quotes, spaces,
 *  angle brackets, parentheses or backslashes. */
export function cleanImageUrl(v: unknown): string {
	const s = typeof v === 'string' ? v.trim() : '';
	return s.length <= 2000 && /^https?:\/\//i.test(s) && !/[\s<>"'()\\]/.test(s) ? s : '';
}
/** Copy the defined values onto `b` (so an unset attribute never appears as a key). */
function assignDefined(b: object, patch: Record<string, unknown>) {
	for (const [k, v] of Object.entries(patch)) if (v !== undefined) (b as Record<string, unknown>)[k] = v;
}

/** #270: the stored canvas from untrusted JSON (unknown keys and bad values dropped). */
export function sanitizeCanvas(v: unknown): EmailCanvas {
	const out: EmailCanvas = {};
	if (!isObj(v)) return out;
	assignDefined(out, {
		backdrop: hexOrUndef(v.backdrop),
		width: oneOf(v.width, CANVAS_WIDTHS),
		radius: oneOf(v.radius, CANVAS_RADII),
		text: hexOrUndef(v.text),
		link: hexOrUndef(v.link),
		fontSize: oneOf(v.fontSize, CANVAS_FONT_SIZES),
		padding: oneOf(v.padding, CANVAS_PADDINGS),
		font: oneOf(v.font, EMAIL_FONT_KEYS),
		headingFont: oneOf(v.headingFont, EMAIL_FONT_KEYS),
		lineHeight: oneOf(v.lineHeight, CANVAS_LINE_HEIGHTS)
	});
	return out;
}

/** Stored canvas JSON (NULL / junk = no canvas). */
export function parseCanvas(json: string | null | undefined): EmailCanvas {
	if (!json) return {};
	try {
		return sanitizeCanvas(JSON.parse(json));
	} catch {
		return {};
	}
}

export const canvasIsSet = (c: EmailCanvas | null | undefined): c is EmailCanvas => !!c && Object.keys(c).length > 0;

function sanitizeMarks(v: unknown): InlineMark[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const seen = new Map<string, InlineMark>();
	for (const m of v) {
		if (!isObj(m) || typeof m.type !== 'string' || seen.has(m.type)) continue;
		if (m.type === 'link') {
			const href = cleanHref(m.href);
			if (href) seen.set('link', { type: 'link', href });
		} else if (m.type === 'textColor') {
			const color = normalizeHex(m.color);
			if (color) seen.set('textColor', { type: 'textColor', color });
		} else if (SIMPLE_MARKS.has(m.type)) seen.set(m.type, { type: m.type as MarkType });
	}
	const out = MARK_ORDER.map((t) => seen.get(t)).filter((m): m is InlineMark => !!m);
	return out.length ? out : undefined;
}

const sameMarks = (a?: InlineMark[], b?: InlineMark[]) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Allowlisted, normalised inline runs: adjacent text with equal marks merged, empty
 *  runs dropped, `\n` inside text turned into hard breaks, an unknown merge token kept
 *  as plain text. */
export function sanitizeInline(v: unknown): Inline[] {
	const out: Inline[] = [];
	const pushText = (text: string, marks?: InlineMark[]) => {
		if (!text) return;
		const prev = out[out.length - 1];
		if (prev?.type === 'text' && sameMarks(prev.marks, marks)) prev.text += text;
		else out.push(marks ? { type: 'text', text, marks } : { type: 'text', text });
	};
	if (!Array.isArray(v)) return out;
	for (const n of v.slice(0, 2000)) {
		if (!isObj(n)) continue;
		const marks = sanitizeMarks(n.marks);
		if (n.type === 'hardBreak') out.push({ type: 'hardBreak' });
		else if (n.type === 'mergeTag') {
			const tag = str(n.tag, 200);
			if (tag && isMergeToken(tag)) out.push(marks ? { type: 'mergeTag', tag, marks } : { type: 'mergeTag', tag });
			else pushText(tag ? `{{${tag}}}` : '', marks);
		} else if (n.type === 'text') {
			const parts = str(n.text).split('\n');
			parts.forEach((p, i) => {
				if (i > 0) out.push({ type: 'hardBreak' });
				pushText(p, marks);
			});
		}
	}
	return out;
}

function sanitizeVisibility(v: unknown): Visibility | undefined {
	if (!isObj(v) || typeof v.kind !== 'string' || !VIS_KINDS.has(v.kind)) return undefined;
	const name = str(v.name, 100).trim();
	if (!name) return undefined;
	const vis: Visibility = { kind: v.kind as Visibility['kind'], name };
	if (v.kind === 'field-eq') vis.value = str(v.value, 200);
	return vis;
}

type Where = 'top' | 'section' | 'cell';

function sanitizeList(v: unknown, allowContent: boolean, where: Where): Block[] {
	return (Array.isArray(v) ? v : []).slice(0, MAX_BLOCKS).flatMap((x) => sanitizeBlock(x, allowContent, where));
}

function sanitizeBlock(v: unknown, allowContent: boolean, where: Where): Block[] {
	if (!isObj(v) || typeof v.type !== 'string') return [];
	const id = typeof v.id === 'string' && /^[\w-]{1,64}$/.test(v.id) ? v.id : crypto.randomUUID();
	const visibility = sanitizeVisibility(v.visibility);
	const inCell = where === 'cell';
	const align = oneOf(v.align, ALIGNS);
	const textSize = oneOf(v.textSize, TEXT_SIZES); // #276
	let b: Block | null = null;
	switch (v.type) {
		case 'heading': {
			const display = v.size === 'display';
			const level = display ? 1 : v.level === 1 || v.level === 3 ? v.level : 2;
			if (Array.isArray(v.content)) {
				const content = sanitizeInline(v.content);
				b = { id, type: 'heading', level, text: inlinePlainText(content), content };
			} else b = { id, type: 'heading', level, text: str(v.text, 2000) };
			if (display) b.size = 'display';
			assignDefined(b, { color: hexOrUndef(v.color), align, textSize });
			break;
		}
		case 'eyebrow':
			b = { id, type: 'eyebrow', content: sanitizeInline(v.content) };
			if (v.tone === 'accent') b.tone = 'accent';
			assignDefined(b, { align });
			break;
		case 'milestones': {
			const items = (Array.isArray(v.items) ? v.items : []).slice(0, 4).map((it) => ({
				title: sanitizeInline(isObj(it) ? it.title : null),
				label: sanitizeInline(isObj(it) ? it.label : null)
			}));
			while (items.length < 2) items.push({ title: [], label: [] });
			b = { id, type: 'milestones', items, rule: v.rule !== false };
			assignDefined(b, { align });
			break;
		}
		case 'section': {
			// Nesting rule: a section inside a section or a cell keeps only its children.
			if (where !== 'top') return sanitizeList(v.blocks, allowContent, where);
			const sec: SectionBlock = {
				id,
				type: 'section',
				bg: normalizeHex(v.bg) || BRAND.white,
				padding: v.padding === 'sm' || v.padding === 'md' ? v.padding : 'lg',
				width: v.width === 'inset' ? 'inset' : 'full',
				blocks: sanitizeList(v.blocks, allowContent, 'section')
			};
			const color = normalizeHex(v.color);
			if (color) sec.color = color;
			if (v.align === 'center') sec.align = 'center';
			const borderColor = hexOrUndef(v.borderColor);
			assignDefined(sec, {
				padTop: clampInt(v.padTop, 0, PAD_MAX),
				padBottom: clampInt(v.padBottom, 0, PAD_MAX),
				padX: clampInt(v.padX, 0, PAD_MAX),
				radius: oneOf(v.radius, SECTION_RADII),
				borderColor,
				// A border needs a colour; its width defaults to 1px.
				borderWidth: borderColor ? (clampInt(v.borderWidth, 1, 4) ?? 1) : undefined,
				bgImage: cleanImageUrl(v.bgImage) || undefined,
				accent: hexOrUndef(v.accent)
			});
			b = sec;
			break;
		}
		case 'text':
			b = { id, type: 'text', md: str(v.md, 200_000) };
			break;
		case 'paragraph':
		case 'quote':
		case 'callout':
		{
			const tb: Block = { id, type: v.type as 'paragraph' | 'quote' | 'callout', content: sanitizeInline(v.content) };
			assignDefined(tb, { align, textSize, color: hexOrUndef(v.color) });
			b = tb;
			break;
		}
		case 'list': {
			const items = (Array.isArray(v.items) ? v.items : []).slice(0, 500).map(sanitizeInline);
			b = { id, type: 'list', ordered: v.ordered === true, items: items.length ? items : [[]] };
			if (b.ordered && v.style === 'steps') b.style = 'steps';
			assignDefined(b, { align, textSize, color: hexOrUndef(v.color) });
			break;
		}
		case 'image': {
			const src = str(v.src, 2000).trim();
			const img: Block = { id, type: 'image', src: /^https?:\/\//i.test(src) && !/[\s<>"]/.test(src) ? src : '', alt: str(v.alt, 500) };
			const href = cleanHref(v.href);
			if (href) img.href = href;
			const pct = clampImageWidthPct(v.widthPct);
			const w = Math.round(Number(v.width));
			if (pct) img.widthPct = pct;
			else if (Number.isFinite(w) && w >= 40 && w < 600) img.width = w;
			if (v.style === 'chip') img.style = 'chip';
			const beside = str(v.beside, 80).replace(/\s+/g, ' ').trim();
			if (beside) img.beside = beside;
			// #497: a crop is only kept with its original (else it couldn't be undone).
			const ratio = cleanRatio(v.ratio);
			const origSrc = cleanImageUrl(v.origSrc);
			if (ratio && origSrc && img.src) assignDefined(img, { ratio, origSrc, focal: cleanFocal(v.focal) });
			assignDefined(img, { align });
			b = img;
			break;
		}
		case 'button': {
			const btn: Block = {
				id,
				type: 'button',
				label: str(v.label, 200),
				href: cleanHref(v.href),
				align: v.align === 'center' || v.align === 'right' ? v.align : 'left'
			};
			// The secondary link needs both a label and a usable URL.
			const linkLabel = str(v.linkLabel, 200).trim();
			const linkHref = cleanHref(v.linkHref);
			if (linkLabel && linkHref) Object.assign(btn, { linkLabel, linkHref });
			assignDefined(btn, {
				bg: hexOrUndef(v.bg),
				fg: hexOrUndef(v.fg),
				radius: oneOf(v.radius, BUTTON_RADII),
				btnSize: oneOf(v.btnSize, ['sm', 'md', 'lg'] as const),
				full: v.full === true ? true : undefined,
				linkColor: hexOrUndef(v.linkColor)
			});
			b = btn;
			break;
		}
		case 'divider':
			b = { id, type: 'divider' };
			assignDefined(b, { color: hexOrUndef(v.color), thickness: clampInt(v.thickness, 1, 4), short: v.short === true ? true : undefined });
			break;
		case 'spacer':
			b = { id, type: 'spacer', size: v.size === 'sm' || v.size === 'lg' ? v.size : 'md' };
			assignDefined(b, { px: clampInt(v.px, 0, SPACER_MAX) });
			break;
		case 'content':
			b = allowContent && !inCell ? { id, type: 'content' } : null;
			break;
		case 'columns': {
			if (inCell || !Array.isArray(v.cells)) return [];
			const cells = v.cells.slice(0, 3).map((c) => sanitizeList(c, allowContent, 'cell'));
			while (cells.length < 2) cells.push([]);
			b = { id, type: 'columns', cells };
			assignDefined(b, {
				gap: oneOf(v.gap, COLUMN_GAPS),
				valign: oneOf(v.valign, ['top', 'middle'] as const),
				stack: v.stack === false ? false : undefined
			});
			break;
		}
	}
	if (b && visibility) b.visibility = visibility;
	// #270: space below, on every block but the content area.
	const spaceBelow = oneOf(v.spaceBelow, SPACE_BELOW);
	if (b && spaceBelow !== undefined && b.type !== 'content') b.spaceBelow = spaceBelow;
	// #498: which archive page a web template block shows on (not the content area).
	const showOn = oneOf(v.showOn, SHOW_ON);
	if (b && showOn !== undefined && b.type !== 'content') b.showOn = showOn;
	return b ? [b] : [];
}

/** Rebuild a block document from untrusted JSON, keeping only known types, marks and
 *  attributes (`allowContent` = templates' content area). Never throws. */
export function sanitizeBlocks(input: unknown, opts: { allowContent?: boolean } = {}): Block[] {
	if (!Array.isArray(input)) return [];
	return sanitizeList(input, opts.allowContent ?? true, 'top');
}

/** #262: content areas anywhere in a document (top level or inside sections). */
export function countContentAreas(blocks: Block[]): number {
	return blocks.reduce((n, b) => n + (b.type === 'content' ? 1 : b.type === 'section' ? countContentAreas(b.blocks) : 0), 0);
}

/** #262: drop every content area after the first (document order, sections included). */
export function keepFirstContentArea(blocks: Block[]): Block[] {
	let seen = false;
	const walk = (list: Block[]): Block[] =>
		list.flatMap((b): Block[] => {
			if (b.type === 'section') return [{ ...b, blocks: walk(b.blocks) }];
			if (b.type !== 'content') return [b];
			if (seen) return [];
			seen = true;
			return [b];
		});
	return walk(blocks);
}

/** True when a document has nothing that would render (empty paragraphs only). */
export function blocksAreEmpty(blocks: Block[]): boolean {
	const has = (b: Block): boolean => {
		switch (b.type) {
			case 'heading':
				return !!(b.content ? inlinePlainText(b.content) : b.text).trim();
			case 'text':
				return !!b.md.trim();
			case 'paragraph':
			case 'quote':
			case 'callout':
				return b.content.some((n) => n.type === 'mergeTag' || (n.type === 'text' && n.text.trim()));
			case 'list':
				return b.items.some((it) => it.some((n) => n.type === 'mergeTag' || (n.type === 'text' && n.text.trim())));
			case 'eyebrow':
				return b.content.some((n) => n.type === 'mergeTag' || (n.type === 'text' && n.text.trim()));
			case 'milestones':
				return b.items.some((it) => !!inlinePlainText([...it.title, ...it.label]).trim());
			case 'image':
				return !!b.src;
			case 'button':
				return !!b.href;
			case 'spacer':
				return false;
			case 'columns':
				return b.cells.some((c) => c.some(has));
			case 'section':
				return b.blocks.some(has);
			default:
				return true;
		}
	};
	return !blocks.some(has);
}

/** Markdown → HTML for the builder's visual canvas (operator-authored content). */
export function markdownToHtml(s: string): string {
	return md(s);
}

const SPACER_PX = { sm: 12, md: 28, lg: 56 } as const;

// ---------------------------------------------------------------------------
// Page target
// ---------------------------------------------------------------------------

/** #262: a section's colours: text (explicit or auto), the accent for step circles /
 *  eyebrows (teal unless it'd vanish on the background), and the hairline colour. */
function sectionColors(s: SectionBlock): { color: string; accent: string; hairline: string } {
	const color = s.color ?? autoTextColor(s.bg);
	// #270: an explicit accent wins over the computed one.
	const accent = s.accent ?? (contrastRatio(BRAND.teal, s.bg) >= 3 ? BRAND.teal : color);
	const hairline = contrastRatio(BRAND.hairline, s.bg) >= 1.2 ? BRAND.hairline : color;
	return { color, accent, hairline };
}

/** #270: a section's custom padding as (top, sides, bottom) px, or null for the preset. */
function customPad(s: SectionBlock, preset: readonly [number, number]): [number, number, number] | null {
	if (s.padTop === undefined && s.padBottom === undefined && s.padX === undefined) return null;
	return [s.padTop ?? preset[0], s.padX ?? preset[1], s.padBottom ?? preset[0]];
}

/** #270: the button's size presets (padding, font size, line height). md = the original. */
const BTN_SIZE = { sm: ['8px 16px', 14, 18], md: ['11px 22px', 16, 20], lg: ['15px 30px', 18, 24] } as const;

const PAGE_SEC_PAD = { sm: '16px 20px', md: '28px 28px', lg: '44px 40px' } as const;
const PAGE_SEC_PAD_PX = { sm: [16, 20], md: [28, 28], lg: [44, 40] } as const;

/** #270: inline style for a page block's own alignment / colour / space below ('' = none,
 *  so blocks without design attributes render exactly as before). */
function pageStyle(b: Block, extra = ''): string {
	const a = 'align' in b && b.type !== 'button' ? b.align : undefined;
	const fs = blockTextSizePx(b);
	const s = `${a ? `text-align:${a};` : ''}${fs ? `font-size:${fs}px;` : ''}${blockColorCss(b)}${b.spaceBelow !== undefined ? `margin-bottom:${b.spaceBelow}px;` : ''}${extra}`;
	return s ? ` style="${s}"` : '';
}

/** #276: which size column a block reads (null = no text size). */
export function textSizeKind(type: string, level?: unknown, display?: boolean): TextSizeKind | null {
	if (type === 'heading') return display ? 'display' : level === 1 ? 'h1' : level === 3 ? 'h3' : 'h2';
	return type === 'paragraph' || type === 'list' || type === 'quote' || type === 'callout' ? 'body' : null;
}

/** #276: a block's text size in px (undefined when unset, so the default applies). */
export function blockTextSizePx(b: Block): number | undefined {
	if (!('textSize' in b) || !b.textSize) return undefined;
	const kind = textSizeKind(b.type, b.type === 'heading' ? b.level : undefined, b.type === 'heading' && b.size === 'display');
	return kind ? TEXT_SIZE_PX[kind][b.textSize] : undefined;
}

/** #276: `color:` for a body text block's own colour ('' when unset). A heading's colour
 *  has always been painted by its own renderer. */
function blockColorCss(b: Block): string {
	return (b.type === 'paragraph' || b.type === 'list' || b.type === 'quote' || b.type === 'callout') && b.color ? `color:${b.color};` : '';
}

/** #498: the archive page being rendered; a block with another `showOn` is left out. */
type PageKind = ShowOn | undefined;

function pageBlock(b: Block, acc?: string, content?: string, page?: PageKind): string {
	if (page && b.showOn && b.showOn !== page) return '';
	switch (b.type) {
		case 'heading': {
			const st = pageStyle(b, b.color ? `color:${b.color};` : '');
			if (b.size === 'display') return `<h1 class="b-display"${st}>${b.content ? renderInlineHtml(b.content, '') : esc(b.text)}</h1>`;
			return `<h${b.level}${st}>${b.content ? renderInlineHtml(b.content, '') : esc(b.text)}</h${b.level}>`;
		}
		case 'eyebrow': {
			const just = b.align ? `justify-content:${b.align === 'left' ? 'flex-start' : b.align === 'right' ? 'flex-end' : 'center'};` : '';
			return `<p class="b-eyebrow${b.tone === 'accent' ? ' accent' : ''}"${pageStyle(b, just)}><span class="b-eyebrow-rule"${acc ? ` style="border-top-color:${acc}"` : ''}></span>${renderInlineHtml(b.content, '')}</p>`;
		}
		case 'milestones': {
			const items = b.items
				.map((it) => `<div><strong>${renderInlineHtml(it.title, '')}</strong><span>${renderInlineHtml(it.label, '')}</span></div>`)
				.join('');
			const extra = `${b.align ? `text-align:${b.align};` : ''}${b.spaceBelow !== undefined ? `margin-bottom:${b.spaceBelow}px;` : ''}${acc && b.rule ? `border-top-color:${acc};` : ''}`;
			return `<div class="b-ms${b.rule ? ' rule' : ''}" style="--n:${b.items.length}${extra ? `;${extra}` : ''}">${items}</div>`;
		}
		case 'section': {
			const { color, accent, hairline } = sectionColors(b);
			const pad = customPad(b, PAGE_SEC_PAD_PX[b.padding]);
			const extra =
				(b.radius !== undefined ? `border-radius:${b.radius}px;` : '') +
				(b.borderColor ? `border:${b.borderWidth ?? 1}px solid ${b.borderColor};` : '') +
				(b.bgImage ? `background-image:url(${b.bgImage});background-size:cover;background-position:center;` : '') +
				(b.spaceBelow !== undefined ? `margin-bottom:${b.spaceBelow}px;` : '');
			const style = `background:${b.bg};color:${color};padding:${pad ? `${pad[0]}px ${pad[1]}px ${pad[2]}px` : PAGE_SEC_PAD[b.padding]};--acc:${accent};--hair:${hairline};--btn-bg:${color};--btn-fg:${b.bg};${b.align === 'center' ? 'text-align:center;' : ''}${extra}`;
			return `<section class="b-sec ${b.width}" style="${style}">${b.blocks.map((x) => pageBlock(x, b.accent, content, page)).join('\n')}</section>`;
		}
		case 'text':
			// #531: member-authored and served on the app origin — no raw HTML here.
			return `<div class="b-text">${parseMarkdownSafe(b.md)}</div>`;
		case 'paragraph':
			return `<p${pageStyle(b)}>${renderInlineHtml(b.content, '') || '<br>'}</p>`;
		case 'list': {
			const tag = b.ordered ? 'ol' : 'ul';
			const cls = b.style === 'steps' ? ' class="b-steps"' : '';
			const inside = b.align && b.align !== 'left' && b.style !== 'steps' ? 'list-style-position:inside;padding-left:0;' : '';
			return `<${tag}${cls}${pageStyle(b, inside)}>${b.items.map((it) => `<li>${renderInlineHtml(it, '')}</li>`).join('')}</${tag}>`;
		}
		case 'quote':
			return `<blockquote${pageStyle(b)}>${renderInlineHtml(b.content, '')}</blockquote>`;
		case 'callout':
			return `<div class="b-callout"${pageStyle(b)}>${renderInlineHtml(b.content, '')}</div>`;
		case 'image': {
			if (!safeUrl(b.src)) return '';
			const auto = !b.style && !b.beside && b.align && b.align !== 'left' ? (b.align === 'center' ? 'margin-left:auto;margin-right:auto;' : 'margin-left:auto;') : '';
			const sizeCss = (b.widthPct ? `width:${b.widthPct}%` : b.width ? `max-width:${b.width}px` : '') + (auto ? `${b.widthPct || b.width ? ';' : ''}${auto}` : '');
			const size = sizeCss ? ` style="${sizeCss}"` : '';
			const img = `<img src="${safeUrl(b.src)}" alt="${esc(b.alt)}" loading="lazy"${size}>`;
			const linked = b.href && safeUrl(b.href) ? `<a href="${safeUrl(b.href)}">${img}</a>` : img;
			if (!b.style && !b.beside) return `<div class="b-img"${pageStyle(b)}>${linked}</div>`;
			const chip = b.style === 'chip' ? `<span class="b-chip">${linked}</span>` : linked;
			const just = b.align ? `justify-content:${b.align === 'left' ? 'flex-start' : b.align === 'right' ? 'flex-end' : 'center'};` : '';
			return `<div class="b-img b-img-row"${pageStyle(b, just)}>${chip}${b.beside ? `<span class="b-beside">${esc(b.beside)}</span>` : ''}</div>`;
		}
		case 'button': {
			if (!safeUrl(b.href)) return '';
			const linkStyle = b.linkColor ? ` style="color:${b.linkColor}"` : '';
			const link = b.linkLabel && safeUrl(b.linkHref ?? '') ? `<a class="b-link" href="${safeUrl(b.linkHref!)}"${linkStyle}>${esc(b.linkLabel)}</a>` : '';
			const row = link ? ' b-btn-row' : '';
			const sz = b.btnSize && b.btnSize !== 'md' ? BTN_SIZE[b.btnSize] : null;
			const btnCss =
				(b.bg ? `background:${b.bg};` : '') +
				(b.fg ? `color:${b.fg};` : '') +
				(b.radius !== undefined ? `border-radius:${b.radius}px;` : '') +
				(sz ? `padding:${sz[0]};font-size:${sz[1]}px;line-height:${sz[2]}px;` : '') +
				(b.full ? 'display:block;text-align:center;' : '');
			const mb = b.spaceBelow !== undefined ? `;margin-bottom:${b.spaceBelow}px` : '';
			return `<div class="b-btn${row}" style="text-align:${b.align}${link ? `;justify-content:${b.align === 'left' ? 'flex-start' : b.align === 'right' ? 'flex-end' : 'center'}` : ''}${mb}"><a class="btn" href="${safeUrl(b.href)}"${btnCss ? ` style="${btnCss}"` : ''}>${esc(b.label || 'Learn more')}</a>${link}</div>`;
		}
		case 'divider': {
			const col = b.color ?? acc;
			const css =
				(b.thickness || col ? `border-top:${b.thickness ?? 1}px solid ${col ?? '#e5e7eb'};` : '') +
				(b.short ? 'width:25%;' : '') +
				(b.spaceBelow !== undefined ? `margin-bottom:${b.spaceBelow}px;` : '');
			return css ? `<hr style="${css}">` : `<hr>`;
		}
		case 'content':
			return content ?? ''; // pages have no campaign content; #481: a web template's issue lands here
		case 'spacer':
			return `<div style="height:${b.px ?? SPACER_PX[b.size] ?? SPACER_PX.md}px"></div>`;
		case 'columns': {
			const cells = b.cells
				.map((cell) => `<div class="col">${cell.map((x) => pageBlock(x, acc, content, page)).join('\n')}</div>`)
				.join('\n');
			const css =
				(b.gap !== undefined ? `gap:${b.gap}px;` : '') +
				(b.valign === 'middle' ? 'align-items:center;' : '') +
				(b.stack === false ? `grid-template-columns:repeat(${b.cells.length}, minmax(0, 1fr));` : '') +
				(b.spaceBelow !== undefined ? `margin-bottom:${b.spaceBelow}px;` : '');
			return `<div class="cols cols-${b.cells.length}"${css ? ` style="${css}"` : ''}>${cells}</div>`;
		}
	}
}

/** #481: the page target's block styles (hosted pages and the newsletter archive). */
export const PAGE_CSS = `  :root { color-scheme: light; }
  body { margin:0; padding:0; background:#fafafa;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    font-size:17px; line-height:1.65; color:#1f2328; }
  .page { max-width:720px; margin:0 auto; padding:48px 24px 80px; }
  h1 { font-size:32px; line-height:1.2; margin:32px 0 20px; }
  h2 { font-size:22px; line-height:1.3; margin:28px 0 12px; }
  p { margin:0 0 16px; }
  ul, ol { margin:0 0 16px; padding-left:22px; }
  a { color:#2563eb; }
  img { max-width:100%; height:auto; border-radius:8px; display:block; }
  hr { border:none; border-top:1px solid #e5e7eb; margin:28px 0; }
  blockquote { margin:0 0 16px; padding:4px 0 4px 16px; border-left:3px solid #e5e7eb; color:#57606a; }
  h3 { font-size:18px; line-height:1.35; margin:22px 0 10px; }
  /* #329: no space above a heading that opens its container or follows a heading / eyebrow. */
  :is(.page, .b-sec, .col) > :is(h1, h2, h3):first-child,
  :is(h1, h2, h3, .b-eyebrow) + :is(h1, h2, h3) { margin-top:0; }
  .b-img { margin:0 0 16px; }
  .b-callout { margin:0 0 16px; padding:14px 16px; background:#f4f4f5; border-radius:8px; }
  .b-btn { margin:8px 0 20px; }
  .btn { display:inline-block; background:#2563eb; color:#ffffff; padding:11px 22px;
    border-radius:8px; text-decoration:none; font-weight:600; }
  .cols { display:grid; gap:24px; margin:0 0 16px; }
  .cols-2 { grid-template-columns:1fr 1fr; }
  .cols-3 { grid-template-columns:1fr 1fr 1fr; }
  @media (max-width:600px) { .cols-2, .cols-3 { grid-template-columns:1fr; } }
  .b-sec { margin:0 0 16px; border-radius:12px; font-family:${BRAND_FONT}; }
  .b-sec.full { border-radius:0; margin:0; }
  .b-sec > :last-child { margin-bottom:0; }
  .b-sec a { color:inherit; }
  .b-sec .btn { background:var(--btn-bg); color:var(--btn-fg); }
  .b-eyebrow { display:flex; align-items:center; gap:10px; margin:0 0 16px; font-size:13px;
    line-height:1.4; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; }
  .b-sec[style*="text-align:center"] .b-eyebrow { justify-content:center; }
  .b-eyebrow.accent { color:var(--acc, #1a9ec4); }
  .b-eyebrow-rule { flex:0 0 28px; border-top:2px solid currentColor; }
  .b-display { font-size:52px; line-height:1.05; letter-spacing:-0.02em; margin:0 0 20px; }
  .b-ms { display:grid; grid-template-columns:repeat(var(--n), minmax(0, 1fr)); gap:16px; margin:8px 0 24px; }
  .b-ms.rule { border-top:4px solid currentColor; padding-top:16px; }
  .b-ms strong { display:block; font-size:20px; line-height:1.25; }
  .b-ms span { display:block; font-size:13px; line-height:1.4; }
  .b-steps { list-style:none; padding:0; counter-reset:step; }
  .b-steps li { counter-increment:step; display:flex; gap:16px; margin:0; padding:14px 0;
    border-top:1px solid var(--hair, #e3e3e3); }
  .b-steps li:first-child { border-top:0; }
  .b-steps li::before { content:counter(step); flex:0 0 28px; height:28px; border:2px solid var(--acc, #1a9ec4);
    border-radius:50%; text-align:center; line-height:28px; font-size:14px; font-weight:700; }
  .b-btn-row { display:flex; flex-wrap:wrap; align-items:center; gap:12px 20px; }
  .b-link { font-weight:600; text-decoration:underline; }
  .b-img-row { display:flex; align-items:center; gap:12px; }
  .b-sec[style*="text-align:center"] .b-img-row { justify-content:center; }
  .b-img-row img { width:auto; }
  .b-chip { display:inline-block; background:#ffffff; border-radius:12px; padding:12px 16px; }
  .b-chip img { border-radius:0; }
  .b-beside { font-size:22px; font-weight:700; }
  @media (max-width:600px) {
    .b-ms { grid-template-columns:1fr 1fr; }
    .b-display { font-size:36px; }
    .b-sec { padding:28px 20px !important; }
  }
`;

/** #481: page-target HTML for a list of blocks (no document). A `content` block renders
 *  `content` (the newsletter archive's issue / index inside a web template). #498: with
 *  `opts.page`, blocks whose `showOn` names the other page are skipped. */
export function renderPageBlocks(blocks: Block[], content?: string, opts: { page?: ShowOn } = {}): string {
	return sanitizeBlocks(blocks, { allowContent: content !== undefined })
		.map((b) => pageBlock(b, undefined, content, opts.page))
		.join('\n');
}

/** Full standalone HTML document for a hosted page (/p/[slug]). */
export function renderPageHtml(title: string, blocks: Block[]): string {
	const body = sanitizeBlocks(blocks).map((b) => pageBlock(b)).join('\n');
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${PAGE_CSS}</style>
</head>
<body>
<main class="page">
${body}
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Email target (table-based hybrid — Gmail/Outlook-safe)
// ---------------------------------------------------------------------------

/** Visibility → condition string for the per-recipient evaluator (#62). */
function visCond(v: Visibility): string | null {
	const name = (v.name ?? '').trim().replaceAll('}', '').replaceAll('"', '');
	if (!name) return null;
	if (v.kind === 'tag' || v.kind === 'no-tag') {
		const negate = v.kind === 'no-tag';
		// A name outside the tag charset still has to be emitted. Dropping it would
		// show the block with no condition; the old string stays verbatim instead.
		return formatTagCondition(name, negate) ?? `${negate ? '!' : ''}tag:${name}`;
	}
	if (v.kind === 'field-exists') return `field:${name}`;
	if (v.kind === 'field-eq') return `field:${name} == "${(v.value ?? '').replaceAll('"', '').replaceAll('}', '')}"`;
	return null;
}

/** Render context: the available width, the font, and (#262) the enclosing section's
 *  colours. Outside a section every block renders exactly as before. #270: `size` /
 *  `link` = the template canvas's body font size and link colour (unset = 16px / blue);
 *  `sec.acc` = the section's explicit accent (unset = the original colours). */
type EmailCtx = {
	width: number;
	font: string;
	size?: number;
	link?: string;
	sec?: { bg: string; color: string; accent: string; hairline: string; center: boolean; acc?: string };
	/** #275: the canvas's chosen fonts / line height (unset = as before). `own` = the
	 *  canvas picked a body font, so sections use it instead of the brand font. */
	hfont?: string;
	lh?: number;
	own?: boolean;
};
const TOP_CTX: EmailCtx = { width: 600, font: EMAIL_FONT };

/** #276: a text block's own size (when set) wins over the canvas body size. */
const textStyle = (c: EmailCtx, b?: Block) => `font-family:${c.font};font-size:${(b && blockTextSizePx(b)) ?? c.size ?? 16}px;line-height:${c.lh ?? 1.6};`;
/** Inline HTML; links inside a section wear its text colour (underlined). */
const inl = (nodes: Inline[], c: EmailCtx, color?: string) =>
	color || c.sec
		? renderInlineHtml(nodes, `color:${color ?? c.sec!.color};text-decoration:underline;`)
		: c.link
			? renderInlineHtml(nodes, `color:${c.link};text-decoration:underline;`)
			: renderInlineHtml(nodes);
const PRES = 'role="presentation" border="0" cellpadding="0" cellspacing="0"';
/** Email section padding (vertical, horizontal); a media query steps lg/md down on phones. */
const SEC_PAD = { sm: [16, 20], md: [28, 28], lg: [40, 36] } as const;

/** #270: the block's bottom margin (its own default unless `spaceBelow` is set). */
const mb = (b: Block, d: number) => b.spaceBelow ?? d;

/** #329: default space above a (non-display) heading, by level. */
export const HEADING_SPACE_ABOVE = { 1: 32, 2: 28, 3: 22 } as const;
/** #329: a heading's space above in px: its level's default, but 0 when it opens its
 *  container (email body, section, column — `prev` undefined) or follows another heading
 *  or an eyebrow, so those stay tight. */
export function headingSpaceAbove(b: Block, prev?: Block): number {
	if (b.type !== 'heading' || b.size === 'display') return 0;
	if (!prev || prev.type === 'heading' || prev.type === 'eyebrow') return 0;
	return HEADING_SPACE_ABOVE[b.level] ?? HEADING_SPACE_ABOVE[2];
}
/** #270: `text-align` for a block's own alignment ('' when unset). */
const ta = (b: Block) => ('align' in b && b.type !== 'button' && b.align ? `text-align:${b.align};` : '');
/** #270: a shrink-to-fit table's alignment: own setting, else the section's centring. */
function tableAlign(b: Block, c: EmailCtx, bottom: number): string {
	const own = 'align' in b ? b.align : undefined;
	const al = own ?? (c.sec?.center ? 'center' : 'left');
	if (al === 'center') return ` align="center" style="margin:0 auto ${bottom}px;"`;
	if (al === 'right') return ` style="margin:0 0 ${bottom}px auto;"`;
	return ` style="margin:0 0 ${bottom}px;"`;
}

/** `prev` = the previous sibling in the same container (undefined = first). */
function emailBlock(b: Block, c: EmailCtx, prev?: Block): string {
	const inner = emailBlockInner(b, c, prev);
	const cond = b.visibility ? visCond(b.visibility) : null;
	return cond && inner ? `{{#if ${cond}}}${inner}{{/if}}` : inner;
}

function emailBlockInner(b: Block, c: EmailCtx, prev?: Block): string {
	const width = c.width;
	switch (b.type) {
		case 'heading': {
			const own = `${ta(b)}${b.color ? `color:${b.color};` : ''}`;
			const content = b.content && b.color ? inl(b.content, c, b.color) : null;
			if (b.size === 'display') {
				// Inline 48px is the fallback; the shell's media query steps it down on phones.
				return `<div class="ds-display" style="font-family:${c.hfont ?? c.font};font-size:${blockTextSizePx(b) ?? 48}px;font-weight:800;line-height:1.05;letter-spacing:-0.02em;margin:0 0 ${mb(b, 20)}px;${own}">${content ?? (b.content ? inl(b.content, c) : esc(b.text))}</div>`;
			}
			const size = blockTextSizePx(b) ?? (b.level === 1 ? 26 : b.level === 2 ? 20 : 17);
			// #329: space above is a top margin, like every other block's spacing here (margin
			// on a block element holds up in Outlook's Word engine; padding on a div doesn't).
			const top = headingSpaceAbove(b, prev);
			return `<div style="font-family:${c.hfont ?? c.font};font-size:${size}px;font-weight:700;line-height:1.25;margin:${top ? `${top}px` : 0} 0 ${mb(b, 14)}px;${own}">${content ?? (b.content && (c.sec || c.link) ? inl(b.content, c) : headingInline(b))}</div>`;
		}
		case 'text':
			return `<div style="font-family:${c.font};font-size:${c.size ?? 16}px;line-height:${c.lh ?? 1.6};${b.spaceBelow !== undefined ? `margin:0 0 ${b.spaceBelow}px;` : ''}">${md(b.md)}</div>`;
		case 'paragraph':
			return `<p style="${textStyle(c, b)}margin:0 0 ${mb(b, 16)}px;${ta(b)}${blockColorCss(b)}">${inl(b.content, c) || '<br>'}</p>`;
		case 'eyebrow': {
			const col = b.tone === 'accent' ? (c.sec?.accent ?? BRAND.teal) : (c.sec?.color ?? BRAND.ink);
			// #270: an explicit section accent colours the rule.
			const rule = c.sec?.acc ?? col;
			return (
				`<table ${PRES}${tableAlign(b, c, mb(b, 16))}><tr>` +
				`<td width="28" style="width:28px;"><div style="border-top:2px solid ${rule};width:28px;font-size:0;line-height:0;">&nbsp;</div></td>` +
				`<td style="padding-left:10px;font-family:${c.font};font-size:13px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${col};">${inl(b.content, c, col) || '&nbsp;'}</td>` +
				`</tr></table>`
			);
		}
		case 'list': {
			if (b.style === 'steps' && b.ordered) {
				const acc = c.sec?.accent ?? BRAND.teal;
				const hair = c.sec?.hairline ?? BRAND.hairline;
				// One table row per step: outlined number on the left, text on the right,
				// a hairline between items.
				const rows = b.items
					.map((it, i) => {
						const rule = i ? `border-top:1px solid ${hair};` : '';
						return (
							`<tr><td width="44" valign="top" style="width:44px;padding:14px 0;${rule}">` +
							`<div style="width:28px;height:28px;border:2px solid ${acc};border-radius:50%;text-align:center;font-family:${c.font};font-size:14px;font-weight:700;line-height:28px;">${i + 1}</div></td>` +
							`<td valign="top" style="${textStyle(c, b)}padding:17px 0 14px;${rule}${blockColorCss(b)}">${inl(it, c) || '<br>'}</td></tr>`
						);
					})
					.join('');
				return `<table ${PRES} width="100%" style="margin:0 0 ${mb(b, 16)}px;text-align:${b.align ?? 'left'};">${rows}</table>`;
			}
			const tag = b.ordered ? 'ol' : 'ul';
			const items = b.items.map((it) => `<li style="margin:0 0 8px;">${inl(it, c) || '<br>'}</li>`).join('');
			const inside = b.align && b.align !== 'left' ? 'list-style-position:inside;padding-left:0;' : '';
			return `<${tag} style="${textStyle(c, b)}margin:0 0 ${mb(b, 16)}px;padding-left:22px;${ta(b)}${inside}${blockColorCss(b)}">${items}</${tag}>`;
		}
		case 'milestones': {
			const n = b.items.length;
			const cw = Math.floor((width - 8) / n); // a little slack so n always fit on one row
			const rule = b.rule ? `border-top:4px solid ${c.sec?.acc ?? c.sec?.color ?? BRAND.ink};padding-top:16px;` : '';
			const al = b.align ?? 'left';
			// Hybrid: fixed max-width inline-block cells wrap to 2×2 / one column on phones.
			const cells = b.items
				.map(
					(it) =>
						`<div class="ds-ms" style="display:inline-block;width:100%;max-width:${cw}px;vertical-align:top;">` +
						`<div style="padding:0 12px 12px 0;font-family:${c.font};font-size:16px;line-height:1.4;text-align:${al};">` +
						`<div style="font-size:20px;font-weight:700;line-height:1.25;margin:0 0 4px;">${inl(it.title, c) || '&nbsp;'}</div>` +
						`<div style="font-size:13px;line-height:1.4;">${inl(it.label, c) || '&nbsp;'}</div></div></div>`
				)
				.join('');
			return `<div style="font-size:0;line-height:0;margin:8px 0 ${mb(b, 12)}px;${rule}text-align:${al};">${cells}</div>`;
		}
		case 'quote':
			if (c.sec) return `<blockquote style="${textStyle(c, b)}margin:0 0 ${mb(b, 16)}px;padding:4px 0 4px 16px;border-left:3px solid ${c.sec.hairline};${ta(b)}${blockColorCss(b)}">${inl(b.content, c) || '<br>'}</blockquote>`;
			return `<blockquote style="${textStyle(c, b)}margin:0 0 ${mb(b, 16)}px;padding:4px 0 4px 16px;border-left:3px solid #e5e7eb;color:#57606a;${ta(b)}${blockColorCss(b)}">${inl(b.content, c) || '<br>'}</blockquote>`;
		case 'callout':
			// A callout keeps its own light box (and dark text) inside a coloured section.
			return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 ${mb(b, 16)}px;"><tr><td style="${textStyle(c, b)}background:#f4f4f5;border-radius:8px;padding:14px 16px;${c.sec ? `color:#1f2328;text-align:${b.align ?? 'left'};` : ta(b)}${blockColorCss(b)}">${renderInlineHtml(b.content) || '<br>'}</td></tr></table>`;
		case 'image': {
			if (!safeUrl(b.src)) return '';
			const chip = b.style === 'chip';
			const w = b.widthPct
				? Math.round((width * b.widthPct) / 100)
				: b.width
					? Math.min(b.width, width)
					: chip || b.beside
						? Math.min(120, width)
						: width;
			const href = cleanHref(b.href);
			if (!chip && !b.beside) {
				const al = b.align ?? (c.sec?.center ? 'center' : 'left');
				const margin = al === 'center' ? 'margin:0 auto;' : al === 'right' ? 'margin:0 0 0 auto;' : '';
				const img = `<img src="${safeUrl(b.src)}" alt="${esc(b.alt)}" width="${w}" style="display:block;${margin}width:100%;max-width:${w}px;height:auto;border-radius:6px;">`;
				const out = href ? `<a href="${esc(href)}">${img}</a>` : img;
				// #329: 16px below by default, like a paragraph.
				return `<div style="margin:0 0 ${mb(b, 16)}px;">${out}</div>`;
			}
			// Chip / wordmark: a fixed-width image in a shrink-to-fit table.
			const img = `<img src="${safeUrl(b.src)}" alt="${esc(b.alt)}" width="${w}" style="display:block;width:${w}px;max-width:100%;height:auto;border-radius:${chip ? 0 : 6}px;">`;
			let cell = href ? `<a href="${esc(href)}">${img}</a>` : img;
			if (chip) cell = `<table ${PRES}><tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:12px;padding:12px 16px;">${cell}</td></tr></table>`;
			const beside = b.beside
				? `<td valign="middle" style="padding-left:12px;font-family:${c.font};font-size:22px;font-weight:700;line-height:1.2;">${esc(b.beside)}</td>`
				: '';
			// align="center" alone is ignored by some renderers (and the preview iframe); auto
			// side margins centre the shrink-to-fit table reliably.
			return `<table ${PRES}${tableAlign(b, c, mb(b, 16))}><tr><td valign="middle">${cell}</td>${beside}</tr></table>`;
		}
		case 'button': {
			const href = cleanHref(b.href);
			if (!href) return '';
			// In a section the button takes the section's text colour, its label the background.
			// #270: explicit colours, radius, size and full width win.
			const bg = b.bg ?? c.sec?.color ?? '#2563eb';
			const fg = b.fg ?? c.sec?.bg ?? '#ffffff';
			const [pad, fs, lh] = BTN_SIZE[b.btnSize ?? 'md'];
			const radius = b.radius ?? 8;
			const btn = (attrs: string) =>
				`<table ${PRES}${b.full ? ' width="100%"' : ''}${attrs}><tr><td style="background:${bg};border-radius:${radius}px;font-size:${fs}px;line-height:${lh}px;"><a href="${esc(href)}" style="display:${b.full ? 'block' : 'inline-block'};padding:${pad};font-family:${c.font};font-size:${fs}px;font-weight:600;line-height:${lh}px;color:${fg};text-decoration:none;${b.full ? 'text-align:center;' : ''}">${esc(b.label || 'Learn more')}</a></td></tr></table>`;
			const linkHref = b.linkLabel ? cleanHref(b.linkHref) : '';
			if (!linkHref) {
				// Auto side margins back up align= (ignored by some renderers) for centre/right.
				const bot = mb(b, 18);
				const m = b.align === 'center' ? `8px auto ${bot}px` : b.align === 'right' ? `8px 0 ${bot}px auto` : `8px 0 ${bot}px`;
				return btn(` align="${b.align}" style="margin:${m};"`);
			}
			// Button + secondary link: two inline-blocks that wrap (stack) when too narrow.
			return (
				`<div style="text-align:${b.align};font-size:0;line-height:0;margin:8px 0 ${mb(b, 8)}px;">` +
				`<div class="ds-cta" style="display:inline-block;vertical-align:middle;margin:0 24px 10px 0;">${btn('')}</div>` +
				`<div class="ds-cta-link" style="display:inline-block;vertical-align:middle;margin:0 0 10px;font-family:${c.font};font-size:16px;font-weight:600;line-height:1.4;">` +
				`<a href="${esc(linkHref)}" style="font-size:16px;line-height:1.4;color:${b.linkColor ?? c.sec?.color ?? '#2563eb'};text-decoration:underline;">${esc(b.linkLabel!)}</a></div></div>`
			);
		}
		case 'divider': {
			const col = b.color ?? c.sec?.acc ?? c.sec?.hairline ?? '#e5e7eb';
			const bot = b.spaceBelow !== undefined ? ` ${b.spaceBelow}px` : '';
			const short = b.short ? `width:25%;${c.sec?.center ? 'margin-left:auto;margin-right:auto;' : ''}` : '';
			return `<div style="border-top:${b.thickness ?? 1}px solid ${col};margin:24px 0${bot};font-size:0;line-height:0;${short}">&nbsp;</div>`;
		}
		case 'content':
			return CONTENT_PLACEHOLDER;
		case 'spacer':
			return `<div style="height:${b.px ?? SPACER_PX[b.size] ?? SPACER_PX.md}px;font-size:0;line-height:0;">&nbsp;</div>`;
		case 'columns': {
			const n = b.cells.length;
			const gap = b.gap ?? 12;
			const cellW = Math.floor(width / n) - gap;
			const va = b.valign ?? 'top';
			if (b.stack === false) {
				// #270: no stacking: a plain table row keeps the cells side by side on phones.
				const tds = b.cells
					.map(
						(cell) =>
							`<td width="${Math.floor(100 / n)}%" valign="${va}" style="padding:0 ${gap / 2}px;font-size:16px;line-height:1.6;">${cell.map((cb, i) => emailBlock(cb, { ...c, width: cellW }, cell[i - 1])).join('\n')}</td>`
					)
					.join('');
				return `<table ${PRES} width="100%" style="margin:0 0 ${mb(b, 16)}px;"><tr>${tds}</tr></table>`;
			}
			// Hybrid stacking: inline-block cells with fixed max-widths reflow to full
			// width on narrow screens without needing media-query support.
			const cells = b.cells
				.map(
					(cell) =>
						`<div class="stack" style="display:inline-block;width:100%;max-width:${cellW}px;vertical-align:${va};">` +
						`<div style="padding:0 ${gap / 2}px;font-size:16px;line-height:1.6;">${cell.map((cb, i) => emailBlock(cb, { ...c, width: cellW - gap }, cell[i - 1])).join('\n')}</div></div>`
				)
				.join('');
			return `<div style="text-align:left;font-size:0;margin:0 0 ${mb(b, 16)}px;">${cells}</div>`;
		}
		case 'section': {
			// Bulletproof band: bgcolor attribute + inline background, children inside.
			const { color, accent, hairline } = sectionColors(b);
			const [py, px] = SEC_PAD[b.padding];
			const pad = customPad(b, SEC_PAD[b.padding]);
			const sides = pad ? pad[1] : px;
			const center = b.align === 'center';
			const inset = b.width === 'inset';
			const radius = b.radius !== undefined ? `border-radius:${b.radius}px;` : inset ? 'border-radius:12px;' : '';
			const inner: EmailCtx = {
				width: width - 2 * sides,
				font: c.own ? c.font : BRAND_FONT,
				...(c.size ? { size: c.size } : {}),
				...(c.link ? { link: c.link } : {}),
				...(c.hfont ? { hfont: c.hfont } : {}),
				...(c.lh ? { lh: c.lh } : {}),
				...(c.own ? { own: true } : {}),
				sec: { bg: b.bg, color, accent, hairline, center, ...(b.accent ? { acc: b.accent } : {}) }
			};
			const kids = b.blocks.map((cb, i) => emailBlock(cb, inner, b.blocks[i - 1])).join('\n');
			const margin = b.spaceBelow !== undefined ? `0 0 ${b.spaceBelow}px` : inset ? '0 0 16px' : '0';
			const border = b.borderColor ? `border:${b.borderWidth ?? 1}px solid ${b.borderColor};` : '';
			// Background image: `background` attribute + CSS; the bg colour stays the fallback.
			const bgImg = b.bgImage ? ` background="${esc(b.bgImage)}"` : '';
			const bgCss = b.bgImage ? `background-image:url(${b.bgImage});background-size:cover;background-position:center;` : '';
			const cls = pad ? 'ds-sec' : `ds-sec ds-sec-${b.padding}`;
			const padCss = pad ? `${pad[0]}px ${pad[1]}px ${pad[2]}px` : `${py}px ${px}px`;
			return (
				`<table ${PRES} width="100%" bgcolor="${b.bg}" style="background-color:${b.bg};margin:${margin};${radius}${border}border-collapse:separate;">` +
				`<tr><td class="${cls}" align="${center ? 'center' : 'left'}"${bgImg} style="padding:${padCss};color:${color};font-family:${inner.font};text-align:${center ? 'center' : 'left'};${radius}${bgCss}">${kids}</td></tr></table>`
			);
		}
	}
}

/** #270: the canvas card's inner padding as (top, sides, bottom) px. Unset = the classic
 *  32px 24px; 0 / 16 / 24 = that on every side. */
export function canvasPadding(c: EmailCanvas): { top: number; side: number; bottom: number } {
	if (c.padding === undefined) return { top: 32, side: 24, bottom: 32 };
	return { top: c.padding, side: c.padding, bottom: c.padding };
}

/** #270: leads a canvas document laid out by renderBlocksEmailHtml(): the card cell then
 *  carries no padding of its own (full-bleed sections reach the card edges). */
export const CANVAS_LAYOUT_MARK = '<!--ds-canvas-->';

const isFullSection = (b: Block) => b.type === 'section' && b.width !== 'inset';

/** Email-safe inner HTML for a block document (600px target). Drop into the email
 *  shell (signature/footer) at compose time — merge tags in text survive untouched
 *  for personalize() to fill per recipient. #270: a template's canvas sets the width,
 *  body font size and link colour (no canvas = exactly as before), and lays the card
 *  out: full-width sections span the card edge to edge, everything else (inset
 *  sections included) sits in runs padded by the card's side padding.
 *  `layout`: 'doc' (default) = a whole card body (layout mark + top padding);
 *  'fill' = campaign content for a top-level content area (runs, no mark / top padding);
 *  'bare' = no card layout (content filling an area inside a section). */
export function renderBlocksEmailHtml(blocks: Block[], canvas?: EmailCanvas | null, opts: { layout?: 'doc' | 'fill' | 'bare' } = {}): string {
	const clean = sanitizeBlocks(blocks);
	if (!canvasIsSet(canvas)) return clean.map((b, i) => emailBlock(b, TOP_CTX, clean[i - 1])).join('\n');
	const cardW = canvas.width ?? 600;
	const { top, side } = canvasPadding(canvas);
	const base: EmailCtx = {
		width: cardW,
		font: fontStack(canvas.font),
		...(canvas.fontSize ? { size: canvas.fontSize } : {}),
		...(canvas.link ? { link: canvas.link } : {}),
		...(canvas.headingFont ? { hfont: fontStack(canvas.headingFont) } : {}),
		...(canvas.lineHeight ? { lh: canvas.lineHeight } : {}),
		...(canvas.font ? { own: true } : {})
	};
	const layout = opts.layout ?? 'doc';
	if (layout === 'bare') return clean.map((b, i) => emailBlock(b, { ...base, width: cardW - 2 * side }, clean[i - 1])).join('\n');
	const runCtx: EmailCtx = { ...base, width: cardW - 2 * side };
	const out: string[] = [];
	let run: string[] = [];
	const flush = () => {
		if (run.length) out.push(side ? `<div class="ds-pad" style="padding:0 ${side}px;">${run.join('\n')}</div>` : run.join('\n'));
		run = [];
	};
	clean.forEach((b, i) => {
		const prev = clean[i - 1];
		if (isFullSection(b)) {
			flush();
			out.push(emailBlock(b, base, prev));
		} else if (b.type === 'content') {
			// The campaign content fills this spot with its own runs / full-bleed sections.
			flush();
			out.push(emailBlock(b, runCtx, prev));
		} else run.push(emailBlock(b, runCtx, prev));
	});
	flush();
	if (layout === 'fill') return out.join('\n');
	const lead = top && !(clean[0] && isFullSection(clean[0])) ? `<div style="height:${top}px;font-size:0;line-height:0;">&nbsp;</div>\n` : '';
	return CANVAS_LAYOUT_MARK + lead + out.join('\n');
}

/** Plain-text alternative for a block document (for the email's TextBody). */
export function renderBlocksEmailText(blocks: Block[]): string {
	const part = (b: Block): string => {
		const inner = partInner(b);
		const cond = b.visibility ? visCond(b.visibility) : null;
		return cond && inner ? `{{#if ${cond}}}${inner}{{/if}}` : inner;
	};
	const partInner = (b: Block): string => {
		switch (b.type) {
			case 'heading':
				return `${b.content ? renderInlineText(b.content) : b.text}\n`;
			case 'text':
				return `${b.md.trim()}\n`;
			case 'paragraph':
				return `${renderInlineText(b.content)}\n`;
			case 'list':
				return b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : '-'} ${renderInlineText(it)}`).join('\n') + '\n';
			case 'quote':
				return renderInlineText(b.content).split('\n').map((l) => `> ${l}`).join('\n') + '\n';
			case 'callout':
				return `${renderInlineText(b.content)}\n`;
			case 'image': {
				const t = [b.alt ? `[${b.alt}]` : '', b.beside ?? ''].filter(Boolean).join(' ');
				return t ? `${t}\n` : '';
			}
			case 'button':
				if (!cleanHref(b.href)) return '';
				return `${b.label || 'Learn more'}: ${b.href}\n` + (b.linkLabel && cleanHref(b.linkHref) ? `${b.linkLabel}: ${b.linkHref}\n` : '');
			case 'eyebrow':
				return `${renderInlineText(b.content)}\n`;
			case 'milestones':
				return b.items.map((it) => [renderInlineText(it.title), renderInlineText(it.label)].filter((s) => s.trim()).join(' — ')).join('\n') + '\n';
			case 'divider':
				return '—\n';
			case 'content':
				return CONTENT_PLACEHOLDER + '\n';
			case 'spacer':
				return '\n';
			case 'columns':
				return b.cells.map((cell) => cell.map(part).join('\n')).join('\n');
			case 'section':
				return b.blocks.map(part).join('\n');
		}
	};
	return sanitizeBlocks(blocks).map(part).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
