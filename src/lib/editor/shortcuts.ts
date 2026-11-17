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
