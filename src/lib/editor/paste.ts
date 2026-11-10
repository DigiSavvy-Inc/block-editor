// #261: pasted HTML from Google Docs, Notion and Word → plain semantic HTML before the
// editor schema's parse rules see it. Inline styles become marks (bold / italic /
// underline / strike), every other attribute, class, font and style goes, Word list
// paragraphs become real lists. String-only (no DOM), so it runs in the test pool.

/** Elements kept as-is (attributes still filtered). */
const KEEP = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'a', 'strong', 'em', 'u', 's', 'code', 'img', 'hr', 'div']);
/** Elements written under another name. Layout containers become plain divs so their
 *  text still starts new blocks. */
const RENAME: Record<string, string> = {
	b: 'strong',
	i: 'em',
	del: 's',
	strike: 's',
	ins: 'u',
	table: 'div',
	thead: 'div',
	tbody: 'div',
	tfoot: 'div',
	tr: 'div',
	td: 'div',
	th: 'div',
	section: 'div',
	article: 'div',
	header: 'div',
	footer: 'div',
	main: 'div',
	figure: 'div',
	figcaption: 'p',
	pre: 'p'
};
const VOID = new Set(['br', 'img', 'hr', 'wbr', 'input', 'meta', 'link', 'col', 'area', 'base', 'source']);
/** Attributes the schema reads (the pm-* ones round-trip a copy inside the editor). */
const KEEP_ATTRS: Record<string, string[]> = { a: ['href'], img: ['src', 'alt'] };
const INTERNAL_ATTRS = ['data-merge-tag', 'data-pm-block', 'data-attrs', 'data-cols', 'data-text-color'];

type Mark = 'strong' | 'em' | 'u' | 's';

function parseAttrs(src: string): Map<string, string> {
	const out = new Map<string, string>();
	const re = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
	for (let m = re.exec(src); m; m = re.exec(src)) out.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
	return out;
}

function styleOf(attrs: Map<string, string>): Map<string, string> {
	const out = new Map<string, string>();
	for (const decl of (attrs.get('style') ?? '').split(';')) {
		const i = decl.indexOf(':');
		if (i > 0) out.set(decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim().toLowerCase());
	}
	return out;
}

/** Marks an inline style asks for. Underline inside a link is the link's own look. */
function styleMarks(style: Map<string, string>, inLink: boolean): Mark[] {
	const marks: Mark[] = [];
	const weight = style.get('font-weight') ?? '';
	if (/^(bold|bolder|[6-9]00)$/.test(weight)) marks.push('strong');
	if (/^(italic|oblique)/.test(style.get('font-style') ?? '')) marks.push('em');
	const deco = `${style.get('text-decoration') ?? ''} ${style.get('text-decoration-line') ?? ''}`;
	if (/underline/.test(deco) && !inLink) marks.push('u');
	if (/line-through/.test(deco)) marks.push('s');
	return marks;
}

function attrString(tag: string, attrs: Map<string, string>): string {
	let out = '';
	const put = (k: string, v: string) => (out += ` ${k}="${v.replaceAll('"', '&quot;')}"`);
	for (const k of KEEP_ATTRS[tag] ?? []) if (attrs.has(k)) put(k, attrs.get(k)!);
	for (const k of INTERNAL_ATTRS) if (attrs.has(k)) put(k, attrs.get(k)!);
	const cls = (attrs.get('class') ?? '').split(/\s+/).filter((c) => /^pm-[\w-]+$/.test(c));
	if (cls.length) put('class', cls.join(' '));
	return out;
}

const textOf = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').trim();

/** Word writes list items as `<p style="mso-list:l0 level1 lfo1">` with the bullet or
 *  number in a hidden span. Turn each into `<li>` and wrap runs in `<ul>` / `<ol>`. */
function wordLists(html: string): string {
	const items = html.replace(/<p\b([^>]*mso-list:(?!\s*ignore)[^>]*)>([\s\S]*?)<\/p>/gi, (_m, _attrs: string, inner: string) => {
		const hidden = /<!\[if !supportLists\]>([\s\S]*?)<!\[endif\]>/i.exec(inner)?.[1] ?? /mso-list:\s*ignore[^>]*>([^<]*)/i.exec(inner)?.[1] ?? '';
		const ordered = /^\(?([0-9]+|[a-z]|[ivxlc]+)[.)]$/i.test(textOf(hidden));
		const body = inner.replace(/<!\[if !supportLists\]>[\s\S]*?<!\[endif\]>/gi, '');
		return `<li data-word-list="${ordered ? 'ol' : 'ul'}">${body}</li>`;
	});
	return items.replace(/<li data-word-list="(ol|ul)">[\s\S]*?<\/li>(?:\s*<li data-word-list="\1">[\s\S]*?<\/li>)*/g, (run, kind: string) => `<${kind}>${run}</${kind}>`);
}

/** Clean pasted HTML down to tags and attributes the editor schema understands. */
export function cleanPastedHtml(html: string): string {
	const src = wordLists(
		html
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/<(style|script|head|title|xml|template|noscript|svg|math|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
			.replace(/<o:p>(?:\s|&nbsp;)*<\/o:p>/gi, '')
	)
		.replace(/<!\[if !supportLists\]>[\s\S]*?<!\[endif\]>/gi, '')
		.replace(/<!\[[\s\S]*?\]>/g, '');

	type Open = { name: string; close: string };
	const stack: Open[] = [];
	let out = '';
	let inLink = 0;
	let skip = 0; // inside a Word `mso-list:Ignore` span left over (bullet glyphs)

	const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*)>|[^<]+|</g;
	for (let m = re.exec(src); m; m = re.exec(src)) {
		const [tok, slash, rawName, rawAttrs] = m;
		if (!rawName) {
			if (!skip) out += tok === '<' ? '&lt;' : tok;
			continue;
		}
		const name = rawName.toLowerCase();
		if (slash) {
			const i = stack.map((o) => o.name).lastIndexOf(name);
			if (i < 0) continue;
			for (const o of stack.splice(i).reverse()) {
				if (o.name === 'a') inLink--;
				if (o.close === '\u0000skip') skip--;
				else if (!skip) out += o.close;
			}
			continue;
		}
		const attrs = parseAttrs(rawAttrs);
		const style = styleOf(attrs);
		const selfClosing = VOID.has(name) || /\/\s*$/.test(rawAttrs);
		if (name === 'span' && /^ignore/.test(style.get('mso-list') ?? '')) {
			if (!selfClosing) {
				stack.push({ name, close: '\u0000skip' });
				skip++;
			}
			continue;
		}
		let tag = KEEP.has(name) ? name : (RENAME[name] ?? '');
		if (name === 'span' && attrs.has('data-merge-tag')) tag = 'span'; // the editor's own merge tag
		if (name === 'span' && attrs.has('data-text-color')) tag = 'span'; // #276: the editor's own text colour
		// Google Docs wraps the whole paste in <b style="font-weight:normal">.
		if (name === 'b' && /^(normal|[1-5]00)$/.test(style.get('font-weight') ?? '')) tag = '';
		const marks = styleMarks(style, inLink > 0 || name === 'a').filter((mk) => mk !== tag);
		if (selfClosing) {
			if (tag && !skip) out += `<${tag}${attrString(tag, attrs)}>`;
			continue;
		}
		if (name === 'a') inLink++;
		const open = (tag ? `<${tag}${attrString(tag, attrs)}>` : '') + marks.map((mk) => `<${mk}>`).join('');
		const close = marks.map((mk) => `</${mk}>`).reverse().join('') + (tag ? `</${tag}>` : '');
		if (!skip) out += open;
		stack.push({ name, close });
	}
	for (const o of stack.reverse()) {
		if (o.close === '\u0000skip') skip--;
		else if (!skip) out += o.close;
	}
	return out.trim();
}
