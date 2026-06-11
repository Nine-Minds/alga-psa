'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Switch } from '@alga-psa/ui/components/Switch';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  SHORTCUT_ACTION_CATALOG,
  getShortcutProfiles,
  useClientPlatform,
  useKeyboardShortcutPreferences,
  type Platform,
  type ShortcutActionCatalogEntry,
} from '@alga-psa/ui/keyboard-shortcuts';

// ── Keyboard layout (from the design handoff: variation-c KB_ROWS) ──────────
type KbCell = [label: string, value: string, units: number, kind?: 'mod'];
const KB_ROWS: KbCell[][] = [
  [['`', '`', 1], ['1', '1', 1], ['2', '2', 1], ['3', '3', 1], ['4', '4', 1], ['5', '5', 1], ['6', '6', 1], ['7', '7', 1], ['8', '8', 1], ['9', '9', 1], ['0', '0', 1], ['-', '-', 1], ['=', '=', 1], ['⌫', 'Backspace', 1.5, 'mod']],
  [['⇥', 'Tab', 1.4, 'mod'], ['Q', 'q', 1], ['W', 'w', 1], ['E', 'e', 1], ['R', 'r', 1], ['T', 't', 1], ['Y', 'y', 1], ['U', 'u', 1], ['I', 'i', 1], ['O', 'o', 1], ['P', 'p', 1], ['[', '[', 1], [']', ']', 1], ['\\', '\\', 1.1, 'mod']],
  [['⇪', 'CapsLock', 1.6, 'mod'], ['A', 'a', 1], ['S', 's', 1], ['D', 'd', 1], ['F', 'f', 1], ['G', 'g', 1], ['H', 'h', 1], ['J', 'j', 1], ['K', 'k', 1], ['L', 'l', 1], [';', ';', 1], ["'", "'", 1], ['↵ return', 'Enter', 1.9, 'mod']],
  [['⇧ shift', 'shift', 2.1, 'mod'], ['Z', 'z', 1], ['X', 'x', 1], ['C', 'c', 1], ['V', 'v', 1], ['B', 'b', 1], ['N', 'n', 1], ['M', 'm', 1], [',', ',', 1], ['.', '.', 1], ['/ ?', '/', 1], ['⇧ shift', 'shift', 2.4, 'mod']],
  [['fn', 'fn', 1, 'mod'], ['⌃ ctrl', 'ctrl', 1, 'mod'], ['⌥ opt', 'alt', 1, 'mod'], ['⌘ cmd', 'cmd', 1.25, 'mod'], ['Space', 'space', 5.5], ['⌘ cmd', 'cmd', 1.25, 'mod'], ['⌥ opt', 'alt', 1, 'mod'], ['←', 'ArrowLeft', 1], ['↓', 'ArrowDown', 1], ['↑', 'ArrowUp', 1], ['→', 'ArrowRight', 1]],
];
const KB_KEYS = new Set(KB_ROWS.flat().map((c) => c[1].toLowerCase()));

interface Layer { id: string; label: string }
const LAYERS: Layer[] = [
  { id: '', label: 'Plain' },
  { id: 'mod', label: '⌘ Mod' },
  { id: 'shift', label: '⇧ Shift' },
  { id: 'mod+shift', label: '⌘⇧' },
];

interface CatColor { fg: string; bg: string; dot: string }
const PRIMARY: CatColor = { fg: 'rgb(var(--color-primary-700))', bg: 'rgb(var(--color-primary-50))', dot: 'rgb(var(--color-primary-500))' };
const SECONDARY: CatColor = { fg: 'rgb(var(--color-secondary-900))', bg: 'rgb(var(--color-secondary-50))', dot: 'rgb(var(--color-secondary-500))' };
const GREEN: CatColor = { fg: 'rgb(22 101 52)', bg: 'rgb(220 252 231)', dot: 'rgb(34 197 94)' };
const ACCENT: CatColor = { fg: 'rgb(var(--color-accent-700))', bg: 'rgb(var(--color-accent-50))', dot: 'rgb(var(--color-accent-500))' };
const CAT_COLOR: Record<string, CatColor> = {
  global: PRIMARY, navigation: PRIMARY,
  ai: SECONDARY, editor: SECONDARY,
  page: GREEN, assets: GREEN,
  selection: ACCENT, panel: ACCENT, record: ACCENT, dialog: ACCENT,
};
const LEGEND: Array<[string, CatColor]> = [
  ['Global', PRIMARY], ['AI', SECONDARY], ['Page', GREEN], ['Selection', ACCENT],
];

function groupOf(action: ShortcutActionCatalogEntry): string {
  return action.groupKey.replace(/^groups\./, '');
}
function colorOf(action: ShortcutActionCatalogEntry): CatColor {
  return CAT_COLOR[groupOf(action)] ?? PRIMARY;
}

function splitBinding(binding: string): string[] {
  return binding.split('+').map((s) => s.trim()).filter(Boolean);
}

function keyLabel(token: string, platform: Platform): string {
  const low = token.toLowerCase();
  if (low === 'mod') return platform === 'mac' ? '⌘' : 'Ctrl';
  if (low === 'cmd' || low === 'meta') return '⌘';
  if (low === 'ctrl') return 'Ctrl';
  if (low === 'alt' || low === 'opt' || low === 'option') return platform === 'mac' ? '⌥' : 'Alt';
  if (low === 'shift') return '⇧';
  if (low === 'arrowup') return '↑';
  if (low === 'arrowdown') return '↓';
  if (low === 'arrowleft') return '←';
  if (low === 'arrowright') return '→';
  if (low === 'enter' || low === 'return') return '↵';
  if (low === 'escape' || low === 'esc') return 'Esc';
  if (low === 'space') return 'Space';
  if (low === 'tab') return '⇥';
  if (low === 'backspace') return '⌫';
  if (low === 'delete') return '⌦';
  if (token.length === 1) return token.toUpperCase();
  return token;
}

// ── Atoms ──────────────────────────────────────────────────────────────────
type CapTone = 'plain' | 'soft' | 'muted';
function KeyCap({ children, tone = 'plain', size = 'sm' }: { children: React.ReactNode; tone?: CapTone; size?: 'sm' | 'md' }) {
  const h = size === 'md' ? 24 : 20;
  const wide = String(children).length > 1;
  const palettes: Record<CapTone, React.CSSProperties> = {
    plain: { background: '#fff', color: 'rgb(var(--color-text-800))', border: '1px solid rgb(var(--color-border-300))', boxShadow: '0 1px 0 rgb(var(--color-border-300)), inset 0 -1px 0 rgb(var(--color-border-100))' },
    soft: { background: 'rgb(var(--color-primary-50))', color: 'rgb(var(--color-primary-700))', border: '1px solid rgb(var(--color-primary-200))', boxShadow: '0 1px 0 rgb(var(--color-primary-200))' },
    muted: { background: 'rgb(var(--color-border-50))', color: 'rgb(var(--color-text-500))', border: '1px dashed rgb(var(--color-border-300))' },
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: wide ? 'auto' : h, height: h, padding: `0 ${wide ? 8 : 4}px`, borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: size === 'md' ? 12 : 11, fontWeight: 500, ...palettes[tone] }}>
      {children}
    </span>
  );
}

function BindingDisplay({ binding, platform, tone = 'plain', size = 'sm', placeholder }: { binding: string; platform: Platform; tone?: CapTone; size?: 'sm' | 'md'; placeholder: string }) {
  const tokens = splitBinding(binding);
  if (!tokens.length) {
    return <span style={{ fontSize: 12, color: 'rgb(var(--color-text-400))', fontStyle: 'italic' }}>{placeholder}</span>;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
      {tokens.map((t, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: 'rgb(var(--color-text-400))', fontSize: 11 }}>+</span>}
          <KeyCap tone={tone} size={size}>{keyLabel(t, platform)}</KeyCap>
        </React.Fragment>
      ))}
    </span>
  );
}

function ScopeChip({ scope }: { scope: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 6px', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, background: 'rgb(var(--color-border-50))', color: 'rgb(var(--color-text-700))', border: '1px solid rgb(var(--color-border-200))' }}>
      {scope}
    </span>
  );
}

// ── Binding index (mirrors handoff buildBindingIndex, real catalog driven) ───
interface IndexEntry { action: ShortcutActionCatalogEntry; binding: string; conflict?: ShortcutActionCatalogEntry }
interface ChordEntry { action: ShortcutActionCatalogEntry; binding: string }

function buildIndex(resolved: Map<string, readonly string[]>) {
  const idx: Record<string, Record<string, IndexEntry>> = {};
  LAYERS.forEach((l) => { idx[l.id] = {}; });
  const chords: ChordEntry[] = [];

  for (const action of SHORTCUT_ACTION_CATALOG) {
    const bindings = resolved.get(action.id) ?? [];
    for (const binding of bindings) {
      if (!binding) continue;
      if (binding.includes(' ')) { chords.push({ action, binding }); continue; }
      const parts = splitBinding(binding);
      const mods = parts.slice(0, -1).map((p) => p.toLowerCase());
      const key = (parts[parts.length - 1] ?? '').toLowerCase();
      if (mods.some((m) => m === 'alt' || m === 'opt' || m === 'option')) { chords.push({ action, binding }); continue; }
      let layer = '';
      if (mods.some((m) => m === 'mod' || m === 'cmd' || m === 'ctrl' || m === 'meta')) layer = 'mod';
      if (mods.includes('shift')) layer = layer ? `${layer}+shift` : 'shift';
      if (!(layer in idx) || !KB_KEYS.has(key)) { chords.push({ action, binding }); continue; }
      const existing = idx[layer][key];
      if (existing) { existing.conflict = action; }
      else { idx[layer][key] = { action, binding }; }
    }
  }
  return { idx, chords };
}

// ── Real keydown capture → neutral binding string ───────────────────────────
function tokenFromEvent(e: KeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (e.code === 'BracketLeft') return '[';
  if (e.code === 'BracketRight') return ']';
  if (/^F([1-9]|1[0-2])$/.test(e.code)) return e.code.toLowerCase();
  if (['Enter', 'Escape', 'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) return e.key;
  if (e.key.length === 1) return e.key;
  return null;
}
function bindingFromEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const token = tokenFromEvent(e);
  if (!token) return null;
  const mods: string[] = [];
  if (e.metaKey || e.ctrlKey) mods.push('mod');
  if (e.altKey) mods.push('alt');
  const shiftIsExplicit =
    token.length !== 1 ||
    /^Key[A-Z]$/.test(e.code) ||
    /^Digit[0-9]$/.test(e.code) ||
    e.code === 'BracketLeft' ||
    e.code === 'BracketRight';
  if (e.shiftKey && shiftIsExplicit) {
    mods.push('shift');
  }
  return [...mods, token].join('+');
}

interface PendingConflict { target: ShortcutActionCatalogEntry; binding: string; other: ShortcutActionCatalogEntry }

export default function KeyboardShortcutsPanel(): React.JSX.Element {
  const { t } = useTranslation('msp/keyboard-shortcuts');
  const platform = useClientPlatform('other');
  const prefs = useKeyboardShortcutPreferences();
  const profiles = getShortcutProfiles();

  const [layer, setLayer] = useState('');
  const [hover, setHover] = useState<IndexEntry | ChordEntry | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [capture, setCapture] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const captureRef = useRef<string | null>(null);
  captureRef.current = capture;

  const resolved = useMemo(() => {
    const map = new Map<string, readonly string[]>();
    for (const a of SHORTCUT_ACTION_CATALOG) map.set(a.id, prefs.getResolvedBindings(a.id));
    return map;
  }, [prefs]);

  const { idx, chords } = useMemo(() => buildIndex(resolved), [resolved]);
  const layerBindings = idx[layer] ?? {};
  const layerCounts = useMemo(() => {
    const c: Record<string, number> = {};
    LAYERS.forEach((l) => { c[l.id] = Object.keys(idx[l.id] ?? {}).length; });
    return c;
  }, [idx]);

  const q = query.trim().toLowerCase();
  const visibleChords = chords.filter((c) => {
    if (!q) return true;
    return t(c.action.labelKey, { defaultValue: c.action.id }).toLowerCase().includes(q) || c.binding.toLowerCase().includes(q);
  });

  const isModified = useCallback((id: string) => Boolean(prefs.preferences.bindings[id]), [prefs.preferences.bindings]);
  const activeProfileName = profiles.find((p) => p.id === prefs.profile)?.name ?? 'Default';

  const focus = hover ?? (selectedKey ? layerBindings[selectedKey] ?? null : null);

  const commitBinding = useCallback((target: ShortcutActionCatalogEntry, binding: string, unbindOther?: ShortcutActionCatalogEntry) => {
    try {
      if (unbindOther) prefs.setActionBindings(unbindOther.id, []);
      prefs.setActionBindings(target.id, [binding]);
      toast.success(t('settings.messages.bindingUpdated', { defaultValue: 'Shortcut updated' }));
    } catch (error) {
      handleError(error, t('settings.errors.saveFailed', { defaultValue: 'Failed to save keyboard shortcut' }));
    }
  }, [prefs, t]);

  // Real keydown capture while rebinding.
  useEffect(() => {
    if (!capture) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (captureRef.current !== capture) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') { setCapture(null); return; }
      const binding = bindingFromEvent(e);
      if (!binding) return;
      const target = SHORTCUT_ACTION_CATALOG.find((a) => a.id === capture);
      if (!target) { setCapture(null); return; }
      const other = SHORTCUT_ACTION_CATALOG.find((a) => a.id !== target.id && (resolved.get(a.id) ?? []).includes(binding));
      if (other) { setPendingConflict({ target, binding, other }); setCapture(null); return; }
      commitBinding(target, binding);
      setCapture(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capture, commitBinding, resolved]);

  const buildCheatsheetGroups = useCallback(() => {
    const groups = new Map<string, Array<{ name: string; binding: string }>>();
    for (const a of SHORTCUT_ACTION_CATALOG) {
      const list = groups.get(a.groupKey) ?? [];
      const b = (resolved.get(a.id) ?? []).map((x) => splitBinding(x).map((tk) => keyLabel(tk, platform)).join('+')).join(' / ');
      list.push({ name: t(a.labelKey, { defaultValue: a.id }), binding: b || '—' });
      groups.set(a.groupKey, list);
    }
    return groups;
  }, [platform, resolved, t]);

  const copyCheatsheet = useCallback(async () => {
    const groups = buildCheatsheetGroups();
    const title = t('settings.title', { defaultValue: 'Keyboard Shortcuts' });
    const lines: string[] = [`# ${title}`, ''];
    for (const [gk, rows] of groups) {
      lines.push(`## ${t(gk, { defaultValue: gk.replace('groups.', '') })}`);
      for (const r of rows) lines.push(`- ${r.name}: ${r.binding}`);
      lines.push('');
    }
    const text = lines.join('\n');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('execCommand copy failed');
      }
      toast.success(t('settings.messages.cheatsheetCopied', { defaultValue: 'Cheatsheet copied to clipboard' }));
    } catch (e) {
      handleError(e, t('settings.errors.copyFailed', { defaultValue: 'Failed to copy cheatsheet' }));
    }
  }, [buildCheatsheetGroups, t]);

  const printCheatsheet = useCallback(() => {
    const groups = buildCheatsheetGroups();
    const title = t('settings.title', { defaultValue: 'Keyboard Shortcuts' });
    const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const sections = Array.from(groups.entries()).map(([gk, rows]) => `
      <section>
        <h2>${escape(t(gk, { defaultValue: gk.replace('groups.', '') }))}</h2>
        <dl>${rows.map((r) => `<dt>${escape(r.name)}</dt><dd><kbd>${escape(r.binding)}</kbd></dd>`).join('')}</dl>
      </section>
    `).join('');
    const win = window.open('', '_blank');
    if (!win) {
      handleError(new Error('popup blocked'), t('settings.errors.printFailed', { defaultValue: 'Unable to open print window. Allow pop-ups and try again.' }));
      return;
    }
    const styles = `
      @page { size: letter; margin: 0.4in; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font: 10.5px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; color: #111; padding: 0; }
      header { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1px solid #222; padding-bottom: 4px; margin-bottom: 8px; }
      h1 { font-size: 14px; margin: 0; letter-spacing: -0.01em; }
      header .meta { font-size: 9px; color: #666; }
      .grid { column-count: 2; column-gap: 18px; column-rule: 1px solid #eee; }
      section { break-inside: avoid; page-break-inside: avoid; margin: 0 0 10px; }
      h2 { font-size: 9px; margin: 0 0 3px; text-transform: uppercase; letter-spacing: 0.08em; color: #555; border-bottom: 1px solid #eee; padding-bottom: 2px; }
      dl { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; margin: 0; }
      dt { font-size: 10.5px; color: #222; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      dd { margin: 0; font-size: 10px; color: #111; text-align: right; white-space: nowrap; }
      kbd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9.5px; background: #f4f4f5; border: 1px solid #d4d4d8; border-bottom-width: 2px; border-radius: 3px; padding: 1px 5px; }
      @media print { header .meta { display: none; } }
    `;
    win.document.write(`<!doctype html><html><head><title>${escape(title)}</title><style>${styles}</style></head><body><header><h1>${escape(title)}</h1><span class="meta">${escape(new Date().toLocaleDateString())}</span></header><div class="grid">${sections}</div></body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch { /* noop */ } }, 50);
  }, [buildCheatsheetGroups, t]);

  if (!prefs.preferencesLoaded) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingIndicator layout="stacked" text={t('settings.loading', { defaultValue: 'Loading keyboard shortcuts…' })} spinnerProps={{ size: 'md' }} />
      </div>
    );
  }

  const UNIT = 44;
  const GAP = 4;

  return (
    <div id="keyboard-shortcuts-panel" style={{ display: 'flex', flexDirection: 'column', border: '1px solid rgb(var(--color-border-200))', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'rgb(var(--color-card))' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid rgb(var(--color-border-200))' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: 'rgb(var(--color-text-900))', letterSpacing: '-0.01em' }}>
            {t('settings.title', { defaultValue: 'Keyboard shortcuts' })}
          </div>
          <div style={{ fontSize: 13, color: 'rgb(var(--color-text-500))' }}>
            {t('settings.description', { defaultValue: 'Customize keyboard shortcuts for your account.' })}
          </div>
        </div>
        <div style={{ display: 'inline-flex', gap: 2, padding: 3, background: 'rgb(var(--color-border-50))', border: '1px solid rgb(var(--color-border-200))', borderRadius: 'var(--radius-md)' }}>
          {profiles.map((p) => (
            <button
              key={p.id}
              id={`keyboard-shortcuts-profile-${p.id}`}
              type="button"
              onClick={() => { try { prefs.setProfile(p.id); toast.success(t('settings.messages.profileChanged', { defaultValue: 'Profile changed' })); } catch (e) { handleError(e, t('settings.errors.saveFailed', { defaultValue: 'Failed to save keyboard shortcut' })); } }}
              style={{ border: 0, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500, borderRadius: 'var(--radius-sm)', background: prefs.profile === p.id ? 'rgb(var(--color-primary-500))' : 'transparent', color: prefs.profile === p.id ? 'rgb(var(--color-primary-50))' : 'rgb(var(--color-text-700))' }}
            >
              {t(p.nameKey, { defaultValue: p.name })}
            </button>
          ))}
        </div>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <button
            id="keyboard-shortcuts-copy"
            type="button"
            onClick={copyCheatsheet}
            style={{ height: 30, padding: '0 12px', border: '1px solid rgb(var(--color-border-300))', background: 'rgb(var(--color-card))', color: 'rgb(var(--color-text-700))', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >
            {t('settings.actions.copyCheatsheet', { defaultValue: 'Copy cheatsheet' })}
          </button>
          <button
            id="keyboard-shortcuts-print"
            type="button"
            onClick={printCheatsheet}
            style={{ height: 30, padding: '0 12px', border: '1px solid rgb(var(--color-border-300))', background: 'rgb(var(--color-card))', color: 'rgb(var(--color-text-700))', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >
            {t('settings.actions.printCheatsheet', { defaultValue: 'Print' })}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', minHeight: 0 }}>
        {/* Keyboard area */}
        <div style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12, background: 'rgb(var(--color-border-50))', borderRight: '1px solid rgb(var(--color-border-200))', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'inline-flex', gap: 2, padding: 3, background: 'rgb(var(--color-card))', border: '1px solid rgb(var(--color-border-200))', borderRadius: 'var(--radius-md)' }}>
              {LAYERS.map((l) => (
                <button
                  key={l.id}
                  id={`keyboard-shortcuts-layer-${l.id || 'plain'}`}
                  type="button"
                  onClick={() => { setLayer(l.id); setSelectedKey(null); }}
                  style={{ border: 0, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500, borderRadius: 'var(--radius-sm)', display: 'inline-flex', alignItems: 'center', gap: 6, background: layer === l.id ? 'rgb(var(--color-primary-500))' : 'transparent', color: layer === l.id ? 'rgb(var(--color-primary-50))' : 'rgb(var(--color-text-700))' }}
                >
                  <span>{l.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '0 6px', borderRadius: 999, minWidth: 16, textAlign: 'center', background: layer === l.id ? 'rgb(var(--color-primary-700))' : 'rgb(var(--color-border-100))', color: layer === l.id ? 'rgb(var(--color-primary-50))' : 'rgb(var(--color-text-600))' }}>
                    {layerCounts[l.id]}
                  </span>
                </button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {LEGEND.map(([label, col]) => (
                <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgb(var(--color-text-600))' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: col.dot }} />
                  {t(`legend.${label.toLowerCase()}`, { defaultValue: label })}
                </span>
              ))}
            </div>
          </div>

          {/* Keyboard */}
          <div style={{ background: 'rgb(var(--color-card))', border: '1px solid rgb(var(--color-border-200))', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: GAP, boxShadow: '0 2px 6px rgba(15,23,42,0.04)' }}>
            {KB_ROWS.map((row, ri) => (
              <div key={ri} style={{ display: 'flex', gap: GAP }}>
                {row.map((cell, ci) => {
                  const [label, value, units, kind] = cell;
                  const w = units * UNIT + (units - 1) * GAP;
                  const entry = layerBindings[value.toLowerCase()];
                  const isBound = Boolean(entry);
                  const isSelected = selectedKey === value.toLowerCase();
                  const col = entry ? colorOf(entry.action) : null;
                  let bg = 'linear-gradient(180deg,#fff,rgb(var(--color-border-50)))';
                  let color = 'rgb(var(--color-text-700))';
                  let border = '1px solid rgb(var(--color-border-300))';
                  let shadow = '0 1px 0 rgb(var(--color-border-300)), inset 0 1px 0 rgb(255 255 255 / 0.5)';
                  let cursor = 'default';
                  if (kind === 'mod') { bg = 'rgb(var(--color-border-100))'; color = 'rgb(var(--color-text-500))'; border = '1px solid rgb(var(--color-border-200))'; }
                  if (isBound && col) { bg = col.bg; color = col.fg; border = `1px solid ${col.dot}`; shadow = `0 1px 0 ${col.dot}, inset 0 1px 0 rgb(255 255 255 / 0.7)`; cursor = 'pointer'; }
                  if (isSelected && isBound && col) { border = `2px solid ${col.dot}`; shadow = `0 0 0 3px ${col.dot}33, ${shadow}`; }
                  return (
                    <div
                      key={ci}
                      onMouseEnter={() => entry && setHover(entry)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => entry && setSelectedKey(value.toLowerCase())}
                      style={{ width: w, height: 44, background: bg, color, border, borderRadius: 'var(--radius-md)', boxShadow: shadow, cursor, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between', padding: '4px 6px', position: 'relative', overflow: 'hidden' }}
                    >
                      <span style={{ fontWeight: isBound ? 600 : 500, fontSize: kind === 'mod' ? 10 : 12, lineHeight: 1 }}>{label}</span>
                      {isBound && (
                        <span style={{ fontSize: 9, fontWeight: 600, lineHeight: 1, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t(entry!.action.labelKey, { defaultValue: entry!.action.id })}
                        </span>
                      )}
                      {entry?.conflict && (
                        <span title={t('settings.conflict.indicator', { defaultValue: 'Conflicts with another action' })} style={{ position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: 999, background: 'rgb(var(--color-destructive))', boxShadow: '0 0 0 2px rgb(var(--color-card))' }} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Status / hint strip */}
          <div style={{ padding: '10px 14px', background: 'rgb(var(--color-card))', border: '1px solid rgb(var(--color-border-200))', borderRadius: 'var(--radius-md)', minHeight: 60, display: 'flex', alignItems: 'center', gap: 14 }}>
            {focus ? (
              <KeyDetail
                entry={focus}
                platform={platform}
                modified={isModified(focus.action.id)}
                enabled={!prefs.isActionDisabled(focus.action.id)}
                capturing={capture === focus.action.id}
                onRebind={() => setCapture(capture === focus.action.id ? null : focus.action.id)}
                onReset={() => { try { prefs.resetAction(focus.action.id); toast.success(t('settings.messages.resetOne', { defaultValue: 'Shortcut reset' })); } catch (e) { handleError(e, t('settings.errors.saveFailed', { defaultValue: 'Failed to save keyboard shortcut' })); } }}
                onToggleEnabled={(v) => { try { prefs.setActionDisabled(focus.action.id, !v); } catch (e) { handleError(e, t('settings.errors.saveFailed', { defaultValue: 'Failed to save keyboard shortcut' })); } }}
                t={t}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'rgb(var(--color-text-500))', fontSize: 13 }}>
                {t('settings.hint', { defaultValue: 'Hover a key to preview, click to rebind. Toggle modifier layers above to see prefixed shortcuts.' })}
                <span style={{ fontSize: 11, color: 'rgb(var(--color-text-400))' }}>
                  {t('settings.modHint', {
                    modKey: platform === 'mac' ? '⌘' : 'Ctrl',
                    defaultValue: 'mod resolves to {{modKey}} on this device',
                  })}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right rail: chords */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid rgb(var(--color-border-200))', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'rgb(var(--color-text-700))', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {t('settings.chords.title', { defaultValue: 'Chord shortcuts' })}
              <span style={{ color: 'rgb(var(--color-text-400))', fontWeight: 500, marginLeft: 4 }}>{visibleChords.length}</span>
            </div>
            <input
              id="keyboard-shortcuts-chord-search"
              placeholder={t('settings.chords.search', { defaultValue: 'Search…' })}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: '100%', height: 28, padding: '0 8px', fontFamily: 'var(--font-sans)', fontSize: 12, color: 'rgb(var(--color-text-800))', background: 'rgb(var(--color-border-50))', border: '1px solid rgb(var(--color-border-200))', borderRadius: 'var(--radius-md)', outline: 'none' }}
            />
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '4px 6px 16px', maxHeight: 360 }}>
            {visibleChords.map((c) => {
              const col = colorOf(c.action);
              const mod = isModified(c.action.id);
              return (
                <div
                  key={`${c.action.id}:${c.binding}`}
                  onMouseEnter={() => setHover(c)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setHover(c)}
                  style={{ padding: '8px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 5, height: 5, borderRadius: 999, background: col.dot }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'rgb(var(--color-text-900))', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t(c.action.labelKey, { defaultValue: c.action.id })}
                    </span>
                    {mod && <span style={{ width: 5, height: 5, borderRadius: 999, background: 'rgb(var(--color-accent-500))' }} />}
                  </div>
                  <BindingDisplay binding={c.binding} platform={platform} size="sm" tone={mod ? 'soft' : 'plain'} placeholder={t('settings.notSet', { defaultValue: 'Not set' })} />
                </div>
              );
            })}
            {visibleChords.length === 0 && (
              <div style={{ padding: 18, fontSize: 12, color: 'rgb(var(--color-text-500))', textAlign: 'center' }}>
                {t('settings.chords.empty', { defaultValue: 'No chords match.' })}
              </div>
            )}
          </div>
          <div style={{ padding: '10px 14px', borderTop: '1px solid rgb(var(--color-border-200))', background: 'rgb(var(--color-border-50))' }}>
            <button
              id="keyboard-shortcuts-reset-all"
              type="button"
              onClick={() => setResetAllOpen(true)}
              style={{ width: '100%', height: 30, border: '1px solid rgb(var(--color-border-300))', background: 'rgb(var(--color-card))', color: 'rgb(var(--color-text-700))', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
            >
              {t('settings.actions.resetAllTo', { defaultValue: 'Reset all to {{profile}}', profile: activeProfileName })}
            </button>
          </div>
        </div>
      </div>

      <ConfirmationDialog
        id="keyboard-shortcuts-reset-all-confirmation"
        isOpen={resetAllOpen}
        onClose={() => setResetAllOpen(false)}
        onConfirm={() => { try { prefs.resetAllShortcuts(); toast.success(t('settings.messages.resetAll', { defaultValue: 'Keyboard shortcuts reset' })); } catch (e) { handleError(e, t('settings.errors.saveFailed', { defaultValue: 'Failed to save keyboard shortcut' })); } setResetAllOpen(false); }}
        title={t('settings.resetAll.title', { defaultValue: 'Reset all shortcuts?' })}
        message={t('settings.resetAll.message', { defaultValue: 'All custom keyboard shortcuts will be removed and restored to the {{profile}} profile.', profile: activeProfileName })}
        confirmLabel={t('settings.actions.resetAll', { defaultValue: 'Reset all' })}
      />
      <ConfirmationDialog
        id="keyboard-shortcuts-conflict-confirmation"
        isOpen={pendingConflict !== null}
        onClose={() => setPendingConflict(null)}
        onConfirm={() => { if (pendingConflict) commitBinding(pendingConflict.target, pendingConflict.binding, pendingConflict.other); setPendingConflict(null); }}
        title={t('settings.conflict.title', { defaultValue: 'Reassign shortcut?' })}
        message={pendingConflict ? t('settings.conflict.message', {
          defaultValue: '{{binding}} is already assigned to {{action}}. Reassign it and leave {{action}} unbound?',
          binding: pendingConflict.binding,
          action: t(pendingConflict.other.labelKey, { defaultValue: pendingConflict.other.id }),
        }) : ''}
        confirmLabel={t('settings.actions.reassign', { defaultValue: 'Reassign' })}
      />
    </div>
  );
}

function KeyDetail({ entry, platform, modified, enabled, capturing, onRebind, onReset, onToggleEnabled, t }: {
  entry: IndexEntry | ChordEntry;
  platform: Platform;
  modified: boolean;
  enabled: boolean;
  capturing: boolean;
  onRebind: () => void;
  onReset: () => void;
  onToggleEnabled: (value: boolean) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const action = entry.action;
  const col = colorOf(action);
  return (
    <>
      <div style={{ width: 4, alignSelf: 'stretch', background: col.dot, borderRadius: 4 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'rgb(var(--color-text-900))' }}>{t(action.labelKey, { defaultValue: action.id })}</span>
          <ScopeChip scope={action.scope} />
          {modified && (
            <span style={{ fontSize: 10, fontWeight: 600, color: 'rgb(var(--color-accent-700))', background: 'rgb(var(--color-accent-50))', padding: '1px 5px', borderRadius: 4 }}>
              {t('settings.modified', { defaultValue: 'Modified' })}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'rgb(var(--color-text-600))', marginTop: 2 }}>
          {t(action.descriptionKey ?? action.labelKey, { defaultValue: action.id })}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Switch
          id={`keyboard-shortcut-enabled-${action.id.replace(/\./g, '-')}`}
          checked={enabled}
          onCheckedChange={(v) => onToggleEnabled(Boolean(v))}
        />
        <div style={{ fontSize: 11, color: 'rgb(var(--color-text-500))', marginLeft: 4 }}>{t('settings.boundTo', { defaultValue: 'Bound to' })}</div>
        <BindingDisplay binding={entry.binding} platform={platform} size="md" tone={modified ? 'soft' : 'plain'} placeholder={t('settings.notSet', { defaultValue: 'Not set' })} />
        <button
          id={`keyboard-shortcut-rebind-${action.id.replace(/\./g, '-')}`}
          type="button"
          onClick={onRebind}
          style={{ height: 28, padding: '0 10px', border: '1px solid rgb(var(--color-border-300))', background: capturing ? 'rgb(var(--color-primary-50))' : 'rgb(var(--color-card))', color: 'rgb(var(--color-text-700))', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
        >
          {capturing ? t('settings.capturePrompt', { defaultValue: 'Press keys…' }) : t('settings.actions.rebind', { defaultValue: 'Rebind' })}
        </button>
        {modified && (
          <button
            id={`keyboard-shortcut-reset-${action.id.replace(/\./g, '-')}`}
            type="button"
            onClick={onReset}
            title={t('settings.actions.reset', { defaultValue: 'Reset' })}
            style={{ width: 28, height: 28, border: '1px solid rgb(var(--color-border-300))', background: 'rgb(var(--color-card))', color: 'rgb(var(--color-text-600))', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            ↺
          </button>
        )}
      </div>
    </>
  );
}
