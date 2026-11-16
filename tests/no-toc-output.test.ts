// Headings only get anchors when a document has a table of contents block. Without one,
// every renderer must keep producing exactly the output it did before that block
// existed. The hashes below were recorded from the renderers as they were before the
// table of contents was added; a change here means existing documents render
// differently, which is a breaking change, not a snapshot to update.
import { describe, expect, it } from 'vitest';
import { renderBlocksEmailHtml, renderBlocksEmailText, renderPageBlocks, renderPageHtml, type Block, type EmailCanvas } from '../src/lib/blocks';
import { blocksToMarkdown } from '../src/lib/blocks-markdown';
import { KITCHEN_SINK } from './fixtures/kitchen-sink-blocks';

async function sha(s: string): Promise<string> {
	const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
const t = (text: string) => [{ type: 'text' as const, text }];

/** Headings with page filters and visibility rules, inside and outside containers. */
const FILTERED: Block[] = [
	{ id: 'a', type: 'heading', level: 2, text: 'Everywhere', content: t('Everywhere') },
	{ id: 'b', type: 'heading', level: 2, text: 'Issue only', content: t('Issue only'), showOn: 'issue' },
	{ id: 'c', type: 'heading', level: 3, text: 'Hot only', content: t('Hot only'), visibility: { kind: 'tag', name: 'hot' } },
	{ id: 's', type: 'section', bg: '#15130e', padding: 'md', width: 'full', showOn: 'index', blocks: [{ id: 'd', type: 'heading', level: 2, text: 'In a section', content: t('In a section') }] },
	{ id: 'k', type: 'columns', cells: [[{ id: 'e', type: 'heading', level: 3, text: 'In a cell', content: t('In a cell') }], [{ id: 'f', type: 'paragraph', content: t('Beside') }]] }
];

const CANVAS: EmailCanvas = { width: 640, padding: 16, link: '#0a7ea4', font: 'georgia', headingFont: 'helvetica', lineHeight: 1.8, fontSize: 17 };

function outputs(blocks: Block[]): Record<string, string> {
	return {
		pageHtml: renderPageHtml('Doc', blocks),
		pageBlocks: renderPageBlocks(blocks),
		pageIssue: renderPageBlocks(blocks, '<p>Issue</p>', { page: 'issue' }),
		pageIndex: renderPageBlocks(blocks, '<p>Index</p>', { page: 'index' }),
		email: renderBlocksEmailHtml(blocks),
		emailCanvas: renderBlocksEmailHtml(blocks, CANVAS),
		emailFill: renderBlocksEmailHtml(blocks, CANVAS, { layout: 'fill' }),
		emailBare: renderBlocksEmailHtml(blocks, CANVAS, { layout: 'bare' }),
		text: renderBlocksEmailText(blocks),
		markdown: blocksToMarkdown(blocks)
	};
}
const hashes = async (blocks: Block[]) => Object.fromEntries(await Promise.all(Object.entries(outputs(blocks)).map(async ([k, v]) => [k, await sha(v)])));

describe('documents without a table of contents render as before', () => {
	it('the kitchen sink fixture', async () => {
		expect(await hashes(KITCHEN_SINK)).toEqual({
			email: '58a0b7638d6a3731',
			emailBare: 'b4a11eb41a07f066',
			emailCanvas: 'ff491f86922cd8e4',
			emailFill: '1222473bfed95678',
			markdown: 'b0f7e53acee20add',
			pageBlocks: 'f9fa284466016e1c',
			pageHtml: '188f2bb90ae65f66',
			pageIndex: 'dc00dbbdd5fc42ba',
			pageIssue: '747327bd17dd27da',
			text: 'e5f01a039c7b861f'
		});
	});
	it('headings with page filters, visibility rules, sections and columns', async () => {
		expect(await hashes(FILTERED)).toEqual({
			email: '5715a9589bbfafbb',
			emailBare: 'afbda07c40825d78',
			emailCanvas: '4b71a02aa9521eb6',
			emailFill: 'ec298dc05d405bf8',
			markdown: '48b513b76421164c',
			pageBlocks: '147e82fda06aed3b',
			pageHtml: '5a7377f8c59d5058',
			pageIndex: 'e8488239688f7fa5',
			pageIssue: '91d27f5feff3f292',
			text: '87a2a265106cfd25'
		});
	});
	it('no heading carries an anchor', () => {
		for (const out of Object.values(outputs([...KITCHEN_SINK, ...FILTERED]))) {
			expect(out).not.toMatch(/<h[1-3][^>]* id=/);
			expect(out).not.toContain('<a name=');
		}
	});
});
