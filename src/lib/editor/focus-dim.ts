// #525: Focus paragraph (iA Writer style) for Write mode. While on, every top-level block of
// the doc except the one holding the selection — the top-level ancestor of
// `ctl.blockAtSelection()` — gets the `pm-dim` class through a node decoration (ProseMirror
// owns the DOM, so the class is never set by hand). Sections, columns and images dim as a
// whole. The editor switches it on / off with `setFocusDim` (focus, menus, Write mode).
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const DIM_CLASS = 'pm-dim';
export const focusDimKey = new PluginKey<boolean>('focusDim');

/** Index of the top-level block holding the selection (−1 when none, e.g. a doc-end gap). */
export function activeTopIndex(state: EditorState): number {
	const { $from } = state.selection;
	const i = $from.index(0);
	return i < state.doc.childCount ? i : -1;
}

export function focusDimPlugin() {
	return new Plugin<boolean>({
		key: focusDimKey,
		state: {
			init: () => false,
			apply: (tr, on) => {
				const meta = tr.getMeta(focusDimKey);
				return typeof meta === 'boolean' ? meta : on;
			}
		},
		props: {
			decorations(state) {
				if (!focusDimKey.getState(state)) return null;
				const active = activeTopIndex(state);
				const decos: Decoration[] = [];
				state.doc.forEach((node, offset, index) => {
					if (index !== active) decos.push(Decoration.node(offset, offset + node.nodeSize, { class: DIM_CLASS }));
				});
				return DecorationSet.create(state.doc, decos);
			}
		}
	});
}

/** A transaction switching dimming on / off (not an undo step), or null when unchanged. */
export function setFocusDimTr(state: EditorState, on: boolean): Transaction | null {
	if (focusDimKey.getState(state) === on) return null;
	return state.tr.setMeta(focusDimKey, on).setMeta('addToHistory', false);
}
