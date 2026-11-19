// Enter in the editor's own fields (Design panel, toolbars, bubbles, popovers, menus) must
// never submit the host page's form. Hosts mount the editor inside a <form>, and Enter in a
// single-line field there makes the browser submit it through its default button. One
// keydown guard on the editor root covers every field, present and future. Pure (no DOM
// globals) so tests run it directly; BlockEditor wires the event.

/** Input types Enter activates like a button (or opens a picker for). They keep Enter. */
const BUTTON_LIKE = new Set(['button', 'submit', 'reset', 'image', 'file', 'color', 'hidden']);

/** Input types that commit as soon as they change. Enter has nothing left to commit. */
const COMMITS_AT_ONCE = new Set(['checkbox', 'radio', 'range']);

/** `pass`: leave Enter alone. `block`: stop the form submission only. `commit`: stop it and
 *  commit the field the way leaving it would (its `change` fires when the value changed). */
export type FormEnterAction = 'pass' | 'block' | 'commit';

/** The minimal KeyboardEvent surface `formEnterAction` needs. */
export interface EnterKeyLike {
	key: string;
	isComposing?: boolean;
	defaultPrevented: boolean;
	target: unknown;
}

/** What Enter should do in the field that has focus. The ProseMirror doc (contenteditable),
 *  textareas, selects and buttons are not inputs and pass; so does an IME composition, and a
 *  field whose own Enter handler already ran (it called preventDefault, e.g. the link field). */
export function formEnterAction(e: EnterKeyLike): FormEnterAction {
	if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return 'pass';
	const t = e.target as { tagName?: string; type?: string } | null;
	if (!t || t.tagName !== 'INPUT') return 'pass';
	const type = (t.type || 'text').toLowerCase();
	if (BUTTON_LIKE.has(type)) return 'pass';
	return COMMITS_AT_ONCE.has(type) ? 'block' : 'commit';
}
