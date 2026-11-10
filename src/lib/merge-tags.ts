// Merge tags ({{first_name}}, {{field:name}}) and conditional markers are filled
// per recipient AFTER markdown render. marked percent-encodes `{{…}}` inside link
// destinations (`%7B%7Bfield:report_url%7D%7D`) and HTML-escapes quotes / < / > inside
// `{{#if}}` conditions, so substitution never sees the original tokens. Shield the
// tokens through parse, then restore them. Interpolating values before marked is
// unsafe: one rendered template is reused for many recipients, field values would
// pass through marked as raw HTML, and a URL with spaces, parentheses, or `&`
// either breaks the link syntax or gets `&` escaped twice.

import { Marked, marked, type Tokens } from 'marked';

export type TemplateMode = 'text' | 'html';

// #170: {{company.<key>}} with an optional fallback, {{company.hours_30d|0}}.
const COMPANY_TOKEN = 'company\\.[a-z0-9_]+(?:\\|[^{}|]{0,80})?';

function shieldRe(): RegExp {
	return new RegExp(`\\{\\{(?:#if\\s+[^}]+|else|\\/if|field:[\\w\\- ]+|${COMPANY_TOKEN}|first_name|last_name|company|email|name)\\}\\}`, 'g');
}

function tokenRe(): RegExp {
	return new RegExp(`\\{\\{(field:[\\w\\- ]+|${COMPANY_TOKEN}|first_name|last_name|company|email|name)\\}\\}`, 'g');
}

/** #250: is `inner` (the text between `{{` and `}}`) a merge tag or conditional marker
 *  the send path understands? Same vocabulary as the markdown shield. */
export function isMergeToken(inner: string): boolean {
	const m = shieldRe().exec(`{{${inner}}}`);
	return !!m && m.index === 0 && m[0].length === inner.length + 4;
}

/** #250: split text into plain runs and `{{…}}` merge tokens (inner text, no braces). */
export function splitMergeTokens(text: string): Array<string | { tag: string }> {
	const out: Array<string | { tag: string }> = [];
	let last = 0;
	for (const m of text.matchAll(shieldRe())) {
		if (m.index! > last) out.push(text.slice(last, m.index));
		out.push({ tag: m[0].slice(2, -2) });
		last = m.index! + m[0].length;
	}
	if (last < text.length) out.push(text.slice(last));
	return out;
}

/** Does this template use any {{company.*}} tag? (also marked's percent-encoded href form) */
export function hasCompanyTags(s: string): boolean {
	return s.includes('{{company.') || /%7B%7Bcompany\./i.test(s);
}

/** `company.<key>|fallback` → its parts, or null when the token isn't a company tag. */
export function parseCompanyToken(token: string): { key: string; fallback: string } | null {
	const m = /^company\.([a-z0-9_]+)(?:\|([^{}|]*))?$/.exec(token);
	return m ? { key: m[1], fallback: (m[2] ?? '').trim() } : null;
}

/** Parse markdown the way emails do, leaving merge tags and {{#if}} markers literal
 *  (including inside hrefs) for per-recipient substitution. */
export function parseMarkdownPreservingMergeTags(markdown: string): string {
	const { shielded, restore } = shieldMergeTokens(markdown);
	return restore(marked.parse(shielded, { async: false, gfm: true, breaks: true }) as string);
}

// #531: hosted pages (/p/[slug]) and the public newsletter archive render legacy
// markdown `text` blocks on the app origin, where any member can author them. There the
// markdown is untrusted: raw HTML is escaped (shown as text) apart from a few attribute-less
// formatting tags, links / images keep only safe targets, and restored merge tokens are
// HTML-escaped (a `{{#if}}` condition or a company fallback may hold quotes or `<`). The
// archive's publicHtml reads the escaped tokens back (conditionals decode them, company
// fallbacks are unescaped before use). Email rendering keeps
// parseMarkdownPreservingMergeTags, unchanged.

/** `&` → `&amp;` unless it already starts an entity; `< > " '` escaped. Same visible
 *  text as marked's default text escaping, so normal markdown renders the same. */
function escapeTextKeepEntities(s: string): string {
	return escapeBareAmp(s).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A link / image target that may render on a public page: http(s), mailto, tel, or a
 *  scheme-less (relative / fragment / query) URL. null = render the text only. */
function safePageHref(raw: string, opts: { image?: boolean } = {}): string | null {
	// Control characters and whitespace can hide a scheme from a naive check.
	// eslint-disable-next-line no-control-regex
	const href = (raw ?? '').replace(/[\u0000- \u007f-\u009f]/g, '');
	if (!href || href.includes('\\') || href.startsWith('//')) return null;
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
	if (scheme) {
		const s = scheme[1].toLowerCase();
		const ok = opts.image ? s === 'http' || s === 'https' : s === 'http' || s === 'https' || s === 'mailto' || s === 'tel';
		if (!ok) return null;
	}
	let encoded: string;
	try {
		encoded = encodeURI(href).replace(/%25/g, '%');
	} catch {
		return null;
	}
	return escapeTextKeepEntities(encoded);
}

/** #531: simple formatting tags old content may hold. Passed through only when the whole
 *  token is one of these with no attributes, and rebuilt here (never the author's bytes). */
const SIMPLE_TAGS = new Set(['br', 'b', 'i', 'em', 'strong', 'u', 's', 'sup', 'sub', 'small', 'mark', 'hr']);

function simpleTag(text: string): string | null {
	const m = /^<(\/?)([a-z]+)\s*(\/?)>$/i.exec(text.trim());
	if (!m) return null;
	const name = m[2].toLowerCase();
	if (!SIMPLE_TAGS.has(name) || (m[1] && m[3])) return null;
	// Void elements: `</br>` reads as a line break (as browsers treat it), `</hr>` as nothing.
	if (name === 'br') return '<br>';
	if (name === 'hr') return m[1] ? '' : '<hr>';
	return m[1] ? `</${name}>` : `<${name}>`;
}

const pageMarked = new Marked({
	gfm: true,
	breaks: true,
	async: false,
	renderer: {
		html({ text, block }: Tokens.HTML | Tokens.Tag) {
			const tag = simpleTag(text);
			if (tag !== null) return block ? `${tag}\n` : tag;
			const t = escapeHtmlText(text);
			return block ? `<p>${t.trim().replace(/\n/g, '<br>')}</p>\n` : t;
		},
		text(token: Tokens.Text | Tokens.Escape) {
			if ('tokens' in token && token.tokens) return this.parser.parseInline(token.tokens);
			// Unconditional: marked flags text after an inline <code>/<pre> tag as already
			// escaped, which would let the following markup through.
			return escapeTextKeepEntities(token.text);
		},
		link({ href, title, tokens }: Tokens.Link) {
			const inner = this.parser.parseInline(tokens);
			const safe = safePageHref(href);
			if (!safe) return inner;
			return `<a href="${safe}"${title ? ` title="${escapeHtmlText(title)}"` : ''}>${inner}</a>`;
		},
		image({ href, title, text }: Tokens.Image) {
			const safe = safePageHref(href, { image: true });
			if (!safe) return escapeTextKeepEntities(text);
			return `<img src="${safe}" alt="${escapeHtmlText(text)}"${title ? ` title="${escapeHtmlText(title)}"` : ''}>`;
		}
	}
});

/** #531: markdown → HTML for public pages on the app origin (hosted pages, newsletter
 *  archive). No raw HTML, no script URLs; merge tokens kept as escaped text. */
export function parseMarkdownSafe(markdown: string): string {
	const tokens: string[] = [];
	const shielded = (markdown ?? '').replace(shieldRe(), (tag) => {
		tokens.push(tag);
		return `PMKMERGE${tokens.length - 1}TAG`;
	});
	const html = pageMarked.parse(shielded) as string;
	return tokens.length === 0
		? html
		: html.replace(/PMKMERGE(\d+)TAG/g, (_, n: string) => escapeHtmlText(tokens[Number(n)] ?? ''));
}

/** #531: the public newsletter archive — a `{{…}}` still in the HTML after conditionals and
 *  merge tags means nothing to a reader, so it is shown as text: `{{` to the first `}}`,
 *  whatever is between (a token restored from an href can hold a single `}` or quotes). */
export function escapeLeftoverMergeTokens(html: string): string {
	return html.includes('{{') ? html.replace(/\{\{[\s\S]*?\}\}/g, escapeTextKeepEntities) : html;
}

/** #531: exact inverse of the page renderers' escaping (one pass, so `&amp;lt;` → `&lt;`). */
export function unescapeHtmlText(s: string): string {
	const map: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
	return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, n: string) => map[n]);
}

/** Swap merge tokens for inert placeholders before marked sees the text; `restore`
 *  puts them back byte-for-byte (also used by the editor's markdown import, #250). */
export function shieldMergeTokens(markdown: string): { shielded: string; restore: (s: string) => string } {
	const tokens: string[] = [];
	const shielded = markdown.replace(shieldRe(), (tag) => {
		const i = tokens.length;
		tokens.push(tag);
		return `PMKMERGE${i}TAG`;
	});
	const restore = (s: string) =>
		tokens.length === 0 ? s : s.replace(/PMKMERGE(\d+)TAG/g, (_, n: string) => tokens[Number(n)] ?? '');
	return { shielded, restore };
}

function escapeHtmlText(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Bare `&` → `&amp;` once. Existing entities (`&amp;`, `&quot;`, `&#39;`) are left alone
 *  so a query string is never written as `&amp;amp;`. */
function escapeBareAmp(s: string): string {
	return s.replace(/&(?![a-zA-Z][a-zA-Z0-9]+;|#\d+;|#x[\da-fA-F]+;)/g, '&amp;');
}

function decodeEntities(s: string): string {
	let cur = s;
	for (let i = 0; i < 3; i++) {
		const next = cur
			.replace(/&quot;/gi, '"')
			.replace(/&#0*34;/gi, '"')
			.replace(/&apos;/gi, "'")
			.replace(/&#0*39;/gi, "'")
			.replace(/&lt;/gi, '<')
			.replace(/&#0*60;/gi, '<')
			.replace(/&gt;/gi, '>')
			.replace(/&#0*62;/gi, '>')
			.replace(/&amp;/gi, '&');
		if (next === cur) break;
		cur = next;
	}
	return cur;
}

/** A merge value used as an entire href. Only http(s) and mailto survive; anything
 *  else (javascript:, data:, a bare name) becomes `#` (or '' when the value is empty). */
function sanitizeFullUrl(raw: string): string {
	let t = decodeEntities(raw).replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, '').trim();
	if (t === '') return '';
	t = t.replace(/ /g, '%20').replace(/"/g, '%22').replace(/'/g, '%27').replace(/</g, '%3C').replace(/>/g, '%3E');
	if (!/^(https?:\/\/|mailto:)/i.test(t)) return '#';
	return escapeBareAmp(t);
}

/** Percent-encode a value spliced into an existing URL. encodeURIComponent leaves `'`,
 *  which would break out of a single-quoted href. */
function encodeHrefSegment(raw: string): string {
	return encodeURIComponent(raw).replace(/'/g, '%27');
}

function finalizeSubstitutedHref(href: string): string {
	const escaped = escapeBareAmp(href);
	const t = escaped.trim();
	if (t === '' || t === '#') return t;
	if (/^(https?:\/\/|mailto:)/i.test(t)) return escaped;
	return '#';
}

function looksLikeTag(inner: string): boolean {
	return /^(?:field:[\w\- ]+|company\.[a-z0-9_]+(?:\|[^{}|]{0,80})?|first_name|last_name|company|email|name|#if\s+\S.*|else|\/if)$/.test(inner);
}

/** marked's legacy output: href="%7B%7Bfield:report_url%7D%7D". Restore the token so
 *  substitution can fill it. Already-literal tags are unchanged. */
function decodeMustacheInAttrs(html: string): string {
	return html.replace(/(\b(?:href|src)\s*=\s*)(["'])([\s\S]*?)\2/gi, (_full, pre: string, q: string, val: string) => {
		const next = val.replace(/%7B%7B([\w:%#.\- ]*?)%7D%7D/gi, (encoded, inner: string) => {
			let text = inner;
			try {
				text = decodeURIComponent(inner);
			} catch {
				/* keep the raw inner */
			}
			return looksLikeTag(text) ? `{{${text}}}` : encoded;
		});
		return pre + q + next + q;
	});
}

function replaceTextTokens(input: string, resolve: (token: string) => string | null): string {
	return input.replace(tokenRe(), (full, token: string) => {
		const raw = resolve(token);
		return raw === null ? full : escapeHtmlText(raw);
	});
}

function replaceAttrTokens(val: string, resolve: (token: string) => string | null): string {
	const tags = [...val.matchAll(tokenRe())];
	const known = tags.filter((t) => resolve(t[1]) !== null);
	if (known.length === 0) return val;

	if (known.length === 1 && val.trim() === known[0][0]) {
		return finalizeSubstitutedHref(sanitizeFullUrl(resolve(known[0][1]) ?? ''));
	}

	const next = val.replace(tokenRe(), (full, token: string) => {
		const raw = resolve(token);
		if (raw === null) return full;
		return encodeHrefSegment(raw);
	});
	return finalizeSubstitutedHref(next);
}

/**
 * Substitute merge tokens. `resolve` returns null to leave an unrecognized token
 * verbatim (current behavior for unknown tags). `html` escapes text values and
 * treats href/src as attributes: a token that is the whole value must be an
 * http(s) or mailto URL; a token embedded in a larger URL is percent-encoded.
 * `text` inserts the raw value (plain-text bodies keep a real query string).
 */
export function applyMergeTokens(
	input: string,
	mode: TemplateMode,
	resolve: (token: string) => string | null
): string {
	switch (mode) {
		case 'text':
			return input.replace(tokenRe(), (full, token: string) => {
				const raw = resolve(token);
				return raw === null ? full : raw;
			});
		case 'html': {
			const decoded = decodeMustacheInAttrs(input);
			const attr = /(\b(?:href|src)\s*=\s*)(["'])([\s\S]*?)\2/gi;
			let out = '';
			let last = 0;
			let m: RegExpExecArray | null;
			while ((m = attr.exec(decoded))) {
				out += replaceTextTokens(decoded.slice(last, m.index), resolve);
				out += m[1] + m[2] + replaceAttrTokens(m[3], resolve) + m[2];
				last = m.index + m[0].length;
			}
			out += replaceTextTokens(decoded.slice(last), resolve);
			return out;
		}
		default: {
			const _never: never = mode;
			return _never;
		}
	}
}
