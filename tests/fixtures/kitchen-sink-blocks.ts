// #270: every block type and pre-#270 attribute, inside and outside sections and
// columns — the back-compat fixture (no design attributes set anywhere).
import type { Block } from '../../src/lib/blocks';

const t = (text: string) => [{ type: 'text' as const, text }];
const link = (text: string, href: string) => [{ type: 'text' as const, text, marks: [{ type: 'link' as const, href }] }];

function body(prefix: string): Block[] {
	return [
		{ id: `${prefix}h1`, type: 'heading', level: 1, text: 'Title', content: t('Title') },
		{ id: `${prefix}h2`, type: 'heading', level: 2, text: 'Sub', content: [...t('Sub '), ...link('link', 'https://a.test')] },
		{ id: `${prefix}h3`, type: 'heading', level: 3, text: 'Plain heading' },
		{ id: `${prefix}dh`, type: 'heading', level: 1, size: 'display', text: 'Big', content: t('Big') },
		{ id: `${prefix}md`, type: 'text', md: 'Legacy **markdown** {{first_name}}' },
		{ id: `${prefix}p`, type: 'paragraph', content: [...t('Hello '), ...link('there', 'https://b.test'), { type: 'mergeTag', tag: 'first_name' }] },
		{ id: `${prefix}pe`, type: 'paragraph', content: [] },
		{ id: `${prefix}ul`, type: 'list', ordered: false, items: [t('One'), t('Two')] },
		{ id: `${prefix}ol`, type: 'list', ordered: true, items: [t('One'), t('Two')] },
		{ id: `${prefix}st`, type: 'list', ordered: true, style: 'steps', items: [t('A'), t('B'), t('C')] },
		{ id: `${prefix}q`, type: 'quote', content: t('Quoted') },
		{ id: `${prefix}co`, type: 'callout', content: t('Note') },
		{ id: `${prefix}eb`, type: 'eyebrow', content: t('Label') },
		{ id: `${prefix}eba`, type: 'eyebrow', content: t('Accent label'), tone: 'accent' },
		{ id: `${prefix}ms`, type: 'milestones', rule: true, items: [{ title: t('1'), label: t('a') }, { title: t('2'), label: t('b') }, { title: t('3'), label: t('c') }] },
		{ id: `${prefix}ms2`, type: 'milestones', rule: false, items: [{ title: t('x'), label: t('y') }, { title: [], label: [] }] },
		{ id: `${prefix}img`, type: 'image', src: 'https://img.test/a.png', alt: 'A' },
		{ id: `${prefix}imgw`, type: 'image', src: 'https://img.test/b.png', alt: 'B', width: 200, href: 'https://c.test' },
		{ id: `${prefix}imgp`, type: 'image', src: 'https://img.test/c.png', alt: 'C', widthPct: 40 },
		{ id: `${prefix}chip`, type: 'image', src: 'https://img.test/d.png', alt: 'D', width: 48, style: 'chip' },
		{ id: `${prefix}besd`, type: 'image', src: 'https://img.test/e.png', alt: 'E', beside: 'Wordmark' },
		{ id: `${prefix}bl`, type: 'button', label: 'Left', href: 'https://d.test', align: 'left' },
		{ id: `${prefix}bc`, type: 'button', label: 'Centre', href: 'https://d.test', align: 'center' },
		{ id: `${prefix}br`, type: 'button', label: 'Right', href: 'https://d.test', align: 'right', linkLabel: 'or here', linkHref: 'mailto:a@b.test' },
		{ id: `${prefix}bx`, type: 'button', label: 'No link', href: '', align: 'left' },
		{ id: `${prefix}hr`, type: 'divider' },
		{ id: `${prefix}sps`, type: 'spacer', size: 'sm' },
		{ id: `${prefix}spl`, type: 'spacer', size: 'lg' },
		{ id: `${prefix}vis`, type: 'paragraph', content: t('Hot only'), visibility: { kind: 'tag', name: 'hot' } },
		{
			id: `${prefix}c2`,
			type: 'columns',
			cells: [
				[{ id: `${prefix}c2a`, type: 'paragraph', content: t('Left cell') }],
				[{ id: `${prefix}c2b`, type: 'image', src: 'https://img.test/f.png', alt: 'F' }]
			]
		},
		{
			id: `${prefix}c3`,
			type: 'columns',
			cells: [[{ id: `${prefix}c3a`, type: 'heading', level: 3, text: 'x' }], [], [{ id: `${prefix}c3c`, type: 'button', label: 'Go', href: 'https://e.test', align: 'center' }]]
		}
	];
}

export const KITCHEN_SINK: Block[] = [
	...body('t-'),
	{ id: 'content', type: 'content' },
	{ id: 's1', type: 'section', bg: '#1a9ec4', padding: 'lg', width: 'full', blocks: body('s1-') },
	{ id: 's2', type: 'section', bg: '#15130e', color: '#ffffff', padding: 'sm', width: 'inset', align: 'center', blocks: body('s2-') },
	{ id: 's3', type: 'section', bg: '#f5f3ed', padding: 'md', width: 'full', blocks: body('s3-') }
];
