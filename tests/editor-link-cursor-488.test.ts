// #488: links in the block editor show the pointer cursor (a click opens the #473 popover).
// CSS cursors aren't covered by the DOM tests, so this checks the stylesheet rule exists.
import { describe, it, expect } from 'vitest';
import source from '../src/lib/components/BlockEditor.svelte?raw';

describe('block editor link cursor', () => {
	it('gives every link in the editor document cursor: pointer', () => {
		const rule = source.match(/\.be-doc :global\(\.pm-doc a\)\s*\{([^}]*)\}/);
		expect(rule).not.toBeNull();
		expect(rule![1]).toMatch(/cursor:\s*pointer/);
	});

	it('no later editor link rule sets another cursor', () => {
		const linkRules = [...source.matchAll(/:global\([^)]*\ba\)\s*\{([^}]*)\}/g)];
		for (const r of linkRules) {
			const cursor = r[1].match(/cursor:\s*([a-z-]+)/);
			if (cursor) expect(cursor[1]).toBe('pointer');
		}
	});
});
