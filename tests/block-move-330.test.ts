import { describe, it, expect } from 'vitest';
import { canMoveBlock, moveTitle } from '../src/lib/editor/move';

describe('#330 handle move buttons', () => {
	it('disables up on the first sibling and down on the last', () => {
		expect(canMoveBlock(0, 3, -1)).toBe(false);
		expect(canMoveBlock(0, 3, 1)).toBe(true);
		expect(canMoveBlock(1, 3, -1)).toBe(true);
		expect(canMoveBlock(1, 3, 1)).toBe(true);
		expect(canMoveBlock(2, 3, -1)).toBe(true);
		expect(canMoveBlock(2, 3, 1)).toBe(false);
	});

	it('an only child moves neither way', () => {
		expect(canMoveBlock(0, 1, -1)).toBe(false);
		expect(canMoveBlock(0, 1, 1)).toBe(false);
	});

	it('titles carry the platform shortcut', () => {
		expect(moveTitle(-1, true)).toBe('Move up (⌘⇧↑)');
		expect(moveTitle(1, true)).toBe('Move down (⌘⇧↓)');
		expect(moveTitle(-1, false)).toBe('Move up (Ctrl+Shift+↑)');
		expect(moveTitle(1, false)).toBe('Move down (Ctrl+Shift+↓)');
	});
});
