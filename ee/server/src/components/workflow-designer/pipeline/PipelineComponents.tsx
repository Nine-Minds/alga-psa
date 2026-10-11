'use client';

/**
 * Pipeline Visualization Components
 *
 * Renders workflow steps as a vertical pipeline with:
 * - Dashed line connectors between steps
 * - Color-coded step type indicators
 * - Insert-between functionality
 * - Visual branch representation for control blocks
 */

import React, { useState, useCallback } from 'react';
import {
  GripVertical,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Play,
  GitBranch,
  Repeat,
  Shield,
  CornerDownRight,
  Zap,
  Clock,
  User,
  Settings,
  ArrowRight
} from 'lucide-react';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { Step, IfBlock, ForEachBlock, TryCatchBlock, NodeStep } from '@alga-psa/workflows/runtime';
import { formatTimeWaitDuration } from '../timeWaitDuration';
import { WorkflowConditionSummary } from '../WorkflowConditionBuilder';
import {
  formatWorkflowPatchChangeSummary,
  summarizeWorkflowPatchChanges,
} from '../mapping/UpdatePatchSection';

/**
 * Step type color configuration
 * Returns Tailwind color classes for different step types
 */
export const getStepTypeColor = (stepType: string): {
  border: string;
  bg: string;
  text: string;
  icon: string;
  badge: string;
} => {
  switch (stepType) {
    case 'action.call':
      return {
        border: 'border-l-blue-500',
        bg: 'bg-blue-500/10',
        text: 'text-blue-600',
        icon: 'text-blue-500',
        badge: 'bg-blue-500/15 text-blue-600'
      };
    case 'control.if':
      return {
        border: 'border-l-amber-500',
        bg: 'bg-amber-500/10',
        text: 'text-amber-600',
        icon: 'text-amber-500',
        badge: 'bg-amber-500/15 text-amber-600'
      };
    case 'control.forEach':
      return {
        border: 'border-l-purple-500',
        bg: 'bg-purple-500/10',
        text: 'text-purple-600',
        icon: 'text-purple-500',
        badge: 'bg-purple-500/15 text-purple-600'
      };
    case 'control.tryCatch':
      return {
        border: 'border-l-orange-500',
        bg: 'bg-orange-500/10',
        text: 'text-orange-600',
        icon: 'text-orange-500',
        badge: 'bg-orange-500/15 text-orange-600'
      };
    case 'control.return':
      return {
        border: 'border-l-red-500',
        bg: 'bg-red-500/10',
        text: 'text-red-600',
        icon: 'text-red-500',
        badge: 'bg-red-500/15 text-red-600'
      };
    case 'control.callWorkflow':
      return {
        border: 'border-l-cyan-500',
        bg: 'bg-cyan-500/10',
        text: 'text-cyan-600',
        icon: 'text-cyan-500',
        badge: 'bg-cyan-500/15 text-cyan-600'
      };
    case 'state.set':
      return {
        border: 'border-l-green-500',
        bg: 'bg-green-500/10',
        text: 'text-green-600',
        icon: 'text-green-500',
        badge: 'bg-green-500/15 text-green-600'
      };
    case 'transform.assign':
      return {
        border: 'border-l-teal-500',
        bg: 'bg-teal-500/10',
        text: 'text-teal-600',
        icon: 'text-teal-500',
        badge: 'bg-teal-500/15 text-teal-600'
      };
    case 'event.wait':
      return {
        border: 'border-l-indigo-500',
        bg: 'bg-indigo-500/10',
        text: 'text-indigo-600',
        icon: 'text-indigo-500',
        badge: 'bg-indigo-500/15 text-indigo-600'
      };
    case 'time.wait':
      return {
        border: 'border-l-sky-500',
        bg: 'bg-sky-500/10',
        text: 'text-sky-600',
        icon: 'text-sky-500',
        badge: 'bg-sky-500/15 text-sky-600'
      };
    case 'human.task':
      return {
        border: 'border-l-pink-500',
        bg: 'bg-pink-500/10',
        text: 'text-pink-600',
        icon: 'text-pink-500',
        badge: 'bg-pink-500/15 text-pink-600'
      };
    default:
      return {
        border: 'border-l-gray-400',
        bg: 'bg-gray-500/10',
        text: 'text-gray-600',
        icon: 'text-gray-500',
        badge: 'bg-gray-500/15 text-gray-600'
      };
  }
};

/**
 * Get icon component for step type
 */
export const getStepTypeIcon = (stepType: string): React.ReactNode => {
  const colors = getStepTypeColor(stepType);
  const iconClass = `h-4 w-4 ${colors.icon}`;

  switch (stepType) {
    case 'action.call':
      return <Zap className={iconClass} />;
    case 'control.if':
      return <GitBranch className={iconClass} />;
    case 'control.forEach':
      return <Repeat className={iconClass} />;
    case 'control.tryCatch':
      return <Shield className={iconClass} />;
    case 'control.return':
      return <CornerDownRight className={iconClass} />;
    case 'control.callWorkflow':
      return <ArrowRight className={iconClass} />;
    case 'state.set':
      return <Settings className={iconClass} />;
    case 'transform.assign':
      return <Settings className={iconClass} />;
    case 'event.wait':
      return <Clock className={iconClass} />;
    case 'time.wait':
      return <Clock className={iconClass} />;
    case 'human.task':
      return <User className={iconClass} />;
    default:
      return <Settings className={iconClass} />;
  }
};

/**
 * Pipeline Start Indicator
 */
export const PipelineStart: React.FC<{
  onInsert?: () => void;
  disabled?: boolean;
}> = ({ onInsert, disabled }) => {
  const { t } = useTranslation('msp/workflows');
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500/15 border-2 border-green-500">
        <Play className="h-4 w-4 text-green-600 ml-0.5" />
      </div>
      <div className="text-xs text-gray-500 mt-1">
        {t('pipeline.start', { defaultValue: 'Start' })}
      </div>
      {onInsert && !disabled && (
        <PipelineConnector onInsert={onInsert} position="start" />
      )}
    </div>
  );
};

/**
 * The designer's current insertion point (where the next palette item lands), so connectors
 * and empty branches can show it.
 */
export const WorkflowInsertionPointContext = React.createContext<{ pipePath: string; index: number } | null>(null);

export const useIsInsertionPoint = (pipePath: string | undefined, index: number | undefined): boolean => {
  const insertionPoint = React.useContext(WorkflowInsertionPointContext);
  return Boolean(
    insertionPoint &&
    pipePath !== undefined &&
    index !== undefined &&
    insertionPoint.pipePath === pipePath &&
    insertionPoint.index === index
  );
};

/**
 * Pipeline Connector with Insert Button
 * Renders the dashed line between steps with an always-visible "+" that sets the insertion point.
 * The connector at the current insertion point is highlighted and labelled.
 */
export const PipelineConnector: React.FC<{
  onInsert?: () => void;
  position?: 'start' | 'middle' | 'end';
  disabled?: boolean;
  pipePath?: string;
  index?: number;
}> = ({ onInsert, position = 'middle', disabled, pipePath, index }) => {
  const { t } = useTranslation('msp/workflows');
  const [isHovered, setIsHovered] = useState(false);
  const isActive = useIsInsertionPoint(pipePath, index);
  const showButton = Boolean(onInsert) && !disabled;
  const buttonId = pipePath !== undefined && index !== undefined
    ? `workflow-insert-${pipePath.replace(/[^a-zA-Z0-9_-]/g, '-')}-${index}`
    : undefined;

  return (
    <div
      className="relative flex flex-col items-center py-1"
      data-position={position}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Dashed line */}
      <div
        className={`w-0.5 h-6 border-l-2 border-dashed ${
          isActive || isHovered ? 'border-primary-400' : 'border-gray-300 dark:border-[rgb(var(--color-border-300))]'
        } transition-colors`}
      />

      {showButton && (
        <button
          id={buttonId}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onInsert?.();
          }}
          className={`absolute top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 rounded-full border
            ${isActive
              ? 'bg-primary-500 border-primary-500 text-white ring-2 ring-primary-200 dark:ring-primary-500/40'
              : isHovered
                ? 'bg-primary-500 border-primary-500 text-white'
                : 'bg-[rgb(var(--color-card))] border-gray-300 text-gray-400 dark:border-[rgb(var(--color-border-300))]'}
            hover:bg-primary-600 hover:border-primary-600 hover:text-white
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
            shadow-sm transition-colors duration-150 z-10`}
          title={t('pipeline.insertStepHere', { defaultValue: 'Insert step here' })}
          aria-label={t('pipeline.insertStepHere', { defaultValue: 'Insert step here' })}
          aria-pressed={isActive}
          data-testid="pipeline-insert-button"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      {showButton && isActive && (
        <span
          className="absolute top-1/2 left-1/2 ml-4 -translate-y-1/2 whitespace-nowrap rounded bg-primary-50 px-1.5 py-0.5 text-[11px] font-medium text-primary-700 dark:bg-primary-500/20 dark:text-primary-300"
          data-testid="pipeline-insertion-point-label"
        >
          {t('pipeline.insertionPointLabel', { defaultValue: 'New steps go here' })}
        </span>
      )}
    </div>
  );
};

/**
 * Empty Pipeline Placeholder
 */
export const EmptyPipeline: React.FC<{
  onAddStep?: () => void;
  disabled?: boolean;
  compact?: boolean;
  pipePath?: string;
}> = ({ onAddStep, disabled, compact = false, pipePath }) => {
  const { t } = useTranslation('msp/workflows');
  const isActive = useIsInsertionPoint(pipePath, 0);
  const canAdd = Boolean(onAddStep) && !disabled;
  const message = disabled
    ? t('pipeline.emptyDisabled', { defaultValue: 'No steps yet.' })
    : compact
      ? t('pipeline.emptyBranchPrompt', { defaultValue: 'Add a step to this branch' })
      : t('pipeline.emptySelectPrompt', { defaultValue: 'Select a step from the panel to get started.' });
  const className = `flex w-full flex-col items-center justify-center ${compact ? 'py-3 px-3' : 'py-8 px-4'} border-2 border-dashed rounded-lg transition-colors ${
    isActive
      ? 'border-primary-400 bg-primary-50 dark:bg-primary-500/15'
      : 'border-gray-300 bg-gray-50 dark:border-[rgb(var(--color-border-300))] dark:bg-[rgb(var(--color-background))]'
  } ${canAdd ? 'hover:border-primary-400 cursor-pointer' : ''}`;
  const content = (
    <>
      <div className={`${isActive ? 'text-primary-500' : 'text-gray-400'} ${compact ? 'mb-1' : 'mb-3'}`}>
        <Plus className={compact ? 'h-4 w-4' : 'h-8 w-8'} />
      </div>
      <p className={`text-center ${compact ? 'text-xs' : 'text-sm'} ${isActive ? 'text-primary-700 dark:text-primary-300' : 'text-gray-500'}`}>
        {isActive && !disabled
          ? t('pipeline.emptyActivePrompt', { defaultValue: 'New steps go here. Pick one from the palette.' })
          : message}
      </p>
    </>
  );

  if (!canAdd) {
    return (
      <div className={className} data-testid="empty-pipeline">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      id={pipePath ? `workflow-empty-pipe-${pipePath.replace(/[^a-zA-Z0-9_-]/g, '-')}` : undefined}
      className={className}
      data-testid="empty-pipeline"
      aria-pressed={isActive}
      onClick={(event) => {
        event.stopPropagation();
        onAddStep?.();
      }}
    >
      {content}
    </button>
  );
};

/**
 * Step Card Summary Content
 * Shows relevant info based on step type
 */
export const StepCardSummary: React.FC<{
  step: Step;
}> = ({ step }) => {
  const { t } = useTranslation('msp/workflows');
  if (step.type === 'action.call') {
    const config = (step as NodeStep).config as {
      actionId?: string;
      saveAs?: string;
      inputMapping?: Record<string, unknown>;
    } | undefined;
    // Update-action patch steps read as a change summary on the card.
    const patchChangeLabels = summarizeWorkflowPatchChanges(
      config?.inputMapping?.patch as Parameters<typeof summarizeWorkflowPatchChanges>[0]
    );
    return (
      <div className="space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          {config?.actionId && (
            <span className="text-xs text-gray-600 font-mono bg-gray-100 px-1.5 py-0.5 rounded">
              {config.actionId}
            </span>
          )}
          {config?.saveAs && (
            <Badge variant="outline" className="text-xs">
              → {config.saveAs}
            </Badge>
          )}
        </div>
        {patchChangeLabels.length > 0 && (
          <div className="text-xs text-gray-500">
            {formatWorkflowPatchChangeSummary(t, patchChangeLabels)}
            {' · '}
            {t('pipeline.patchSummary.unchanged', { defaultValue: 'other fields unchanged' })}
          </div>
        )}
      </div>
    );
  }

  if (step.type === 'control.if') {
    const ifStep = step as IfBlock;
    return <WorkflowConditionSummary expression={ifStep.condition?.$expr ?? ''} />;
  }

  if (step.type === 'control.forEach') {
    const forStep = step as ForEachBlock;
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">
          iterate as <code className="font-mono bg-gray-100 px-1 rounded">{forStep.itemVar || 'item'}</code>
        </span>
      </div>
    );
  }

  if (step.type === 'control.tryCatch') {
    const tryStep = step as TryCatchBlock;
    return (
      <span className="text-xs text-gray-500">
        {tryStep.captureErrorAs && (
          <>catch as <code className="font-mono bg-gray-100 px-1 rounded">{tryStep.captureErrorAs}</code></>
        )}
      </span>
    );
  }

  if (step.type === 'state.set') {
    const config = (step as NodeStep).config as { state?: string } | undefined;
    return config?.state ? (
      <span className="text-xs text-gray-500">
        → <code className="font-mono bg-gray-100 px-1 rounded">{config.state}</code>
      </span>
    ) : null;
  }

  if (step.type === 'event.wait') {
    const config = (step as NodeStep).config as { eventName?: string; filters?: unknown[]; timeoutMs?: number } | undefined;
    const filterCount = Array.isArray(config?.filters) ? config!.filters!.length : 0;
    return (
      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
        {config?.eventName && <span className="font-mono">{config.eventName}</span>}
        {filterCount > 0 && <Badge variant="outline" className="text-[10px]">filters: {filterCount}</Badge>}
        {typeof config?.timeoutMs === 'number' && <Badge variant="outline" className="text-[10px]">timeout: {config.timeoutMs}ms</Badge>}
      </div>
    );
  }

  if (step.type === 'time.wait') {
    const config = (step as NodeStep).config as { mode?: string; durationMs?: number } | undefined;
    if (config?.mode === 'duration' && typeof config.durationMs === 'number') {
      return <span className="text-xs text-gray-500">for {formatTimeWaitDuration(config.durationMs)}</span>;
    }
    if (config?.mode === 'until') {
      return <span className="text-xs text-gray-500">until expression</span>;
    }
    return null;
  }

  return null;
};

/**
 * Branch Label Component
 */
export const BranchLabel: React.FC<{
  label: string;
  variant?: 'then' | 'else' | 'try' | 'catch' | 'body';
}> = ({ label, variant = 'then' }) => {
  const colors = {
    then: 'bg-green-500/15 text-green-600 border-green-500/30',
    else: 'bg-gray-500/15 text-gray-600 border-gray-500/30',
    try: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
    catch: 'bg-orange-500/15 text-orange-600 border-orange-500/30',
    body: 'bg-purple-500/15 text-purple-600 border-purple-500/30'
  };

  return (
    <div className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colors[variant]}`}>
      {label}
    </div>
  );
};

/**
 * Collapsible Block Wrapper
 */
export const CollapsibleBlock: React.FC<{
  title: string;
  variant: 'then' | 'else' | 'try' | 'catch' | 'body';
  stepCount: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}> = ({ title, variant, stepCount, defaultExpanded = true, children }) => {
  const { t } = useTranslation('msp/workflows');
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 mb-2 hover:bg-gray-50 rounded px-1 py-0.5 -ml-1"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-gray-400" />
        ) : (
          <ChevronRight className="h-3 w-3 text-gray-400" />
        )}
        <BranchLabel label={title} variant={variant} />
        {!isExpanded && stepCount > 0 && (
          <span className="text-xs text-gray-400">
            {t('pipeline.stepCount', { defaultValue: '({{count}} steps)', count: stepCount })}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="ml-4 pl-3 border-l-2 border-dashed border-gray-200">
          {children}
        </div>
      )}
    </div>
  );
};

export type { Step, IfBlock, ForEachBlock, TryCatchBlock, NodeStep };
