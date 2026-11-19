// #525: Focus paragraph (iA Writer style) for Write mode. While on, every top-level block of
// the doc except the one holding the cursor — the top-level ancestor of
// `ctl.blockAtSelection()` — gets the `pm-dim` class through a node decoration (ProseMirror
// owns the DOM, so the class is never set by hand). A selection across several blocks keeps
// all of them lit, so the writer can read what they selected. Sections, columns and images
// dim as a whole. The editor switches it on / off with `setFocusDim` (focus, menus, Write mode).
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const DIM_CLASS = 'pm-dim';
export const focusDimKey = new PluginKey<boolean>('focusDim');

/** First and last index of the top-level blocks the selection touches (one for a collapsed
 *  cursor), or null when none, e.g. a doc-end gap. */
export function activeTopRange(state: EditorState): [number, number] | null {
	const { $from, $to, empty } = state.selection;
	const count = state.doc.childCount;
	const first = $from.index(0);
	if (first >= count) return null;
	// A range ending between two top-level blocks (a selected image, select all) ends with the
	// block before that point, not the one after it.
	const last = !empty && $to.depth === 0 ? $to.index(0) - 1 : $to.index(0);
	return [first, Math.min(Math.max(last, first), count - 1)];
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
				const [first, last] = activeTopRange(state) ?? [-1, -1];
				const decos: Decoration[] = [];
				state.doc.forEach((node, offset, index) => {
					if (index < first || index > last) decos.push(Decoration.node(offset, offset + node.nodeSize, { class: DIM_CLASS }));
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
