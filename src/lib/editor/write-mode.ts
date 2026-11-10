// #523: Write mode — a distraction-free layout for the block editor. The editor stamps
// <html data-write-mode="1"> while it's on; the root layout hides the app header / nav and
// the assistant button for that attribute. Pure helpers (no DOM globals) so tests can run them.

/** localStorage key: '1' = on, absent = off. Per browser, every page hosting the editor. */
export const WRITE_MODE_KEY = 'ds-write-mode';
/** The <html> data attribute (`dataset.writeMode`). */
export const WRITE_MODE_ATTR = 'data-write-mode';
/** Set for a moment after leaving write mode so the shell fades back in. */
export const WRITE_MODE_EXIT_ATTR = 'data-write-mode-exit';
/** Matches the layout's fade (ms). */
export const WRITE_MODE_FADE_MS = 150;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The saved preference; false when storage is missing or throws (private mode, quota). */
export function readWriteMode(storage: StorageLike | null | undefined): boolean {
	try {
		return storage?.getItem(WRITE_MODE_KEY) === '1';
	} catch {
		return false;
	}
}

/** Saves the preference ('1' or removed); a throwing storage is ignored. */
export function saveWriteMode(storage: StorageLike | null | undefined, on: boolean): void {
	try {
		if (on) storage?.setItem(WRITE_MODE_KEY, '1');
		else storage?.removeItem(WRITE_MODE_KEY);
	} catch {
		/* storage unavailable: the toggle still works for this page */
	}
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>;

/** Cmd/Ctrl+Shift+F. */
export function isWriteModeShortcut(e: KeyLike): boolean {
	return e.key.toLowerCase() === 'f' && e.shiftKey && (e.metaKey || e.ctrlKey) && !e.altKey;
}

/** What's open in the editor that Escape should close first. */
export interface EscapeGuard {
	/** Slash / merge-tag menu. */
	menu: boolean;
	/** Block (⋮⋮) menu or a Design panel popover. */
	popover: boolean;
	/** The link edit bubble or the link preview. */
	link: boolean;
	/** A dialog / drawer / panel outside the editor. */
	dialog: boolean;
	/** Another handler already used this Escape (see `escapeWasHandled`). */
	handled: boolean;
}

/** Escape leaves write mode only when it has nothing else to close. */
export function escapeExitsWriteMode(g: EscapeGuard): boolean {
	return !g.menu && !g.popover && !g.link && !g.dialog && !g.handled;
}

/**
 * Escape keydowns this editor used to close one of its own popovers (slash / `{{` menu,
 * block menu, link bubble, link preview). Tracked explicitly because prosemirror-view calls
 * preventDefault on every Escape that reaches the doc (`captureKeyDown`, keyCode 27), so
 * `defaultPrevented` can't tell "closed a menu" from "nothing to close".
 */
export function escapeTracker() {
	const used = new WeakSet<object>();
	return {
		/** Marks the event as used; returns true so a keymap handler can `return esc.consume(e)`. */
		consume(e: object): true {
			used.add(e);
			return true;
		},
		consumed: (e: object): boolean => used.has(e)
	};
}

/**
 * Whether another handler already used this Escape: this editor closed one of its own
 * popovers, or a handler outside the ProseMirror doc prevented it. Inside the doc
 * `defaultPrevented` is ignored, because ProseMirror prevents every Escape.
 */
export function escapeWasHandled(o: { consumed: boolean; defaultPrevented: boolean; inDoc: boolean }): boolean {
	return o.consumed || (o.defaultPrevented && !o.inDoc);
}
