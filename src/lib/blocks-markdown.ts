// #250: markdown ↔ block documents for the visual editor. Client- AND server-safe.
// - markdownToBlocks(): an old `body_md` campaign opens in the editor as blocks (nothing
//   is written until the user saves).
// - blocksToMarkdown(): the `body_md` export kept next to `body_blocks` (search, API,
//   fallback).
// Merge tags are shielded through marked exactly like the send path does, so they come
// back byte-for-byte as `mergeTag` atoms (or verbatim inside link targets).

import { marked, type Token, type Tokens } from 'marked';
import { shieldMergeTokens, splitMergeTokens } from '$lib/merge-tags.js';
import {
	sanitizeBlocks,
	sanitizeInline,
	inlinePlainText,
	CONTENT_PLACEHOLDER,
	type Block,
	type Inline,
	type InlineMark,
	type Visibility
} from '$lib/blocks.js';
import { formatTagCondition } from '$lib/conditionals.js';

function decodeEntities(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#0*39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&');
}

const newId = () => crypto.randomUUID();

/** Old markdown → blocks. Unknown or raw-HTML constructs become plain text. */
export function markdownToBlocks(markdown: string): Block[] {
	const { shielded, restore } = shieldMergeTokens(markdown ?? '');

	function textRuns(text: string, marks: InlineMark[]): Inline[] {
		const out: Inline[] = [];
		const lines = decodeEntities(restore(text)).split('\n');
		lines.forEach((line, li) => {
			if (li > 0) out.push({ type: 'hardBreak' });
			for (const part of splitMergeTokens(line)) {
				if (typeof part === 'string') out.push({ type: 'text', text: part, marks });
				else out.push({ type: 'mergeTag', tag: part.tag, marks });
			}
		});
		return out;
	}

	function inline(toks: Token[] | undefined, marks: InlineMark[], out: Inline[], state: { underline: boolean }) {
		for (const t of toks ?? []) {
			const m = state.underline ? [...marks, { type: 'underline' } as InlineMark] : marks;
			switch (t.type) {
				case 'text':
				case 'escape': {
					const tt = t as Tokens.Text;
					if (tt.tokens?.length) inline(tt.tokens, marks, out, state);
					else out.push(...textRuns(tt.text, m));
					break;
				}
				case 'strong':
					inline((t as Tokens.Strong).tokens, [...marks, { type: 'bold' }], out, state);
					break;
				case 'em':
					inline((t as Tokens.Em).tokens, [...marks, { type: 'italic' }], out, state);
					break;
				case 'del':
					inline((t as Tokens.Del).tokens, [...marks, { type: 'strike' }], out, state);
					break;
				case 'codespan':
					out.push(...textRuns((t as Tokens.Codespan).text, [...m, { type: 'code' }]));
					break;
				case 'br':
					out.push({ type: 'hardBreak' });
					break;
				case 'link': {
					const l = t as Tokens.Link;
					inline(l.tokens, [...marks, { type: 'link', href: restore(l.href) }], out, state);
					break;
				}
				case 'image': {
					const im = t as Tokens.Image;
					out.push(...textRuns(im.text || '', m));
					break;
				}
				case 'html': {
					const h = (t as Tokens.HTML).text.trim().toLowerCase();
					if (h === '<u>') state.underline = true;
					else if (h === '</u>') state.underline = false;
					else if (h === '<br>' || h === '<br/>' || h === '<br />') out.push({ type: 'hardBreak' });
					break;
				}
				default:
					if ('text' in t && typeof t.text === 'string') out.push(...textRuns(t.text, m));
			}
		}
	}

	const inl = (toks: Token[] | undefined): Inline[] => {
		const out: Inline[] = [];
		inline(toks, [], out, { underline: false });
		return sanitizeInline(out);
	};

	/** A paragraph that is only an image (optionally linked) becomes an image block. */
	function imageOnly(toks: Token[] | undefined): Block | null {
		const real = (toks ?? []).filter((t) => !(t.type === 'text' && !(t as Tokens.Text).text.trim()));
		if (real.length !== 1) return null;
		const t = real[0];
		if (t.type === 'image') {
			const im = t as Tokens.Image;
			return { id: newId(), type: 'image', src: restore(im.href), alt: decodeEntities(im.text || '') };
		}
		if (t.type === 'link') {
			const inner = imageOnly((t as Tokens.Link).tokens);
			if (inner && inner.type === 'image') return { ...inner, href: restore((t as Tokens.Link).href) };
		}
		return null;
	}

	const out: Block[] = [];
	function block(t: Token) {
		switch (t.type) {
			case 'heading': {
				const h = t as Tokens.Heading;
				const content = inl(h.tokens);
				const level = (Math.min(3, Math.max(1, h.depth)) as 1 | 2 | 3);
				out.push({ id: newId(), type: 'heading', level, text: inlinePlainText(content), content });
				break;
			}
			case 'paragraph': {
				const p = t as Tokens.Paragraph;
				out.push(imageOnly(p.tokens) ?? { id: newId(), type: 'paragraph', content: inl(p.tokens) });
				break;
			}
			case 'text': {
				const tt = t as Tokens.Text;
				out.push({ id: newId(), type: 'paragraph', content: inl(tt.tokens ?? [tt]) });
				break;
			}
			case 'list': {
				const l = t as Tokens.List;
				const items = l.items.map((it) => {
					const run: Inline[] = [];
					for (const c of it.tokens) {
						if (c.type === 'list') continue; // nested lists flatten below
						if (run.length) run.push({ type: 'hardBreak' });
						run.push(...inl('tokens' in c && c.tokens ? (c.tokens as Token[]) : [c]));
					}
					return sanitizeInline(run);
				});
				out.push({ id: newId(), type: 'list', ordered: l.ordered, items });
				for (const it of l.items) for (const c of it.tokens) if (c.type === 'list') block(c);
				break;
			}
			case 'blockquote': {
				const run: Inline[] = [];
				for (const c of (t as Tokens.Blockquote).tokens) {
					if (c.type === 'space') continue;
					if (run.length) run.push({ type: 'hardBreak' }, { type: 'hardBreak' });
					run.push(...inl('tokens' in c && c.tokens ? (c.tokens as Token[]) : [c]));
				}
				out.push({ id: newId(), type: 'quote', content: sanitizeInline(run) });
				break;
			}
			case 'hr':
				out.push({ id: newId(), type: 'divider' });
				break;
			case 'code': {
				const code = (t as Tokens.Code).text;
				out.push({ id: newId(), type: 'paragraph', content: sanitizeInline(textRuns(code, [{ type: 'code' }])) });
				break;
			}
			case 'html': {
				const text = decodeEntities((t as Tokens.HTML).text.replace(/<[^>]*>/g, '')).trim();
				if (text) out.push({ id: newId(), type: 'paragraph', content: sanitizeInline(textRuns(text, [])) });
				break;
			}
			case 'table': {
				const tb = t as Tokens.Table;
				for (const row of [tb.header, ...tb.rows]) {
					const run: Inline[] = [];
					row.forEach((cell, i) => {
						if (i) run.push({ type: 'text', text: ' · ' });
						run.push(...inl(cell.tokens));
					});
					out.push({ id: newId(), type: 'paragraph', content: sanitizeInline(run) });
				}
				break;
			}
			default:
				break; // space, def, …
		}
	}
	for (const t of marked.lexer(shielded, { gfm: true, breaks: true })) block(t);
	return sanitizeBlocks(out, { allowContent: false });
}

// ---------------------------------------------------------------------------
// Blocks → markdown (the body_md export)
// ---------------------------------------------------------------------------

function escMd(s: string): string {
	return s.replace(/([\\`*_[\]<>~|])/g, '\\$1');
}

const WRAP: Record<string, [string, string]> = {
	bold: ['**', '**'],
	italic: ['*', '*'],
	strike: ['~~', '~~'],
	underline: ['<u>', '</u>'],
	code: ['`', '`'],
	textColor: ['', ''] // #276: colour has no markdown form
};

function inlineMd(nodes: Inline[]): string {
	let out = '';
	for (let i = 0; i < nodes.length; ) {
		const n = nodes[i];
		const href = n.type === 'hardBreak' ? null : (n.marks?.find((m) => m.type === 'link') as { href: string } | undefined)?.href ?? null;
		let j = i + 1;
		if (href !== null) {
			while (j < nodes.length) {
				const nj = nodes[j];
				const hj = nj.type === 'hardBreak' ? null : (nj.marks?.find((m) => m.type === 'link') as { href: string } | undefined)?.href ?? null;
				if (hj !== href) break;
				j++;
			}
		}
		const inner = nodes
			.slice(i, j)
			.map((x) => {
				if (x.type === 'hardBreak') return '  \n';
				const code = x.marks?.some((m) => m.type === 'code');
				let s = x.type === 'mergeTag' ? `{{${x.tag}}}` : code ? x.text.replace(/`/g, "'") : escMd(x.text);
				const marks = (x.marks ?? []).filter((m) => m.type !== 'link');
				for (let k = marks.length - 1; k >= 0; k--) {
					const [a, b] = WRAP[marks[k].type];
					s = a + s + b;
				}
				return s;
			})
			.join('');
		out += href !== null ? `[${inner}](${href})` : inner;
		i = j;
	}
	return out;
}

function visCondMd(v: Visibility): string | null {
	const name = (v.name ?? '').trim().replaceAll('}', '').replaceAll('"', '');
	if (!name) return null;
	if (v.kind === 'tag' || v.kind === 'no-tag') return formatTagCondition(name, v.kind === 'no-tag') ?? `${v.kind === 'no-tag' ? '!' : ''}tag:${name}`;
	if (v.kind === 'field-exists') return `field:${name}`;
	return `field:${name} == "${(v.value ?? '').replaceAll('"', '').replaceAll('}', '')}"`;
}

function blockMd(b: Block): string {
	switch (b.type) {
		case 'heading':
			return `${'#'.repeat(b.level)} ${b.content ? inlineMd(b.content) : escMd(b.text)}`;
		case 'text':
			return b.md.trim();
		case 'paragraph':
		case 'callout':
			return inlineMd(b.content);
		case 'list':
			return b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : '-'} ${inlineMd(it).replace(/ {2}\n/g, '  \n   ')}`).join('\n');
		case 'quote':
			return inlineMd(b.content)
				.split('\n')
				.map((l) => `> ${l}`)
				.join('\n');
		case 'image': {
			if (!b.src) return '';
			const img = `![${escMd(b.alt)}](${b.src})`;
			return b.href ? `[${img}](${b.href})` : img;
		}
		case 'button': {
			if (!b.href) return '';
			const btn = `[${escMd(b.label || 'Learn more')}](${b.href})`;
			return b.linkLabel && b.linkHref ? `${btn} · [${escMd(b.linkLabel)}](${b.linkHref})` : btn;
		}
		case 'eyebrow':
			return inlineMd(b.content);
		case 'milestones':
			return b.items.map((it) => `- **${inlineMd(it.title)}** ${inlineMd(it.label)}`.trimEnd()).join('\n');
		case 'divider':
			return '---';
		case 'spacer':
			return '';
		case 'content':
			return CONTENT_PLACEHOLDER;
		case 'columns':
			return b.cells.map((c) => c.map(withVis).filter(Boolean).join('\n\n')).filter(Boolean).join('\n\n');
		case 'section':
			return b.blocks.map(withVis).filter(Boolean).join('\n\n');
	}
}

function withVis(b: Block): string {
	const md = blockMd(b);
	const cond = b.visibility ? visCondMd(b.visibility) : null;
	return cond && md ? `{{#if ${cond}}}\n\n${md}\n\n{{/if}}` : md;
}

/** Blocks → markdown for `campaigns.body_md`. */
export function blocksToMarkdown(blocks: Block[]): string {
	return blocks.map(withVis).filter((s) => s.trim()).join('\n\n').trim();
}

/** #255: a stored template / global header-footer document → the editor's rich shape.
 *  Each legacy markdown `text` block becomes rich blocks (also inside columns); the
 *  first keeps the id and every one keeps the visibility rule. Everything else is
 *  unchanged. Old rows still render as stored until they are re-saved. */
export function upgradeLegacyBlocks(blocks: Block[]): Block[] {
	return blocks.flatMap((b): Block[] => {
		if (b.type === 'columns') return [{ ...b, cells: b.cells.map(upgradeLegacyBlocks) }];
		if (b.type === 'section') return [{ ...b, blocks: upgradeLegacyBlocks(b.blocks) }];
		if (b.type !== 'text') return [b];
		const vis = b.visibility ? { visibility: b.visibility } : {};
		return markdownToBlocks(b.md).map((c, i) => ({ ...c, ...(i === 0 ? { id: b.id } : {}), ...vis }));
	});
}
