'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@alga-psa/ui/components/Card';

// LEVERAGE: pattern integration-section — every panel in this module was a
// hand-rolled `rounded-lg border border-border/70 bg-background p-4` div: no
// elevation, no icon, no way to say "this one is the problem". Seventeen copies
// across eleven files. If a second integration wants the same shell, this
// belongs in the UI kit rather than in a feature directory.

export type EntraSectionTone = 'default' | 'blocking' | 'warning' | 'success';

/**
 * Colour here is semantic, never decorative: the tone of a section is the tone
 * of what it contains. A neutral section is the overwhelming default, which is
 * what makes a toned one worth noticing.
 */
const TONE_SHELL: Record<EntraSectionTone, string> = {
  default: 'border-[rgb(var(--color-border-200))]',
  blocking: 'border-destructive/40',
  warning: 'border-warning/40',
  success: 'border-[rgb(var(--color-border-200))]',
};

const TONE_CHIP: Record<EntraSectionTone, string> = {
  default: 'chip-primary',
  blocking: 'bg-alert-destructive-bg text-destructive',
  warning: 'bg-alert-warning-bg text-warning',
  success: 'bg-alert-success-bg text-success',
};

interface EntraSectionProps {
  id?: string;
  /** The section's subject, in one glyph. Decorative to a screen reader — the title carries the meaning. */
  icon: LucideIcon;
  title: string;
  /** One line under the title, when the title alone does not say what the section is for. */
  description?: React.ReactNode;
  /** Controls that act on the section as a whole, aligned to the title. */
  action?: React.ReactNode;
  tone?: EntraSectionTone;
  className?: string;
  /** Padding around the body only — set to false when the child is a DataTable, which brings its own. */
  bodyClassName?: string;
  children?: React.ReactNode;
}

export function EntraSection({
  id,
  icon: Icon,
  title,
  description,
  action,
  tone = 'default',
  className,
  bodyClassName,
  children,
}: EntraSectionProps): React.JSX.Element {
  return (
    <Card id={id} className={`p-4 ${TONE_SHELL[tone]} ${className ?? ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${TONE_CHIP[tone]}`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="flex-shrink-0">{action}</div> : null}
      </div>
      {children ? <div className={bodyClassName ?? 'mt-3'}>{children}</div> : null}
    </Card>
  );
}

export default EntraSection;
