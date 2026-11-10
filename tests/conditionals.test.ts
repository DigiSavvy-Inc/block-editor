import { describe, it, expect } from 'vitest';
import {
	evaluateConditionals,
	buildCondCtx,
	checkCondition,
	formatTagCondition,
	hasConditionals,
	stripConditionalTags
} from '../src/lib/conditionals';
import { renderBlocksEmailHtml, type Block } from '../src/lib/blocks';

const hot = buildCondCtx('Hot, website-lead', '{"tier":"hot","score":92,"budget":"5k/mo"}');
const cold = buildCondCtx('', null);

describe('evaluateConditionals', () => {
	it('tag condition picks the right branch', () => {
		const t = '{{#if tag:hot}}CALL ME{{else}}newsletter{{/if}}';
		expect(evaluateConditionals(t, hot)).toBe('CALL ME');
		expect(evaluateConditionals(t, cold)).toBe('newsletter');
	});

	it('tags match case-insensitively', () => {
		expect(evaluateConditionals('{{#if tag:HOT}}y{{/if}}', hot)).toBe('y');
	});

	it('negation: !tag', () => {
		const t = '{{#if !tag:hot}}cold path{{/if}}';
		expect(evaluateConditionals(t, hot)).toBe('');
		expect(evaluateConditionals(t, cold)).toBe('cold path');
	});

	it('field presence + equality + numeric compare', () => {
		expect(evaluateConditionals('{{#if field:budget}}has budget{{/if}}', hot)).toBe('has budget');
		expect(evaluateConditionals('{{#if field:tier == "hot"}}T{{/if}}', hot)).toBe('T');
		expect(evaluateConditionals('{{#if field:tier != "hot"}}X{{else}}Y{{/if}}', hot)).toBe('Y');
		expect(evaluateConditionals('{{#if field:score >= 90}}high{{/if}}', hot)).toBe('high');
		expect(evaluateConditionals('{{#if field:score < 90}}low{{/if}}', hot)).toBe('');
	});

	it('missing field: presence false, equality false, ordered compare false', () => {
		expect(evaluateConditionals('{{#if field:nope}}x{{else}}none{{/if}}', hot)).toBe('none');
		expect(evaluateConditionals('{{#if field:nope == "a"}}x{{else}}n{{/if}}', hot)).toBe('n');
		expect(evaluateConditionals('{{#if field:nope > 1}}x{{else}}n{{/if}}', hot)).toBe('n');
	});

	it('supports nesting', () => {
		const t = '{{#if tag:hot}}A{{#if field:score >= 90}}+{{/if}}{{else}}B{{/if}}';
		expect(evaluateConditionals(t, hot)).toBe('A+');
		expect(evaluateConditionals(t, cold)).toBe('B');
	});

	it('fails open: malformed condition stays verbatim', () => {
		const t = '{{#if banana phone}}x{{/if}}';
		expect(evaluateConditionals(t, hot)).toBe(t);
	});

	it('fails open: unmatched {{#if}} leaves the tag visible', () => {
		const t = 'before {{#if tag:hot}} dangling';
		expect(evaluateConditionals(t, hot)).toBe(t);
	});

	it('fills {{field:name}} output tags ("" when unset)', () => {
		expect(evaluateConditionals('Budget: {{field:budget}}!', hot)).toBe('Budget: 5k/mo!');
		expect(evaluateConditionals('[{{field:nope}}]', hot)).toBe('[]');
	});

	it('helpers: hasConditionals + stripConditionalTags', () => {
		expect(hasConditionals('plain')).toBe(false);
		expect(hasConditionals('{{field:x}}')).toBe(true);
		expect(stripConditionalTags('{{#if tag:a}}x{{else}}y{{/if}}')).toBe('xy');
	});
});

describe('block visibility → conditional markers', () => {
	it('wraps a visible-when-tagged block and resolves per recipient', () => {
		const blocks: Block[] = [
			{ id: '1', type: 'text', md: 'always' },
			{ id: '2', type: 'text', md: 'HOTBRANCH', visibility: { kind: 'tag', name: 'hot' } },
			{ id: '3', type: 'text', md: 'COLDBRANCH', visibility: { kind: 'no-tag', name: 'hot' } }
		];
		const html = renderBlocksEmailHtml(blocks);
		expect(html).toContain('{{#if tag:hot}}');
		expect(html).toContain('{{#if !tag:hot}}');

		const forHot = evaluateConditionals(html, hot);
		expect(forHot).toContain('HOTBRANCH');
		expect(forHot).not.toContain('COLDBRANCH');

		const forCold = evaluateConditionals(html, cold);
		expect(forCold).not.toContain('HOTBRANCH');
		expect(forCold).toContain('COLDBRANCH');
	});

	it('resolves visibility for a colon tag name', () => {
		const blocks: Block[] = [
			{ id: '1', type: 'text', md: 'DELIVERED', visibility: { kind: 'tag', name: 'snapshot:delivered' } },
			{ id: '2', type: 'text', md: 'NOTYET', visibility: { kind: 'no-tag', name: 'snapshot:delivered' } }
		];
		const html = renderBlocksEmailHtml(blocks);
		expect(html).toContain('{{#if tag:snapshot:delivered}}');
		expect(html).toContain('{{#if !tag:snapshot:delivered}}');

		const has = buildCondCtx('snapshot:delivered', null);
		const hasNot = buildCondCtx('hot', null);
		const forHas = evaluateConditionals(html, has);
		expect(forHas).toContain('DELIVERED');
		expect(forHas).not.toContain('NOTYET');
		const forHasNot = evaluateConditionals(html, hasNot);
		expect(forHasNot).not.toContain('DELIVERED');
		expect(forHasNot).toContain('NOTYET');
	});

	it('field-eq visibility sanitizes quotes/braces out of inputs', () => {
		const blocks: Block[] = [
			{ id: '1', type: 'text', md: 'vip', visibility: { kind: 'field-eq', name: 'tier"}', value: 'h"o}t' } }
		];
		const html = renderBlocksEmailHtml(blocks);
		expect(html).toContain('{{#if field:tier == "hot"}}');
	});
});

describe('colon tag conditions (#126)', () => {
	const delivered = buildCondCtx('snapshot:delivered, snapshot:booked', null);
	const none = buildCondCtx('hot', null);

	it('tag:snapshot:delivered is true only when the contact has the tag', () => {
		expect(checkCondition('tag:snapshot:delivered', delivered)).toBe(true);
		expect(checkCondition('tag:snapshot:delivered', none)).toBe(false);
		expect(evaluateConditionals('{{#if tag:snapshot:delivered}}yes{{else}}no{{/if}}', delivered)).toBe('yes');
		expect(evaluateConditionals('{{#if tag:snapshot:delivered}}yes{{else}}no{{/if}}', none)).toBe('no');
		expect(formatTagCondition('snapshot:delivered')).toBe('tag:snapshot:delivered');
	});

	it('!tag:snapshot:delivered is the inverse', () => {
		expect(checkCondition('!tag:snapshot:delivered', delivered)).toBe(false);
		expect(checkCondition('!tag:snapshot:delivered', none)).toBe(true);
		expect(evaluateConditionals('{{#if !tag:snapshot:delivered}}out{{else}}in{{/if}}', delivered)).toBe('in');
		expect(evaluateConditionals('{{#if !tag:snapshot:delivered}}out{{else}}in{{/if}}', none)).toBe('out');
		expect(formatTagCondition('snapshot:delivered', true)).toBe('!tag:snapshot:delivered');
	});

	it('snapshot:booked and snapshot:replied follow the same rule', () => {
		const booked = buildCondCtx('snapshot:booked', null);
		const replied = buildCondCtx('snapshot:replied', null);
		expect(checkCondition('tag:snapshot:booked', booked)).toBe(true);
		expect(checkCondition('tag:snapshot:booked', replied)).toBe(false);
		expect(checkCondition('!tag:snapshot:booked', replied)).toBe(true);
		expect(checkCondition('tag:snapshot:replied', replied)).toBe(true);
		expect(checkCondition('tag:snapshot:replied', booked)).toBe(false);
		expect(checkCondition('!tag:snapshot:replied', booked)).toBe(true);
	});

	it('colon-free tag conditions are unchanged', () => {
		expect(checkCondition('tag:hot', hot)).toBe(true);
		expect(checkCondition('tag:hot', cold)).toBe(false);
		expect(checkCondition('!tag:hot', hot)).toBe(false);
		expect(checkCondition('!tag:hot', cold)).toBe(true);
		expect(checkCondition('tag:website-lead', buildCondCtx('website-lead', null))).toBe(true);
		expect(checkCondition('tag:hot lead', buildCondCtx('hot lead', null))).toBe(true);
		expect(evaluateConditionals('{{#if tag:hot}}CALL ME{{else}}newsletter{{/if}}', hot)).toBe('CALL ME');
		expect(evaluateConditionals('{{#if tag:hot}}CALL ME{{else}}newsletter{{/if}}', cold)).toBe('newsletter');
		expect(formatTagCondition('hot')).toBe('tag:hot');
		expect(formatTagCondition('snap.shot')).toBeNull();
	});
});
