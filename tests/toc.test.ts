// The table of contents block: the model (sanitiser, slugs, entries), every renderer, the
// markdown export, the editor document round trip and the editor's live preview. The
// guarantee that documents without one render as before is in no-toc-output.test.ts.
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import {
	PAGE_CSS,
	PAGE_TOC_CSS,
	TOC_TITLE_MAX,
	blocksAreEmpty,
	cleanTocLevels,
	hasTocBlock,
	headingSlug,
	renderBlocksEmailHtml,
	renderBlocksEmailText,
	renderPageBlocks,
	renderPageHtml,
	sanitizeBlocks,
	tocEntries,
	type Block
} from '../src/lib/blocks';
import { blocksToMarkdown, markdownToBlocks } from '../src/lib/blocks-markdown';
import { blocksToDoc, docToBlocks } from '../src/lib/editor/doc';
import { schema } from '../src/lib/editor/schema';
import { tocEntriesOf, tocKey, tocLevelsLabel, tocPlugin, tocPreviews } from '../src/lib/editor/toc';
import { GLYPHS } from '../src/lib/icons/glyphs';
import * as data from '../src/lib/data';

const t = (text: string) => [{ type: 'text' as const, text }];
const h = (id: string, level: 1 | 2 | 3, text: string, extra: Partial<Block> = {}): Block => ({ id, type: 'heading', level, text, content: t(text), ...extra }) as Block;
const toc = (levels: (1 | 2 | 3)[] = [2], extra: Partial<Block> = {}): Block => ({ id: 'toc', type: 'toc', levels, ...extra }) as Block;

/** The small document of the README example: H2, H3, H2. */
const SMALL: Block[] = [toc([2, 3]), h('a', 2, 'Getting started'), h('b', 3, 'Install'), h('c', 2, 'Next steps')];

describe('sanitiser', () => {
	it('defaults the levels to [2] and leaves the title out', () => {
		expect(sanitizeBlocks([{ id: 'x', type: 'toc' }])).toEqual([{ id: 'x', type: 'toc', levels: [2] }]);
		expect(sanitizeBlocks([{ id: 'x', type: 'toc', levels: [], title: '   ' }])).toEqual([{ id: 'x', type: 'toc', levels: [2] }]);
	});
	it('keeps a sorted, unique subset of 1, 2 and 3', () => {
		const lv = (levels: unknown) => (sanitizeBlocks([{ id: 'x', type: 'toc', levels }])[0] as Extract<Block, { type: 'toc' }>).levels;
		expect(lv([3, 1, 3, 2, 1])).toEqual([1, 2, 3]);
		expect(lv([4, 0, '2', 2.5, null, 3])).toEqual([3]);
		expect(lv(['1', 'h2'])).toEqual([2]);
		expect(lv('2')).toEqual([2]);
		expect(lv({ 0: 1 })).toEqual([2]);
		expect(cleanTocLevels([2, 3])).toEqual([2, 3]);
	});
	it('collapses the title to one trimmed line and caps it', () => {
		const title = (v: unknown) => (sanitizeBlocks([{ id: 'x', type: 'toc', title: v }])[0] as Extract<Block, { type: 'toc' }>).title;
		expect(title('  On\nthis   page ')).toBe('On this page');
		expect(title(42)).toBeUndefined();
		expect(title('x'.repeat(500))).toHaveLength(TOC_TITLE_MAX);
	});
	it('keeps space below, page filter and visibility; drops bad values and unknown keys', () => {
		const [b] = sanitizeBlocks([{ id: 'x', type: 'toc', levels: [2], spaceBelow: 32, showOn: 'issue', visibility: { kind: 'tag', name: 'vip' }, align: 'center', textSize: 'lg', html: '<b>' }]);
		expect(b).toEqual({ id: 'x', type: 'toc', levels: [2], spaceBelow: 32, showOn: 'issue', visibility: { kind: 'tag', name: 'vip' } });
		const [c] = sanitizeBlocks([{ id: 'x', type: 'toc', spaceBelow: 31, showOn: 'all' }]);
		expect(c).toEqual({ id: 'x', type: 'toc', levels: [2] });
	});
	it('is allowed at the top level, in a section and in a column cell', () => {
		const blocks = sanitizeBlocks([
			toc(),
			{ id: 's', type: 'section', bg: '#ffffff', padding: 'md', width: 'full', blocks: [toc([3], { id: 'ts' })] },
			{ id: 'k', type: 'columns', cells: [[toc([1], { id: 'tc' })], []] }
		]);
		expect(blocks[0].type).toBe('toc');
		expect(blocks[1].type === 'section' && blocks[1].blocks[0]).toMatchObject({ id: 'ts', type: 'toc', levels: [3] });
		expect(blocks[2].type === 'columns' && blocks[2].cells[0][0]).toMatchObject({ id: 'tc', type: 'toc', levels: [1] });
	});
	it('a table of contents alone is an empty document', () => {
		expect(blocksAreEmpty([toc()])).toBe(true);
		expect(blocksAreEmpty([toc(), h('a', 2, 'Hi')])).toBe(false);
	});
	it('finds a table of contents anywhere', () => {
		expect(hasTocBlock([h('a', 2, 'x')])).toBe(false);
		expect(hasTocBlock([{ id: 's', type: 'section', bg: '#fff', padding: 'md', width: 'full', blocks: [toc()] }])).toBe(true);
		expect(hasTocBlock([{ id: 'k', type: 'columns', cells: [[], [toc()]] }])).toBe(true);
	});
});

describe('slugs', () => {
	it('lowercases and joins words with dashes', () => {
		expect(headingSlug('Getting Started!')).toBe('getting-started');
		expect(headingSlug('  --What’s new in 2.0?-- ')).toBe('what-s-new-in-2-0');
		expect(headingSlug('Café crème brûlée')).toBe('cafe-creme-brulee');
	});
	it('drops merge tags and caps the length', () => {
		expect(headingSlug('Hi {{first_name}}, welcome')).toBe('hi-welcome');
		expect(headingSlug('{{first_name}}')).toBe('');
		const long = headingSlug('word '.repeat(40));
		expect(long.length).toBeLessThanOrEqual(60);
		expect(long).not.toMatch(/-$/);
	});
	it('de-duplicates with -2, -3 and falls back to section-N', () => {
		const e = tocEntries([h('a', 2, 'Intro'), h('b', 2, 'Intro'), h('c', 2, 'Intro'), h('d', 2, 'Intro 2'), h('e', 2, '¿¡'), h('f', 2, 'Hi'), { id: 'g', type: 'heading', level: 2, text: '{{first_name}}', content: [{ type: 'mergeTag', tag: 'first_name' }] }], [2]);
		expect(e.map((x) => x.slug)).toEqual(['intro', 'intro-2', 'intro-3', 'intro-2-2', 'section-5', 'hi', 'section-7']);
		// The merge tag stays in the list text (personalised per recipient in email).
		expect(e[6].text).toBe('{{first_name}}');
	});
	it('are computed over every heading, whatever the levels shown', () => {
		const doc = [h('a', 3, 'Same'), h('b', 2, 'Same')];
		expect(tocEntries(doc, [2])).toEqual([{ slug: 'same-2', level: 2, text: 'Same', depth: 0 }]);
		expect(tocEntries(doc, [3])).toEqual([{ slug: 'same', level: 3, text: 'Same', depth: 0 }]);
	});
});

describe('tocEntries', () => {
	const DOC: Block[] = [
		h('a', 1, 'Title'),
		h('b', 2, 'One'),
		{ id: 'md', type: 'text', md: '## Legacy markdown' },
		{
			id: 's',
			type: 'section',
			bg: '#15130e',
			padding: 'md',
			width: 'full',
			blocks: [
				h('c', 3, 'In a section'),
				{ id: 'k', type: 'columns', cells: [[h('d', 3, 'Left cell')], [h('e', 2, 'Right cell')]] }
			]
		},
		{ id: 'k2', type: 'columns', cells: [[h('f', 2, 'Top-level cell')], []] },
		h('g', 2, '   '),
		{ id: 'dh', type: 'heading', level: 1, size: 'display', text: 'Hero', content: t('Hero') },
		{ id: 'p', type: 'paragraph', content: t('## not a heading') }
	];
	it('lists headings in reading order through sections and column cells', () => {
		expect(tocEntries(DOC, [1, 2, 3]).map((e) => e.text)).toEqual(['Title', 'One', 'In a section', 'Left cell', 'Right cell', 'Top-level cell', 'Hero']);
	});
	it('filters by level; a display heading counts as level 1; empty headings and markdown blocks are skipped', () => {
		expect(tocEntries(DOC, [2]).map((e) => e.text)).toEqual(['One', 'Right cell', 'Top-level cell']);
		expect(tocEntries(DOC, [1])).toEqual([
			{ slug: 'title', level: 1, text: 'Title', depth: 0 },
			{ slug: 'hero', level: 1, text: 'Hero', depth: 0 }
		]);
		expect(tocEntries(DOC).map((e) => e.level)).toEqual([2, 2, 2]);
	});
	it('nests a heading under the nearest earlier listed heading of a higher level', () => {
		expect(tocEntries(DOC, [1, 2, 3]).map((e) => e.depth)).toEqual([0, 1, 2, 2, 1, 1, 0]);
		// An H3 before any H2 has nothing to nest under.
		expect(tocEntries([h('a', 3, 'Lead'), h('b', 2, 'Two'), h('c', 3, 'Three')], [2, 3]).map((e) => e.depth)).toEqual([0, 0, 1]);
	});
	it('skips headings a web template leaves off the page', () => {
		const doc: Block[] = [
			h('a', 2, 'Everywhere'),
			h('b', 2, 'Issue only', { showOn: 'issue' }),
			{ id: 's', type: 'section', bg: '#fff', padding: 'md', width: 'full', showOn: 'index', blocks: [h('c', 2, 'Index section')] }
		];
		expect(tocEntries(doc, [2]).map((e) => e.text)).toEqual(['Everywhere', 'Issue only', 'Index section']);
		expect(tocEntries(doc, [2], { page: 'issue' }).map((e) => e.text)).toEqual(['Everywhere', 'Issue only']);
		expect(tocEntries(doc, [2], { page: 'index' }).map((e) => e.text)).toEqual(['Everywhere', 'Index section']);
	});
	it('reads a heading without rich content from its text', () => {
		expect(tocEntries([{ id: 'a', type: 'heading', level: 2, text: 'Plain  text' }])).toEqual([{ slug: 'plain-text', level: 2, text: 'Plain text', depth: 0 }]);
	});
});

describe('page renderer', () => {
	it('anchors the headings and renders a nav of nested jump links', () => {
		expect(renderPageBlocks(SMALL)).toBe(
			'<nav class="b-toc" aria-label="Table of contents"><ul><li><a href="#getting-started">Getting started</a><ul><li><a href="#install">Install</a></li></ul></li><li><a href="#next-steps">Next steps</a></li></ul></nav>\n' +
				'<h2 id="getting-started">Getting started</h2>\n<h3 id="install">Install</h3>\n<h2 id="next-steps">Next steps</h2>'
		);
	});
	it('closes every nesting level, also at the end of the list', () => {
		const html = renderPageBlocks([toc([1, 2, 3]), h('a', 1, 'A'), h('b', 2, 'B'), h('c', 3, 'C'), h('d', 1, 'D'), h('e', 3, 'E')]);
		const nav = html.slice(0, html.indexOf('</nav>'));
		expect(nav).toContain('<ul><li><a href="#a">A</a><ul><li><a href="#b">B</a><ul><li><a href="#c">C</a></li></ul></li></ul></li><li><a href="#d">D</a><ul><li><a href="#e">E</a></li></ul></li></ul>');
		expect(nav.split('<ul>').length).toBe(nav.split('</ul>').length);
		expect(nav.split('<li>').length).toBe(nav.split('</li>').length);
	});
	it('the title is a paragraph, never a heading the list could pick up', () => {
		const html = renderPageBlocks([toc([2], { title: 'On <this> page' }), h('a', 2, 'One')]);
		expect(html).toContain('<nav class="b-toc" aria-label="Table of contents"><p class="b-toc-title">On &lt;this&gt; page</p><ul>');
		expect(html.match(/<h[1-3]/g)).toEqual(['<h2']);
	});
	it('escapes the entry text and anchors display headings too', () => {
		const html = renderPageBlocks([toc([1]), { id: 'd', type: 'heading', level: 1, size: 'display', text: 'Big <deal>', content: t('Big <deal>') }]);
		expect(html).toContain('<a href="#big-deal">Big &lt;deal&gt;</a>');
		expect(html).toContain('<h1 class="b-display" id="big-deal">');
	});
	it('keeps the heading styles after the id and applies space below to the nav', () => {
		const html = renderPageBlocks([toc([2], { spaceBelow: 48 }), h('a', 2, 'One', { color: '#ce423b', align: 'center' })]);
		expect(html).toContain('<nav class="b-toc" aria-label="Table of contents" style="margin-bottom:48px;">');
		expect(html).toContain('<h2 id="one" style="text-align:center;color:#ce423b;">One</h2>');
	});
	it('renders nothing when no heading matches', () => {
		expect(renderPageBlocks([toc([3]), h('a', 2, 'One')])).toBe('\n<h2 id="one">One</h2>');
	});
	it('leaves out headings the page does not show', () => {
		const doc: Block[] = [toc([2]), h('a', 2, 'Everywhere'), h('b', 2, 'Archive only', { showOn: 'index' })];
		const issue = renderPageBlocks(doc, '', { page: 'issue' });
		expect(issue).toContain('href="#everywhere"');
		expect(issue).not.toContain('Archive only');
		expect(renderPageBlocks(doc, '', { page: 'index' })).toContain('<a href="#archive-only">Archive only</a>');
	});
	it('works inside a section and a column cell', () => {
		const html = renderPageBlocks([
			{ id: 's', type: 'section', bg: '#15130e', padding: 'md', width: 'full', blocks: [toc([2]), h('a', 2, 'Inside')] },
			{ id: 'k', type: 'columns', cells: [[toc([2], { id: 't2' })], [h('b', 2, 'Cell')]] }
		]);
		expect(html).toContain('<section class="b-sec full" style="background:#15130e;color:#ffffff;');
		expect(html).toContain('<nav class="b-toc" aria-label="Table of contents"><ul><li><a href="#inside">Inside</a></li><li><a href="#cell">Cell</a></li></ul></nav>');
		expect(html).toContain('<h2 id="cell">Cell</h2>');
	});
	it('renderPageHtml adds the table of contents styles only when there is one', () => {
		expect(renderPageHtml('x', SMALL)).toContain(`${PAGE_CSS}${PAGE_TOC_CSS}</style>`);
		expect(renderPageHtml('x', SMALL.slice(1))).not.toContain('.b-toc');
		expect(PAGE_CSS).not.toContain('.b-toc');
		// Inside a section, links already take its text colour; bullets take its accent.
		expect(PAGE_CSS).toContain('.b-sec a { color:inherit; }');
		expect(PAGE_TOC_CSS).toContain('var(--acc, currentColor)');
	});
});

describe('email renderer', () => {
	it('anchors headings with an id and a preceding <a name>', () => {
		const html = renderBlocksEmailHtml(SMALL);
		expect(html).toContain('<a name="getting-started"></a><div id="getting-started" style="font-family:');
		expect(html).toContain('<a name="install"></a><div id="install" style=');
		expect(html).toContain('<a name="next-steps"></a><div id="next-steps" style=');
	});
	it('builds the list like the list block: a flat ul, deeper entries indented', () => {
		const html = renderBlocksEmailHtml(SMALL);
		const ul = html.slice(0, html.indexOf('</ul>') + 5);
		expect(ul).toMatch(/^<ul style="font-family:[^"]*;font-size:16px;line-height:1\.6;margin:0 0 16px;padding-left:22px;text-align:left;">/);
		expect(ul).toContain('<li style="margin:0 0 8px;"><a href="#getting-started" style="color:#2563eb;text-decoration:underline;">Getting started</a></li>');
		expect(ul).toContain('<li style="margin:0 0 8px;margin-left:22px;list-style-type:circle;"><a href="#install" style="color:#2563eb;text-decoration:underline;">Install</a></li>');
		expect(ul).not.toContain('display:grid');
	});
	it('the title is a bold line, and space below goes on the list', () => {
		const html = renderBlocksEmailHtml([toc([2], { title: 'In this issue', spaceBelow: 32 }), h('a', 2, 'One')]);
		expect(html).toMatch(/^<div style="[^"]*font-weight:700;margin:0 0 8px;text-align:left;">In this issue<\/div><ul style="[^"]*margin:0 0 32px;/);
	});
	it('links follow the canvas link colour, and a section\'s text colour inside one', () => {
		expect(renderBlocksEmailHtml(SMALL, { link: '#0a7ea4' })).toContain('<a href="#install" style="color:#0a7ea4;text-decoration:underline;">');
		const sec = renderBlocksEmailHtml([{ id: 's', type: 'section', bg: '#15130e', padding: 'md', width: 'full', blocks: [toc([2]), h('a', 2, 'Inside')] }]);
		expect(sec).toContain('<a href="#inside" style="color:#ffffff;text-decoration:underline;">Inside</a>');
		expect(sec).toContain('<a name="inside"></a><div id="inside"');
	});
	it('an entry carries the visibility rules of its heading and the containers around it', () => {
		const html = renderBlocksEmailHtml([
			toc([2]),
			h('a', 2, 'Everyone'),
			h('b', 2, 'VIPs', { visibility: { kind: 'tag', name: 'vip' } }),
			{ id: 's', type: 'section', bg: '#ffffff', padding: 'md', width: 'full', visibility: { kind: 'no-tag', name: 'new' }, blocks: [h('c', 2, 'Field set', { visibility: { kind: 'field-exists', name: 'city' } })] }
		]);
		expect(html).toContain('<li style="margin:0 0 8px;"><a href="#everyone"');
		expect(html).toContain('{{#if tag:vip}}<li style="margin:0 0 8px;"><a href="#vips"');
		expect(html).toContain('{{#if !tag:new}}{{#if field:city}}<li style="margin:0 0 8px;"><a href="#field-set" style="color:#2563eb;text-decoration:underline;">Field set</a></li>{{/if}}{{/if}}');
		// The heading itself is wrapped as before, with its anchor inside the condition.
		expect(html).toContain('{{#if tag:vip}}<a name="vips"></a><div id="vips"');
	});
	it('keeps merge tags in the entry text and renders nothing when no heading matches', () => {
		const html = renderBlocksEmailHtml([toc([2]), { id: 'a', type: 'heading', level: 2, text: 'Hi {{first_name}}', content: [...t('Hi '), { type: 'mergeTag', tag: 'first_name' }] }]);
		expect(html).toContain('<a href="#hi" style="color:#2563eb;text-decoration:underline;">Hi {{first_name}}</a>');
		expect(renderBlocksEmailHtml([toc([3]), h('a', 2, 'One')])).toMatch(/^\n<a name="one"><\/a><div id="one"/);
	});
	it('anchors headings in every canvas layout', () => {
		for (const layout of ['doc', 'fill', 'bare'] as const) {
			const html = renderBlocksEmailHtml(SMALL, { width: 640 }, { layout });
			expect(html).toContain('<a name="install"></a><div id="install"');
			expect(html).toContain('href="#install"');
		}
	});
});

describe('plain text and markdown', () => {
	it('text: the title, then one line per entry, indented for lower levels', () => {
		expect(renderBlocksEmailText([toc([2, 3], { title: 'On this page' }), ...SMALL.slice(1)])).toBe(
			'On this page\n- Getting started\n  - Install\n- Next steps\n\nGetting started\n\nInstall\n\nNext steps'
		);
	});
	it('text: entries carry their visibility rules; no entries, no lines', () => {
		expect(renderBlocksEmailText([toc([2]), h('a', 2, 'VIPs', { visibility: { kind: 'tag', name: 'vip' } })])).toBe('{{#if tag:vip}}- VIPs\n{{/if}}\n{{#if tag:vip}}VIPs\n{{/if}}');
		expect(renderBlocksEmailText([toc([1], { title: 'Contents' }), h('a', 2, 'One')])).toBe('One');
	});
	it('markdown: jump links, nested by indentation, merge tags kept as typed', () => {
		const md = blocksToMarkdown([
			toc([2, 3], { title: 'On this *page*' }),
			h('a', 2, 'Getting_started'),
			h('b', 3, 'Install'),
			{ id: 'c', type: 'heading', level: 2, text: 'Hi {{first_name}}', content: [...t('Hi '), { type: 'mergeTag', tag: 'first_name' }] }
		]);
		expect(md).toBe('On this \\*page\\*\n\n- [Getting\\_started](#getting-started)\n  - [Install](#install)\n- [Hi {{first_name}}](#hi)\n\n## Getting\\_started\n\n### Install\n\n## Hi {{first_name}}');
	});
	it('markdown: inside a section, and nothing when no heading matches', () => {
		const md = blocksToMarkdown([{ id: 's', type: 'section', bg: '#fff', padding: 'md', width: 'full', blocks: [toc([2]), h('a', 2, 'Inside')] }]);
		expect(md).toBe('- [Inside](#inside)\n\n## Inside');
		expect(blocksToMarkdown([toc([3], { title: 'Contents' }), h('a', 2, 'One')])).toBe('## One');
	});
	it('markdown import does not create one', () => {
		expect(markdownToBlocks('- [One](#one)\n\n## One').map((b) => b.type)).toEqual(['list', 'heading']);
	});
});

describe('editor document', () => {
	const BLOCKS = sanitizeBlocks([
		toc([2, 3], { title: 'On this page', spaceBelow: 24, showOn: 'issue' }),
		h('a', 2, 'One'),
		{ id: 's', type: 'section', bg: '#15130e', padding: 'md', width: 'full', blocks: [toc([1], { id: 'ts' }), h('b', 3, 'Two')] },
		{ id: 'k', type: 'columns', cells: [[toc([2], { id: 'tc', visibility: { kind: 'tag', name: 'vip' } })], [h('c', 2, 'Three')]] }
	]);
	it('round-trips through ProseMirror JSON and fits the schema', () => {
		const doc = blocksToDoc(BLOCKS);
		expect(() => schema.nodeFromJSON(doc).check()).not.toThrow();
		expect(docToBlocks(doc)).toEqual(BLOCKS);
		expect(doc.content?.[0]).toMatchObject({ type: 'toc', attrs: { levels: [2, 3], title: 'On this page', design: { spaceBelow: 24, showOn: 'issue' } } });
	});
	it('the node sanitises like the block (bad levels, empty title)', () => {
		const doc = { type: 'doc', content: [{ type: 'toc', attrs: { id: 'x', levels: [5, 3, 3], title: '  ' } }] };
		expect(docToBlocks(doc)).toEqual([{ id: 'x', type: 'toc', levels: [3] }]);
		expect(schema.nodes.toc.create().attrs).toMatchObject({ levels: [2], title: '' });
		expect(schema.nodes.toc.isAtom).toBe(true);
		expect(schema.nodes.toc.spec.group).toBe('block cellblock secblock');
	});
});

describe('editor preview', () => {
	const stateOf = (blocks: Block[]) => EditorState.create({ doc: schema.nodeFromJSON(blocksToDoc(blocks)), plugins: [tocPlugin()] });
	/** The entries the toc node view at `pos` is handed. */
	const shown = (state: EditorState, pos = 0) => tocEntriesOf(tocKey.getState(state)!.find(pos, pos + 1));
	const texts = (state: EditorState) => shown(state).map((e) => `${'  '.repeat(e.depth)}${e.text}`);
	/** Position of the heading with this text. */
	const headingPos = (state: EditorState, text: string) => {
		let at = -1;
		state.doc.descendants((n, pos) => {
			if (n.type.name === 'heading' && n.textContent === text) at = pos;
		});
		return at;
	};

	it('lists the matching headings as decorations on the toc node', () => {
		const s = stateOf(SMALL);
		expect(tocPreviews(s.doc).map((p) => p.pos)).toEqual([0]);
		expect(texts(s)).toEqual(['Getting started', '  Install', 'Next steps']);
	});
	it('updates as a heading is edited, added, re-levelled or removed', () => {
		let s = stateOf(SMALL);
		const pos = headingPos(s, 'Install');
		s = s.apply(s.tr.insertText(' it', pos + 1 + 'Install'.length));
		expect(texts(s)).toEqual(['Getting started', '  Install it', 'Next steps']);
		s = s.apply(s.tr.setNodeMarkup(headingPos(s, 'Install it'), undefined, { ...s.doc.nodeAt(headingPos(s, 'Install it'))!.attrs, level: 2 }));
		expect(texts(s)).toEqual(['Getting started', 'Install it', 'Next steps']);
		s = s.apply(s.tr.insert(s.doc.content.size, schema.nodes.heading.create({ level: 3 }, schema.text('Added'))));
		expect(texts(s)).toEqual(['Getting started', 'Install it', 'Next steps', '  Added']);
		const gone = headingPos(s, 'Getting started');
		s = s.apply(s.tr.delete(gone, gone + s.doc.nodeAt(gone)!.nodeSize));
		expect(texts(s)).toEqual(['Install it', 'Next steps', '  Added']);
	});
	it('updates when the levels change, and is empty without matches', () => {
		let s = stateOf(SMALL);
		s = s.apply(s.tr.setNodeMarkup(0, undefined, { ...s.doc.nodeAt(0)!.attrs, levels: [3] }));
		expect(texts(s)).toEqual(['Install']);
		s = s.apply(s.tr.setNodeMarkup(0, undefined, { ...s.doc.nodeAt(0)!.attrs, levels: [1] }));
		expect(shown(s)).toEqual([]);
		expect(tocLevelsLabel([1])).toBe('H1');
		expect(tocLevelsLabel([3, 2])).toBe('H2 and H3');
		expect(tocLevelsLabel([1, 2, 3])).toBe('H1, H2 and H3');
	});
	it('keeps the same decorations on a selection change (no redraw)', () => {
		const s = stateOf(SMALL);
		const moved = s.apply(s.tr.setSelection(TextSelection.create(s.doc, headingPos(s, 'Install') + 2)));
		expect(tocKey.getState(moved)).toBe(tocKey.getState(s));
	});
	it('a document without a toc has no decorations', () => {
		expect(tocKey.getState(stateOf(SMALL.slice(1)))!.find()).toEqual([]);
	});
});

const raw = import.meta.glob(['../src/lib/components/BlockEditor.svelte', '../src/lib/components/DesignPanel.svelte', '../src/lib/editor/setup.ts'], {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;
const src = (suffix: string) => raw[Object.keys(raw).find((k) => k.endsWith(suffix))!];

describe('editor UI', () => {
	it('offers "Table of contents" in the insert menu with its icon', () => {
		expect(src('BlockEditor.svelte')).toContain(
			"{ id: 'toc', label: 'Table of contents', hint: 'Jump links to headings', icon: 'toc', keywords: 'toc contents outline jump nav anchor', action: { kind: 'insert', type: 'toc' } }"
		);
		expect(GLYPHS.toc).toBeTruthy();
	});
	it('the Design panel has the level toggles and a title field that never submits a form', () => {
		const panel = src('DesignPanel.svelte');
		expect(panel).toContain("toc: 'Table of contents'");
		expect(panel).toMatch(/seg\('Headings', TOC_LEVELS\.map/);
		expect(panel).toContain('placeholder="Table of contents"');
		expect(panel).toMatch(/onkeydown=\{\(e\) => \{\s*if \(e\.key !== 'Enter'\) return;\s*e\.preventDefault\(\);/);
	});
	it('the node view shows the empty state and never renders links', () => {
		const setup = src('editor/setup.ts');
		expect(setup).toContain("'Headings will appear here.'");
		const view = setup.slice(setup.indexOf('function tocView'), setup.indexOf('const design = '));
		expect(view).not.toMatch(/el\('a'|createElement\('a'\)|href/);
	});
});

describe('exports', () => {
	it('the ./blocks entry exports the helpers', () => {
		expect(typeof data.tocEntries).toBe('function');
		expect(typeof data.headingSlug).toBe('function');
		expect(typeof data.hasTocBlock).toBe('function');
		expect(typeof data.cleanTocLevels).toBe('function');
		expect(data.TOC_LEVELS).toEqual([1, 2, 3]);
		expect(data.PAGE_TOC_CSS).toContain('.b-toc');
	});
});
