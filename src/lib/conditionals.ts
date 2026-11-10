// Conditional content (#62): per-recipient {{#if …}} / {{else}} / {{/if}} blocks plus
// {{field:name}} output tags, evaluated against a contact's tags + custom fields right
// before personalize(). Fail-open: malformed constructs are left verbatim so mistakes
// are visible in test sends instead of silently eating content.
//
// Pass mode: 'html' when the string is rendered email HTML (field values are escaped;
// a {{field}} that is an entire href must be http(s) or mailto). Default 'text' inserts
// the raw value — subjects and plain-text bodies.

import { applyMergeTokens, type TemplateMode } from '$lib/merge-tags.js';

export type CondCtx = {
	tags: Set<string>; // lowercased tag names
	fields: Record<string, unknown>; // contact custom fields (meta JSON)
};

/** Build a context from the SQL-side values: comma-concatenated tags + meta JSON. */
export function buildCondCtx(tagsCsv: string | null | undefined, metaJson: string | null | undefined): CondCtx {
	const tags = new Set(
		(tagsCsv ?? '')
			.split(',')
			.map((t) => t.trim().toLowerCase())
			.filter(Boolean)
	);
	let fields: Record<string, unknown> = {};
	try {
		const v = metaJson ? JSON.parse(metaJson) : {};
		if (v && typeof v === 'object' && !Array.isArray(v)) fields = v as Record<string, unknown>;
	} catch {
		/* malformed meta — no fields */
	}
	return { tags, fields };
}

/**
 * Body of a `tag:` / `!tag:` name. Letters, digits, `_`, `-`, space, and `:`.
 * Colons are allowed so tags like `snapshot:delivered` match (#126). One source
 * for the parser and for `formatTagCondition`.
 */
const TAG_CONDITION_NAME = String.raw`[\w\-: ]`;
const TAG_NAME_BODY = new RegExp(`^${TAG_CONDITION_NAME}+$`);
const TAG_CONDITION = new RegExp(`^tag:(${TAG_CONDITION_NAME}+)$`, 'i');

/**
 * `tag:name` or `!tag:name`. `}` and `"` are stripped so a name can't break out of
 * `{{#if}}`. Null when the name is empty or contains a character the parser rejects,
 * so block visibility and automation gates can't drift from `evalCond`.
 */
export function formatTagCondition(name: string, negate = false): string | null {
	const cleaned = name.trim().replaceAll('}', '').replaceAll('"', '');
	if (!TAG_NAME_BODY.test(cleaned)) return null;
	return `${negate ? '!' : ''}tag:${cleaned}`;
}

/** Evaluate one condition string. Returns null when malformed (caller fails open). */
function evalCond(raw: string, ctx: CondCtx): boolean | null {
	let c = raw.trim();
	let neg = false;
	if (c.startsWith('!')) {
		neg = true;
		c = c.slice(1).trim();
	}

	let result: boolean | null = null;
	const tagM = TAG_CONDITION.exec(c);
	const cmpM = c.match(/^field:([\w\- ]+?)\s*(==|!=|>=|<=|>|<)\s*"?([^"]*)"?$/);
	const fieldM = c.match(/^field:([\w\- ]+)$/i);

	if (tagM) {
		result = ctx.tags.has(tagM[1].trim().toLowerCase());
	} else if (cmpM) {
		const v = ctx.fields[cmpM[1].trim()];
		const sval = v === undefined || v === null ? '' : String(v);
		const op = cmpM[2];
		const rhs = cmpM[3].trim();
		const ln = Number(sval);
		const rn = Number(rhs);
		const bothNum = sval.trim() !== '' && rhs !== '' && Number.isFinite(ln) && Number.isFinite(rn);
		if (op === '==') result = bothNum ? ln === rn : sval === rhs;
		else if (op === '!=') result = bothNum ? ln !== rn : sval !== rhs;
		else if (!bothNum) result = false; // ordered compares need numbers on both sides
		else if (op === '>') result = ln > rn;
		else if (op === '>=') result = ln >= rn;
		else if (op === '<') result = ln < rn;
		else result = ln <= rn;
	} else if (fieldM) {
		const v = ctx.fields[fieldM[1].trim()];
		result = v !== undefined && v !== null && String(v).trim() !== '';
	}

	if (result === null) return null;
	return neg ? !result : result;
}

/** Evaluate a single condition string for gate steps (#13). Malformed → false. */
export function checkCondition(cond: string, ctx: CondCtx): boolean {
	return evalCond(cond, ctx) === true;
}

const TOKEN = /\{\{#if\s+([^}]+)\}\}|\{\{else\}\}|\{\{\/if\}\}/g;

/** From the text AFTER an opening {{#if}}, find the matching close (nesting-aware).
 *  Returns the if-branch, optional else-branch, the remainder after {{/if}}, and the
 *  raw construct length for verbatim fail-open reconstruction. */
function splitIf(after: string): { ok: boolean; body: string; elseBody: string | null; remainder: string; rawLen: number } {
	TOKEN.lastIndex = 0;
	let depth = 1;
	let elseAt = -1;
	let m: RegExpExecArray | null;
	while ((m = TOKEN.exec(after))) {
		if (m[0].startsWith('{{#if')) depth++;
		else if (m[0] === '{{else}}') {
			if (depth === 1 && elseAt === -1) elseAt = m.index;
		} else {
			depth--;
			if (depth === 0) {
				const closeStart = m.index;
				const body = elseAt === -1 ? after.slice(0, closeStart) : after.slice(0, elseAt);
				const elseBody = elseAt === -1 ? null : after.slice(elseAt + '{{else}}'.length, closeStart);
				return { ok: true, body, elseBody, remainder: after.slice(closeStart + m[0].length), rawLen: closeStart + m[0].length };
			}
		}
	}
	return { ok: false, body: '', elseBody: null, remainder: after, rawLen: 0 };
}

const OPEN = /\{\{#if\s+([^}]+)\}\}/;

/** marked HTML-escapes quotes and < > inside {{#if}} conditions (`&quot;`, `&gt;`, `&lt;`).
 *  Put the operators back so equality and numeric compares still parse. No-op when the
 *  tags were shielded through markdown (they never got escaped). */
function restoreConditionalPunctuation(input: string): string {
	return input.replace(/\{\{#if\s+[^}]+\}\}/g, (tag) => {
		let cur = tag;
		for (let i = 0; i < 3; i++) {
			const next = cur
				.replace(/&quot;/gi, '"')
				.replace(/&#0*34;/gi, '"')
				.replace(/&gt;/gi, '>')
				.replace(/&#0*62;/gi, '>')
				.replace(/&lt;/gi, '<')
				.replace(/&#0*60;/gi, '<')
				.replace(/&amp;/gi, '&');
			if (next === cur) break;
			cur = next;
		}
		return cur;
	});
}

/** Resolve {{#if}}/{{else}}/{{/if}} only. Field output tags are filled once by the caller
 *  so a field value is not scanned for further tags. */
function resolveConditionals(input: string, ctx: CondCtx): string {
	let out = '';
	let rest = input;
	for (let guard = 0; guard < 500; guard++) {
		const m = OPEN.exec(rest);
		if (!m) {
			out += rest;
			rest = '';
			break;
		}
		out += rest.slice(0, m.index);
		const after = rest.slice(m.index + m[0].length);
		const parts = splitIf(after);
		if (!parts.ok) {
			// No matching {{/if}} — keep the opening tag visible and move on.
			out += m[0];
			rest = after;
			continue;
		}
		const cond = evalCond(m[1], ctx);
		if (cond === null) {
			// Malformed condition — keep the whole construct verbatim (visible in tests).
			out += m[0] + after.slice(0, parts.rawLen);
			rest = parts.remainder;
			continue;
		}
		const branch = cond ? parts.body : (parts.elseBody ?? '');
		out += resolveConditionals(branch, ctx);
		rest = parts.remainder;
	}
	return out + rest;
}

/** #531: how evaluateConditionals reads one `{{#if …}}` tag as it appears in rendered HTML
 *  (entity-decoded the same way): true / false for `ctx`, null = malformed (kept verbatim). */
export function conditionalTagResult(tag: string, ctx: CondCtx): boolean | null {
	const m = OPEN.exec(restoreConditionalPunctuation(tag));
	return m ? evalCond(m[1], ctx) : null;
}

/** Resolve every {{#if}}/{{else}}/{{/if}} construct (nesting supported) and fill
 *  {{field:name}} output tags. Unmatched or malformed constructs stay verbatim.
 *  Unknown field names become '' (same as before). */
export function evaluateConditionals(
	input: string,
	ctx: CondCtx,
	opts?: { mode?: TemplateMode }
): string {
	const resolved = resolveConditionals(restoreConditionalPunctuation(input), ctx);
	const mode = opts?.mode ?? 'text';
	return applyMergeTokens(resolved, mode, (token) => {
		const m = /^field:([\w\- ]+)$/.exec(token);
		if (!m) return null;
		const v = ctx.fields[m[1].trim()];
		return v === undefined || v === null ? '' : String(v);
	});
}

/** Does this template need per-recipient evaluation at all? (fast-path check).
 *  Also matches marked's percent-encoded form so a stored HTML body still evaluates. */
export function hasConditionals(s: string): boolean {
	return s.includes('{{#if') || s.includes('{{field:') || /%7B%7B(?:field:|%23if)/i.test(s);
}

/** Strip conditional markers for previews (both branches shown, tags removed). */
export function stripConditionalTags(s: string): string {
	return s.replace(/\{\{#if\s+[^}]+\}\}|\{\{else\}\}|\{\{\/if\}\}/g, '');
}
