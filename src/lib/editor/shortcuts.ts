// Shortcut labels for tooltips and tips, per platform. Pure, no prosemirror import, so
// components can load it statically without pulling the editor chunk.

type NavigatorLike = Pick<Navigator, 'platform' | 'userAgent'>;

/** Whether this is an Apple device. False without a navigator. Node has one too, so a
 *  component that renders on the server calls this after mount. */
export function isMacPlatform(nav: NavigatorLike | null = typeof navigator === 'undefined' ? null : navigator): boolean {
	return !!nav && /Mac|iPhone|iPad/.test(nav.platform || nav.userAgent);
}

const MAC_KEYS: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' };

/** `Mod+Shift+R` → "⌘⇧R" on a Mac, "Ctrl+Shift+R" elsewhere. */
export function shortcutLabel(keys: string, mac: boolean): string {
	const parts = keys.split('+');
	return mac ? parts.map((k) => MAC_KEYS[k] ?? k).join('') : parts.map((k) => (k === 'Mod' ? 'Ctrl' : k)).join('+');
}

/** The heading shortcut. ⌘⌥N on a Mac; Ctrl+Shift+N elsewhere, because Ctrl+Alt is AltGr
 *  on Windows international layouts and types a character there. */
export function headingShortcut(level: 1 | 2 | 3, mac: boolean): string {
	return `Mod+${mac ? 'Alt' : 'Shift'}+${level}`;
}

// --- #5: host action shortcuts ----------------------------------------------------------

type Combo = { mod: boolean; ctrl: boolean; alt: boolean; shift: boolean; key: string };
type KeyEventLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> & { code?: string };

/** `Mod+Shift+K` → its parts (key lower-cased). Null without a key or with an unknown modifier. */
function parseKeys(keys: string): Combo | null {
	const parts = keys.split('+').map((p) => p.trim());
	const key = (parts.pop() ?? '').toLowerCase();
	if (!key) return null;
	const c: Combo = { mod: false, ctrl: false, alt: false, shift: false, key };
	for (const p of parts) {
		const m = p.toLowerCase();
		if (m === 'mod' || m === 'ctrl' || m === 'alt' || m === 'shift') c[m] = true;
		else return null;
	}
	return c;
}

/** The modifier keys a combo means on this platform: Mod is ⌘ on a Mac and Ctrl elsewhere. */
const metaOf = (c: Combo, mac: boolean) => mac && c.mod;
const ctrlOf = (c: Combo, mac: boolean) => c.ctrl || (!mac && c.mod);
const comboId = (c: Combo, mac: boolean) => `${metaOf(c, mac) ? 'Meta+' : ''}${ctrlOf(c, mac) ? 'Ctrl+' : ''}${c.alt ? 'Alt+' : ''}${c.shift ? 'Shift+' : ''}${c.key}`;

/** The editor's own shortcuts with a modifier: the keymap in ./setup.ts, ProseMirror's base
 *  keymap, the clipboard and Write mode. */
export function builtinShortcuts(mac: boolean): string[] {
	const keys = ['Mod+Z', 'Mod+Shift+Z', 'Mod+Y', 'Mod+B', 'Mod+I', 'Mod+U', 'Mod+Shift+X', 'Mod+Shift+S', 'Mod+E', 'Mod+Shift+L', 'Mod+Shift+E', 'Mod+Shift+R'];
	keys.push(headingShortcut(1, mac), headingShortcut(2, mac), headingShortcut(3, mac));
	keys.push('Mod+Shift+ArrowUp', 'Mod+Shift+ArrowDown', 'Mod+Shift+F', 'Mod+A', 'Mod+C', 'Mod+V', 'Mod+X', 'Mod+Enter', 'Mod+Backspace', 'Mod+Delete');
	if (mac) keys.push('Ctrl+H', 'Ctrl+D', 'Ctrl+A', 'Ctrl+E', 'Alt+Backspace', 'Ctrl+Alt+Backspace', 'Alt+Delete', 'Alt+D');
	return keys;
}

/** Whether a key event is the shortcut `keys` (`Mod+…` notation) on this platform. The
 *  physical key counts too, since ⌥ and ⇧ change `key` (⌥S types ß). */
export function shortcutMatches(e: KeyEventLike, keys: string, mac: boolean): boolean {
	const c = parseKeys(keys);
	if (!c || e.metaKey !== metaOf(c, mac) || e.ctrlKey !== ctrlOf(c, mac) || e.altKey !== c.alt || e.shiftKey !== c.shift) return false;
	const code = e.code ?? '';
	const physical = /^Key([A-Z])$/.exec(code)?.[1].toLowerCase() ?? /^Digit(\d)$/.exec(code)?.[1] ?? code.toLowerCase();
	return e.key.toLowerCase() === c.key || physical === c.key;
}

const warned = new Set<string>();

/** A host action's usable shortcut, or null: none set, no Mod / Ctrl / Alt in it, or one of
 *  the editor's own (that one is ignored, with a console warning once per action and shortcut). */
export function hostShortcut(action: { id: string; shortcut?: string }, mac: boolean): string | null {
	const keys = action.shortcut?.trim();
	if (!keys) return null;
	const c = parseKeys(keys);
	const builtin = !!c && builtinShortcuts(mac).some((k) => comboId(parseKeys(k)!, mac) === comboId(c, mac));
	const problem = !c || !(c.mod || c.ctrl || c.alt) ? 'is not a Mod+… shortcut' : builtin ? 'is one of the editor’s own shortcuts' : null;
	if (!problem) return keys;
	const once = `${action.id}|${keys}`;
	if (!warned.has(once)) {
		warned.add(once);
		console.warn(`@digisavvy/block-editor: the shortcut "${keys}" of action "${action.id}" ${problem}, so it is ignored.`);
	}
	return null;
}
