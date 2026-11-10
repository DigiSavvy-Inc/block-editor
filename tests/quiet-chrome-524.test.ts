// #524: quiet chrome + the selection bubble. The state machine and visibility rules are pure;
// the markup and CSS are read raw, like the other component tests.
// Package port: the app's help-panel check is not here (HelpPanel.svelte is app-only).
import { describe, expect, it } from 'vitest';
import {
	QUIET_FADE_MS,
	QUIET_IDLE,
	QUIET_MOUSE_PX,
	isTypingInput,
	nextQuiet,
	selBarTop,
	selBarVisible,
	type QuietState
} from '../src/lib/editor/quiet';

const raw = import.meta.glob(
	['../src/lib/components/BlockEditor.svelte', '../src/lib/components/SelectionBubble.svelte'],
	{ query: '?raw', import: 'default', eager: true }
) as Record<string, string>;
const src = (suffix: string) => {
	const key = Object.keys(raw).find((k) => k.endsWith(suffix));
	if (!key) throw new Error(`missing ${suffix}`);
	return raw[key];
};
const editor = src('components/BlockEditor.svelte');
const bubble = src('components/SelectionBubble.svelte');
const editorCss = editor.slice(editor.indexOf('<style>'));

describe('quiet state machine', () => {
	const typed = nextQuiet(QUIET_IDLE, { kind: 'type' });

	it('typing enters quiet', () => {
		expect(QUIET_IDLE.on).toBe(false);
		expect(typed).toEqual({ on: true, anchor: null });
	});

	it('the first mousemove only sets the anchor; travel of 4px leaves', () => {
		const anchored = nextQuiet(typed, { kind: 'mouse', x: 100, y: 100 });
		expect(anchored).toEqual({ on: true, anchor: { x: 100, y: 100 } });
		const small = nextQuiet(anchored, { kind: 'mouse', x: 102, y: 102 });
		expect(small).toBe(anchored);
		expect(QUIET_MOUSE_PX).toBe(4);
		expect(nextQuiet(anchored, { kind: 'mouse', x: 104, y: 100 }).on).toBe(false);
		expect(nextQuiet(anchored, { kind: 'mouse', x: 100, y: 96 }).on).toBe(false);
	});

	it('a control, a menu or Tab leaves', () => {
		for (const kind of ['control', 'menu', 'tab'] as const) expect(nextQuiet(typed, { kind })).toEqual(QUIET_IDLE);
	});

	it('events while not quiet change nothing (same object)', () => {
		for (const e of [{ kind: 'mouse', x: 1, y: 1 }, { kind: 'control' }, { kind: 'menu' }, { kind: 'tab' }] as const)
			expect(nextQuiet(QUIET_IDLE, e)).toBe(QUIET_IDLE);
	});

	it('typing again resets the anchor', () => {
		const anchored: QuietState = { on: true, anchor: { x: 5, y: 5 } };
		expect(nextQuiet(anchored, { kind: 'type' })).toEqual({ on: true, anchor: null });
		expect(nextQuiet(typed, { kind: 'type' })).toBe(typed);
	});

	it('only text insertion counts as typing', () => {
		expect(isTypingInput('insertText')).toBe(true);
		expect(isTypingInput('insertParagraph')).toBe(true);
		expect(isTypingInput('insertCompositionText')).toBe(true);
		expect(isTypingInput('deleteContentBackward')).toBe(false);
		expect(isTypingInput('formatBold')).toBe(false);
		expect(isTypingInput('insertFromDrop')).toBe(false);
	});
});

describe('selection bubble visibility', () => {
	const base = { edit: true, textSel: true, linkEditing: false, menu: false, focus: true, dismissed: false };
	it('shows for a non-empty text selection in Edit', () => {
		expect(selBarVisible(base)).toBe(true);
	});
	it('hides on a collapsed selection, in a preview, without focus, over a menu or after Escape', () => {
		expect(selBarVisible({ ...base, textSel: false })).toBe(false);
		expect(selBarVisible({ ...base, edit: false })).toBe(false);
		expect(selBarVisible({ ...base, focus: false })).toBe(false);
		expect(selBarVisible({ ...base, menu: true })).toBe(false);
		expect(selBarVisible({ ...base, dismissed: true })).toBe(false);
	});
	it('hides while the link editor is open', () => {
		expect(selBarVisible({ ...base, linkEditing: true })).toBe(false);
	});
	it('sits above the selection, below it when there is no room', () => {
		expect(selBarTop({ relTop: 200, relBottom: 220, viewTop: 300, height: 38 })).toBe(154);
		expect(selBarTop({ relTop: 20, relBottom: 40, viewTop: 300, height: 38 })).toBe(48);
		expect(selBarTop({ relTop: 200, relBottom: 220, viewTop: 30, height: 38 })).toBe(228);
	});
});

describe('markup + CSS', () => {
	it('fades the handle, bar, format toolbar and panel while quiet, 150ms, no pointer events', () => {
		expect(QUIET_FADE_MS).toBe(150);
		expect(editor).toContain('class:quiet={isQuiet}');
		for (const sel of ['.be.quiet .be-handle', '.be.quiet .be-bar', '.be.quiet .be-canvas :global(.be-fmt)', '.be.quiet .be-panel']) expect(editorCss).toContain(sel);
		expect(editorCss).toMatch(/\.be\.quiet \.be-panel \{\s*opacity: 0;\s*pointer-events: none;/);
		expect(editorCss).toContain('transition: opacity 150ms ease');
	});

	it('does not animate under reduced motion', () => {
		const rm = editorCss.slice(editorCss.indexOf('@media (prefers-reduced-motion: reduce)'));
		expect(rm.length).toBeGreaterThan(0);
		expect(rm.slice(0, 200)).toContain('transition: none');
	});

	it('typing is detected in the editor view; Tab and menus bring the chrome back', () => {
		expect(editor).toContain("onbeforeinput={(e) => isTypingInput(e.inputType) && quietOn({ kind: 'type' })}");
		expect(editor).toContain("quietOn({ kind: 'tab' })");
		expect(editor).toContain("quietOn({ kind: 'menu' })");
		expect(editor).toContain("quietOn({ kind: 'mouse', x: e.clientX, y: e.clientY })");
	});

	it('hides the format toolbar in write mode and mounts the bubble after the doc', () => {
		expect(editor).toContain('{#if ctl && !writeOn}');
		const doc = editor.indexOf('class="be-doc"');
		const bub = editor.indexOf('<SelectionBubble');
		expect(doc).toBeGreaterThan(0);
		expect(bub).toBeGreaterThan(doc);
	});

	it('the bubble reuses the toolbar controller commands and formatState', () => {
		expect(bubble).toContain('be-pop be-selbar');
		for (const call of ['ctl.toggleMark(m.mark)', 'ctl.turnSelection(', 'ctl.clearFormatting()', 'onclick={onLink}']) expect(bubble).toContain(call);
		for (const m of ["'bold'", "'italic'", "'underline'", "'strike'", "'h2'", "'h3'", "'quote'"]) expect(bubble).toContain(m);
		expect(bubble).toContain("e.key !== 'Escape'");
	});
});
