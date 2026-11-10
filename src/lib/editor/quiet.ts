// #524: quiet chrome + the selection bubble. Pure helpers (no DOM globals) so tests can
// run them; BlockEditor wires the events.

/** Fade time of the quiet chrome (ms); the CSS transition matches. */
export const QUIET_FADE_MS = 150;
/** Mouse travel (px) inside the editor that brings the chrome back. */
export const QUIET_MOUSE_PX = 4;

/** `on` = the chrome is faded; `anchor` = where the pointer was first seen while quiet. */
export type QuietState = { on: boolean; anchor: { x: number; y: number } | null };

export type QuietEvent =
	/** A text-inserting keystroke in the ProseMirror view. */
	| { kind: 'type' }
	/** Pointer movement inside the editor (client coordinates). */
	| { kind: 'mouse'; x: number; y: number }
	/** Hover or focus on a control (handle, bar, toolbar, panel, bubble). */
	| { kind: 'control' }
	/** A menu or popover opened (slash, `{{`, block menu, link bubble / preview). */
	| { kind: 'menu' }
	/** Tab out of the canvas. */
	| { kind: 'tab' };

export const QUIET_IDLE: QuietState = { on: false, anchor: null };

/** The quiet-state machine: typing enters it; travel ≥ 4px, a control, a menu or Tab leaves. */
export function nextQuiet(s: QuietState, e: QuietEvent): QuietState {
	switch (e.kind) {
		case 'type':
			// Re-entering resets the anchor: the next mousemove sets a fresh one.
			return s.on && !s.anchor ? s : { on: true, anchor: null };
		case 'mouse': {
			if (!s.on) return s;
			// The first position seen while quiet is the anchor (a mousemove can fire from a
			// layout shift without the pointer moving); leave once it travels far enough.
			if (!s.anchor) return { on: true, anchor: { x: e.x, y: e.y } };
			const travel = Math.hypot(e.x - s.anchor.x, e.y - s.anchor.y);
			return travel >= QUIET_MOUSE_PX ? QUIET_IDLE : s;
		}
		case 'control':
		case 'menu':
		case 'tab':
			return s.on ? QUIET_IDLE : s;
	}
}

/** Whether a `beforeinput` inputType inserts text (typing, not deleting / formatting). */
export function isTypingInput(inputType: string): boolean {
	return inputType.startsWith('insert') && inputType !== 'insertFromDrop' && inputType !== 'insertLink';
}

/** What decides whether the selection bubble shows. */
export interface SelBarInput {
	/** The editor is in Edit (not a preview). */
	edit: boolean;
	/** A non-empty text range is selected (`FormatState.textSel`). */
	textSel: boolean;
	/** The link edit bubble is open. */
	linkEditing: boolean;
	/** The slash / `{{` menu is open. */
	menu: boolean;
	/** The canvas (doc or the bubble itself) has focus. */
	focus: boolean;
	/** Escape dismissed this exact selection. */
	dismissed: boolean;
}

/** The bubble shows only for a non-empty text selection in Edit, never over the link editor. */
export function selBarVisible(s: SelBarInput): boolean {
	return s.edit && s.textSel && !s.linkEditing && !s.menu && s.focus && !s.dismissed;
}

/**
 * The bubble's top, relative to the canvas: above the selection, below it when there is no
 * room above (in the canvas, or under the viewport's top edge / sticky header).
 */
export function selBarTop(o: { relTop: number; relBottom: number; viewTop: number; height: number; gap?: number; minViewTop?: number }): number {
	const gap = o.gap ?? 8;
	const above = o.relTop - o.height - gap;
	const roomAbove = above >= 0 && o.viewTop - o.height - gap >= (o.minViewTop ?? 0);
	return roomAbove ? above : o.relBottom + gap;
}
