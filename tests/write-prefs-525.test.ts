// #525: Writing typography and calm status for Write mode — prefs storage, word count /
// read time, focus-paragraph dimming, and the editor-only serif face.
import { describe, expect, it } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import type { DecorationSet } from 'prosemirror-view';
import {
	DEFAULT_WRITE_PREFS,
	DRAFT_SERIF_STACK,
	WRITE_PREFS_KEY,
	countWords,
	docText,
	loadWritePrefs,
	readMinutes,
	saveWritePrefs,
	wordCountLabel
} from '../src/lib/write-prefs';
import { DIM_CLASS, focusDimPlugin, setFocusDimTr } from '../src/lib/editor/focus-dim';
import { blocksToDoc } from '../src/lib/editor/doc';
import { schema } from '../src/lib/editor/schema';
import { sanitizeCanvas, renderBlocksEmailHtml, type Block } from '../src/lib/blocks';
import { KITCHEN_SINK } from './fixtures/kitchen-sink-blocks';

const raw = import.meta.glob(['../src/lib/components/BlockEditor.svelte', '../src/lib/components/WritingMenu.svelte', '../src/lib/write-prefs.ts'], {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;
const src = (suffix: string) => raw[Object.keys(raw).find((k) => k.endsWith(suffix))!];
const editor = src('components/BlockEditor.svelte');
const menu = src('components/WritingMenu.svelte');
const editorCss = editor.slice(editor.indexOf('<style>'));

const pm = (blocks: Block[]) => schema.nodeFromJSON(blocksToDoc(blocks));
const para = (id: string, text: string): Block => ({ id, type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }) as Block;
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

function memStorage(init: Record<string, string> = {}) {
	const m = new Map(Object.entries(init));
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m };
}
const throwing = {
	getItem: () => {
		throw new Error('denied');
	},
	setItem: () => {
		throw new Error('denied');
	}
};

describe('write prefs storage', () => {
	it('round-trips JSON under ds-write-prefs', () => {
		expect(WRITE_PREFS_KEY).toBe('ds-write-prefs');
		const s = memStorage();
		expect(loadWritePrefs(s)).toEqual(DEFAULT_WRITE_PREFS);
		expect(DEFAULT_WRITE_PREFS).toEqual({ font: 'sans', focus: false });
		saveWritePrefs(s, { font: 'serif', focus: true });
		expect(JSON.parse(s.map.get('ds-write-prefs')!)).toEqual({ font: 'serif', focus: true });
		expect(loadWritePrefs(s)).toEqual({ font: 'serif', focus: true });
	});

	it('junk and broken storage read as defaults, never throw', () => {
		expect(loadWritePrefs(memStorage({ 'ds-write-prefs': '{nope' }))).toEqual(DEFAULT_WRITE_PREFS);
		expect(loadWritePrefs(memStorage({ 'ds-write-prefs': '{"font":"comic","focus":"yes"}' }))).toEqual(DEFAULT_WRITE_PREFS);
		expect(loadWritePrefs(null)).toEqual(DEFAULT_WRITE_PREFS);
		expect(loadWritePrefs(throwing)).toEqual(DEFAULT_WRITE_PREFS);
		expect(() => saveWritePrefs(throwing, { font: 'serif', focus: true })).not.toThrow();
	});

	it('the editor loads on mount and saves on change', () => {
		expect(editor).toMatch(/writePrefs = loadWritePrefs\(window\.localStorage\)/);
		expect(editor).toMatch(/saveWritePrefs\(window\.localStorage, next\)/);
	});
});

describe('word count and read time', () => {
	it('counts whitespace-separated words', () => {
		expect(countWords('')).toBe(0);
		expect(countWords('   \n ')).toBe(0);
		expect(countWords(' one  two\tthree\n')).toBe(3);
	});

	it('read time is 230 wpm, rounded up, at least 1', () => {
		expect(readMinutes(0)).toBe(1);
		expect(readMinutes(229)).toBe(1);
		expect(readMinutes(230)).toBe(1);
		expect(readMinutes(231)).toBe(2);
		expect(wordCountLabel(0)).toBe('0 words · 1 min read');
		expect(wordCountLabel(1)).toBe('1 word · 1 min read');
	});

	it('an empty doc has no words', () => {
		expect(countWords(docText(pm([])))).toBe(0);
	});

	it('a merge tag is one word and never glues to its neighbours', () => {
		const doc = pm([
			{ id: 'h', type: 'heading', level: 1, text: '', content: [{ type: 'text', text: 'Hi ' }, { type: 'mergeTag', tag: 'first_name' }] } as Block,
			{ id: 'p', type: 'paragraph', content: [{ type: 'mergeTag', tag: 'company' }, { type: 'text', text: ' rocks' }] } as Block
		]);
		expect(docText(doc)).toContain('{{first_name}}');
		expect(countWords(docText(doc))).toBe(4);
	});

	it('list items and blocks are separate words', () => {
		const doc = pm([
			para('a', 'alpha'),
			{ id: 'l', type: 'list', ordered: false, items: [[{ type: 'text', text: 'one' }], [{ type: 'text', text: 'two' }]] } as Block,
			para('b', 'omega')
		]);
		expect(countWords(docText(doc))).toBe(4);
	});

	it('229 vs 231 words in the doc', () => {
		const n229 = countWords(docText(pm([para('a', words(200)), para('b', words(29))])));
		const n231 = countWords(docText(pm([para('a', words(200)), para('b', words(31))])));
		expect([n229, readMinutes(n229)]).toEqual([229, 1]);
		expect([n231, readMinutes(n231)]).toEqual([231, 2]);
	});

	it('the footer recounts on change, debounced ~300ms', () => {
		expect(editor).toMatch(/WORD_COUNT_DEBOUNCE_MS/);
		expect(src('write-prefs.ts')).toMatch(/WORD_COUNT_DEBOUNCE_MS = 300/);
		expect(editor).toMatch(/class="be-words">\{wordCountLabel\(wordCount\)\}/);
	});
});

describe('focus paragraph', () => {
	const doc = pm([
		para('a', 'first'),
		para('b', 'second'),
		{ id: 's', type: 'section', bg: '#147793', blocks: [para('c', 'inside')] } as Block,
		{ id: 'i', type: 'image', src: 'https://example.com/a.png', alt: '' } as Block
	]);
	const plugin = focusDimPlugin();
	const make = (sel?: (d: typeof doc) => TextSelection | NodeSelection) => {
		let s = EditorState.create({ doc, plugins: [plugin] });
		if (sel) s = s.apply(s.tr.setSelection(sel(s.doc)));
		return s;
	};
	const dimmed = (s: EditorState) => {
		const set = plugin.props.decorations!.call(plugin, s) as DecorationSet | null;
		return (set?.find() ?? []).map((d) => s.doc.nodeAt(d.from)?.attrs.id);
	};
	const on = (s: EditorState) => s.apply(setFocusDimTr(s, true)!);

	it('off by default: nothing dims', () => {
		expect(dimmed(make())).toEqual([]);
	});

	it('dims every top-level block but the one holding the selection', () => {
		const s = on(make((d) => TextSelection.create(d, 10)));
		expect(s.doc.resolve(10).index(0)).toBe(1);
		expect(dimmed(s)).toEqual(['a', 's', 'i']);
	});

	it('a section and an image dim (or stay lit) as a whole', () => {
		let inSection = 0;
		doc.forEach((n, off) => {
			if (n.type.name === 'section') inSection = off + 3;
		});
		expect(dimmed(on(make((d) => TextSelection.create(d, inSection))))).toEqual(['a', 'b', 'i']);
		let imgPos = 0;
		doc.forEach((n, off) => {
			if (n.type.name === 'image') imgPos = off;
		});
		expect(dimmed(on(make((d) => NodeSelection.create(d, imgPos))))).toEqual(['a', 'b', 's']);
	});

	it('switching is not an undo step and is a no-op when unchanged', () => {
		const s = make();
		const tr = setFocusDimTr(s, true)!;
		expect(tr.getMeta('addToHistory')).toBe(false);
		expect(setFocusDimTr(s.apply(tr), true)).toBeNull();
		expect(setFocusDimTr(s, false)).toBeNull();
	});

	it('the editor lifts dimming without focus or with a menu open', () => {
		expect(editor).toMatch(/focusDim = \$derived\(writeOn && writePrefs\.focus && hasFocus && !ui\.menu && !blockMenu && linkDraft === null && !writingOpen\)/);
		expect(editor).toMatch(/c\?\.setFocusDim\(on\)/);
	});

	it('CSS: 0.35 opacity, 150ms transition, none under reduced motion', () => {
		expect(DIM_CLASS).toBe('pm-dim');
		expect(editorCss).toMatch(/\.pm-doc > \.pm-dim\) \{\s*opacity: 0\.35;/);
		expect(editorCss).toMatch(/\.pm-doc > \*\) \{\s*transition: opacity 150ms ease;/);
		expect(editorCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.be\.write \.be-doc :global\(\.pm-doc > \*\) \{\s*transition: none;/);
	});
});

describe('serif drafting face is editor-only', () => {
	it('the serif stack', () => {
		expect(DRAFT_SERIF_STACK).toBe("Georgia, Charter, 'Iowan Old Style', serif");
	});

	it('body takes --be-draft-font, headings keep --cv-hfont', () => {
		expect(editorCss).toMatch(/\.be\.serif \.be-doc :global\(\.pm-doc\),\s*\.be\.serif \.be-doc :global\(\.pm-section\) \{\s*font-family: var\(--be-draft-font\);/);
		expect(editorCss).toMatch(/\.be\.serif \.be-doc :global\(\.pm-doc :is\(h1, h2, h3\)\) \{\s*font-family: var\(--cv-hfont,/);
		expect(editor).toMatch(/style:--be-draft-font=\{draftSerif \? DRAFT_SERIF_STACK : null\}/);
	});

	it('never reaches the canvas JSON or the email', () => {
		// The canvas style string the editor builds has no draft font.
		const canvasStyle = editor.slice(editor.indexOf('const canvasStyle'), editor.indexOf('function blockAction'));
		expect(canvasStyle).not.toMatch(/draft|Georgia|serif/i);
		// The sanitiser drops anything that isn't a known canvas key.
		expect(sanitizeCanvas({ '--be-draft-font': DRAFT_SERIF_STACK, draftFont: 'serif', font: 'georgia-serif' })).not.toHaveProperty('--be-draft-font');
		expect(sanitizeCanvas({ draftFont: 'serif' })).toEqual({});
		// Prefs live only in localStorage; the posted canvas input is untouched.
		expect(editor).toMatch(/value=\{JSON\.stringify\(canvas\)\}/);
		expect(renderBlocksEmailHtml(KITCHEN_SINK)).not.toContain('--be-draft-font');
	});

	it('the Writing menu offers Sans / Serif and a Focus paragraph switch, only in write mode', () => {
		expect(menu).toMatch(/>Sans</);
		expect(menu).toMatch(/>Serif</);
		expect(menu).toMatch(/Focus paragraph/);
		expect(menu).toMatch(/role="switch"/);
		expect(editor).toMatch(/\{#if writeOn\}<WritingMenu /);
	});
});
