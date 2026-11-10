// #476: select text and paste a link to link it. Pure (no view), so it runs in the test pool.
import type { EditorState, Transaction } from 'prosemirror-state';
import { schema } from './schema.js';
import { cleanHref } from '$lib/blocks.js';

/** File extensions that look like a TLD but are a file name (`notes.txt`). */
const FILE_EXTS = new Set(['txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'csv', 'md', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'json', 'html', 'htm', 'js', 'ts', 'css', 'mp4', 'mov']);

const EMAIL_RE = /^[^\s@<>"]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
// host (labels) + optional port, then an optional path / query / hash.
const DOMAIN_RE = /^((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,}))(?::\d{1,5})?([/?#]\S*)?$/i;

/** The href a pasted text becomes over a selection, or null when it should paste as text:
 *  a full http(s) / mailto URL, `www.…`, a bare domain (`example.com/path` → https), an
 *  email address (→ mailto:) or a single merge tag (`{{field:url}}`). */
export function pastedHref(raw: string): string | null {
	const text = (raw ?? '').trim();
	if (!text || /\s/.test(text)) return null;
	if (/^(https?:\/\/|mailto:)/i.test(text)) return cleanHref(text) || null;
	if (text.startsWith('{{')) return /^\{\{[^{}]+\}\}$/.test(text) ? cleanHref(text) || null : null;
	if (EMAIL_RE.test(text)) return cleanHref(`mailto:${text}`) || null;
	if (text.includes('@')) return null;
	if (/^www\./i.test(text)) return cleanHref(`https://${text}`) || null;
	const m = DOMAIN_RE.exec(text);
	if (!m) return null;
	const tld = m[2].toLowerCase();
	if (FILE_EXTS.has(tld)) return null;
	return cleanHref(`https://${text}`) || null;
}

/** Link the selected text to the pasted href: one transaction. An existing link in the
 *  range is replaced (the link mark excludes itself, so it never stacks). Null when the
 *  selection is empty or the text isn't a link. */
export function pasteLinkTr(state: EditorState, text: string): Transaction | null {
	const { from, to, empty } = state.selection;
	if (empty) return null;
	const href = pastedHref(text);
	if (!href) return null;
	return state.tr.removeMark(from, to, schema.marks.link).addMark(from, to, schema.marks.link.create({ href }));
}
