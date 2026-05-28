---
name: Alga PSA
description: Quiet, dense, exact product UI for MSP operations and client service visibility.
colors:
  operator-purple: "#8a4dea"
  operator-purple-hover: "#7c45d3"
  operator-purple-soft: "#f6f0fe"
  system-cyan: "#40cff9"
  system-cyan-soft: "#ecfcfe"
  attention-amber: "#ff9c30"
  attention-amber-soft: "#fff6e6"
  slate-workspace: "#f8fafc"
  slate-panel: "#f1f5f9"
  slate-border: "#e2e8f0"
  slate-border-strong: "#94a3b8"
  slate-text: "#0f172a"
  slate-text-muted: "#64748b"
  sidebar-ink: "#0c111d"
  sidebar-hover: "#1e293b"
  success: "#22c55e"
  warning: "#f59e0b"
  error: "#ef4444"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "0.04em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.operator-purple}"
    textColor: "{colors.slate-workspace}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.operator-purple-hover}"
    textColor: "{colors.slate-workspace}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
    typography: "{typography.body}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.slate-text}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "36px"
    typography: "{typography.body}"
  input-default:
    backgroundColor: "{colors.slate-workspace}"
    textColor: "{colors.slate-text}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
    typography: "{typography.body}"
  card-default:
    backgroundColor: "{colors.slate-workspace}"
    textColor: "{colors.slate-text}"
    rounded: "{rounded.lg}"
    padding: "24px"
  badge-default:
    backgroundColor: "{colors.slate-panel}"
    textColor: "{colors.slate-text-muted}"
    rounded: "9999px"
    padding: "2px 10px"
    typography: "{typography.label}"
---

# Design System: Alga PSA

## 1. Overview

**Creative North Star: "The Modern Workbench"**

Alga PSA should feel like a modern operations workbench: quiet enough for long service days, dense enough for real MSP throughput, and exact enough that users trust every status, total, and action. The visual system uses familiar product UI patterns, crisp semantic tokens, and compact spacing to keep the task in front of the user.

The system is product-first. It borrows Notion's directness and Twenty.com's clean business-object clarity, then adapts both for ticket queues, billing approvals, project status, automation, assets, and client-facing transparency. The `/msp` area can be denser and more operator-focused. The `/client` area should translate the same model into calmer service visibility.

This system rejects dated enterprise MSP software, especially the heavy clutter associated with ConnectWise. It also rejects generic AI-generated SaaS UI: purposeless cards, decorative gradients, vague empty states, and elements placed without thought are forbidden.

**Key Characteristics:**

- Quiet, dense, and exact.
- Restrained product color with Operator Purple used for action and selection.
- Tonal layering first, with lift reserved for interaction.
- Systematic component vocabulary across MSP and client surfaces.
- Strong keyboard, focus, and status communication for operational confidence.

## 2. Colors

The palette is a restrained operational system: Slate Workspace carries the work, Operator Purple marks decisions and active state, System Cyan supports secondary system feedback, and Attention Amber highlights caution without turning the product into an alert wall.

### Primary

- **Operator Purple:** The primary action and selection color. Use it for main actions, active navigation, focused controls, selected table states, and high-value action affordances. It must stay rare enough to mean action.
- **Operator Purple Soft:** The quiet tint for hover, selected table rows, low-priority emphasis, and background hints. Use this before reaching for saturated purple.

### Secondary

- **System Cyan:** A secondary system color for non-destructive system feedback, integration context, extension surfaces, and secondary data visualization. It should not compete with Operator Purple for primary action.

### Tertiary

- **Attention Amber:** A warm attention color for warning, time-sensitive, billing-adjacent, and cautionary states. Use it as a semantic signal, not as decoration.

### Neutral

- **Slate Workspace:** The default working surface. It keeps dense screens calm and gives data, controls, and tables room to breathe.
- **Slate Panel:** The subtle secondary layer for table alternation, hover regions, filter surfaces, and low-emphasis containers.
- **Slate Border:** The default divider and container edge. It should be visible enough to organize dense content but never heavy.
- **Slate Text:** The high-confidence text color for labels, headings, data, and primary content.
- **Slate Text Muted:** Secondary explanation, metadata, helper text, timestamps, and de-emphasized table values.
- **Sidebar Ink:** The navigation anchor. It creates a stable operational frame around the lighter workspace.

### Named Rules

**The Action Rarity Rule.** Operator Purple is for action, active state, focus, or selection. If it appears only to decorate, remove it.

**The Semantic Color Rule.** Success, warning, error, and info states must include iconography, labels, or text. Color alone is never sufficient.

**The No Decorative Gradient Rule.** Gradients are prohibited unless they explain a real state or are part of tenant-provided branding in a constrained client portal context.

## 3. Typography

**Display Font:** System sans stack with native platform rendering.
**Body Font:** System sans stack with native platform rendering.
**Label/Mono Font:** System sans by default. Use mono only for identifiers, logs, code, and machine values.

**Character:** Typography is native, compact, and legible. It should feel like a serious work tool, not a marketing page wearing product chrome.

### Hierarchy

- **Display** (600, 1.5rem, 1.25): Page-level titles, major dashboard headings, and primary workspace context.
- **Headline** (600, 1.25rem, 1.3): Section headers, form group headings, drawer titles, and large panel labels.
- **Title** (600, 1.125rem, 1.25): Card titles, table section titles, modal titles, and local object names.
- **Body** (400, 0.875rem, 1.5): Default UI copy, table cells, descriptions, control labels when not compact, and client-facing explanatory text. Prose should stay within 65 to 75 characters per line when it is meant to be read as a paragraph.
- **Label** (600, 0.75rem, 1.33, tracked): Table headers, badge text, section labels, metadata labels, and compact navigation grouping.

### Named Rules

**The Native Tool Rule.** Use one system sans family for product UI. Do not introduce display fonts into buttons, labels, tables, or data-heavy surfaces.

**The Density Needs Contrast Rule.** Dense screens need weight, spacing, and muted text contrast. Do not make every label the same size and weight.

## 4. Elevation

Alga PSA is flat by default, lifted on interaction. Depth is primarily created through tonal layers, borders, table alternation, and selected states. Shadows are reserved for overlays, dropdowns, dialogs, draggable surfaces, and hover moments where the surface has genuinely moved closer to the user.

### Shadow Vocabulary

- **Surface Rest** (`none`): Default cards, table containers, side panels, and content sections.
- **Subtle Card** (`0 1px 2px rgb(15 23 42 / 0.06)`): Optional low-risk lift for compact cards on a busy workspace surface.
- **Overlay** (`0 10px 24px rgb(15 23 42 / 0.16)`): Dropdowns, popovers, menus, and temporary surfaces.
- **Dialog** (`0 24px 60px rgb(15 23 42 / 0.22)`): Dialogs and high-priority overlays that interrupt the workspace.

### Named Rules

**The Earned Lift Rule.** A surface earns a shadow only when it floats above other content, appears temporarily, or responds to interaction.

**The Flat Workbench Rule.** Default work areas stay flat. Use borders, spacing, and hierarchy before adding shadow.

## 5. Components

### Buttons

Buttons are compact, predictable, and stateful.

- **Shape:** Gently curved rectangle (6px radius), matching the current medium radius.
- **Primary:** Operator Purple background with Slate Workspace text, 40px height, 8px vertical padding, 16px horizontal padding, medium-weight 14px text.
- **Hover / Focus:** Hover darkens to the next Operator Purple step. Focus uses a visible 2px ring in Operator Purple with enough offset to separate it from surrounding surfaces.
- **Secondary / Ghost / Tertiary:** Secondary actions should use outline or soft treatments before adding more saturated color. Ghost buttons are for toolbar and navigation actions, never for destructive confirmation.

### Chips

Chips communicate status, filtering, and compact metadata.

- **Style:** Rounded pill shape with 9999px radius, 10 to 12px horizontal padding, 10 to 12px text, and a visible full border for status variants.
- **State:** Selected filter chips use a soft Operator Purple background and clear text. Status chips use semantic color plus text label.

### Cards / Containers

Cards are structural containers, not decoration.

- **Corner Style:** Soft operational corners (8px radius).
- **Background:** Slate Workspace or the current card surface.
- **Shadow Strategy:** Flat at rest. Optional subtle lift only for hoverable or temporary surfaces.
- **Border:** Full 1px border in Slate Border or an equivalent theme token.
- **Internal Padding:** 24px for full cards, 16px for dense panels, 12px for compact table-adjacent surfaces.

### Inputs / Fields

Inputs should feel exact and stable.

- **Style:** 40px default height, 6px radius, full 1px border, Slate Workspace surface, Slate Text content, and muted placeholder text.
- **Focus:** Clear Operator Purple ring or border shift. Never hide focus for mouse users if the component can be reached by keyboard.
- **Error / Disabled:** Error uses semantic red plus inline message. Disabled state lowers opacity and preserves layout.

### Navigation

Navigation is a stable operational frame.

- **Style:** Sidebar Ink background with light text, 16rem expanded width, 4rem collapsed width, compact row spacing, and 8px row radius.
- **Active State:** Operator Purple at low opacity with clear text and icon contrast.
- **Hover State:** Sidebar hover surface only. Do not add additional accent marks.
- **Mobile Treatment:** Collapse structure before shrinking type. Keep targets at comfortable tap sizes.

### Data Tables

Tables are core product surfaces, not generic content blocks.

- **Structure:** Rounded 8px container with full 1px border, compact 12px vertical cell padding, 24px horizontal cell padding, and alternate row tinting.
- **Headers:** 12px medium labels with tracking, muted but readable. Sorting must be visible and keyboard reachable.
- **Rows:** Hover uses a soft Operator Purple or Slate Panel tint. Clickable rows must indicate interactivity consistently.

### Dialogs and Menus

Temporary surfaces must be precise and interrupt only when needed.

- **Menus:** 6px radius, compact padding, full border, overlay shadow, and focusable rows.
- **Dialogs:** Use for blocking decisions, destructive confirmation, and focused edit flows. Prefer inline progressive disclosure when interruption is not required.

## 6. Do's and Don'ts

### Do:

- **Do** keep MSP operator screens dense, but use hierarchy so priority, ownership, status, and next action are obvious.
- **Do** use Operator Purple for primary action, selected state, focus, and active navigation.
- **Do** use Slate Workspace and Slate Panel to separate areas before adding decorative effects.
- **Do** make every status readable without color: include text, iconography, or both.
- **Do** keep `/client` surfaces calmer than `/msp` surfaces while preserving the same component vocabulary.
- **Do** use skeleton states for content loading and reserve spinners for short, isolated actions.

### Don't:

- **Don't** make Alga PSA feel like dated enterprise MSP software, especially the heavy clutter associated with ConnectWise.
- **Don't** make screens feel AI-generated with decorative gradients, purposeless cards, vague empty states, or elements placed without thought.
- **Don't** place elements without a task, state, or orientation purpose. Purpose before presence is mandatory.
- **Don't** use side-stripe accent borders on cards, list items, callouts, or alerts. Use a full border, tint, icon, or clearer copy instead.
- **Don't** use gradient text.
- **Don't** use glassmorphism as a default surface treatment.
- **Don't** create low-density dashboards that look polished but fail to support real MSP throughput.
- **Don't** use consumer-style gloss for operational, financial, or service-delivery workflows.
