// Enter in the editor's own fields (Design panel, toolbars, bubbles, popovers, menus) never
// submits the host form. The decision is pure; the wiring is read raw, like the other
// component tests.
import { describe, expect, it } from 'vitest';
import { formEnterAction, type EnterKeyLike } from '../src/lib/editor/form-enter';

const raw = import.meta.glob(['../src/lib/components/BlockEditor.svelte'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const editor = Object.values(raw)[0];

const key = (target: EnterKeyLike['target'], over: Partial<EnterKeyLike> = {}): EnterKeyLike => ({ key: 'Enter', defaultPrevented: false, target, ...over });
const input = (type?: string) => ({ tagName: 'INPUT', type });

describe('Enter in an editor field', () => {
	it('commits single-line fields instead of submitting the form', () => {
		for (const type of [undefined, '', 'text', 'url', 'number', 'search', 'email', 'TEXT']) {
			expect(formEnterAction(key(input(type)))).toBe('commit');
		}
	});

	it('only blocks the submission for inputs that commit as they change', () => {
		for (const type of ['checkbox', 'radio', 'range']) expect(formEnterAction(key(input(type)))).toBe('block');
	});

	it('leaves button-like inputs, the doc, textareas, selects and buttons alone', () => {
		for (const type of ['button', 'submit', 'reset', 'image', 'file', 'color']) expect(formEnterAction(key(input(type)))).toBe('pass');
		expect(formEnterAction(key({ tagName: 'DIV' }))).toBe('pass'); // the ProseMirror doc
		expect(formEnterAction(key({ tagName: 'TEXTAREA' }))).toBe('pass');
		expect(formEnterAction(key({ tagName: 'SELECT' }))).toBe('pass');
		expect(formEnterAction(key({ tagName: 'BUTTON' }))).toBe('pass');
		expect(formEnterAction(key(null))).toBe('pass');
	});

	it('leaves other keys, IME composition and fields with their own Enter alone', () => {
		expect(formEnterAction(key(input('text'), { key: 'a' }))).toBe('pass');
		expect(formEnterAction(key(input('text'), { key: 'Tab' }))).toBe('pass');
		expect(formEnterAction(key(input('text'), { isComposing: true }))).toBe('pass');
		// The link field and the hex field handle Enter themselves (preventDefault first).
		expect(formEnterAction(key(input('text'), { defaultPrevented: true }))).toBe('pass');
	});

	it('the editor root guards every field: block the submission, then commit by leaving the field', () => {
		expect(editor).toMatch(/class="be ds-block-editor"[\s\S]*?onkeydown=\{onRootKey\}\s*role="presentation"\s*>\s*<div class="be-bar">/);
		expect(editor).toMatch(
			/function onRootKey\(e: KeyboardEvent\) \{\s*const act = formEnterAction\(e\);\s*if \(act === 'pass'\) return;\s*e\.preventDefault\(\);\s*if \(act !== 'commit'\) return;\s*const field = e\.target as HTMLInputElement;\s*field\.blur\(\);\s*field\.focus\(\);/
		);
	});
});
