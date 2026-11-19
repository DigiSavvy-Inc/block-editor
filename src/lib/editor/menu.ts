// The slash / `{{` menu's matching, and #5's host slash entries. Pure, no prosemirror
// import, so BlockEditor loads it statically and the tests run it.
import type { IconName } from '$lib/icons/glyphs.js';
import type { SlashHostAction } from './host-actions.js';

/** Every word of the query (trimmed, lower-cased) is in the entry's label or keywords. */
export function menuMatches(entry: { label: string; keywords: string }, query: string): boolean {
	return !query || query.split(/\s+/).every((w) => `${entry.label} ${entry.keywords}`.toLowerCase().includes(w));
}

export type HostSlashItem = { id: string; label: string; hint: string; icon?: IconName; keywords: string; action: { kind: 'host'; host: SlashHostAction } };

/** #5: the host app's slash actions as menu entries: no keywords, so the label alone
 *  matches; the title is the hint. */
export function hostSlashItems(actions: SlashHostAction[]): HostSlashItem[] {
	return actions.map((a): HostSlashItem => ({ id: `host:${a.id}`, label: a.label, hint: a.title ?? '', icon: a.icon, keywords: '', action: { kind: 'host', host: a } }));
}
