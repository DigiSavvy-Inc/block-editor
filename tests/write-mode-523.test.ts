// #523: Write mode for the block editor. Pure helpers run directly; the markup and CSS are
// read raw, like the other component tests.
// Package port: the app's root-layout and assistant-button checks are not here (app-only files).
import { describe, expect, it } from 'vitest';
import {
	WRITE_MODE_KEY,
	escapeExitsWriteMode,
	escapeTracker,
	escapeWasHandled,
	isWriteModeShortcut,
	readWriteMode,
	saveWriteMode
} from '../src/lib/editor/write-mode';

const raw = import.meta.glob(
	['../src/lib/components/BlockEditor.svelte'],
	{ query: '?raw', import: 'default', eager: true }
) as Record<string, string>;
const src = (suffix: string) => {
	const key = Object.keys(raw).find((k) => k.endsWith(suffix));
	if (!key) throw new Error(`missing ${suffix}`);
	return raw[key];
};
const editor = src('components/BlockEditor.svelte');
const editorCss = editor.slice(editor.indexOf('<style>'));

function memStorage(init: Record<string, string> = {}) {
	const m = new Map(Object.entries(init));
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, v),
		removeItem: (k: string) => void m.delete(k),
		map: m
	};
}
const throwing = {
	getItem: () => {
		throw new Error('denied');
	},
	setItem: () => {
		throw new Error('denied');
	},
	removeItem: () => {
		throw new Error('denied');
	}
};

describe('write mode storage', () => {
	it('uses the ds-write-mode key with "1" or absent', () => {
		expect(WRITE_MODE_KEY).toBe('ds-write-mode');
		const s = memStorage();
		expect(readWriteMode(s)).toBe(false);
		saveWriteMode(s, true);
		expect(s.map.get('ds-write-mode')).toBe('1');
		expect(readWriteMode(s)).toBe(true);
		saveWriteMode(s, false);
		expect(s.map.has('ds-write-mode')).toBe(false);
		expect(readWriteMode(memStorage({ 'ds-write-mode': 'yes' }))).toBe(false);
	});

	it('never throws when storage is missing or refuses', () => {
		expect(readWriteMode(null)).toBe(false);
		expect(readWriteMode(throwing)).toBe(false);
		expect(() => saveWriteMode(throwing, true)).not.toThrow();
		expect(() => saveWriteMode(undefined, false)).not.toThrow();
	});

	it('the editor reads it on mount and saves on toggle', () => {
		expect(editor).toMatch(/onMount\(\(\) => \{\s*writeMode = readWriteMode\(window\.localStorage\);/);
		expect(editor).toMatch(/saveWriteMode\(/);
	});
});

describe('shortcut and Escape', () => {
	const k = (o: Partial<KeyboardEvent>) => ({ key: 'f', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...o });
	it('Cmd/Ctrl+Shift+F only', () => {
		expect(isWriteModeShortcut(k({ key: 'F', shiftKey: true, metaKey: true }))).toBe(true);
		expect(isWriteModeShortcut(k({ key: 'f', shiftKey: true, ctrlKey: true }))).toBe(true);
		expect(isWriteModeShortcut(k({ key: 'f', metaKey: true }))).toBe(false);
		expect(isWriteModeShortcut(k({ key: 'f', shiftKey: true }))).toBe(false);
		expect(isWriteModeShortcut(k({ key: 'f', shiftKey: true, metaKey: true, altKey: true }))).toBe(false);
		expect(isWriteModeShortcut(k({ key: 'g', shiftKey: true, metaKey: true }))).toBe(false);
	});

	it('Escape exits only when nothing else is open or handled it', () => {
		const none = { menu: false, popover: false, link: false, dialog: false, handled: false };
		expect(escapeExitsWriteMode(none)).toBe(true);
		for (const key of Object.keys(none) as (keyof typeof none)[]) {
			expect(escapeExitsWriteMode({ ...none, [key]: true })).toBe(false);
		}
	});

	it('ProseMirror preventing every Escape does not count as handled; a consumed one does', () => {
		// The doc's blanket preventDefault (prosemirror-view captureKeyDown) alone: still exits.
		expect(escapeWasHandled({ consumed: false, defaultPrevented: true, inDoc: true })).toBe(false);
		expect(escapeWasHandled({ consumed: false, defaultPrevented: false, inDoc: true })).toBe(false);
		// This editor closed one of its own popovers with it.
		expect(escapeWasHandled({ consumed: true, defaultPrevented: true, inDoc: true })).toBe(true);
		expect(escapeWasHandled({ consumed: true, defaultPrevented: false, inDoc: false })).toBe(true);
		// A handler outside the doc (a picker, a colour popover) prevented it.
		expect(escapeWasHandled({ consumed: false, defaultPrevented: true, inDoc: false })).toBe(true);
	});

	it('Escape ordering: an open menu closes first, the next Escape exits', () => {
		const esc = escapeTracker();
		let menuOpen = true;
		let writeMode = true;
		// Mirrors onKey (ProseMirror handleKeyDown) then onWindowKey for one keydown in the doc.
		const press = () => {
			const e = { key: 'Escape' };
			if (menuOpen) {
				menuOpen = false; // dismissMenu clears ui.menu synchronously
				esc.consume(e);
			}
			const handled = escapeWasHandled({ consumed: esc.consumed(e), defaultPrevented: true, inDoc: true });
			if (escapeExitsWriteMode({ menu: menuOpen, popover: false, link: false, dialog: false, handled })) writeMode = false;
		};
		press();
		expect(menuOpen).toBe(false);
		expect(writeMode).toBe(true);
		press();
		expect(writeMode).toBe(false);
	});

	it('consume() marks only that event and returns true for keymap handlers', () => {
		const esc = escapeTracker();
		const a = {};
		const b = {};
		expect(esc.consume(a)).toBe(true);
		expect(esc.consumed(a)).toBe(true);
		expect(esc.consumed(b)).toBe(false);
	});

	it('the editor marks each Escape it uses for its own popovers', () => {
		const onKey = editor.slice(editor.indexOf('function onKey('), editor.indexOf('async function uploadImage'));
		// Slash menu (filtered + empty), block menu, link preview and the selection bubble (#524).
		expect(onKey.match(/esc\.consume\(e\)/g)?.length).toBe(5);
		expect(editor).toMatch(/linkDraft = null;\s*esc\.consume\(e\);\s*ctl\?\.focus\(\);/);
	});

	it('the editor guards Escape with the menu, popovers, link UI, dialogs and handled', () => {
		expect(editor).toMatch(/<svelte:window onkeydown=\{onWindowKey\} \/>/);
		const fn = editor.slice(editor.indexOf('function onWindowKey'));
		expect(fn).toMatch(/isWriteModeShortcut\(e\)/);
		expect(fn).toMatch(/menu: !!ui\.menu/);
		expect(fn).toMatch(/popover: !!blockMenu/);
		expect(fn).toMatch(/link: linkDraft !== null \|\| !!linkPreview/);
		expect(fn).toMatch(/dialog: outsideDialogOpen\(\)/);
		expect(fn).toMatch(/handled: escapeWasHandled\(\{\s*consumed: esc\.consumed\(e\),\s*defaultPrevented: e\.defaultPrevented,\s*inDoc: e\.target instanceof Element && !!e\.target\.closest\('\.ProseMirror'\)/);
		expect(fn.slice(0, fn.indexOf('toggleWriteMode(false)'))).not.toMatch(/handled: e\.defaultPrevented/);
	});
});

describe('toggle markup and html attribute', () => {
	it('a Write button with an icon and aria-pressed, in Edit mode only', () => {
		const bar = editor.slice(editor.indexOf('<div class="be-bar">'), editor.indexOf('<div class="be-body"'));
		expect(bar).toMatch(/\{#if mode === 'edit'\}\s*<button[\s\S]*?class="write-btn"[\s\S]*?aria-pressed=\{writeMode\}[\s\S]*?<Icon name="write-mode"[^>]*\/> Write<\/button/);
		expect(bar).toMatch(/<span class="be-tip">[\s\S]*Cmd\/Ctrl\+Shift\+F[\s\S]*<\/span>/);
	});

	it('stamps data-write-mode and clears it on toggle-off and on destroy', () => {
		expect(editor).toMatch(/html\.dataset\.writeMode = '1'/);
		expect(editor).toMatch(/delete html\.dataset\.writeMode/);
		const destroy = editor.slice(editor.indexOf('onDestroy(() => {'));
		expect(destroy.slice(0, 400)).toMatch(/delete document\.documentElement\.dataset\.writeMode/);
	});

	it('the Design panel gets an edge tab in write mode', () => {
		expect(editor).toMatch(/class:tab-open=\{writeOn && panelTabOpen\}/);
		expect(editor).toMatch(/class="panel-tab" aria-expanded=\{panelTabOpen\}/);
		expect(editorCss).toMatch(/\.be\.write \.panel-tab \{[^}]*writing-mode: vertical-rl/);
		expect(editorCss).toMatch(/\.be\.write \.be-body\.editing \.be-panel \{[^}]*position: fixed;[^}]*right: 0/);
	});

	it('the collapsed tab is centred on the edge, clear of the page header; the open panel keeps the sticky top', () => {
		expect(editorCss).toMatch(/\.be\.write \.be-body\.editing \.be-panel:not\(\.tab-open\) \{\s*top: 50%;\s*transform: translateY\(-50%\);\s*\}/);
		expect(editorCss).toMatch(/\.be\.write \.be-body\.editing \.be-panel \{[^}]*top: var\(--be-sticky-top\)/);
		const open = editorCss.match(/\.be\.write \.be-body\.editing \.be-panel\.tab-open \{([^}]*)\}/)?.[1] ?? '';
		expect(open).toMatch(/overflow: auto/);
		expect(open).not.toMatch(/transform|top:/);
	});
});

describe('layout and canvas CSS', () => {
	it('larger type through --cv-size / --cv-lh and a 720px doc', () => {
		expect(editorCss).toMatch(/\.be\.write \.be-doc \{\s*--cv-size: 18px;\s*--cv-lh: 1\.65;/);
		expect(editorCss).toMatch(/\.be\.write \.be-canvas:not\(\.has-canvas\) \.be-doc \{\s*max-width: 720px;/);
	});

	it('never scales the canvas with zoom or transform', () => {
		for (const m of editorCss.matchAll(/([^{}]*\.be-canvas[^{}]*)\{([^}]*)\}/g)) {
			expect(m[2], m[1]).not.toMatch(/\bzoom\s*:|\btransform\s*:/);
		}
	});
});
