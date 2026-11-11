<script module lang="ts">
	// #270: with several editors on one page (global header + footer) only one phone
	// bottom sheet shows: the editor focused last (else the first mounted).
	let nextEditorId = 0;
	const sheetOwner = $state({ id: 0 });
</script>

<script lang="ts">
	// #250: Notion-style visual email editor (ProseMirror, own Svelte UI). The source of
	// truth is Block[] ($lib/blocks); it posts as JSON in a hidden `name` field. The
	// ProseMirror chunk loads lazily on mount. #261: `target="page"` edits a hosted page
	// (no merge tags, no per-recipient visibility).
	import { onDestroy, onMount, untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { IconName } from '$lib/icons/glyphs.js';
	import FormatToolbar from '$lib/components/FormatToolbar.svelte';
	import SelectionBubble from '$lib/components/SelectionBubble.svelte';
	import DesignPanel, { TYPE_LABEL, type Snap } from '$lib/components/DesignPanel.svelte';
	import { canvasIsSet, cleanHref, fontStack, type Block, type EmailCanvas, type Visibility } from '$lib/blocks.js';
	import { isMergeToken } from '$lib/merge-tags.js';
	import { cropImageToBlob, cropSource, type FocalPoint, type ImageRatio } from '$lib/image-crop.js';
	import { blocksToDoc, docToBlocks, type TurnInto } from '$lib/editor/doc.js';
	import type { EditorController, UiState, SlashAction, BlockInfo } from '$lib/editor/setup.js';
	import { canMoveBlock, moveTitle } from '$lib/editor/move.js';
	import { hrefHasMergeTag, shortHref } from '$lib/editor/link-range.js';
	import { prepareImageForUpload } from '$lib/image-convert.js';
	import {
		WRITE_MODE_FADE_MS,
		escapeExitsWriteMode,
		escapeTracker,
		escapeWasHandled,
		isWriteModeShortcut,
		readWriteMode,
		saveWriteMode
	} from '$lib/editor/write-mode.js';
	import { QUIET_IDLE, isTypingInput, nextQuiet, selBarTop, selBarVisible, type QuietEvent, type QuietState } from '$lib/editor/quiet.js';
	import WritingMenu from '$lib/components/WritingMenu.svelte';
	import { DEFAULT_WRITE_PREFS, DRAFT_SERIF_STACK, WORD_COUNT_DEBOUNCE_MS, countWords, docText, loadWritePrefs, saveWritePrefs, wordCountLabel, type WritePrefs } from '$lib/write-prefs.js';
	import type { ImageUpload } from '$lib/upload.js';
	import { BRAND_SWATCHES, type BrandLogo, type Swatch } from '$lib/brand.js';

	type MergeTag = { tag: string; desc: string };
	type Item = { id: string; label: string; hint: string; icon: IconName; keywords: string; action: SlashAction };

	let {
		blocks = $bindable<Block[]>([]),
		mergeTags = [],
		name = 'body_blocks',
		allowContentArea = false,
		placeholder,
		preview,
		target = 'email',
		canvas = $bindable<EmailCanvas | undefined>(undefined),
		canvasName = 'canvas',
		onready,
		upload,
		brandLogos = [],
		swatches = BRAND_SWATCHES
	}: {
		blocks?: Block[];
		/** #270: the template's email canvas; set (even `{}`) to edit it in the Design
		 *  panel and post it as JSON in `canvasName`. Undefined = no Email group. */
		canvas?: EmailCanvas;
		canvasName?: string;
		mergeTags?: MergeTag[];
		name?: string;
		allowContentArea?: boolean;
		placeholder?: string;
		/** Real renderer for the Desktop / Mobile preview (an email or page document). */
		preview?: (blocks: Block[]) => Promise<string>;
		target?: 'email' | 'page';
		/** #396: called once with the editor's normalised blocks (an unsaved-changes baseline). */
		onready?: (blocks: Block[]) => void;
		/** Stores an image file and resolves to its public URL (see ImageUpload). Without it
		 *  the upload affordances are hidden: images are added by URL only. */
		upload?: ImageUpload;
		/** Logos offered by the image settings' "Brand logo" quick insert. Empty (the
		 *  default) hides the control. */
		brandLogos?: BrandLogo[];
		/** The colour swatches of the text colour menu and the Design panel's colour
		 *  controls. Defaults to BRAND_SWATCHES. */
		swatches?: Swatch[];
	} = $props();
	const isPage = $derived(target === 'page');

	let mount = $state<HTMLDivElement | undefined>();
	let canvasEl = $state<HTMLDivElement | undefined>();
	let ctl = $state<EditorController | null>(null);
	let loadError = $state('');
	let ui = $state<UiState>({ menu: null, bubble: null, atom: null, format: null, linkAt: null });
	let menuIndex = $state(0);
	let hasFocus = $state(false);
	let handle = $state<{ pos: number; top: number; left: number; info: BlockInfo } | null>(null);
	let hovering = false;
	let dragging = $state(false);
	let blockMenu = $state<{ pos: number; top: number; left: number; info: BlockInfo } | null>(null);
	let linkDraft = $state<string | null>(null);
	// #473: the link preview Escape hid (`from:href`), until the caret leaves that link.
	let linkDismissed = $state<string | null>(null);
	let mode = $state<'edit' | 'desktop' | 'mobile'>('edit');
	let previewHtml = $state('');
	let previewBusy = $state(false);
	// #311: a rough dark-mode preview — how clients that invert colours (Gmail app,
	// Outlook) show the email: everything inverted, images flipped back.
	let previewDark = $state(false);
	const DARK_CSS = '<style>html{filter:invert(1) hue-rotate(180deg);background:#fff}img,picture,video{filter:invert(1) hue-rotate(180deg)}</style>';
	const shownPreview = $derived(
		previewDark ? (previewHtml.includes('</head>') ? previewHtml.replace('</head>', `${DARK_CSS}</head>`) : DARK_CSS + previewHtml) : previewHtml
	);
	let uploadError = $state('');
	let vis = $state<{ kind: Visibility['kind'] | ''; name: string; value: string }>({ kind: '', name: '', value: '' });

	const mergeList = $derived(
		mergeTags
			.map((t) => /^\{\{([^{}]+)\}\}$/.exec(t.tag)?.[1])
			.map((inner, i) => ({ inner, desc: mergeTags[i].desc }))
			.filter((t): t is { inner: string; desc: string } => !!t.inner && isMergeToken(t.inner))
	);

	const blockItems = $derived<Item[]>([
		{ id: 'p', label: 'Text', hint: 'Plain paragraph', icon: 'text', keywords: 'paragraph body', action: { kind: 'turn', to: 'paragraph' } },
		{ id: 'h1', label: 'Heading 1', hint: 'Big title', icon: 'heading', keywords: 'h1 title', action: { kind: 'turn', to: 'h1' } },
		{ id: 'h2', label: 'Heading 2', hint: 'Section heading', icon: 'heading', keywords: 'h2 subtitle', action: { kind: 'turn', to: 'h2' } },
		{ id: 'h3', label: 'Heading 3', hint: 'Small heading', icon: 'heading', keywords: 'h3', action: { kind: 'turn', to: 'h3' } },
		{ id: 'dh', label: 'Display heading', hint: 'Huge hero headline', icon: 'heading', keywords: 'display hero big title', action: { kind: 'turn', to: 'display' } },
		{ id: 'eb', label: 'Eyebrow', hint: 'Rule + small label', icon: 'text', keywords: 'eyebrow kicker label overline', action: { kind: 'turn', to: 'eyebrow' } },
		{ id: 'ul', label: 'Bulleted list', hint: '- item', icon: 'list', keywords: 'bullet unordered ul', action: { kind: 'turn', to: 'bullet' } },
		{ id: 'ol', label: 'Numbered list', hint: '1. item', icon: 'list-ordered', keywords: 'ordered ol number', action: { kind: 'turn', to: 'numbered' } },
		{ id: 'st', label: 'Steps', hint: 'Numbered circles', icon: 'list-ordered', keywords: 'steps numbered process how', action: { kind: 'turn', to: 'steps' } },
		{ id: 'ms', label: 'Milestones', hint: 'Dates in a row', icon: 'columns-3', keywords: 'milestones timeline dates stats row', action: { kind: 'insert', type: 'milestones' } },
		{ id: 'sec', label: 'Section', hint: 'Coloured band', icon: 'callout', keywords: 'section band background colour color hero', action: { kind: 'insert', type: 'section' } },
		{ id: 'q', label: 'Quote', hint: '> quote', icon: 'quote', keywords: 'blockquote', action: { kind: 'turn', to: 'quote' } },
		{ id: 'co', label: 'Callout', hint: 'Shaded box', icon: 'callout', keywords: 'note box highlight', action: { kind: 'turn', to: 'callout' } },
		{ id: 'hr', label: 'Divider', hint: '---', icon: 'divider', keywords: 'rule line hr separator', action: { kind: 'insert', type: 'divider' } },
		{ id: 'img', label: 'Image', hint: upload ? 'Upload or link' : 'Link to an image', icon: 'image', keywords: 'picture photo upload', action: { kind: 'insert', type: 'image' } },
		{ id: 'btn', label: 'Button', hint: 'Call to action', icon: 'button', keywords: 'cta link', action: { kind: 'insert', type: 'button' } },
		{ id: 'sp', label: 'Spacer', hint: 'Vertical space', icon: 'spacer', keywords: 'gap space', action: { kind: 'insert', type: 'spacer' } },
		{ id: 'c2', label: '2 columns', hint: 'Side by side', icon: 'columns-2', keywords: 'columns grid two', action: { kind: 'insert', type: 'columns2' } },
		{ id: 'c3', label: '3 columns', hint: 'Three across', icon: 'columns-3', keywords: 'columns grid three', action: { kind: 'insert', type: 'columns3' } },
		...(allowContentArea
			? [{ id: 'ca', label: 'Content area', hint: "Where a campaign's content lands", icon: 'content-area' as IconName, keywords: 'template placeholder', action: { kind: 'insert', type: 'content_area' } as SlashAction }]
			: [])
	]);
	const mergeItems = $derived<Item[]>(
		mergeList.map((t) => ({ id: `m:${t.inner}`, label: `{{${t.inner}}}`, hint: t.desc, icon: 'merge-tag', keywords: `merge tag ${t.inner} ${t.desc}`, action: { kind: 'merge', tag: t.inner } }))
	);

	const filtered = $derived.by<Item[]>(() => {
		const m = ui.menu;
		if (!m) return [];
		const q = m.query.trim().toLowerCase();
		const pool = m.kind === 'slash' ? [...blockItems, ...mergeItems] : mergeItems;
		const hits = pool.filter((i) => !q || q.split(/\s+/).every((w) => `${i.label} ${i.keywords}`.toLowerCase().includes(w)));
		// `{{field:anything}}` typed in full: offer it even if it isn't in the list.
		if (m.kind === 'merge' && q && isMergeToken(m.query.trim()) && !hits.some((h) => h.action.kind === 'merge' && h.action.tag === m.query.trim())) {
			hits.unshift({ id: 'm:typed', label: `{{${m.query.trim()}}}`, hint: 'Insert this tag', icon: 'merge-tag', keywords: '', action: { kind: 'merge', tag: m.query.trim() } });
		}
		return hits.slice(0, 40);
	});

	function rel(r: { left: number; top: number; bottom: number }) {
		const c = canvasEl?.getBoundingClientRect();
		return c ? { left: r.left - c.left, top: r.top - c.top, bottom: r.bottom - c.top, width: c.width } : { left: 0, top: 0, bottom: 0, width: 0 };
	}

	function placeHandle(info: BlockInfo | null) {
		if (!info || !canvasEl) {
			handle = null;
			return;
		}
		const r = info.dom.getBoundingClientRect();
		const p = rel(r);
		handle = { pos: info.pos, top: p.top, left: p.left, info };
	}

	let lastMenuKey = '';
	function onUi(next: UiState) {
		ui = next;
		const key = next.menu ? `${next.menu.kind}:${next.menu.from}:${next.menu.query}` : '';
		if (key !== lastMenuKey) menuIndex = 0;
		lastMenuKey = key;
		if (!next.bubble) linkDraft = null;
		const s = ctl?.view.state.selection;
		selKey = next.bubble && s ? `${s.from}:${s.to}` : null;
		if (selDismissed !== null && selKey !== selDismissed) selDismissed = null;
		if (!next.linkAt || `${next.linkAt.from}:${next.linkAt.href}` !== linkDismissed) linkDismissed = null;
		if (!hovering && ctl) placeHandle(ctl.blockAtSelection());
		readPanel();
	}

	function pick(item: Item | undefined) {
		const m = ui.menu;
		if (!item || !m || !ctl) return;
		ctl.applyMenu(item.action, m.from, m.to);
	}

	// #523: Escapes used to close this editor's own popovers, so Write mode doesn't also exit
	// on them (ProseMirror prevents default on every Escape, so that flag can't tell).
	const esc = escapeTracker();
	function onKey(e: KeyboardEvent): boolean {
		// #524: Tab leaves the canvas (or reaches the selection bubble): the chrome comes back.
		if (e.key === 'Tab' && !ui.menu) quietOn({ kind: 'tab' });
		if (ui.menu && filtered.length) {
			if (e.key === 'ArrowDown') menuIndex = (menuIndex + 1) % filtered.length;
			else if (e.key === 'ArrowUp') menuIndex = (menuIndex - 1 + filtered.length) % filtered.length;
			else if (e.key === 'Enter' || e.key === 'Tab') pick(filtered[menuIndex]);
			else if (e.key === 'Escape') {
				ctl?.dismissMenu(ui.menu.from);
				esc.consume(e);
			} else return false;
			return true;
		}
		if (ui.menu && e.key === 'Escape') {
			ctl?.dismissMenu(ui.menu.from);
			return esc.consume(e);
		}
		if (e.key === 'Escape' && blockMenu) {
			blockMenu = null;
			return esc.consume(e);
		}
		if (e.key === 'Escape' && linkPreview) {
			linkDismissed = `${linkPreview.from}:${linkPreview.href}`;
			return esc.consume(e);
		}
		if (e.key === 'Escape' && selBarShown) {
			selDismissed = selKey;
			return esc.consume(e);
		}
		// Cmd/Ctrl+K is left free for the site-wide search (#476, #477).
		return false;
	}

	async function uploadImage(file: File): Promise<string | null> {
		uploadError = '';
		// No `upload` prop: nothing to send the file to (the upload controls are hidden).
		const send = upload;
		if (!send) return null;
		try {
			file = await prepareImageForUpload(file);
		} catch (e) {
			uploadError = e instanceof Error ? e.message : 'Upload failed.';
			return null;
		}
		try {
			const url = await send(file);
			if (typeof url !== 'string' || !url) {
				uploadError = 'Upload failed.';
				return null;
			}
			return url;
		} catch (e) {
			uploadError = e instanceof Error && e.message ? e.message : 'Upload failed.';
			return null;
		}
	}

	// #497: crop the image block to an aspect ratio — always from its original — and bake
	// the result into a new uploaded file. `ratio` null = back to the original.
	let cropping = $state(false);
	async function cropTo(sn: Snap, ratio: ImageRatio | null, focal: FocalPoint | null) {
		if (!ctl || cropping) return;
		const source = cropSource(sn.attrs);
		if (!source) return;
		if (!ratio) {
			ctl.setAttrs(sn.pos, { src: source, ratio: null, origSrc: null, focal: null });
			return;
		}
		uploadError = '';
		cropping = true;
		const startSrc = sn.attrs.src;
		try {
			const file = await cropImageToBlob(source, ratio, focal);
			const url = await uploadImage(file);
			// Apply only while the same image block is still where it was.
			const node = ctl?.view.state.doc.nodeAt(sn.pos);
			if (url && node?.type.name === 'image' && node.attrs.src === startSrc)
				ctl?.setAttrs(sn.pos, { src: url, origSrc: source, ratio, focal: focal && focal !== 'mc' ? focal : null });
		} catch (e) {
			uploadError = e instanceof Error && e.message ? e.message : 'Cropping failed.';
		} finally {
			cropping = false;
		}
	}

	const editorId = ++nextEditorId;
	onMount(() => {
		if (!sheetOwner.id) sheetOwner.id = editorId;
		return () => {
			if (sheetOwner.id === editorId) sheetOwner.id = 0;
		};
	});

	// #523: Write mode — hides the app chrome (header, nav, assistant button) through
	// <html data-write-mode>, centres a larger canvas and folds the Design panel to an edge
	// tab. Saved per browser; only in Edit (a preview shows the chrome again).
	let writeMode = $state(false);
	let panelTabOpen = $state(false);
	let rootEl = $state<HTMLDivElement | undefined>();
	const writeOn = $derived(writeMode && mode === 'edit');
	let shellHidden = false;
	let exitTimer: ReturnType<typeof setTimeout> | undefined;
	function setShell(on: boolean) {
		if (typeof document === 'undefined' || on === shellHidden) return;
		const html = document.documentElement;
		shellHidden = on;
		clearTimeout(exitTimer);
		if (on) {
			delete html.dataset.writeModeExit;
			html.dataset.writeMode = '1';
		} else {
			delete html.dataset.writeMode;
			html.dataset.writeModeExit = '1';
			exitTimer = setTimeout(() => delete html.dataset.writeModeExit, WRITE_MODE_FADE_MS + 50);
		}
	}
	$effect(() => {
		setShell(writeOn);
	});
	onMount(() => {
		writeMode = readWriteMode(window.localStorage);
	});
	onDestroy(() => {
		// Never leave the shell hidden after navigating away.
		clearTimeout(exitTimer);
		if (shellHidden && typeof document !== 'undefined') {
			delete document.documentElement.dataset.writeMode;
			delete document.documentElement.dataset.writeModeExit;
			shellHidden = false;
		}
	});
	function toggleWriteMode(on = !writeMode) {
		writeMode = on;
		panelTabOpen = false;
		saveWriteMode(typeof window === 'undefined' ? null : window.localStorage, on);
	}
	/** A dialog, drawer or side panel outside this editor that Escape should close first. */
	function outsideDialogOpen(): boolean {
		const open = document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"], .hp-panel, .ap');
		return Array.from(open).some((d) => !rootEl?.contains(d) && !d.contains(rootEl ?? null));
	}
	function onWindowKey(e: KeyboardEvent) {
		if (mode !== 'edit' || sheetOwner.id !== editorId) return;
		if (isWriteModeShortcut(e)) {
			e.preventDefault();
			toggleWriteMode();
			return;
		}
		if (e.key !== 'Escape' || !writeMode) return;
		const exit = escapeExitsWriteMode({
			menu: !!ui.menu,
			popover: !!blockMenu || !!rootEl?.querySelector('.be-pop, [role="dialog"], [role="menu"]'),
			link: linkDraft !== null || !!linkPreview,
			dialog: outsideDialogOpen(),
			handled: escapeWasHandled({
				consumed: esc.consumed(e),
				defaultPrevented: e.defaultPrevented,
				inDoc: e.target instanceof Element && !!e.target.closest('.ProseMirror')
			})
		});
		if (!exit) return;
		e.preventDefault();
		toggleWriteMode(false);
	}

	// #525: Writing preferences (serif drafting face, focus paragraph) and the word count
	// footer — Write mode only, editor only (never in the blocks or the canvas JSON).
	let writePrefs = $state<WritePrefs>({ ...DEFAULT_WRITE_PREFS });
	let writingOpen = $state(false);
	let wordCount = $state(0);
	let countTimer: ReturnType<typeof setTimeout> | undefined;
	onMount(() => {
		writePrefs = loadWritePrefs(window.localStorage);
	});
	function setWritePrefs(next: WritePrefs) {
		writePrefs = next;
		saveWritePrefs(window.localStorage, next);
	}
	function recount() {
		clearTimeout(countTimer);
		if (ctl) wordCount = countWords(docText(ctl.view.state.doc));
	}
	function scheduleCount() {
		clearTimeout(countTimer);
		countTimer = setTimeout(recount, WORD_COUNT_DEBOUNCE_MS);
	}
	onDestroy(() => clearTimeout(countTimer));
	$effect(() => {
		if (writeOn && ctl) untrack(recount);
	});
	// Dimming lifts while the canvas lost focus or a menu / popover / link editor is open.
	const draftSerif = $derived(writeOn && writePrefs.font === 'serif');
	const focusDim = $derived(writeOn && writePrefs.focus && hasFocus && !ui.menu && !blockMenu && linkDraft === null && !writingOpen);
	$effect(() => {
		const c = ctl;
		const on = focusDim;
		// untrack: the dispatch runs onUi, which writes editor state this effect mustn't follow.
		untrack(() => c?.setFocusDim(on));
	});

	onMount(() => {
		let destroyed = false;
		import('$lib/editor/setup.js')
			.then((mod) => {
				if (destroyed || !mount) return;
				ctl = mod.createEditor(mount, {
					doc: blocksToDoc(untrack(() => blocks)),
					placeholder,
					label: target === 'page' ? 'Page body' : 'Email body',
					onChange: (doc) => {
						blocks = docToBlocks(doc, { allowContent: allowContentArea });
						if (writeOn) scheduleCount();
					},
					onUi,
					onKey,
					uploadImage,
					canUpload: () => !!upload
				});
				// Normalise ids / imported markdown once, so the posted JSON is the editor's.
				blocks = docToBlocks(ctl.view.state.doc.toJSON() as never, { allowContent: allowContentArea });
				onready?.(blocks);
			})
			.catch(() => (loadError = 'The editor failed to load. Reload the page to try again.'));
		return () => {
			destroyed = true;
			ctl?.destroy();
		};
	});

	// #330: after a ↑/↓ click the handle follows the moved block; it stays pinned there
	// until the pointer really moves (browsers fire a mousemove when layout shifts).
	let pin: { x: number; y: number } | null = null;
	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

	function moveFromHandle(dir: -1 | 1, e: MouseEvent) {
		if (!handle || !ctl || !canMoveBlock(handle.info.index, handle.info.siblings, dir)) return;
		ctl.move(handle.pos, dir);
		pin = { x: e.clientX, y: e.clientY };
		placeHandle(ctl.blockAtSelection());
	}

	function onMove(e: MouseEvent) {
		if (!ctl || blockMenu || mode !== 'edit') return;
		const t = e.target as HTMLElement;
		if (t.closest('.be-pop, .be-handle, .be-fmt')) return;
		if (pin && Math.abs(e.clientX - pin.x) < 6 && Math.abs(e.clientY - pin.y) < 6) return;
		pin = null;
		hovering = true;
		placeHandle(ctl.blockAt(e.clientX, e.clientY));
	}

	function openBlockMenu() {
		if (!handle || !ctl) return;
		const v = handle.info.node.attrs.visibility as Visibility | null;
		vis = { kind: v?.kind ?? '', name: v?.name ?? '', value: v?.value ?? '' };
		blockMenu = { ...handle };
	}

	// #270: the persistent Design panel. It follows the selection: the selected block's
	// own settings, the section around it, the columns around it, and (templates) the
	// email canvas. Snapshots of the node attrs, re-read after every transaction.
	// #275: the panel itself is DesignPanel.svelte.
	let pBlock = $state<Snap | null>(null);
	let pSection = $state<Snap | null>(null);
	let pColumns = $state<Snap | null>(null);
	let sheetOpen = $state(false);
	const snap = (pos: number | null): Snap | null => {
		const n = pos === null || !ctl ? null : ctl.nodeAt(pos);
		return n && pos !== null ? { pos, type: n.type.name, attrs: { ...n.attrs }, childCount: n.childCount } : null;
	};
	function readPanel() {
		if (!ctl) return;
		const info = ctl.blockAtSelection();
		const wasAtom = !!pBlock && ATOM_PANEL.has(pBlock.type);
		pBlock = info && info.node.type.name !== 'section' && info.node.type.name !== 'columns' ? snap(info.pos) : null;
		pSection = snap(info?.section ?? null);
		pColumns = snap(info?.columns ?? null);
		// Phones: selecting an image / button / spacer opens the sheet with its settings.
		// (Not on the stacked-above bar at mid widths: expanding it would shove the canvas
		// down under the pointer.)
		if (!wasAtom && pBlock && ATOM_PANEL.has(pBlock.type) && isPhone()) sheetOpen = true;
	}
	const ATOM_PANEL = new Set(['image', 'button', 'spacer']);
	const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
	// #270: the template's email canvas (templates only; undefined = not editable here).
	const canvasStyle = $derived.by(() => {
		if (!canvasIsSet(canvas)) return '';
		const c = canvas;
		return [
			c.backdrop ? `--cv-backdrop:${c.backdrop}` : '',
			`--cv-width:${c.width ?? 600}px`,
			c.radius !== undefined ? `--cv-radius:${c.radius}px` : '',
			c.text ? `--cv-text:${c.text}` : '',
			c.link ? `--cv-link:${c.link}` : '',
			c.fontSize ? `--cv-size:${c.fontSize}px` : '',
			c.font ? `--cv-font:${fontStack(c.font)}` : '',
			c.headingFont ? `--cv-hfont:${fontStack(c.headingFont)}` : '',
			c.lineHeight ? `--cv-lh:${c.lineHeight}` : ''
		]
			.filter(Boolean)
			.join(';');
	});

	function blockAction(fn: (pos: number) => void) {
		if (!blockMenu) return;
		fn(blockMenu.pos);
		blockMenu = null;
	}

	function applyVis() {
		if (!blockMenu || !ctl) return;
		const v: Visibility | null = vis.kind && vis.name.trim() ? { kind: vis.kind, name: vis.name.trim(), ...(vis.kind === 'field-eq' ? { value: vis.value } : {}) } : null;
		ctl.setAttrs(blockMenu.pos, { visibility: v });
		blockMenu = null;
	}

	const TEXT_TYPES = new Set(['paragraph', 'heading', 'bullet_list', 'ordered_list', 'quote', 'callout', 'eyebrow']);
	const turnOptions: { to: TurnInto; label: string }[] = [
		{ to: 'paragraph', label: 'Text' },
		{ to: 'h1', label: 'Heading 1' },
		{ to: 'h2', label: 'Heading 2' },
		{ to: 'h3', label: 'Heading 3' },
		{ to: 'display', label: 'Display heading' },
		{ to: 'eyebrow', label: 'Eyebrow' },
		{ to: 'bullet', label: 'Bulleted list' },
		{ to: 'numbered', label: 'Numbered list' },
		{ to: 'steps', label: 'Steps' },
		{ to: 'quote', label: 'Quote' },
		{ to: 'callout', label: 'Callout' }
	];

	/** The toolbar's Link button / Cmd+K: an empty caret inside a link selects the whole
	 *  link first, then the edit input opens prefilled with its href. */
	function openLinkEditor() {
		if (!ctl) return;
		const at = ui.linkAt;
		if (!ui.bubble && at) {
			ctl.selectRange(at);
			linkDraft = at.href;
			return;
		}
		if (ui.bubble) linkDraft = ui.bubble.href ?? '';
	}

	function openHref(href: string) {
		if (hrefHasMergeTag(href)) return;
		window.open(href, '_blank', 'noopener,noreferrer');
	}

	function commitLink() {
		if (!ctl || linkDraft === null) return;
		const ok = ctl.setLink(linkDraft.trim() || null);
		if (ok) linkDraft = null;
	}

	async function setMode(m: typeof mode) {
		mode = m;
		blockMenu = null;
		if (m === 'edit' || !preview) return;
		previewBusy = true;
		try {
			previewHtml = await preview(blocks);
		} catch {
			previewHtml = '<p style="font-family:sans-serif;color:#b42318;padding:16px">Preview failed to load.</p>';
		} finally {
			previewBusy = false;
		}
	}

	const bubblePos = $derived(ui.bubble ? rel(ui.bubble.rect) : null);
	const menuPos = $derived(ui.menu ? rel(ui.menu.rect) : null);
	// #473: the link preview shows while the caret sits in a link and the editor (or the
	// popover, whose buttons never take focus) has focus, unless Escape hid it.
	const linkPreview = $derived(
		ui.linkAt && hasFocus && mode === 'edit' && linkDraft === null && !ui.menu && `${ui.linkAt.from}:${ui.linkAt.href}` !== linkDismissed ? ui.linkAt : null
	);
	// #524: quiet chrome. The first text-inserting keystroke fades the handle, the editor bar,
	// the format toolbar and the Design panel; pointer travel, a control, a menu or Tab
	// brings them back (state machine in $lib/editor/quiet).
	let quiet = $state.raw<QuietState>(QUIET_IDLE);
	function quietOn(e: QuietEvent) {
		const n = nextQuiet(quiet, e);
		if (n !== quiet) quiet = n;
	}
	// #525's Writing popover sits in .be-bar, which quiet fades: an open popover keeps the chrome up.
	const menuOpen = $derived(!!ui.menu || !!blockMenu || linkDraft !== null || writingOpen);
	$effect(() => {
		if (menuOpen) quietOn({ kind: 'menu' });
	});
	const isQuiet = $derived(quiet.on && mode === 'edit' && !menuOpen);
	function onRootFocus(e: FocusEvent) {
		const t = e.target;
		if (t instanceof Element && !t.closest('.ProseMirror')) quietOn({ kind: 'control' });
	}

	// #524: the selection bubble — a non-empty text selection in Edit, not under the link
	// editor. Escape hides it until the selection changes.
	let selKey = $state<string | null>(null);
	let selDismissed = $state<string | null>(null);
	const selBarShown = $derived(
		selBarVisible({
			edit: mode === 'edit',
			textSel: !!ui.bubble && !!ui.format?.textSel,
			linkEditing: linkDraft !== null,
			menu: !!ui.menu,
			focus: hasFocus,
			dismissed: selKey !== null && selKey === selDismissed
		})
	);
	const SEL_BAR_H = 38;
	const SEL_BAR_W = 340;
	const selBarPos = $derived.by(() => {
		if (!selBarShown || !ui.bubble) return null;
		const p = rel(ui.bubble.rect);
		return {
			top: selBarTop({ relTop: p.top, relBottom: p.bottom, viewTop: ui.bubble.rect.top, height: SEL_BAR_H }),
			left: Math.min(Math.max(0, p.left), Math.max(0, p.width - SEL_BAR_W))
		};
	});
	function closeSelBar() {
		selDismissed = selKey;
		ctl?.focus();
	}

	const LINK_POP_H = 40;
	const linkPos = $derived.by(() => {
		if (!linkPreview) return null;
		const p = rel(linkPreview.rect);
		// Below the link; above it when the viewport has no room below (like the bubble).
		const below = typeof window === 'undefined' || linkPreview.rect.bottom + LINK_POP_H + 8 <= window.innerHeight;
		return { top: below || p.top - LINK_POP_H - 6 < 0 ? p.bottom + 6 : p.top - LINK_POP_H - 6, left: Math.min(Math.max(0, p.left), Math.max(0, p.width - 360)) };
	});
</script>

<svelte:window onkeydown={onWindowKey} />

<div
	class="be ds-block-editor"
	class:write={writeOn}
	class:quiet={isQuiet}
	class:serif={draftSerif}
	style:--be-draft-font={draftSerif ? DRAFT_SERIF_STACK : null}
	bind:this={rootEl}
	onmousemove={(e) => quietOn({ kind: 'mouse', x: e.clientX, y: e.clientY })}
	onfocusin={onRootFocus}
	role="presentation"
>
	<div class="be-bar">
		<div class="seg" role="group" aria-label="Editor view">
			<button type="button" class:on={mode === 'edit'} aria-pressed={mode === 'edit'} onclick={() => setMode('edit')}><Icon name="edit" size={16} /> Edit</button>
			{#if preview}
				<button type="button" class:on={mode === 'desktop'} aria-pressed={mode === 'desktop'} onclick={() => setMode('desktop')}>Desktop</button>
				<button type="button" class:on={mode === 'mobile'} aria-pressed={mode === 'mobile'} onclick={() => setMode('mobile')}>Mobile</button>
			{/if}
		</div>
		{#if mode === 'edit'}
			<button
				type="button"
				class="write-btn"
				class:on={writeMode}
				aria-pressed={writeMode}
				title="Write mode: hide the app around the editor ({isMac ? 'Cmd' : 'Ctrl'}+Shift+F, Esc to exit)"
				onclick={() => toggleWriteMode()}><Icon name="write-mode" size={16} /> Write</button
			>
			{#if writeOn}<WritingMenu prefs={writePrefs} onchange={setWritePrefs} bind:open={writingOpen} />{/if}
		{/if}
		{#if preview && !isPage && mode !== 'edit'}
			<div class="seg" role="group" aria-label="Preview colours">
				<button type="button" class:on={previewDark} aria-pressed={previewDark} onclick={() => (previewDark = !previewDark)}>Dark</button>
			</div>
		{/if}
		<span class="be-tip">
			Type <kbd>/</kbd> for blocks{#if !isPage}, <kbd>{'{{'}</kbd> for merge tags{/if}. Format with the toolbar or the bubble over selected text; select text and paste a link to link it. <kbd>Cmd/Ctrl+Shift+↑↓</kbd> moves a block. <kbd>Cmd/Ctrl+Shift+F</kbd> toggles Write mode.
		</span>
	</div>

	<div class="be-body" class:editing={mode === 'edit'}>
	<div
		class="be-canvas"
		class:hidden={mode !== 'edit'}
		class:has-canvas={!!canvasStyle}
		style={canvasStyle}
		bind:this={canvasEl}
		onmousemove={onMove}
		onmouseleave={() => {
			hovering = false;
			if (!blockMenu && ctl) placeHandle(hasFocus ? ctl.blockAtSelection() : null);
		}}
		onfocusin={() => {
			hasFocus = true;
			sheetOwner.id = editorId;
		}}
		onfocusout={(e) => {
			if (!canvasEl?.contains(e.relatedTarget as Node | null)) hasFocus = false;
		}}
		role="presentation"
	>
		{#if ctl && !writeOn}
			<!-- #524: in Write mode the selection bubble is the formatting UI. -->
			<FormatToolbar {ctl} format={ui.format} mergeTags={isPage ? [] : mergeList} {swatches} onLink={openLinkEditor} />
		{/if}
		{#if !ctl}<p class="be-loading">{loadError || 'Loading editor…'}</p>{/if}
		<div class="be-doc" bind:this={mount} onbeforeinput={(e) => isTypingInput(e.inputType) && quietOn({ kind: 'type' })}></div>

		<!-- #524: right after the doc in DOM order, so Tab from the text reaches it. -->
		{#if selBarPos && ctl}
			<SelectionBubble {ctl} format={ui.format} top={selBarPos.top} left={selBarPos.left} onLink={openLinkEditor} onClose={closeSelBar} />
		{/if}
		{#if writeOn && ctl}<p class="be-words">{wordCountLabel(wordCount)}</p>{/if}

		{#if handle && ctl}
			<div class="be-handle" style="top:{handle.top}px;left:max(0px, calc({handle.left}px - var(--be-gutter)))">
				<button
					type="button"
					class="hbtn"
					title="Add a block below"
					aria-label="Add a block below"
					onclick={() => {
						if (!handle || !ctl) return;
						ctl.selectAfter(handle.pos);
						ctl.view.dispatch(ctl.view.state.tr.insertText('/'));
					}}><Icon name="add" size={16} /></button
				>
				<button
					type="button"
					class="hbtn drag"
					class:dragging
					draggable="true"
					title="Drag to move, click for options"
					aria-label="Block options"
					aria-haspopup="menu"
					ondragstart={(e) => {
						if (!handle || !ctl) return;
						dragging = true;
						ctl.startDrag(handle.pos, e);
					}}
					ondragend={() => (dragging = false)}
					onclick={openBlockMenu}><Icon name="drag-handle" size={16} /></button
				>
				{#each [-1, 1] as const as dir (dir)}
					{@const t = moveTitle(dir, isMac)}
					<button
						type="button"
						class="hbtn"
						title={t}
						aria-label={t}
						disabled={!canMoveBlock(handle.info.index, handle.info.siblings, dir)}
						onclick={(e) => moveFromHandle(dir, e)}><Icon name={dir < 0 ? 'arrow-up' : 'arrow-down'} size={16} /></button
					>
				{/each}
			</div>
		{/if}

		{#if blockMenu && ctl}
			{@const bm = blockMenu}
			<div class="be-pop be-blockmenu" role="menu" tabindex="-1" style="top:{bm.top}px;left:{Math.max(0, bm.left - 24)}px">
				{#if TEXT_TYPES.has(bm.info.node.type.name)}
					<p class="pop-h">Turn into</p>
					<div class="turn">
						{#each turnOptions as o (o.to)}
							<button type="button" role="menuitem" onclick={() => blockAction((p) => ctl?.turnInto(p, o.to))}>{o.label}</button>
						{/each}
					</div>
				{/if}
				{#if bm.info.section !== null && bm.info.section !== bm.pos}
					{@const secPos = bm.info.section}
					{@const sec = ctl.blockInfo(secPos)}
					<p class="pop-h">Section</p>
					<div class="acts">
						<button type="button" role="menuitem" disabled={!sec || !canMoveBlock(sec.index, sec.siblings, -1)} onclick={() => blockAction(() => ctl?.move(secPos, -1))}><Icon name="chevron-up" size={16} /> Move section up</button>
						<button type="button" role="menuitem" disabled={!sec || !canMoveBlock(sec.index, sec.siblings, 1)} onclick={() => blockAction(() => ctl?.move(secPos, 1))}><Icon name="chevron-down" size={16} /> Move section down</button>
						<button type="button" role="menuitem" onclick={() => blockAction(() => ctl?.duplicate(secPos))}><Icon name="copy" size={16} /> Duplicate section</button>
						<button type="button" role="menuitem" class="danger" onclick={() => blockAction(() => ctl?.remove(secPos))}><Icon name="delete" size={16} /> Delete section</button>
					</div>
				{/if}
				<p class="hint-row">Colours, alignment and spacing are in the Design panel.</p>
				<div class="acts">
					<button type="button" role="menuitem" onclick={() => blockAction((p) => ctl?.duplicate(p))}><Icon name="copy" size={16} /> Duplicate</button>
					<button type="button" role="menuitem" title={moveTitle(-1, isMac)} disabled={!canMoveBlock(bm.info.index, bm.info.siblings, -1)} onclick={() => blockAction((p) => ctl?.move(p, -1))}><Icon name="chevron-up" size={16} /> Move up</button>
					<button type="button" role="menuitem" title={moveTitle(1, isMac)} disabled={!canMoveBlock(bm.info.index, bm.info.siblings, 1)} onclick={() => blockAction((p) => ctl?.move(p, 1))}><Icon name="chevron-down" size={16} /> Move down</button>
					<button type="button" role="menuitem" class="danger" onclick={() => blockAction((p) => ctl?.remove(p))}><Icon name="delete" size={16} /> Delete</button>
				</div>
				{#if !isPage}
				<p class="pop-h"><Icon name="eye" size={16} /> Visibility</p>
				<div class="vis">
					<select bind:value={vis.kind} aria-label="Who sees this block">
						<option value="">Everyone</option>
						<option value="tag">Has tag</option>
						<option value="no-tag">Doesn't have tag</option>
						<option value="field-exists">Field is set</option>
						<option value="field-eq">Field equals</option>
					</select>
					{#if vis.kind}
						<input bind:value={vis.name} placeholder={vis.kind.startsWith('field') ? 'Field name' : 'Tag name'} aria-label="Tag or field name" />
						{#if vis.kind === 'field-eq'}<input bind:value={vis.value} placeholder="Value" aria-label="Field value" />{/if}
					{/if}
					<button type="button" class="secondary" onclick={applyVis}>Apply</button>
				</div>
				{/if}
				<button type="button" class="close" aria-label="Close" onclick={() => (blockMenu = null)}><Icon name="close" size={16} /></button>
			</div>
		{/if}

		{#if ui.menu && menuPos && filtered.length && hasFocus}
			<ul class="be-pop be-menu" role="listbox" aria-label={ui.menu.kind === 'slash' ? 'Insert a block' : 'Insert a merge tag'} style="top:{menuPos.bottom + 6}px;left:{Math.min(menuPos.left, Math.max(0, menuPos.width - 300))}px">
				{#each filtered as item, i (item.id)}
					<li>
						<button
							type="button"
							role="option"
							aria-selected={i === menuIndex}
							class:active={i === menuIndex}
							onmousedown={(e) => {
								e.preventDefault();
								pick(item);
							}}
							onmouseenter={() => (menuIndex = i)}
						>
							<Icon name={item.icon} size={16} />
							<span class="mi-label">{item.label}</span>
							<span class="mi-hint">{item.hint}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<!-- #276: formatting lives in the fixed toolbar; only the link editor floats. -->
		{#if ui.bubble && bubblePos && linkDraft !== null}
			<div class="be-pop be-bubble" role="dialog" aria-label="Edit link" tabindex="-1" style="top:{bubblePos.top - 46 < 0 ? bubblePos.bottom + 8 : bubblePos.top - 46}px;left:{Math.min(Math.max(0, bubblePos.left), Math.max(0, bubblePos.width - 340))}px" onmousedown={(e) => (e.target as HTMLElement).tagName !== 'INPUT' && e.preventDefault()}>
				<input
					{@attach (el) => el.focus()}
					class="link-in"
					placeholder="Paste or type a link (https://, mailto:, {'{{field:…}}'})"
					bind:value={linkDraft}
					aria-label="Link URL"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							commitLink();
						} else if (e.key === 'Escape') {
							linkDraft = null;
							esc.consume(e);
							ctl?.focus();
						}
					}}
				/>
				<button type="button" class="tb" onclick={commitLink}>Save</button>
				{#if ui.bubble.href}<button type="button" class="tb" onclick={() => { ctl?.setLink(null); linkDraft = null; }}>Remove</button>{/if}
				{#if linkDraft.trim() && !cleanHref(/^www\./i.test(linkDraft.trim()) ? `https://${linkDraft.trim()}` : linkDraft.trim())}<span class="bad">Use https://, mailto: or a merge tag</span>{/if}
			</div>
		{/if}

		<!-- #473: click a link (empty caret in it) → its URL with Edit, Unlink and Open. -->
		{#if linkPreview && linkPos}
			{@const lp = linkPreview}
			{@const tagged = hrefHasMergeTag(lp.href)}
			<div class="be-pop be-linkpop" role="dialog" aria-label="Link" tabindex="-1" style="top:{linkPos.top}px;left:{linkPos.left}px" onmousedown={(e) => e.preventDefault()}>
				<span class="lp-url" title={lp.href}>{shortHref(lp.href)}</span>
				<button type="button" class="tb" title="Edit link" aria-label="Edit link" onclick={() => openLinkEditor()}><Icon name="edit" size={16} /></button>
				<button type="button" class="tb" title="Unlink" aria-label="Unlink" onclick={() => ctl?.unlinkAt(lp)}><Icon name="unlink" size={16} /></button>
				<button
					type="button"
					class="tb"
					title={tagged ? 'Merge tag: no fixed URL' : 'Open link in a new tab'}
					aria-label="Open link"
					aria-disabled={tagged}
					onclick={() => openHref(lp.href)}><Icon name="external" size={16} /></button
				>
			</div>
		{/if}

	</div>

	{#if mode === 'edit'}
		<!-- #270: the persistent Design panel (a sticky bottom sheet on phones). -->
		<aside class="be-panel" class:open={sheetOpen} class:tab-open={writeOn && panelTabOpen} class:dormant={sheetOwner.id !== editorId} aria-label="Design">
			{#if writeOn}
				<!-- #523: in Write mode the panel folds to a slim tab on the right edge. -->
				<button type="button" class="panel-tab" aria-expanded={panelTabOpen} onclick={() => (panelTabOpen = !panelTabOpen)}>
					<Icon name={panelTabOpen ? 'close' : 'palette'} size={16} />
					<span>{panelTabOpen ? 'Close design' : 'Design'}</span>
				</button>
			{/if}
			<button type="button" class="panel-toggle" aria-expanded={sheetOpen} onclick={() => (sheetOpen = !sheetOpen)}>
				<span>Design{#if pBlock}: {TYPE_LABEL[pBlock.type] ?? 'Block'}{:else if pSection}: Section{/if}</span>
				<Icon name={sheetOpen ? 'chevron-down' : 'chevron-up'} size={16} />
			</button>
			<div class="panel-body">
				<DesignPanel
					block={pBlock}
					section={pSection}
					columns={pColumns}
					setDesign={(sn, patch) => ctl?.setDesign(sn.pos, patch)}
					setNode={(sn, attrs) => ctl?.setAttrs(sn.pos, attrs)}
					uploadInto={(pos, f) => ctl?.uploadInto(pos, f)}
					{cropTo}
					{cropping}
					setMilestoneCount={(pos, n) => ctl?.setMilestoneCount(pos, n)}
					{uploadError}
					canUpload={!!upload}
					{brandLogos}
					{swatches}
					showOnControl={isPage && allowContentArea}
					bind:canvas
				/>
			</div>
		</aside>
	{/if}
	</div>

	{#if mode !== 'edit'}
		<div class="be-preview">
			{#if previewBusy}<p class="be-loading">Rendering preview…</p>{/if}
			<iframe title="{isPage ? 'Page' : 'Email'} preview ({mode}{previewDark ? ', dark' : ''})" sandbox="" srcdoc={shownPreview} style="width:{mode === 'mobile' ? 375 : 720}px"></iframe>
		</div>
	{/if}

	<input type="hidden" {name} value={JSON.stringify(blocks)} />
	{#if canvas !== undefined}<input type="hidden" name={canvasName} value={JSON.stringify(canvas)} />{/if}
</div>

<style>
	.be {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}
	.be-bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-s);
	}
	.be-tip {
		font-size: var(--size-xs);
		line-height: var(--line-xs);
		color: var(--muted);
	}
	kbd {
		font-family: var(--font-mono);
		font-size: var(--size-xs);
		padding: 0 var(--space-xxs);
		border-radius: var(--radius-xs);
		box-shadow: 0 0 0 var(--border-s) var(--neutral-4);
	}
	.seg {
		display: inline-flex;
		gap: var(--space-xxs);
		padding: var(--space-xxs);
		border-radius: var(--radius-s);
		box-shadow: 0 0 0 var(--border-s) var(--border);
		background: var(--bg);
	}
	.seg button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-xxs);
		padding: var(--space-xxs) var(--space-s);
		font-size: var(--size-s);
		line-height: var(--line-s);
		color: var(--muted);
		background: transparent;
		border: none;
		border-radius: var(--radius-xs);
	}
	.seg button:hover {
		filter: none;
		color: var(--text);
	}
	.seg button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-s);
	}

	/* The canvas looks like the email: white page, the send's fonts and spacing. */
	.be-canvas {
		position: relative;
		border-radius: var(--radius-m);
		box-shadow: var(--border-shadow-s), var(--shadow-s);
		background: #ffffff;
		padding: var(--space-l) var(--space-l) var(--space-l) 64px;
		min-height: 360px;
		--be-gutter: 52px;
	}
	.be-canvas.hidden {
		display: none;
	}
	.be-loading {
		color: #57606a;
		font-size: var(--size-s);
	}
	.be-doc {
		max-width: 640px;
	}
	.be-doc :global(.pm-doc) {
		position: relative;
		outline: none;
		min-height: 300px;
		word-wrap: break-word;
		white-space: pre-wrap;
		white-space: break-spaces;
		font-variant-ligatures: none;
		font-family: var(--cv-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
		font-size: var(--cv-size, 16px);
		line-height: var(--cv-lh, 1.6);
		color: var(--cv-text, #1f2328);
	}
	.be-doc :global(.pm-doc p) {
		margin: 0 0 16px;
	}
	.be-doc :global(.pm-doc h1),
	.be-doc :global(.pm-doc h2),
	.be-doc :global(.pm-doc h3) {
		font-family: var(--cv-hfont, inherit);
		font-weight: 700;
		line-height: 1.25;
		margin: 0 0 14px;
		letter-spacing: normal;
		color: inherit;
	}
	/* #329: space above a heading (HEADING_SPACE_ABOVE in $lib/blocks), none when it opens
	   the doc / a section / a column or follows a heading or an eyebrow — like the send. */
	.be-doc :global(.pm-doc h1) {
		font-size: 26px;
		margin-top: 32px;
	}
	.be-doc :global(.pm-doc h2) {
		font-size: 20px;
		margin-top: 28px;
	}
	.be-doc :global(.pm-doc h3) {
		font-size: 17px;
		margin-top: 22px;
	}
	.be-doc :global(:is(.pm-doc, .pm-section, .pm-column) > :is(h1, h2, h3):first-child),
	.be-doc :global(:is(h1, h2, h3, .pm-eyebrow) + :is(h1, h2, h3)) {
		margin-top: 0;
	}
	.be-doc :global(.pm-doc ul),
	.be-doc :global(.pm-doc ol) {
		margin: 0 0 16px;
		padding-left: 22px;
	}
	.be-doc :global(.pm-doc li) {
		position: relative;
		margin: 0 0 8px;
	}
	.be-doc :global(.pm-doc li p) {
		margin: 0;
	}
	.be-doc :global(.pm-doc blockquote) {
		margin: 0 0 16px;
		padding: 4px 0 4px 16px;
		border-left: 3px solid #e5e7eb;
		color: #57606a;
	}
	.be-doc :global(.pm-doc .pm-callout) {
		margin: 0 0 16px;
		padding: 14px 16px;
		background: #f4f4f5;
		border-radius: 8px;
	}
	/* Like the email: a callout keeps its own (left) alignment in a centred section
	   unless it sets one itself (an inline text-align from its design attr). */
	.be-doc :global(.pm-section .pm-callout) {
		color: #1f2328;
		text-align: left;
	}
	.be-doc :global(.pm-doc a) {
		color: var(--cv-link, #2563eb);
		text-decoration: underline;
		/* #488: a click opens the link popover (#473), so links get the pointer, not the I-beam. */
		cursor: pointer;
	}
	.be-doc :global(.pm-doc code) {
		font-family: ui-monospace, Menlo, Consolas, monospace;
		font-size: 14px;
		background: #f4f4f5;
		padding: 1px 5px;
		border-radius: 4px;
	}
	.be-doc :global(.pm-merge) {
		display: inline-block;
		padding: 0 5px;
		margin: 0 1px;
		border-radius: 4px;
		background: #eef2ff;
		color: #1e3a8a;
		font-family: ui-monospace, Menlo, Consolas, monospace;
		font-size: 13px;
		line-height: 1.5;
		white-space: nowrap;
		cursor: default;
	}
	.be-doc :global(.pm-atom) {
		margin: 0 0 16px;
		border-radius: 6px;
		cursor: pointer;
	}
	.be-doc :global(.pm-atom img) {
		display: block;
		width: 100%;
		height: auto;
		border-radius: 6px;
	}
	.be-doc :global(.pm-atom hr) {
		border: none;
		border-top: 1px solid #e5e7eb;
		margin: 24px 0;
	}
	.be-doc :global(.pm-btn) {
		display: inline-block;
		background: #2563eb;
		color: #ffffff;
		padding: 11px 22px;
		border-radius: 8px;
		font-weight: 600;
	}
	/* #427: the shared .notice.warn box, sized to sit inline beside the button. It keeps
	   the email doc's text colour, since the doc is a light email surface in either theme. */
	.be-doc :global(.pm-warn) {
		display: inline-block;
		margin: 0 0 0 var(--space-xs);
		padding: 0 var(--space-xs);
		color: inherit;
	}
	.be-doc :global(.pm-img-frame) {
		position: relative;
		max-width: 100%;
	}
	.be-doc :global(.pm-resize) {
		display: none;
		position: absolute;
		top: 50%;
		right: -7px;
		width: 10px;
		height: 40px;
		margin-top: -20px;
		border-radius: 5px;
		background: #2563eb;
		box-shadow: 0 0 0 2px #ffffff;
		cursor: ew-resize;
		touch-action: none;
	}
	.be-doc :global(.ProseMirror-selectednode .pm-resize),
	.be-doc :global(.pm-img-frame.resizing .pm-resize) {
		display: block;
	}
	.be-doc :global(.pm-size) {
		display: none;
		position: absolute;
		top: 8px;
		right: 8px;
		padding: 0 6px;
		border-radius: 4px;
		background: rgba(31, 35, 40, 0.8);
		color: #ffffff;
		font-size: 12px;
		line-height: 20px;
	}
	.be-doc :global(.pm-img-frame.resizing .pm-size) {
		display: block;
	}
	.be-doc :global(.pm-placeholder) {
		border: 2px dashed #c4c9d4;
		border-radius: 8px;
		padding: 24px 16px;
		text-align: center;
		color: #57606a;
		font-size: 14px;
	}
	.be-doc :global(.pm-spacer) {
		background: repeating-linear-gradient(45deg, transparent 0 6px, #f4f4f5 6px 12px);
	}
	.be-doc :global(.pm-columns) {
		display: grid;
		grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr));
		gap: 12px;
		margin: 0 0 16px;
	}
	.be-doc :global(.pm-columns[data-cols='3']) {
		--cols: 3;
	}
	.be-doc :global(.pm-column) {
		min-width: 0;
		padding: 6px;
		border-radius: 6px;
		box-shadow: 0 0 0 1px #eaeef2;
	}
	/* #262 design blocks — the editor mirrors the email renderer's look. */
	.be-doc :global(.pm-section) {
		margin: 0 0 16px;
		padding: 40px 36px;
		font-family: var(--cv-font, Inter, Helvetica, Arial, sans-serif);
	}
	.be-doc :global(.pm-section[data-pad='sm']) {
		padding: 16px 20px;
	}
	.be-doc :global(.pm-section[data-pad='md']) {
		padding: 28px;
	}
	.be-doc :global(.pm-section[data-width='full']) {
		margin: 0;
	}
	.be-doc :global(.pm-section[data-width='inset']) {
		border-radius: 12px;
	}
	.be-doc :global(.pm-section[data-align='center']) {
		text-align: center;
	}
	.be-doc :global(.pm-section > :last-child) {
		margin-bottom: 0;
	}
	.be-doc :global(.pm-section a) {
		color: inherit;
	}
	.be-doc :global(.pm-section .pm-btn) {
		background: var(--sec-fg);
		color: var(--sec-bg);
	}
	.be-doc :global(.pm-doc h1.pm-display) {
		font-size: 48px;
		font-weight: 800;
		line-height: 1.05;
		letter-spacing: -0.02em;
		margin: 0 0 20px;
	}
	.be-doc :global(.pm-eyebrow) {
		width: fit-content;
		min-width: 120px;
		margin: 0 0 16px;
		padding-left: 38px;
		background: linear-gradient(currentColor, currentColor) left center / 28px 2px no-repeat;
		font-size: 13px;
		line-height: 1.4;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.be-doc :global(.pm-section[data-align='center'] .pm-eyebrow) {
		margin-left: auto;
		margin-right: auto;
	}
	.be-doc :global(.pm-eyebrow[data-tone='accent']) {
		color: var(--acc, #1a9ec4);
	}
	.be-doc :global(.pm-section[style*='--acc'] .pm-eyebrow) {
		background-image: linear-gradient(var(--acc), var(--acc));
	}
	.be-doc :global(.pm-section[style*='--acc'] .pm-atom hr) {
		border-top-color: var(--acc);
	}
	.be-doc :global(.pm-milestones) {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
		margin: 8px 0 16px;
		text-align: left;
	}
	.be-doc :global(.pm-milestones[data-n='2']) {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.be-doc :global(.pm-milestones[data-n='3']) {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.be-doc :global(.pm-milestones[data-rule='true']) {
		border-top: 4px solid var(--acc, currentColor);
		padding-top: 16px;
	}
	.be-doc :global(.pm-ms-title) {
		font-size: 20px;
		font-weight: 700;
		line-height: 1.25;
		margin: 0 0 4px;
	}
	.be-doc :global(.pm-ms-label) {
		font-size: 13px;
		line-height: 1.4;
	}
	.be-doc :global(.pm-doc ol.pm-steps) {
		list-style: none;
		padding-left: 0;
		counter-reset: step;
		text-align: left;
	}
	.be-doc :global(.pm-doc ol.pm-steps > li) {
		counter-increment: step;
		margin: 0;
		padding: 16px 0 14px 44px;
		border-top: 1px solid #e3e3e3;
	}
	.be-doc :global(.pm-doc ol.pm-steps > li:first-child) {
		border-top: 0;
	}
	.be-doc :global(.pm-doc ol.pm-steps > li::before) {
		content: counter(step);
		position: absolute;
		left: 0;
		top: 14px;
		width: 28px;
		height: 28px;
		border: 2px solid var(--acc, #1a9ec4);
		border-radius: 50%;
		text-align: center;
		font-size: 14px;
		font-weight: 700;
		line-height: 28px;
	}
	.be-doc :global(.pm-btn-link) {
		margin-left: 20px;
		font-weight: 600;
		text-decoration: underline;
		color: #2563eb;
	}
	.be-doc :global(.pm-section .pm-btn-link) {
		color: inherit;
	}
	.be-doc :global(.pm-img-row) {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	/* Image alignment mirrors the email renderer: the block's own align, else the
	   section's centring (Edit view must match the preview). The per-block rules repeat
	   .pm-atom so they outrank the section default. */
	.be-doc :global(.pm-section[data-align='center'] .pm-img-row) {
		justify-content: center;
	}
	.be-doc :global(.pm-section[data-align='center'] .pm-image:not(.pm-img-row) .pm-img-frame) {
		margin-left: auto;
		margin-right: auto;
	}
	.be-doc :global(.pm-atom.pm-image:not(.pm-img-row)[data-align='left'] .pm-img-frame) {
		margin-left: 0;
		margin-right: auto;
	}
	.be-doc :global(.pm-atom.pm-image:not(.pm-img-row)[data-align='center'] .pm-img-frame) {
		margin-left: auto;
		margin-right: auto;
	}
	.be-doc :global(.pm-atom.pm-image:not(.pm-img-row)[data-align='right'] .pm-img-frame) {
		margin-left: auto;
		margin-right: 0;
	}
	.be-doc :global(.pm-atom.pm-img-row[data-align='left']) {
		justify-content: flex-start;
	}
	.be-doc :global(.pm-atom.pm-img-row[data-align='center']) {
		justify-content: center;
	}
	.be-doc :global(.pm-atom.pm-img-row[data-align='right']) {
		justify-content: flex-end;
	}
	.be-doc :global(.pm-chip) {
		background: #ffffff;
		border-radius: 12px;
		padding: 12px 16px;
	}
	.be-doc :global(.pm-chip img) {
		border-radius: 0;
	}
	.be-doc :global(.pm-beside) {
		font-size: 22px;
		font-weight: 700;
		line-height: 1.2;
	}
	.be-doc :global(.ProseMirror-selectednode) {
		outline: 2px solid #2563eb;
		outline-offset: 2px;
	}
	.be-doc :global(.ProseMirror-hideselection *::selection) {
		background: transparent;
	}
	.be-doc :global(.ProseMirror-gapcursor) {
		display: none;
		pointer-events: none;
		position: absolute;
	}
	.be-doc :global(.ProseMirror-gapcursor:after) {
		content: '';
		display: block;
		position: absolute;
		top: -2px;
		width: 20px;
		border-top: 1px solid #1f2328;
		animation: be-blink 1.1s steps(2, start) infinite;
	}
	.be-doc :global(.ProseMirror-focused .ProseMirror-gapcursor) {
		display: block;
	}
	@keyframes be-blink {
		to {
			visibility: hidden;
		}
	}
	.be-doc :global(.pm-empty::before) {
		content: attr(data-placeholder);
		float: left;
		height: 0;
		color: #8b949e;
		pointer-events: none;
	}
	/* A visibility rule: amber rule on the left + the condition as a small label. */
	.be-doc :global(.pm-has-vis) {
		position: relative;
		box-shadow: -10px 0 0 -8px #bf8700;
	}
	.be-doc :global(.pm-has-vis::after) {
		content: attr(data-vis);
		position: absolute;
		top: -14px;
		right: 0;
		font-size: 11px;
		line-height: 14px;
		color: #7d4e00;
		font-weight: 400;
		font-style: normal;
		pointer-events: none;
	}

	/* #498: a web template block shown on one archive page only: a small label, top left. */
	.be-doc :global(.pm-show-on) {
		position: relative;
	}
	.be-doc :global(.pm-show-on::before) {
		content: attr(data-show-on);
		position: absolute;
		top: -14px;
		left: 0;
		font-size: 11px;
		line-height: 14px;
		color: #57606a;
		font-weight: 400;
		font-style: normal;
		letter-spacing: normal;
		text-transform: none;
		pointer-events: none;
	}

	/* #330: + and ⋮⋮ on the first row, ↑ ↓ under them, inside the gutter. */
	.be-handle {
		position: absolute;
		display: grid;
		grid-template-columns: repeat(2, auto);
		gap: 2px;
		z-index: 5;
	}
	.hbtn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		color: #57606a;
		background: transparent;
		border: none;
		border-radius: var(--radius-xs);
	}
	.hbtn:hover {
		filter: none;
		background: #f4f4f5;
		color: #1f2328;
	}
	.hbtn:disabled {
		opacity: 0.35;
		background: transparent;
		cursor: default;
	}
	.hbtn.drag {
		cursor: grab;
	}
	.hbtn.drag:active,
	.hbtn.drag.dragging {
		cursor: grabbing;
	}

	.be-pop {
		position: absolute;
		z-index: 30;
		background: var(--surface);
		color: var(--text);
		border-radius: var(--radius-s);
		box-shadow: 0 0 0 var(--border-s) var(--border), var(--shadow-m);
	}
	.be-menu {
		width: 300px;
		max-height: 320px;
		overflow: auto;
		margin: 0;
		padding: var(--space-xxs);
		list-style: none;
	}
	.be-menu button {
		display: grid;
		grid-template-columns: 20px minmax(0, auto) minmax(0, 1fr);
		align-items: center;
		gap: var(--space-xs);
		width: 100%;
		padding: var(--space-xs);
		text-align: left;
		color: inherit;
		background: transparent;
		border: none;
		border-radius: var(--radius-xs);
		font-size: var(--size-s);
		line-height: var(--line-s);
	}
	.be-menu button.active {
		background: var(--bg);
		filter: none;
	}
	.mi-label {
		font-weight: var(--weight-ui-medium);
		white-space: nowrap;
	}
	.mi-hint {
		color: var(--muted);
		font-size: var(--size-xs);
		line-height: var(--line-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.be-bubble {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 2px;
		padding: var(--space-xxs);
		max-width: 340px;
	}
	.be-linkpop {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: var(--space-xxs) var(--space-xxs) var(--space-xxs) var(--space-xs);
		max-width: 360px;
	}
	.lp-url {
		min-width: 0;
		margin-right: var(--space-xxs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted);
		font-size: var(--size-s);
		line-height: var(--line-s);
	}
	.be-linkpop .tb[aria-disabled='true'] {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.be-linkpop .tb[aria-disabled='true']:hover {
		background: transparent;
	}
	.tb {
		min-width: 30px;
		height: 30px;
		padding: 0 var(--space-xs);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text);
		background: transparent;
		border: none;
		border-radius: var(--radius-xs);
		font-size: var(--size-s);
	}
	.tb:hover {
		filter: none;
		background: var(--bg);
	}
	.link-in {
		flex: 1 1 200px;
		min-width: 0;
		font-size: var(--size-s);
	}
	.bad {
		flex-basis: 100%;
		font-size: var(--size-xs);
		line-height: var(--line-xs);
		color: var(--danger);
	}
	.be-blockmenu {
		width: 320px;
		max-width: calc(100% - 8px);
		padding: var(--space-s);
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}
	.pop-h {
		display: flex;
		align-items: center;
		gap: var(--space-xxs);
		margin: 0;
		font-size: var(--size-xs);
		line-height: var(--line-xs);
		font-weight: var(--weight-ui-medium);
		color: var(--muted);
	}
	.turn {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xxs);
	}
	.turn button,
	.acts button {
		padding: var(--space-xxs) var(--space-xs);
		font-size: var(--size-s);
		line-height: var(--line-s);
		color: var(--text);
		background: var(--bg);
		border: none;
		border-radius: var(--radius-xs);
		box-shadow: 0 0 0 var(--border-s) var(--border);
		display: inline-flex;
		align-items: center;
		gap: var(--space-xxs);
	}
	.acts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-xxs);
	}
	.acts .danger {
		color: var(--danger);
	}
	.vis {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xxs);
	}
	.vis select,
	.vis input {
		flex: 1 1 120px;
		min-width: 0;
		font-size: var(--size-s);
	}
	.close {
		position: absolute;
		top: var(--space-xxs);
		right: var(--space-xxs);
		padding: var(--space-xxs);
		background: transparent;
		border: none;
		color: var(--muted);
	}
	/* #270: the Design panel's three layouts, keyed on the editor's own width (the
	   container is .be, so the grid on .be-body can respond to it):
	   - roomy (≥ 820px of editor): panel to the RIGHT of the canvas, sticky under the app
	     header with its own scroll;
	   - narrower: panel stacked ABOVE the canvas as a compact sticky bar that expands;
	   - phones (≤ 768px viewport): a fixed bottom sheet (see the media query below). */
	.be {
		container-type: inline-size;
		/* #520: + a StickyActions bar above the editor (0 when there is none). */
		--be-sticky-top: calc(var(--header-h, 64px) + var(--sticky-actions-top, 0px) + var(--space-s));
	}
	.be-body.editing {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-s);
		align-items: start;
	}
	.be-body.editing .be-panel {
		order: -1;
		position: sticky;
		top: var(--be-sticky-top);
		z-index: 5;
		max-height: calc(100vh - var(--be-sticky-top) - var(--space-s));
		overflow: auto;
		box-shadow: var(--border-shadow-s), var(--shadow-s);
	}
	.be-panel:not(.open) .panel-body {
		display: none;
	}
	@container (min-width: 820px) {
		.be-body.editing {
			grid-template-columns: minmax(0, 1fr) 280px;
		}
		.be-body.editing .be-panel {
			order: 0;
			box-shadow: var(--border-shadow-s);
		}
		.be-panel:not(.open) .panel-body {
			display: flex;
		}
		.be-panel .panel-toggle {
			display: none;
		}
	}
	@container (min-width: 1000px) {
		.be-body.editing {
			grid-template-columns: minmax(0, 1fr) 320px;
		}
	}
	.be-panel {
		border-radius: var(--radius-m);
		background: var(--surface);
		box-shadow: var(--border-shadow-s);
		font-size: var(--size-s);
		line-height: var(--line-s);
	}
	.panel-toggle {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-xs);
		padding: var(--space-xs) var(--space-s);
		font-size: var(--size-s);
		font-weight: var(--weight-ui-medium);
		color: var(--text);
		background: transparent;
		border: none;
	}
	.panel-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
		padding: var(--space-s);
	}
	.hint-row {
		margin: 0;
		font-size: var(--size-xs);
		line-height: var(--line-xs);
		color: var(--muted);
	}
	/* The canvas preview (#270): backdrop around a white card. */
	.be-canvas.has-canvas {
		background: var(--cv-backdrop, #ffffff);
	}
	.be-canvas.has-canvas .be-doc {
		max-width: var(--cv-width, 600px);
		margin: 0 auto;
		background: #ffffff;
		border-radius: var(--cv-radius, 0);
		padding: var(--space-s);
	}
	@media (max-width: 768px) {
		/* No containment here: it would trap the fixed sheet inside the editor box. */
		.be {
			container-type: normal;
		}
		.be-body.editing {
			padding-bottom: 56px;
		}
		.be-body.editing .be-panel {
			position: fixed;
			top: auto;
			left: 0;
			right: 0;
			bottom: var(--sticky-actions-bottom, 0px); /* #520: above a StickyActions bar */
			z-index: 25;
			max-height: 60vh;
			border-radius: var(--radius-m) var(--radius-m) 0 0;
			padding-bottom: env(safe-area-inset-bottom, 0px);
			box-shadow: var(--border-shadow-s), var(--shadow-m);
		}
		.be-body.editing .be-panel.open {
			height: 60vh;
		}
		.be-panel:not(.open) .panel-body {
			display: none;
		}
		.be-body.editing .be-panel.dormant {
			display: none;
		}
		.panel-toggle {
			display: flex;
			min-height: 44px;
		}
		/* Lift the help button clear of the collapsed sheet's bar. */
		:global(body:has(.be-body.editing) .hp-fab) {
			bottom: calc(44px + var(--space-m));
		}
	}
	/* #524: quiet chrome — typing fades the controls (150ms); the StickyActions bar sits
	   outside the editor and never fades. No animation under reduced motion. */
	.be-handle,
	.be-bar,
	.be-canvas :global(.be-fmt),
	.be-panel {
		transition: opacity 150ms ease;
	}
	.be.quiet .be-handle,
	.be.quiet .be-bar,
	.be.quiet .be-canvas :global(.be-fmt),
	.be.quiet .be-panel {
		opacity: 0;
		pointer-events: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.be-handle,
		.be-bar,
		.be-canvas :global(.be-fmt),
		.be-panel {
			transition: none;
		}
	}
	/* #523: Write mode. The app chrome is hidden by the root layout (html[data-write-mode]);
	   here: the toggle, the tip line off, a centred wider page with larger editing type
	   (overrides only — never written to the canvas JSON), and the Design panel folded to a
	   tab on the right edge. No zoom / transform: the handle, menus and link bubble place
	   themselves from client rects. Phones keep the #270 bottom sheet. */
	.write-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-xxs);
		padding: var(--space-xxs) var(--space-s);
		font-size: var(--size-s);
		line-height: var(--line-s);
		color: var(--muted);
		background: var(--bg);
		border: none;
		border-radius: var(--radius-s);
		box-shadow: 0 0 0 var(--border-s) var(--border);
	}
	.write-btn:hover {
		filter: none;
		color: var(--text);
	}
	.write-btn.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 0 0 var(--border-s) var(--border), var(--shadow-s);
	}
	.panel-tab {
		display: none;
	}
	.be.write .be-tip {
		display: none;
	}
	/* #525: Writing preferences (Write mode only, editor only). Serif drafting face: body text
	   (incl. sections) takes --be-draft-font instead of --cv-font; headings keep --cv-hfont,
	   else the sans body face. */
	.be.serif .be-doc :global(.pm-doc),
	.be.serif .be-doc :global(.pm-section) {
		font-family: var(--be-draft-font);
	}
	.be.serif .be-doc :global(.pm-doc :is(h1, h2, h3)) {
		font-family: var(--cv-hfont, var(--cv-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif));
	}
	/* Focus paragraph: every top-level block but the current one (pm-dim, a decoration). */
	.be.write .be-doc :global(.pm-doc > *) {
		transition: opacity 150ms ease;
	}
	.be.write .be-doc :global(.pm-doc > .pm-dim) {
		opacity: 0.35;
	}
	@media (prefers-reduced-motion: reduce) {
		.be.write .be-doc :global(.pm-doc > *) {
			transition: none;
		}
	}
	.be-words {
		margin: var(--space-s) 0 0;
		font-size: var(--size-s);
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.be.write .be-canvas:not(.has-canvas) .be-words {
		max-width: 720px;
		margin-inline: auto;
	}
	@media (min-width: 769px) {
		/* A fixed panel must escape the editor box (containment would trap it). */
		.be.write {
			container-type: normal;
		}
		.be.write .be-body.editing {
			grid-template-columns: minmax(0, 1fr);
		}
		.be.write .be-canvas {
			width: 100%;
			max-width: 960px;
			margin-inline: auto;
			padding-top: var(--space-xl);
			padding-bottom: var(--space-xl);
		}
		.be.write .be-doc {
			--cv-size: 18px;
			--cv-lh: 1.65;
		}
		.be.write .be-canvas:not(.has-canvas) .be-doc {
			max-width: 720px;
			margin-inline: auto;
		}
		.be.write .be-body.editing .be-panel {
			order: 0;
			position: fixed;
			top: var(--be-sticky-top);
			right: 0;
			z-index: 20;
			width: auto;
			max-height: calc(100vh - var(--be-sticky-top) - var(--space-s));
			overflow: visible;
			border-radius: var(--radius-m) 0 0 var(--radius-m);
			box-shadow: var(--border-shadow-s), var(--shadow-s);
		}
		/* Collapsed, the tab sits mid-height on the edge, clear of the page header and the
		   editor bar; opened, the panel runs from the sticky top so it can scroll. */
		.be.write .be-body.editing .be-panel:not(.tab-open) {
			top: 50%;
			transform: translateY(-50%);
		}
		.be.write .be-body.editing .be-panel.dormant {
			display: none;
		}
		.be.write .be-body.editing .be-panel.tab-open {
			width: 320px;
			overflow: auto;
			box-shadow: var(--border-shadow-s), var(--shadow-m);
		}
		.be.write .be-panel .panel-toggle {
			display: none;
		}
		.be.write .be-panel:not(.tab-open) .panel-body {
			display: none;
		}
		.be.write .be-panel.tab-open .panel-body {
			display: flex;
		}
		.be.write .panel-tab {
			display: flex;
			align-items: center;
			gap: var(--space-xxs);
			padding: var(--space-s) var(--space-xs);
			font-size: var(--size-s);
			font-weight: var(--weight-ui-medium);
			color: var(--text);
			background: transparent;
			border: none;
			writing-mode: vertical-rl;
		}
		.be.write .be-panel.tab-open .panel-tab {
			width: 100%;
			writing-mode: horizontal-tb;
			justify-content: flex-end;
			padding: var(--space-xs) var(--space-s) 0;
			color: var(--muted);
		}
	}
	.be-preview {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: var(--space-m);
		border-radius: var(--radius-m);
		background: var(--surface-subtle);
		box-shadow: var(--border-shadow-s);
		overflow-x: auto;
	}
	.be-preview iframe {
		max-width: 100%;
		height: 640px;
		border: none;
		background: #ffffff;
		border-radius: var(--radius-s);
		box-shadow: var(--shadow-s);
	}
	@media (max-width: 640px) {
		.be-canvas {
			padding: var(--space-m) var(--space-s) var(--space-m) 56px;
		}
		.be-doc :global(.pm-columns) {
			grid-template-columns: minmax(0, 1fr);
		}
		.be-doc :global(.pm-section) {
			padding: 24px 16px;
		}
		.be-doc :global(.pm-doc h1.pm-display) {
			font-size: 34px;
		}
		.be-doc :global(.pm-milestones) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	/* #330: touch needs ≥ 28px targets, so the gutter widens to fit two of them. */
	@media (pointer: coarse) {
		.be-canvas {
			padding-left: 72px;
			--be-gutter: 60px;
		}
		.hbtn {
			width: 28px;
			height: 28px;
		}
	}
	/* #261: phones get a narrow gutter; the handle (which follows the tapped block)
	   stacks its buttons instead of reserving room for them side by side. */
	@media (max-width: 480px) {
		.be-canvas {
			padding-left: 32px;
			--be-gutter: 30px;
		}
		.be-handle {
			grid-template-columns: auto;
		}
	}
</style>
