// The table of contents inside the editor. Its list is never stored on the node: this
// plugin works out the entries of every toc node whenever the document changes (with
// tocEntries, like the renderers) and hands them to the node view as a node
// decoration's spec. A different list is a different decoration, so ProseMirror updates
// that node view (and only it). No view at import time, so it runs in the test pool.
import { Plugin, PluginKey } from 'prosemirror-state';
import type { Node as PMNodeT } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { cleanTocLevels, tocEntries, type TocEntry } from '$lib/blocks.js';
import { docToBlocks, type PMNode } from './doc.js';

export const tocKey = new PluginKey<DecorationSet>('be-toc');

export type TocPreview = { pos: number; node: PMNodeT; entries: TocEntry[] };

/** Every toc node in the document, with the entries it lists. */
export function tocPreviews(doc: PMNodeT): TocPreview[] {
	const found: { pos: number; node: PMNodeT }[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name === 'toc') found.push({ pos, node });
		return !node.isTextblock;
	});
	if (!found.length) return [];
	const blocks = docToBlocks(doc.toJSON() as PMNode);
	return found.map(({ pos, node }) => ({ pos, node, entries: tocEntries(blocks, node.attrs.levels as number[]) }));
}

/** "H2", "H2 and H3", "H1, H2 and H3". */
export function tocLevelsLabel(levels: unknown): string {
	const names = cleanTocLevels(levels).map((l) => `H${l}`);
	return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
}

function tocDecorations(doc: PMNodeT): DecorationSet {
	const previews = tocPreviews(doc);
	if (!previews.length) return DecorationSet.empty;
	return DecorationSet.create(
		doc,
		previews.map((p) => Decoration.node(p.pos, p.pos + p.node.nodeSize, {}, { toc: JSON.stringify(p.entries) }))
	);
}

export function tocPlugin() {
	return new Plugin<DecorationSet>({
		key: tocKey,
		state: {
			init: (_config, state) => tocDecorations(state.doc),
			apply: (tr, set) => (tr.docChanged ? tocDecorations(tr.doc) : set)
		},
		props: {
			decorations: (state) => tocKey.getState(state)
		}
	});
}

/** The entries a toc node view was handed ([] when none). */
export function tocEntriesOf(decos: readonly Decoration[]): TocEntry[] {
	for (const d of decos) {
		const json = (d.spec as { toc?: unknown } | undefined)?.toc;
		if (typeof json !== 'string') continue;
		try {
			const v = JSON.parse(json);
			return Array.isArray(v) ? (v as TocEntry[]) : [];
		} catch {
			return [];
		}
	}
	return [];
}
