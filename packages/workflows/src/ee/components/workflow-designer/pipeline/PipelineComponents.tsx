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
import type { Step, IfBlock, ForEachBlock, TryCatchBlock, NodeStep } from '@shared/workflow/runtime';

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
        bg: 'bg-blue-50',
        text: 'text-blue-700',
        icon: 'text-blue-500',
        badge: 'bg-blue-100 text-blue-800'
      };
    case 'control.if':
      return {
        border: 'border-l-amber-500',
        bg: 'bg-amber-50',
        text: 'text-amber-700',
        icon: 'text-amber-500',
        badge: 'bg-amber-100 text-amber-800'
      };
    case 'control.forEach':
      return {
        border: 'border-l-purple-500',
        bg: 'bg-purple-50',
        text: 'text-purple-700',
        icon: 'text-purple-500',
        badge: 'bg-purple-100 text-purple-800'
      };
    case 'control.tryCatch':
      return {
        border: 'border-l-orange-500',
        bg: 'bg-orange-50',
        text: 'text-orange-700',
        icon: 'text-orange-500',
        badge: 'bg-orange-100 text-orange-800'
      };
    case 'control.return':
      return {
        border: 'border-l-red-500',
        bg: 'bg-red-50',
        text: 'text-red-700',
        icon: 'text-red-500',
        badge: 'bg-red-100 text-red-800'
      };
    case 'control.callWorkflow':
      return {
        border: 'border-l-cyan-500',
        bg: 'bg-cyan-50',
        text: 'text-cyan-700',
        icon: 'text-cyan-500',
        badge: 'bg-cyan-100 text-cyan-800'
      };
    case 'state.set':
      return {
        border: 'border-l-green-500',
        bg: 'bg-green-50',
        text: 'text-green-700',
        icon: 'text-green-500',
        badge: 'bg-green-100 text-green-800'
      };
    case 'transform.assign':
      return {
        border: 'border-l-teal-500',
        bg: 'bg-teal-50',
        text: 'text-teal-700',
        icon: 'text-teal-500',
        badge: 'bg-teal-100 text-teal-800'
      };
    case 'event.wait':
      return {
        border: 'border-l-indigo-500',
        bg: 'bg-indigo-50',
        text: 'text-indigo-700',
        icon: 'text-indigo-500',
        badge: 'bg-indigo-100 text-indigo-800'
      };
    case 'human.task':
      return {
        border: 'border-l-pink-500',
        bg: 'bg-pink-50',
        text: 'text-pink-700',
        icon: 'text-pink-500',
        badge: 'bg-pink-100 text-pink-800'
      };
    default:
      return {
        border: 'border-l-gray-400',
        bg: 'bg-gray-50',
        text: 'text-gray-700',
        icon: 'text-gray-500',
        badge: 'bg-gray-100 text-gray-800'
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
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 border-2 border-green-500">
        <Play className="h-4 w-4 text-green-600 ml-0.5" />
      </div>
      <div className="text-xs text-gray-500 mt-1">Start</div>
      {onInsert && !disabled && (
        <PipelineConnector onInsert={onInsert} position="start" />
      )}
    </div>
  );
};

/**
 * Pipeline Connector with Insert Button
 * Renders dashed line between steps with hover-activated plus button
 */
export const PipelineConnector: React.FC<{
  onInsert?: () => void;
  position?: 'start' | 'middle' | 'end';
  disabled?: boolean;
}> = ({ onInsert, position = 'middle', disabled }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="relative flex flex-col items-center py-1"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Dashed line */}
      <div
        className={`w-0.5 h-6 border-l-2 border-dashed ${
          isHovered ? 'border-primary-400' : 'border-gray-300'
        } transition-colors`}
      />

      {/* Insert button - shows on hover */}
      {onInsert && !disabled && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInsert();
          }}
          className={`absolute top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 rounded-full
            ${isHovered ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}
            bg-primary-500 hover:bg-primary-600 text-white shadow-sm
            transition-all duration-150 ease-out z-10`}
          title="Insert step here"
          data-testid="pipeline-insert-button"
        >
          <Plus className="h-3 w-3" />
        </button>
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
}> = ({ onAddStep, disabled }) => {
  return (
    <div
      className="flex flex-col items-center justify-center py-8 px-4 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50"
      data-testid="empty-pipeline"
    >
      <div className="text-gray-400 mb-3">
        <Plus className="h-8 w-8" />
      </div>
      <p className="text-sm text-gray-500 text-center mb-3">
        No steps yet. Add your first step to start building the workflow.
      </p>
      {onAddStep && !disabled && (
        <Button
          id="empty-pipeline-add-first-step"
          variant="outline"
          size="sm"
          onClick={onAddStep}
          data-testid="add-first-step-button"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add first step
        </Button>
      )}
    </div>
  );
};

/**
 * Step Card Summary Content
 * Shows relevant info based on step type
 */
export const StepCardSummary: React.FC<{
  step: Step;
}> = ({ step }) => {
  if (step.type === 'action.call') {
    const config = (step as NodeStep).config as { actionId?: string; saveAs?: string } | undefined;
    return (
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
    );
  }

  if (step.type === 'control.if') {
    const ifStep = step as IfBlock;
    const conditionPreview = ifStep.condition?.$expr?.slice(0, 30) || '';
    return (
      <span className="text-xs text-gray-500 font-mono truncate max-w-[200px]">
        {conditionPreview}{conditionPreview.length >= 30 ? '...' : ''}
      </span>
    );
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
    const config = (step as NodeStep).config as { eventName?: string } | undefined;
    return config?.eventName ? (
      <span className="text-xs text-gray-500 font-mono">
        {config.eventName}
      </span>
    ) : null;
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
    then: 'bg-green-100 text-green-700 border-green-200',
    else: 'bg-gray-100 text-gray-700 border-gray-200',
    try: 'bg-blue-100 text-blue-700 border-blue-200',
    catch: 'bg-orange-100 text-orange-700 border-orange-200',
    body: 'bg-purple-100 text-purple-700 border-purple-200'
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
            ({stepCount} step{stepCount !== 1 ? 's' : ''})
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
