// #525: Writing preferences for the block editor's Write mode (#523) — a serif drafting face
// and focus-paragraph dimming — plus the word count / read time footer maths. Pure (no DOM
// globals, no editor imports) so tests run it directly. Editor-only: nothing here ever
// reaches the blocks, the canvas JSON or the email.

/** localStorage key: JSON `{ font, focus }`. Per browser, every page hosting the editor. */
export const WRITE_PREFS_KEY = 'ds-write-prefs';

/** The serif drafting stack (`--be-draft-font`), editor only. */
export const DRAFT_SERIF_STACK = "Georgia, Charter, 'Iowan Old Style', serif";

/** Reading speed for the footer's read time. */
export const WORDS_PER_MINUTE = 230;

/** How long the footer waits after a transaction before recounting (ms). */
export const WORD_COUNT_DEBOUNCE_MS = 300;

export type DraftFont = 'sans' | 'serif';
export interface WritePrefs {
	/** Body face while drafting in Write mode. Default sans (the canvas font). */
	font: DraftFont;
	/** Dim every top-level block but the one holding the selection. Default off. */
	focus: boolean;
}

export const DEFAULT_WRITE_PREFS: WritePrefs = { font: 'sans', focus: false };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Lenient: junk → defaults, field by field. */
export function normalizeWritePrefs(v: unknown): WritePrefs {
	const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
	return { font: o.font === 'serif' ? 'serif' : 'sans', focus: o.focus === true };
}

/** The saved preferences; defaults when storage is missing, throws or holds junk. */
export function loadWritePrefs(storage: StorageLike | null | undefined): WritePrefs {
	try {
		const raw = storage?.getItem(WRITE_PREFS_KEY);
		return raw ? normalizeWritePrefs(JSON.parse(raw)) : { ...DEFAULT_WRITE_PREFS };
	} catch {
		return { ...DEFAULT_WRITE_PREFS };
	}
}

/** Saves the preferences as JSON; a throwing storage is ignored. */
export function saveWritePrefs(storage: StorageLike | null | undefined, prefs: WritePrefs): void {
	try {
		storage?.setItem(WRITE_PREFS_KEY, JSON.stringify(normalizeWritePrefs(prefs)));
	} catch {
		/* storage unavailable: the choice still applies on this page */
	}
}

/** Words = runs of non-whitespace. */
export function countWords(text: string): number {
	const t = text.trim();
	return t ? t.split(/\s+/).length : 0;
}

/** Whole minutes at 230 words per minute, rounded up, never below 1. */
export function readMinutes(words: number): number {
	return Math.max(1, Math.ceil(Math.max(0, words) / WORDS_PER_MINUTE));
}

/** The minimal ProseMirror node surface `docText` needs (keeps this module editor-free). */
export interface TextNodeLike {
	content: { size: number };
	textBetween(from: number, to: number, blockSeparator?: string | null, leafText?: string | null | ((leaf: never) => string)): string;
}

interface LeafLike {
	type: { spec: { leafText?: (n: never) => string } };
}

/** The doc's text: blocks (list items, cells, sections) separated by a space, so words never
 *  run together across blocks; leaves use their schema `leafText` (a merge tag reads as
 *  `{{tag}}` — one word), else a space (images, dividers, line breaks). */
export function docText(doc: TextNodeLike): string {
	// A function (not a string): a string leafText would replace the schema's own.
	const leaf = (n: LeafLike) => {
		const own = n.type.spec.leafText as ((x: LeafLike) => string) | undefined;
		return own ? own(n) : ' ';
	};
	return doc.textBetween(0, doc.content.size, ' ', leaf as (n: never) => string);
}

/** "N words · M min read" (singular for 1 word). */
export function wordCountLabel(words: number): string {
	return `${words.toLocaleString('en-US')} ${words === 1 ? 'word' : 'words'} · ${readMinutes(words)} min read`;
}
