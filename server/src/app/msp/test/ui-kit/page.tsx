'use client';

import React, { useState } from 'react';
import { useTheme } from 'next-themes';
import { THEME_PAIRS } from '@alga-psa/tenancy/lib/themePairs';

// Buttons
import { Button } from '@alga-psa/ui/components/Button';
// Badge
import { Badge } from '@alga-psa/ui/components/Badge';
// Card
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@alga-psa/ui/components/Card';
// Input
import { Input } from '@alga-psa/ui/components/Input';
// TextArea
import { TextArea } from '@alga-psa/ui/components/TextArea';
// Label
import { Label } from '@alga-psa/ui/components/Label';
// Checkbox
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
// Switch
import { Switch } from '@alga-psa/ui/components/Switch';
// RadioGroup
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
// CustomSelect
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
// Tabs
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@alga-psa/ui/components/Tabs';
// Separator
import { Separator } from '@alga-psa/ui/components/Separator';
// Skeleton
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
// Tooltip
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
// Dialog
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
// Popover
import { Popover, PopoverTrigger, PopoverContent } from '@alga-psa/ui/components/Popover';
// DropdownMenu
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@alga-psa/ui/components/DropdownMenu';
// TextEditor — the real rich-text editor, so the .editor-paper well below is the
// one users actually type into rather than a div wearing its class.
import { TextEditor } from '@alga-psa/ui/editor';
// DataTable — the real table, so row/status colours are inspected in situ.
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
// Real skeleton components — rendered rather than mimed, so this page cannot
// drift from what the app actually shows while loading.
import ChartSkeleton from '@alga-psa/ui/components/skeletons/ChartSkeleton';
import TaskFormSkeleton from '@alga-psa/ui/components/skeletons/TaskFormSkeleton';
import SettingsTabSkeleton from '@alga-psa/ui/components/skeletons/SettingsTabSkeleton';
// BentoTile — the ticket grid surface (110 render sites)
import { BentoTile } from '@alga-psa/ui/components/bento';
// EmptyState
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
// Alert
import { Alert, AlertTitle, AlertDescription } from '@alga-psa/ui/components/Alert';
// Icons
import { ContentCard } from '@alga-psa/ui/components'; 
import {

  Sun, Moon, Monitor, ChevronDown, Settings,
  Plus, Trash2, Edit, Check,
  Inbox, MoreVertical, Copy, Download, Share2,                                                               
  Package, Users, Eye, Star 
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Section wrapper
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="text-xl font-semibold text-[rgb(var(--color-text-900))] mb-4 pb-2 border-b border-[rgb(var(--color-border-200))]">
        {title}
      </h2>
      <div className="space-y-6">{children}</div>
    </section>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Contrast review
//
// Every foreground/background token pair still measuring under WCAG AA 4.5:1
// somewhere in the app, rendered live. The ratio is computed from the BROWSER's
// resolved colours, not from a table baked in here — so switch mode or pair
// above and every number below re-measures against what is actually painted.
// ─────────────────────────────────────────────────────────────────────────────

interface ContrastOccurrence { el: string; file: string; line: number }
interface ContrastPair {
  fg: string;
  bg: string;
  fgA?: number;
  bgA?: number;
  /** chip = brand text on a same-family tint · muted = text on a subtle surface */
  group: 'chip' | 'muted' | 'other';
  staticWorst: number;
  worstTheme: string;
  occ: ContrastOccurrence[];
}

const CONTRAST_REVIEW: ContrastPair[] = [
  // Empty: the audit reports 0 of 114 token fg/bg sites below AA in any of the
  // 18 theme-modes. Add an entry only to stage a newly-found pair for review.
];

function parseRgb(v: string): [number, number, number] | null {
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[\s,\/]+/).map(Number).filter((n) => !Number.isNaN(n));
  return p.length >= 3 ? [p[0], p[1], p[2]] : null;
}
function chan(c: number) {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}
function lum(c: [number, number, number]) {
  return 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
}
function ratioOf(a: [number, number, number], b: [number, number, number]) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Flatten a translucent fill onto what sits behind it, the way the screen does. */
function composite(c: [number, number, number], on: [number, number, number], a: number): [number, number, number] {
  return [0, 1, 2].map((i) => Math.round(a * c[i] + (1 - a) * on[i])) as [number, number, number];
}

function ContrastRow({ pair, themeKey }: { pair: ContrastPair; themeKey: string }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [live, setLive] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const root = getComputedStyle(document.documentElement);
    const read = (token: string) => parseRgb(`rgb(${root.getPropertyValue(token).trim()})`);
    const card = read('--color-card') ?? [255, 255, 255];
    let fg = read(pair.fg);
    let bg = read(pair.bg);
    if (!fg || !bg) { setLive(null); return; }
    if (pair.bgA) bg = composite(bg, card, pair.bgA);
    if (pair.fgA) fg = composite(fg, bg, pair.fgA);
    setLive(ratioOf(fg, bg));
    void cs;
  }, [pair, themeKey]);

  const bgCss = pair.bgA
    ? `rgb(var(${pair.bg}) / ${pair.bgA})`
    : `rgb(var(${pair.bg}))`;
  const fgCss = pair.fgA
    ? `rgb(var(${pair.fg}) / ${pair.fgA})`
    : `rgb(var(${pair.fg}))`;
  const band = live === null ? 'unknown' : live < 3 ? 'severe' : live < 4.5 ? 'muted' : 'passes';
  const bandColor =
    band === 'severe' ? 'rgb(var(--color-status-error))'
    : band === 'muted' ? 'rgb(var(--color-status-warning))'
    : 'rgb(var(--color-status-success))';

  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-[rgb(var(--color-border-200))] last:border-b-0">
      <div ref={ref} className="rounded px-3 py-2 text-sm min-w-[220px]"
           style={{ background: bgCss, color: fgCss }}>
        The quick brown fox — 14px
      </div>
      <div className="w-16 text-right text-sm font-mono" style={{ color: bandColor }}>
        {live === null ? '—' : `${live.toFixed(2)}:1`}
      </div>
      <div className="w-20 text-[10px] uppercase tracking-wide text-[rgb(var(--color-text-400))]">
        {pair.group}
      </div>
      <div className="flex-1 min-w-0 text-xs text-[rgb(var(--color-text-500))]">
        <div className="truncate">
          <code>{pair.fg.replace('--color-', '')}{pair.fgA ? `/${pair.fgA}` : ''}</code>
          {' on '}
          <code>{pair.bg.replace('--color-', '')}{pair.bgA ? `/${pair.bgA}` : ''}</code>
          <span className="opacity-70"> · worst {pair.staticWorst}:1 in {pair.worstTheme}</span>
        </div>
        <div className="opacity-80 mt-0.5 flex flex-wrap gap-x-3">
          {pair.occ.map((o) => (
            <span key={`${o.file}:${o.line}`} className="whitespace-nowrap">
              <code>{o.el}</code> in {o.file}:{o.line}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

interface DemoRow { id: string; title: string; client: string; status: string; state?: string }

// Shaped like a real ticket list so the table is exercised the way the app uses it.
const demoRows: DemoRow[] = [
  { id: 'TICKET001074', title: 'Workstation freezing during shift changeover', client: 'Cascade Manufacturing', status: 'Scheduled' },
  { id: 'TICKET001073', title: 'Windows update fails repeatedly', client: 'Cascade Manufacturing', status: 'Scheduled', state: 'selected' },
  { id: 'TICKET001072', title: 'Replace failing SSD — SMART warnings', client: 'Northstar Dental', status: 'In Progress' },
  { id: 'TICKET001071', title: 'Repro Create+View bug', client: 'Queen of Hearts Ltd', status: 'Awaiting Client' },
];

const demoColumns: ColumnDefinition<DemoRow>[] = [
  { title: 'Ticket', dataIndex: 'id', width: '20%' },
  { title: 'Title', dataIndex: 'title' },
  { title: 'Client', dataIndex: 'client', width: '22%' },
  {
    title: 'Status',
    dataIndex: 'status',
    width: '16%',
    render: (value: string) => <Badge variant="default">{value}</Badge>,
  },
];

const sidebarItems = [
  { name: 'Dashboard' },
  { name: 'Tickets' },
  { name: 'Clients' },
  {
    name: 'Settings',
    subItems: ['General', 'Billing', 'Users', 'Security'],
  },
  { name: 'Projects' },
];

function SidebarDemo() {
  const [activeItem, setActiveItem] = useState<string>('Dashboard');
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  const handleClick = (name: string, hasSubItems: boolean) => {
    if (hasSubItems) {
      setOpenSubmenu(openSubmenu === name ? null : name);
    }
    setActiveItem(name);
  };

  return (
    <div className="w-56 rounded-lg overflow-hidden bg-sidebar-bg">
      <div className="p-4 text-sidebar-text">
        <div className="text-sm font-semibold mb-4">Sidebar</div>
        <div className="space-y-1">
          {sidebarItems.map((item) => (
            <div key={item.name}>
              <div
                className={`px-3 py-2 rounded text-sm cursor-pointer transition-colors text-sidebar-text hover:bg-sidebar-hover flex items-center justify-between ${
                  activeItem === item.name ? 'bg-[rgb(var(--color-primary-500)/0.2)]' : ''
                }`}
                onClick={() => handleClick(item.name, !!item.subItems)}
              >
                {item.name}
                {item.subItems && (
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${openSubmenu === item.name ? 'rotate-180' : ''}`}
                  />
                )}
              </div>
              {item.subItems && openSubmenu === item.name && (
                <div className="pl-4 space-y-1 mt-1">
                  {item.subItems.map((sub) => (
                    <div
                      key={sub}
                      className={`px-3 py-2 rounded text-sm cursor-pointer transition-colors text-sidebar-text hover:bg-sidebar-hover ${
                        activeItem === sub ? 'bg-[rgb(var(--color-primary-500)/0.2)]' : ''
                      }`}
                      onClick={() => setActiveItem(sub)}
                    >
                      {sub}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SubSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-[rgb(var(--color-text-500))] mb-3 uppercase tracking-wider">
        {label}
      </h3>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ComponentShowcasePage() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  // Theme-pair switcher. The pair is normally server-rendered onto <html> from
  // tenant settings; here we drive the same attribute directly so every surface
  // below can be checked against all nine pairs without changing tenant config.
  const [pair, setPair] = useState<string>('alga');
  React.useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme-pair');
    if (pair === 'alga') root.removeAttribute('data-theme-pair');
    else root.setAttribute('data-theme-pair', pair);
    return () => {
      if (previous) root.setAttribute('data-theme-pair', previous);
      else root.removeAttribute('data-theme-pair');
    };
  }, [pair]);

  // State for interactive components
  const [switchChecked, setSwitchChecked] = useState(false);
  const [switch2Checked, setSwitch2Checked] = useState(true);
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  const [radioValue, setRadioValue] = useState('option1');
  const [selectValue, setSelectValue] = useState('option1');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [textareaValue, setTextareaValue] = useState('');
  const [activeTab, setActiveTab] = useState('tab1');

  return (
    <div className="min-h-screen bg-[rgb(var(--color-background))] text-[rgb(var(--color-text-900))]">
      {/* Sticky header with theme toggle */}
      <div className="sticky top-0 z-50 bg-[rgb(var(--color-background))] border-b border-[rgb(var(--color-border-200))] px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[rgb(var(--color-text-900))]">
              Component Showcase
            </h1>
            <p className="text-sm text-[rgb(var(--color-text-500))]">
              Current theme: <span className="font-medium">{resolvedTheme}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              id="theme-light"
              variant={resolvedTheme === 'light' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTheme('light')}
            >
              <Sun className="h-4 w-4 mr-1" /> Light
            </Button>
            <Button
              id="theme-dark"
              variant={resolvedTheme === 'dark' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTheme('dark')}
            >
              <Moon className="h-4 w-4 mr-1" /> Dark
            </Button>
            <Button
              id="theme-system"
              variant={theme === 'system' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTheme('system')}
            >
              <Monitor className="h-4 w-4 mr-1" /> System
            </Button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-2 flex items-center gap-2 flex-wrap">
          <span className="text-xs uppercase tracking-wide text-[rgb(var(--color-text-500))] mr-1">Pair</span>
          {['alga', ...THEME_PAIRS.map((p) => p.id).filter((id) => id !== 'alga' && id !== 'custom')].map((id) => (
            <button
              key={id}
              id={`theme-pair-${id}`}
              type="button"
              onClick={() => setPair(id)}
              className={`rounded px-2 py-1 text-xs font-medium border transition-colors ${
                pair === id
                  ? 'chip-primary border-[rgb(var(--color-primary-500))]'
                  : 'bg-[rgb(var(--color-card))] text-[rgb(var(--color-text-700))] border-[rgb(var(--color-border-200))] hover:border-[rgb(var(--color-primary-400))]'
              }`}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TYPOGRAPHY / COLORS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Typography & Colors">
          <SubSection label="Text colors">
            <div className="flex flex-wrap gap-4">
              <span className="text-[rgb(var(--color-text-900))]">text-900 (Primary)</span>
              <span className="text-[rgb(var(--color-text-700))]">text-700 (Secondary)</span>
              <span className="text-[rgb(var(--color-text-500))]">text-500 (Muted)</span>
              <span className="text-[rgb(var(--color-text-300))]">text-300 (Faint)</span>
            </div>
          </SubSection>

          <SubSection label="Brand colors">
            <div className="flex flex-wrap gap-2">
              {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((shade) => (
                <div key={`primary-${shade}`} className="text-center">
                  <div
                    className="w-12 h-12 rounded-md border border-[rgb(var(--color-border-200))]"
                    style={{ backgroundColor: `rgb(var(--color-primary-${shade}))` }}
                  />
                  <span className="text-xs text-[rgb(var(--color-text-500))]">P-{shade}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((shade) => (
                <div key={`secondary-${shade}`} className="text-center">
                  <div
                    className="w-12 h-12 rounded-md border border-[rgb(var(--color-border-200))]"
                    style={{ backgroundColor: `rgb(var(--color-secondary-${shade}))` }}
                  />
                  <span className="text-xs text-[rgb(var(--color-text-500))]">S-{shade}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((shade) => (
                <div key={`accent-${shade}`} className="text-center">
                  <div
                    className="w-12 h-12 rounded-md border border-[rgb(var(--color-border-200))]"
                    style={{ backgroundColor: `rgb(var(--color-accent-${shade}))` }}
                  />
                  <span className="text-xs text-[rgb(var(--color-text-500))]">A-{shade}</span>
                </div>
              ))}
            </div>
          </SubSection>

          <SubSection label="Semantic colors">
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[rgb(var(--color-status-success))]" />
                <span className="text-sm">Success</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[rgb(var(--color-status-warning))]" />
                <span className="text-sm">Warning</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[rgb(var(--color-status-error))]" />
                <span className="text-sm">Error</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[rgb(var(--color-destructive))]" />
                <span className="text-sm">Destructive</span>
              </div>
            </div>
          </SubSection>

          <SubSection label="Background & borders">
            <div className="flex flex-wrap gap-4">
              <div className="p-4 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))]">
                <span className="text-sm">Background</span>
              </div>
              <div className="p-4 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
                <span className="text-sm">Card</span>
              </div>
              <div className="p-4 rounded-md border-2 border-[rgb(var(--color-border-100))]">
                <span className="text-sm">Border-100</span>
              </div>
              <div className="p-4 rounded-md border-2 border-[rgb(var(--color-border-200))]">
                <span className="text-sm">Border-200</span>
              </div>
              <div className="p-4 rounded-md border-2 border-[rgb(var(--color-border-400))]">
                <span className="text-sm">Border-400</span>
              </div>
              <div className="p-4 rounded-md border-2 border-[rgb(var(--color-border-600))]">
                <span className="text-sm">Border-600</span>
              </div>
            </div>
          </SubSection>

          <SubSection label="Secondary text — the retuned rung">

          <p className="text-sm text-[rgb(var(--color-text-500))] -mt-2">
            Rather than rewrite the ~470 places that read <code>text-500</code>, the rung itself moved in
            the eight pairs that failed AA against their own tinted surfaces (slate, sky, ocean, forest,
            sunset, cappuccino). Worst is now <strong>4.56:1</strong>, was 3.38:1. Ramp order is preserved
            in every pair.
          </p>
          <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] card-elevated p-4 flex flex-wrap gap-3">
            {(['card', 'background', 'border-50', 'border-100'] as const).map((bg) => (
              <div key={bg} className="rounded p-3 space-y-1" style={{ background: `rgb(var(--color-${bg}))` }}>
                <div className="text-[10px] uppercase tracking-wide text-[rgb(var(--color-text-500))]">{bg}</div>
                {(['text-500', 'text-600', 'text-700'] as const).map((fg) => (
                  <div key={fg} className="text-sm" style={{ color: `rgb(var(--color-${fg}))` }}>
                    {fg} — secondary copy
                  </div>
                ))}
              </div>
            ))}
          </div>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* BUTTONS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Buttons">
          <SubSection label="Variants">
            <div className="flex flex-wrap items-center gap-3">
              <Button id="btn-default" variant="default">Default</Button>
              <Button id="btn-secondary" variant="secondary">Secondary</Button>
              <Button id="btn-destructive" variant="destructive">Destructive</Button>
              <Button id="btn-accent" variant="accent">Accent</Button>
              <Button id="btn-outline" variant="outline">Outline</Button>
              <Button id="btn-ghost" variant="ghost">Ghost</Button>
              <Button id="btn-link" variant="link">Link</Button>
              <Button id="btn-soft" variant="soft">Soft</Button>
              <Button id="btn-dashed" variant="dashed">Dashed</Button>
            </div>
          </SubSection>

          <SubSection label="Sizes">
            <div className="flex flex-wrap items-center gap-3">
              <Button id="btn-xs" size="xs">Extra Small</Button>
              <Button id="btn-sm" size="sm">Small</Button>
              <Button id="btn-md" size="default">Default</Button>
              <Button id="btn-lg" size="lg">Large</Button>
              <Button id="btn-icon" size="icon" variant="icon"><Settings className="h-4 w-4" /></Button>
            </div>
          </SubSection>

          <SubSection label="With icons">
            <div className="flex flex-wrap items-center gap-3">
              <Button id="btn-icon-left"><Plus className="h-4 w-4 mr-2" /> Add New</Button>
              <Button id="btn-icon-del" variant="destructive"><Trash2 className="h-4 w-4 mr-2" /> Delete</Button>
              <Button id="btn-icon-edit" variant="outline"><Edit className="h-4 w-4 mr-2" /> Edit</Button>
              <Button id="btn-icon-save" variant="soft"><Check className="h-4 w-4 mr-2" /> Save</Button>
            </div>
          </SubSection>

          <SubSection label="States">
            <div className="flex flex-wrap items-center gap-3">
              <Button id="btn-disabled" disabled>Disabled</Button>
              <Button id="btn-disabled-outline" variant="outline" disabled>Disabled Outline</Button>
              <Button id="btn-disabled-ghost" variant="ghost" disabled>Disabled Ghost</Button>
            </div>
          </SubSection>

        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* BADGES */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Badges">
          <SubSection label="Variants">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="default">Default</Badge>
              <Badge variant="primary">Primary</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="error">Error</Badge>
              <Badge variant="info">Info</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="default-muted">Default Muted</Badge>
            </div>
          </SubSection>

          <SubSection label="Sizes">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="primary" size="sm">Small</Badge>
              <Badge variant="primary" size="md">Medium</Badge>
              <Badge variant="primary" size="lg">Large</Badge>
            </div>
          </SubSection>

          <SubSection label="Chips — the shipped rule">

          <p className="text-sm text-[rgb(var(--color-text-500))] -mt-2">
            51 hand-rolled badge/pill/tag styles collapsed into five classes. The fill carries the
            semantics; the lettering is <code>text-900</code>, which flips with the mode — so there is
            one rule per family and no <code>dark:</code> variant anywhere. Worst measured pair across
            all 18 theme-modes and four surfaces is <strong>9.53:1</strong>; it used to be 1.05:1.
          </p>
          <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] card-elevated p-4">
            <div className="flex flex-wrap gap-2">
              {(['chip-primary', 'chip-secondary', 'chip-accent', 'chip-neutral', 'chip-danger'] as const).map((c) => (
                <span key={c} className={`${c} inline-flex items-center rounded px-2 py-1 text-xs font-semibold`}>
                  {c}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-[rgb(var(--color-text-500))]">
              Outline is an inset ring, not a border, so a chip never changes box size — it drops into a
              ternary branch whose sibling has none. High contrast raises the tint to 22% and makes the
              ring solid, because it flattens primary and secondary to grey where a 14% tint reads as nothing.
            </p>
          </div>
          <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-app-ground))] p-4 space-y-2">
            <div className="text-xs uppercase tracking-wide text-[rgb(var(--color-text-500))]">the same chips on app-ground, card and border-50</div>
            <div className="flex flex-wrap gap-3">
              {(['card', 'border-50', 'border-100'] as const).map((bg) => (
                <div key={bg} className="rounded p-3 space-y-2" style={{ background: `rgb(var(--color-${bg}))` }}>
                  <div className="text-[10px] uppercase tracking-wide text-[rgb(var(--color-text-500))]">{bg}</div>
                  <div className="flex gap-1.5">
                    {(['chip-primary', 'chip-accent', 'chip-danger'] as const).map((c) => (
                      <span key={c} className={`${c} inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold`}>chip</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* FORM CONTROLS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Form Controls">
          <SubSection label="Input">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
              <div>
                <Label htmlFor="input-default">Default Input</Label>
                <Input
                  id="input-default"
                  placeholder="Type something..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="input-error">Error Input</Label>
                <Input
                  id="input-error"
                  placeholder="Invalid value"
                  hasError={true}
                />
              </div>
              <div>
                <Label htmlFor="input-disabled">Disabled Input</Label>
                <Input
                  id="input-disabled"
                  placeholder="Disabled"
                  disabled
                  value="Cannot edit"
                />
              </div>
              <div>
                <Label htmlFor="input-with-value">With Value</Label>
                <Input
                  id="input-with-value"
                  value="Hello World"
                  readOnly
                />
              </div>
            </div>
          </SubSection>

          <SubSection label="TextArea">
            <div className="max-w-md">
              <Label htmlFor="textarea-default">Description</Label>
              <TextArea
                id="textarea-default"
                placeholder="Write a description..."
                value={textareaValue}
                onChange={(e) => setTextareaValue(e.target.value)}
              />
            </div>
          </SubSection>

          <SubSection label="Select">
            <div className="max-w-xs">
              <Label>Custom Select</Label>
              <CustomSelect
                options={[
                  { value: 'option1', label: 'Option 1' },
                  { value: 'option2', label: 'Option 2' },
                  { value: 'option3', label: 'Option 3' },
                  { value: 'option4', label: 'Option 4 (Disabled)' },
                ]}
                value={selectValue}
                onValueChange={setSelectValue}
                placeholder="Select an option..."
              />
            </div>
          </SubSection>

          <SubSection label="Checkbox">
            <div className="flex flex-col gap-3">
              <Checkbox
                id="checkbox-unchecked"
                label="Unchecked checkbox"
                checked={checkboxChecked}
                onChange={(e) => setCheckboxChecked(e.target.checked)}
              />
              <Checkbox
                id="checkbox-checked"
                label="Checked checkbox"
                checked={true}
                onChange={() => {}}
              />
              <Checkbox
                id="checkbox-disabled"
                label="Disabled checkbox"
                disabled
                checked={false}
                onChange={() => {}}
              />
              <Checkbox
                id="checkbox-disabled-checked"
                label="Disabled checked"
                disabled
                checked={true}
                onChange={() => {}}
              />
            </div>
          </SubSection>

          <SubSection label="Switch">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Switch
                  id="switch-off"
                  checked={switchChecked}
                  onCheckedChange={setSwitchChecked}
                  label="Off state"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="switch-on"
                  checked={switch2Checked}
                  onCheckedChange={setSwitch2Checked}
                  label="On state"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="switch-disabled"
                  checked={false}
                  onCheckedChange={() => {}}
                  disabled
                  label="Disabled"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="switch-sm"
                  checked={true}
                  onCheckedChange={() => {}}
                  size="sm"
                  label="Small"
                />
                <Switch
                  id="switch-md"
                  checked={true}
                  onCheckedChange={() => {}}
                  size="md"
                  label="Medium"
                />
                <Switch
                  id="switch-lg"
                  checked={true}
                  onCheckedChange={() => {}}
                  size="lg"
                  label="Large"
                />
              </div>
            </div>
          </SubSection>

          <SubSection label="Radio Group">
            <RadioGroup
              options={[
                { value: 'option1', label: 'Option 1', description: 'First option description' },
                { value: 'option2', label: 'Option 2', description: 'Second option description' },
                { value: 'option3', label: 'Option 3', description: 'Third option (disabled)', disabled: true },
              ]}
              value={radioValue}
              onChange={setRadioValue}
              name="demo-radio"
            />
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* CARDS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Cards">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Basic Card</CardTitle>
                <CardDescription>A simple card with header and content.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[rgb(var(--color-text-700))]">
                  This is the card body content. Cards provide a container for grouping related information.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Card with Footer</CardTitle>
                <CardDescription>Includes actions at the bottom.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[rgb(var(--color-text-700))]">
                  Card content with some descriptive text that explains the card purpose.
                </p>
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button id="card-cancel" variant="outline" size="sm">Cancel</Button>
                <Button id="card-save" size="sm">Save</Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Stats Card</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-[rgb(var(--color-primary-500))]">2,847</div>
                <p className="text-sm text-[rgb(var(--color-text-500))] mt-1">Total tickets this month</p>
                <div className="flex items-center gap-1 mt-2">
                  <Badge variant="success" size="sm">+12.5%</Badge>
                  <span className="text-xs text-[rgb(var(--color-text-500))]">vs last month</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* CONTENT CARDS (Collapsible) */}                                                                        
        {/* ═══════════════════════════════════════════════════════════════════ */}                              
        <Section title="Content Cards (Collapsible)">                                                              
          <p className="text-sm text-[rgb(var(--color-text-600))] mb-2">                                         
            ContentCard supports a collapsible mode with chevron toggle, count badge, and optional add button.                                                                                                                 
          </p>                                                                                                     
                                                                                                                   
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">                                           
            {/* Non-collapsible (original API) */}                                                          
            <ContentCard id="content-card-basic">                                                           
              <ContentCard.Header>                                                                          
                <Star className="w-5 h-5 mr-2" />                                                           
                Non-Collapsible (Original API)                                                              
              </ContentCard.Header>                                                                         
              <p className="text-sm text-[rgb(var(--color-text-700))]">                                     
                This card uses the original ContentCard.Header pattern. No collapse behavior.               
              </p>                                                                                          
            </ContentCard>                                                                                  
                                                                                                            
            {/* Collapsible – expanded by default */}                                                       
            <ContentCard                                                                                    
              id="content-card-expanded"                                                                    
              collapsible                                                                                   
              defaultExpanded                                                                               
              title="Expanded by Default"                                                                   
              headerIcon={<Users className="w-5 h-5" />}                                                    
              count={3}                                                                                     
            >                                                                                               
              <ul className="text-sm text-[rgb(var(--color-text-700))] space-y-1">                          
                <li>Agent 1</li>                                                                            
                <li>Agent 2</li>                                                                            
                <li>Agent 3</li>                                                                            
              </ul>                                                                                         
            </ContentCard>                                                                                  
                                                                                                            
            {/* Collapsible – collapsed by default with count badge */}                                     
            <ContentCard                                                                                    
              id="content-card-collapsed"                                                                   
              collapsible                                                                                   
              defaultExpanded={false}                                                                       
              title="Collapsed with Count"                                                                  
              headerIcon={<Package className="w-5 h-5" />}                                                  
              count={5}                                                                                     
            >                                                                                               
              <p className="text-sm text-[rgb(var(--color-text-700))]">                                     
                This content is hidden by default. The count badge (5) shows when collapsed.                
              </p>                                                                                          
            </ContentCard>                                                                                  
                                                                                                            
            {/* Collapsible – with add button */}                                                           
            <ContentCard                                                                                    
              id="content-card-add"                                                                         
              collapsible                                                                                   
              defaultExpanded={false}                                                                       
              title="With Add Button"                                                                       
              headerIcon={<Eye className="w-5 h-5" />}                                                      
              count={0}                                                                                     
              addButton={{                                                                                  
                id: 'content-card-add-btn',                                                                 
                label: 'Add Item',                                                                          
                onClick: () => alert('Add clicked! Card also auto-expands.'),                               
              }}                                                                                            
            >                                                                                               
              <p className="text-sm text-[rgb(var(--color-text-700))]">                                     
                Clicking &quot;Add Item&quot; triggers the callback and auto-expands the card if collapsed. 
              </p>                                                                                          
            </ContentCard>                                                                                  
          </div>                                                                                            
        </Section>                                                                                          
                                                                                                            
        {/* ═══════════════════════════════════════════════════════════════════ */}                         
        {/* TABS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Tabs">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="tab1">Overview</TabsTrigger>
              <TabsTrigger value="tab2">Details</TabsTrigger>
              <TabsTrigger value="tab3">Settings</TabsTrigger>
              <TabsTrigger value="tab4" disabled>Disabled</TabsTrigger>
            </TabsList>
            <TabsContent value="tab1">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-[rgb(var(--color-text-700))]">
                    This is the overview tab content. Tabs help organize content into separate views.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="tab2">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-[rgb(var(--color-text-700))]">
                    Details tab content with more specific information.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="tab3">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-[rgb(var(--color-text-700))]">
                    Settings tab for configuration options.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TOOLTIPS, POPOVERS, DROPDOWNS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Overlays & Tooltips">
          <SubSection label="Tooltips">
            <div className="flex flex-wrap items-center gap-4">
              <Tooltip content="This is a tooltip">
                <Button id="tooltip-btn" variant="outline">Hover me (Tooltip)</Button>
              </Tooltip>
              <Tooltip content="Another tooltip with longer text that wraps">
                <Badge variant="info">Hover for info</Badge>
              </Tooltip>
            </div>
          </SubSection>

          <SubSection label="Popover">
            <Popover>
              <PopoverTrigger asChild>
                <Button id="popover-btn" variant="outline">
                  Open Popover <ChevronDown className="h-4 w-4 ml-1" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-[rgb(var(--color-text-900))]">Popover Title</h4>
                  <p className="text-sm text-[rgb(var(--color-text-500))]">
                    This is popover content. Use it for contextual information or forms.
                  </p>
                  <div className="flex gap-2 pt-2">
                    <Button id="popover-action" size="sm">Action</Button>
                    <Button id="popover-cancel" variant="outline" size="sm">Cancel</Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </SubSection>

          <SubSection label="Dropdown Menu">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button id="dropdown-btn" variant="outline">
                  <MoreVertical className="h-4 w-4 mr-1" /> Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Copy className="h-4 w-4 mr-2" /> Copy
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Edit className="h-4 w-4 mr-2" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Download className="h-4 w-4 mr-2" /> Download
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Share2 className="h-4 w-4 mr-2" /> Share
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-[rgb(var(--color-destructive))]">
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* DIALOG */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Dialog">
          <Button id="dialog-open-btn" variant="outline" onClick={() => setDialogOpen(true)}>
            Open Dialog
          </Button>
          <Dialog id="demo-dialog" isOpen={dialogOpen} onClose={() => setDialogOpen(false)} title="Dialog Title">
            <DialogContent>
              <p className="text-sm text-[rgb(var(--color-text-700))]">
                This is a dialog / modal. It overlays the page content and requires user interaction before returning.
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <Label htmlFor="dialog-input">Name</Label>
                  <Input id="dialog-input" placeholder="Enter a name" />
                </div>
                <div>
                  <Label htmlFor="dialog-select">Category</Label>
                  <CustomSelect
                    options={[
                      { value: 'cat1', label: 'Category 1' },
                      { value: 'cat2', label: 'Category 2' },
                    ]}
                    value=""
                    onValueChange={() => {}}
                    placeholder="Select category..."
                  />
                </div>
              </div>
            </DialogContent>
            <DialogFooter>
              <Button id="dialog-cancel" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button id="dialog-confirm" onClick={() => setDialogOpen(false)}>Confirm</Button>
            </DialogFooter>
          </Dialog>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SEPARATORS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Separator">
          <div className="space-y-4 max-w-md">
            <p className="text-sm text-[rgb(var(--color-text-700))]">Content above the separator</p>
            <Separator />
            <p className="text-sm text-[rgb(var(--color-text-700))]">Content below the separator</p>
          </div>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SKELETONS / LOADING */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Loading & Skeletons">
          <SubSection label="Skeleton shapes">
            <div className="space-y-3 max-w-md">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <div className="flex items-center gap-3 mt-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            </div>
          </SubSection>

          <SubSection label="Skeleton card">
            <Card className="max-w-sm">
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-48 mt-1" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-9 w-20" />
              </CardFooter>
            </Card>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* EMPTY STATE */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Empty State">
          <Card>
            <EmptyState
              title="No tickets found"
              description="There are no tickets matching your current filters. Try adjusting your search criteria."
              icon={<Inbox className="h-6 w-6" />}
              action={<Button id="empty-action" size="sm"><Plus className="h-4 w-4 mr-1" /> Create Ticket</Button>}
            />
          </Card>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* ALERTS / INLINE FEEDBACK */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Alerts">
          <div className="space-y-3 max-w-2xl">
            <Alert variant="info">
              <AlertTitle>Information</AlertTitle>
              <AlertDescription>This is an informational alert message for general notices.</AlertDescription>
            </Alert>

            <Alert variant="success">
              <AlertTitle>Success</AlertTitle>
              <AlertDescription>Operation completed successfully. All changes have been saved.</AlertDescription>
            </Alert>

            <Alert variant="warning">
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>Your subscription is expiring soon. Please renew to avoid service interruption.</AlertDescription>
            </Alert>

            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>Failed to save changes. Please check your connection and try again.</AlertDescription>
            </Alert>

            <Alert variant="default">
              <AlertTitle>Default</AlertTitle>
              <AlertDescription>This is the default alert variant with no specific semantic meaning.</AlertDescription>
            </Alert>
          </div>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TABLE-LIKE LAYOUT */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Table Rows">
          <Card>
            <div className="divide-y divide-[rgb(var(--color-border-200))]">
              {/* Header */}
              <div className="flex items-center px-4 py-3 text-xs font-medium uppercase tracking-wider text-[rgb(var(--color-text-500))]">
                <div className="flex-1">Name</div>
                <div className="w-32">Status</div>
                <div className="w-32">Priority</div>
                <div className="w-24 text-right">Actions</div>
              </div>
              {/* Row 1 */}
              <div className="flex items-center px-4 py-3 hover:bg-[rgb(var(--color-table-hover))] transition-colors">
                <div className="flex-1 text-sm font-medium text-[rgb(var(--color-text-900))]">Server maintenance request</div>
                <div className="w-32"><Badge variant="success" size="sm">Open</Badge></div>
                <div className="w-32"><Badge variant="error" size="sm">High</Badge></div>
                <div className="w-24 text-right">
                  <Button id="row1-actions" variant="ghost" size="xs"><MoreVertical className="h-4 w-4" /></Button>
                </div>
              </div>
              {/* Row 2 (alt) */}
              <div className="flex items-center px-4 py-3 bg-[rgb(var(--color-table-row-alt))] hover:bg-[rgb(var(--color-table-hover))] transition-colors">
                <div className="flex-1 text-sm font-medium text-[rgb(var(--color-text-900))]">Network configuration update</div>
                <div className="w-32"><Badge variant="warning" size="sm">Pending</Badge></div>
                <div className="w-32"><Badge variant="info" size="sm">Medium</Badge></div>
                <div className="w-24 text-right">
                  <Button id="row2-actions" variant="ghost" size="xs"><MoreVertical className="h-4 w-4" /></Button>
                </div>
              </div>
              {/* Row 3 */}
              <div className="flex items-center px-4 py-3 hover:bg-[rgb(var(--color-table-hover))] transition-colors">
                <div className="flex-1 text-sm font-medium text-[rgb(var(--color-text-900))]">User onboarding documentation</div>
                <div className="w-32"><Badge variant="default-muted" size="sm">Closed</Badge></div>
                <div className="w-32"><Badge variant="default" size="sm">Low</Badge></div>
                <div className="w-24 text-right">
                  <Button id="row3-actions" variant="ghost" size="xs"><MoreVertical className="h-4 w-4" /></Button>
                </div>
              </div>
              {/* Row 4 (selected) */}
              <div className="flex items-center px-4 py-3 bg-[rgb(var(--color-table-selected))] hover:bg-[rgb(var(--color-table-hover))] transition-colors">
                <div className="flex-1 text-sm font-medium text-[rgb(var(--color-text-900))]">Email integration setup (selected)</div>
                <div className="w-32"><Badge variant="primary" size="sm">In Progress</Badge></div>
                <div className="w-32"><Badge variant="error" size="sm">Critical</Badge></div>
                <div className="w-24 text-right">
                  <Button id="row4-actions" variant="ghost" size="xs"><MoreVertical className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          </Card>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* COMBINED FORM EXAMPLE */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Combined Form Example">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Create New Ticket</CardTitle>
              <CardDescription>Fill in the details below to create a new support ticket.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="form-title" required>Title</Label>
                  <Input id="form-title" placeholder="Ticket title" />
                </div>
                <div>
                  <Label htmlFor="form-category">Category</Label>
                  <CustomSelect
                    options={[
                      { value: 'bug', label: 'Bug Report' },
                      { value: 'feature', label: 'Feature Request' },
                      { value: 'support', label: 'Support' },
                    ]}
                    value=""
                    onValueChange={() => {}}
                    placeholder="Select category..."
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="form-desc">Description</Label>
                <TextArea id="form-desc" placeholder="Describe the issue in detail..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Priority</Label>
                  <RadioGroup
                    options={[
                      { value: 'low', label: 'Low' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'high', label: 'High' },
                    ]}
                    value="medium"
                    onChange={() => {}}
                    name="form-priority"
                    orientation="horizontal"
                  />
                </div>
                <div className="flex items-end">
                  <Checkbox id="form-urgent" label="Mark as urgent" checked={false} onChange={() => {}} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="form-notify"
                  checked={true}
                  onCheckedChange={() => {}}
                  label="Send email notification"
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button id="form-cancel" variant="outline">Cancel</Button>
              <Button id="form-submit">Create Ticket</Button>
            </CardFooter>
          </Card>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SIDEBAR COLORS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Sidebar Colors">
          <SidebarDemo />
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SCHEDULE / EVENT COLORS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Schedule Event Colors">
          <div className="flex flex-wrap gap-3">
            <div className="px-4 py-2 rounded-md border border-[rgb(var(--color-border-200))]" style={{ backgroundColor: 'rgb(var(--color-event-non-billable))' }}>
              <span className="text-sm text-[rgb(var(--color-text-900))]">Non-Billable</span>
            </div>
            <div className="px-4 py-2 rounded-md border border-[rgb(var(--color-border-200))]" style={{ backgroundColor: 'rgb(var(--color-event-interaction))' }}>
              <span className="text-sm text-[rgb(var(--color-text-900))]">Interaction</span>
            </div>
            <div className="px-4 py-2 rounded-md border border-[rgb(var(--color-border-200))]" style={{ backgroundColor: 'rgb(var(--color-event-appointment))' }}>
              <span className="text-sm text-[rgb(var(--color-text-900))]">Appointment</span>
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TABLE STATUS ROW COLORS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="DataTable">
          <p className="text-sm text-[rgb(var(--color-text-500))] -mt-2">
            The real <code>DataTable</code>, not swatches — so its card surface, header rule, row
            dividers, hover and selected states are inspected exactly as they ship. Row tints come
            from <code>--color-table-*</code>; the container carries <code>.card-elevated</code>.
          </p>
          <DataTable
            id="uikit-datatable"
            data={demoRows}
            columns={demoColumns}
            pagination={false}
            rowClassName={(r) => (r.state === 'selected' ? 'bg-[rgb(var(--color-table-selected))]' : '')}
          />
        </Section>

        {/* Everything below exists so the theming work can be inspected in one
            place: the surfaces and token families that were silently wrong in
            one mode — literals that cannot invert, ramp steps sitting too close,
            and shadows tuned for a white page. */}

        <Section title="Card Elevation">
          <p className="text-sm text-[rgb(var(--color-text-500))] -mt-2">
            <code>.card-elevated</code> replaces Tailwind&apos;s <code>shadow-*</code> on card surfaces.
            Dark carries roughly 8&times; the alpha of light for the same apparent lift — a 5% shadow
            over a near-black page has nothing left to darken.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Baseline only — a bare surface with NO elevation, to compare against.
                Deliberately hand-rolled: there is no component for "unstyled card". */}
            <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
              <div className="font-medium text-[rgb(var(--color-text-900))]">No elevation</div>
              <div className="text-xs text-[rgb(var(--color-text-500))] mt-1">baseline, border only</div>
            </div>
            {/* The real component — Card carries .card-elevated itself, so this is
                what ships, not a copy of its class string. */}
            <Card className="p-4">
              <div className="font-medium text-[rgb(var(--color-text-900))]">&lt;Card&gt;</div>
              <div className="text-xs text-[rgb(var(--color-text-500))] mt-1">real component, resting lift</div>
            </Card>
            <Card className="p-4 card-elevated-hover transition-shadow">
              <div className="font-medium text-[rgb(var(--color-text-900))]">&lt;Card&gt; + hover</div>
              <div className="text-xs text-[rgb(var(--color-text-500))] mt-1">hover me</div>
            </Card>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <BentoTile id="uikit-bento" title="BentoTile" subtitle="the ticket Grid surface">
              <p className="text-sm text-[rgb(var(--color-text-600))]">
                Shared by 110 render sites. Border and elevation both come from tokens.
              </p>
            </BentoTile>
            <ContentCard id="uikit-contentcard" title="ContentCard">
              <p className="text-sm text-[rgb(var(--color-text-600))]">The entity-view surface.</p>
            </ContentCard>
          </div>
        </Section>

        <Section title="Surface Ladder">
          <p className="text-sm text-[rgb(var(--color-text-500))] -mt-2">
            Page ground &rarr; card &rarr; border steps. Every rung must stay distinguishable from its
            neighbours in both modes; the dark ramp used to sit about a third as far apart as light.
          </p>
          <div className="rounded-lg p-4 bg-[rgb(var(--color-app-ground))] space-y-3">
            <div className="text-xs uppercase tracking-wide text-[rgb(var(--color-text-500))]">app-ground (this panel)</div>
            <div className="rounded-md p-3 bg-[rgb(var(--color-card))] border border-[rgb(var(--color-border-200))]">
              <div className="text-sm text-[rgb(var(--color-text-900))]">card + border-200</div>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {['border-50', 'border-100', 'border-200', 'border-300'].map((t) => (
                  <div key={t} className="rounded p-2 text-[11px] text-[rgb(var(--color-text-700))]"
                       style={{ background: `rgb(var(--color-${t}))` }}>
                    {t}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="text-sm text-[rgb(var(--color-text-500))]">
            The ramp is monotonic in every pair <em>except</em> high contrast, which repurposes
            200/300 as maximum-contrast hairlines &mdash; near-black on white, near-white on black.
            Switch the pair above to see rungs 200/300 invert while 400 drops back to a mid grey.
            That is intentional for <code>border-*</code>; it means those two rungs are never a fill.
          </p>
          <div className="flex flex-wrap gap-1">
            {['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'].map((n) => (
              <div key={n} className="w-[68px]">
                <div className="h-10 rounded-t border border-[rgb(var(--color-border-400))] border-b-0"
                     style={{ background: `rgb(var(--color-border-${n}))` }} />
                <div className="rounded-b border border-[rgb(var(--color-border-400))] px-1 py-0.5 text-center text-[10px] text-[rgb(var(--color-text-600))]">
                  {n}
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-[rgb(var(--color-border-200))] p-3">
              <div className="text-xs font-semibold text-[rgb(var(--color-text-900))]">Hairline &mdash; correct</div>
              <div className="mt-2 rounded border border-[rgb(var(--color-border-200))] p-2 text-xs text-[rgb(var(--color-text-700))]">
                border-[--color-border-200]
              </div>
            </div>
            <div className="rounded-md border border-[rgb(var(--color-border-200))] p-3">
              <div className="text-xs font-semibold text-[rgb(var(--color-text-900))]">Fill &mdash; use the surface end</div>
              <div className="mt-2 flex gap-2">
                <div className="flex-1 rounded p-2 text-xs text-[rgb(var(--color-text-700))] bg-[rgb(var(--color-border-100))]">border-100</div>
                <div className="flex-1 rounded p-2 text-xs text-[rgb(var(--color-text-800))] bg-[rgb(var(--color-text-500)/0.14)]">text-500 / 0.14</div>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Editor Paper">
          <p className="text-sm text-[rgb(var(--color-text-500))] -mt-2">
            <code>.editor-paper</code> — a shallow well pressed into the card. The tint comes from the
            running pair&apos;s own primary/secondary, so every theme tints itself.
          </p>
          <Card className="p-4">
            <div className="text-xs text-[rgb(var(--color-text-500))] mb-1">Write a reply</div>
            {/* The real editor. Its own wrapper carries .editor-paper, so what you
                see here is exactly what a ticket comment box renders. */}
            <TextEditor id="uikit-text-editor" placeholder="Start typing…" />
          </Card>
        </Section>

        <Section title="Keycaps">
          <p className="text-sm text-[rgb(var(--color-text-500))] -mt-2">
            The shortcuts cheatsheet. A cap is lit from above, so its face runs light-to-dark — a ramp
            that inverts between modes, which is why it is four tokens rather than one value.
          </p>
          <div className="flex flex-wrap gap-2">
            {['Q', 'W', 'E', 'R', 'T'].map((k) => (
              <div key={k} className="w-14 h-11 rounded-md grid place-items-center text-xs font-medium"
                   style={{ background: 'var(--keycap-face)', color: 'rgb(var(--color-text-700))',
                            border: '1px solid var(--keycap-edge)',
                            boxShadow: '0 1px 0 var(--keycap-edge), inset 0 1px 0 var(--keycap-gloss)' }}>
                {k}
              </div>
            ))}
            {['?', 'g g', '@'].map((k) => (
              <div key={k} className="h-6 px-2 rounded grid place-items-center text-[11px] font-semibold font-mono"
                   style={{ background: 'var(--keycap-flat)', color: 'rgb(var(--color-text-800))',
                            border: '1px solid var(--keycap-edge)' }}>
                {k}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Status Colors & Contrast">
          <p className="text-sm text-[rgb(var(--color-text-500))] -mt-2">
            Each fill paired with its own foreground token. The fill is identical in both modes, so the
            ink must NOT flip with the mode — every pair here clears WCAG AA (worst 4.63:1).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {['success', 'warning', 'error'].map((k) => (
              <div key={k} className="rounded-lg p-4 font-medium"
                   style={{ background: `rgb(var(--color-status-${k}))`,
                            color: `rgb(var(--color-status-${k}-foreground))` }}>
                status-{k}
                <div className="text-xs font-normal opacity-90 mt-1">fill + its foreground</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {['info', 'success', 'warning'].map((k) => (
              <div key={k} className="rounded-lg p-4 text-sm font-medium border"
                   style={{ background: `rgb(var(--badge-${k}-bg))`,
                            color: `rgb(var(--badge-${k}-text))`,
                            borderColor: `rgb(var(--badge-${k}-border))` }}>
                badge-{k}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Skeleton Family">
          <p className="text-sm text-[rgb(var(--color-text-500))] -mt-2">
            <code>.skeleton-fill</code> and <code>.skeleton-fill-strong</code>. Hand-rolled
            {' '}<code>bg-gray-200</code> placeholders landed 8.4 luma off the card in dark against the
            token&apos;s 24.9 — technically present, effectively invisible.
          </p>
          <Skeleton className="h-10 w-full" />
          <p className="text-xs text-[rgb(var(--color-text-500))]">
            The composed skeletons the app actually renders while loading — imported, not mimed,
            so this page cannot drift from them.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-[rgb(var(--color-text-500))] mb-2">ChartSkeleton</div>
              <ChartSkeleton />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-[rgb(var(--color-text-500))] mb-2">SettingsTabSkeleton</div>
              <SettingsTabSkeleton />
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-[rgb(var(--color-text-500))] mb-2">TaskFormSkeleton</div>
            <TaskFormSkeleton />
          </div>
        </Section>

        <Section title="Contrast Review — clear">
          <p className="text-sm text-[rgb(var(--color-text-500))] -mt-2">
            Nothing left to call. The audit measures 114 element sites that pair a real foreground
            token with a real background token; <strong>0</strong> fall under WCAG AA in any of the 18
            theme-modes. It was 44 sites, worst 1.05:1. Anything found later lands in this table, still
            measured live from the browser so switching mode or pair above re-measures every row.
          </p>
          <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] card-elevated p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wide text-[rgb(var(--color-text-500))]">
                {CONTRAST_REVIEW.length} pairs · {pair} · {resolvedTheme}
              </div>
              <div className="text-xs text-[rgb(var(--color-text-500))]">measured in-browser</div>
            </div>
            {CONTRAST_REVIEW.map((cp) => (
              <ContrastRow
                key={`${cp.fg}|${cp.bg}|${cp.fgA ?? ''}|${cp.bgA ?? ''}`}
                pair={cp}
                themeKey={`${pair}:${resolvedTheme}`}
              />
            ))}
          </div>
        </Section>

      </div>
    </div>
  );
}
