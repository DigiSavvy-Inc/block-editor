// #330: the block handle's ↑/↓ buttons. Pure, no prosemirror import, so BlockEditor can
// load it statically without pulling the editor chunk.

/** Whether the block at `index` of `siblings` can move one step in `dir`. */
export function canMoveBlock(index: number, siblings: number, dir: -1 | 1): boolean {
	return dir < 0 ? index > 0 : index < siblings - 1;
}

/** Tooltip for a move button, with the Cmd/Ctrl+Shift+↑/↓ shortcut for the platform. */
export function moveTitle(dir: -1 | 1, mac: boolean): string {
	const keys = `${mac ? '⌘⇧' : 'Ctrl+Shift+'}${dir < 0 ? '↑' : '↓'}`;
	return `${dir < 0 ? 'Move up' : 'Move down'} (${keys})`;
}
