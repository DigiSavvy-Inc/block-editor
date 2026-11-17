// Issue #2: shortcut hints show the keys for the computer in use, and the shortcuts that
// clash with a browser or a keyboard layout are safe.
import { describe, it, expect } from 'vitest';
import { headingShortcut, isMacPlatform, shortcutLabel } from '../src/lib/editor/shortcuts';
import { moveTitle } from '../src/lib/editor/move';
import blockEditor from '../src/lib/components/BlockEditor.svelte?raw';
import formatToolbar from '../src/lib/components/FormatToolbar.svelte?raw';
import selectionBubble from '../src/lib/components/SelectionBubble.svelte?raw';
import setup from '../src/lib/editor/setup.ts?raw';
import readme from '../README.md?raw';

describe('shortcutLabel', () => {
	it('uses Mac symbols with no separators on a Mac', () => {
		expect(shortcutLabel('Mod+B', true)).toBe('⌘B');
		expect(shortcutLabel('Mod+Shift+R', true)).toBe('⌘⇧R');
		expect(shortcutLabel('Mod+Alt+2', true)).toBe('⌘⌥2');
		expect(shortcutLabel('Mod+Shift+↑↓', true)).toBe('⌘⇧↑↓');
	});

	it('spells the keys out with Ctrl everywhere else', () => {
		expect(shortcutLabel('Mod+B', false)).toBe('Ctrl+B');
		expect(shortcutLabel('Mod+Shift+R', false)).toBe('Ctrl+Shift+R');
		expect(shortcutLabel('Mod+Shift+2', false)).toBe('Ctrl+Shift+2');
		expect(shortcutLabel('Mod+Shift+↑↓', false)).toBe('Ctrl+Shift+↑↓');
	});

	it('the move tooltips go through it', () => {
		expect(moveTitle(-1, true)).toBe('Move up (⌘⇧↑)');
		expect(moveTitle(1, false)).toBe('Move down (Ctrl+Shift+↓)');
	});
});

describe('isMacPlatform', () => {
	it('is false without a navigator', () => {
		expect(isMacPlatform(null)).toBe(false);
	});

	it('reads the platform, then the user agent', () => {
		expect(isMacPlatform({ platform: 'MacIntel', userAgent: '' })).toBe(true);
		expect(isMacPlatform({ platform: 'iPhone', userAgent: '' })).toBe(true);
		expect(isMacPlatform({ platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe(true);
		expect(isMacPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(false);
		expect(isMacPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe(false);
	});
});

describe('no hint names both platforms', () => {
	it('the toolbar and the bubble build every shortcut tooltip from the helper', () => {
		expect(formatToolbar).not.toContain('Cmd/Ctrl');
		expect(selectionBubble).not.toContain('Cmd/Ctrl');
		for (const keys of ['Mod+B', 'Mod+I', 'Mod+U', 'Mod+Shift+X', 'Mod+E', 'Mod+Shift+L', 'Mod+Shift+E', 'Mod+Shift+R']) expect(formatToolbar).toContain(`'${keys}')`);
		for (const keys of ['Mod+B', 'Mod+I', 'Mod+U', 'Mod+Shift+X']) expect(selectionBubble).toContain(`'${keys}')`);
		expect(selectionBubble).toContain('headingShortcut(2, mac)');
		expect(selectionBubble).toContain('headingShortcut(3, mac)');
	});

	it('the editor bar, tip line and Write mode hint use the helper', () => {
		const markup = blockEditor.slice(blockEditor.lastIndexOf('</script>'));
		expect(markup).not.toContain('Cmd/Ctrl');
		expect(markup).not.toMatch(/'Cmd'|'Ctrl'/);
		expect(markup).toContain("<kbd>{shortcutLabel('Mod+Shift+↑↓', isMac)}</kbd>");
		expect(markup).toContain("<kbd>{shortcutLabel('Mod+Shift+F', isMac)}</kbd>");
		expect(markup).toContain("({shortcutLabel('Mod+Shift+F', isMac)}, Esc to exit)");
	});

	it('the editor learns the platform after mount, so a server render matches the first client render', () => {
		expect(blockEditor).toMatch(/let isMac = \$state\(false\);\s*onMount\(\(\) => \{\s*isMac = isMacPlatform\(\);/);
	});
});

describe('shortcuts that clash with the browser or the keyboard layout', () => {
	it('headings avoid Ctrl+Alt off the Mac, where it is AltGr', () => {
		expect(headingShortcut(2, true)).toBe('Mod+Alt+2');
		expect(headingShortcut(2, false)).toBe('Mod+Shift+2');
		expect(headingShortcut(3, false)).toBe('Mod+Shift+3');
		expect(setup).not.toMatch(/'Mod-Alt-\d'/);
		expect(setup).toMatch(/\[heading\(1\)\]: turnSelectionInto\('h1'\)/);
		expect(setup).toMatch(/\[heading\(2\)\]: turnSelectionInto\('h2'\)/);
		expect(setup).toMatch(/\[heading\(3\)\]: turnSelectionInto\('h3'\)/);
	});

	it('align right always claims the hard-reload keys while the editor has focus', () => {
		expect(setup).toContain("'Mod-Shift-r': always(setAlign('right'))");
	});

	it('strikethrough moves off the Firefox screenshot keys and the old keys still work', () => {
		expect(setup).toContain("'Mod-Shift-x': toggleMark(m.strike)");
		expect(setup).toContain("'Mod-Shift-s': always(toggleMark(m.strike))");
	});
});

describe('README', () => {
	it('lists the shortcuts with Mac and Windows columns', () => {
		expect(readme).toContain('| Action | Mac | Windows and Linux |');
		expect(readme).toContain('| Strikethrough | ⌘⇧X | Ctrl+Shift+X |');
		expect(readme).toContain('| Heading 1, 2, 3 | ⌘⌥1, ⌘⌥2, ⌘⌥3 | Ctrl+Shift+1, Ctrl+Shift+2, Ctrl+Shift+3 |');
		expect(readme).not.toContain('Cmd/Ctrl');
	});
});
