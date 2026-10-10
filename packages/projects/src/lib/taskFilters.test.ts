import { describe, expect, it } from 'vitest';
import {
  filterTasks,
  matchesTaskFilters,
  type FilterableTask,
  type TaskFilterContext,
} from './taskFilters';

const task = (overrides: Partial<FilterableTask> & { task_id: string }): FilterableTask => ({
  task_name: 'Task',
  description: null,
  priority_id: null,
  task_type_key: 'task',
  assigned_to: null,
  assigned_team_id: null,
  ...overrides,
});

describe('matchesTaskFilters', () => {
  it('passes every task through when no criteria are set', () => {
    const subject = task({ task_id: 't1', task_name: 'Replace the switch' });

    expect(matchesTaskFilters(subject, {})).toBe(true);
    expect(matchesTaskFilters(subject, { searchQuery: '   ', priorityId: 'all', taskTypeKey: 'all' })).toBe(true);
  });

  describe('search', () => {
    const subject = task({
      task_id: 't1',
      task_name: 'Patch the Firewall',
      description: 'Scheduled during the maintenance window',
    });

    it('matches the task name case-insensitively by default', () => {
      expect(matchesTaskFilters(subject, { searchQuery: 'firewall' })).toBe(true);
      expect(matchesTaskFilters(subject, { searchQuery: 'router' })).toBe(false);
    });

    it('matches the description text', () => {
      expect(matchesTaskFilters(subject, { searchQuery: 'maintenance' })).toBe(true);
    });

    it('honours case sensitivity', () => {
      expect(matchesTaskFilters(subject, { searchQuery: 'firewall', searchCaseSensitive: true })).toBe(false);
      expect(matchesTaskFilters(subject, { searchQuery: 'Firewall', searchCaseSensitive: true })).toBe(true);
    });

    it('honours whole-word matching', () => {
      expect(matchesTaskFilters(subject, { searchQuery: 'wall' })).toBe(true);
      expect(matchesTaskFilters(subject, { searchQuery: 'wall', searchWholeWord: true })).toBe(false);
      expect(matchesTaskFilters(subject, { searchQuery: 'Firewall', searchWholeWord: true })).toBe(true);
    });

    it('treats regex-special characters as literals', () => {
      const dotted = task({ task_id: 't2', task_name: 'Upgrade v1.2 (beta)' });

      expect(matchesTaskFilters(dotted, { searchQuery: 'v1.2' })).toBe(true);
      expect(matchesTaskFilters(dotted, { searchQuery: 'v1x2' })).toBe(false);
      expect(matchesTaskFilters(dotted, { searchQuery: 'beta', searchWholeWord: true })).toBe(true);
      // the escaped parens are literal, and \b never sits next to one
      expect(matchesTaskFilters(dotted, { searchQuery: '(beta)', searchWholeWord: true })).toBe(false);
    });

    it('uses pre-extracted description text when the caller supplies it', () => {
      const ctx: TaskFilterContext = { descriptionText: () => 'memoized haystack' };

      expect(matchesTaskFilters(subject, { searchQuery: 'haystack' }, ctx)).toBe(true);
      expect(matchesTaskFilters(subject, { searchQuery: 'maintenance' }, ctx)).toBe(false);
    });

    it('reads plain text out of rich-text descriptions', () => {
      const rich = task({
        task_id: 't3',
        task_name: 'Ship it',
        description_rich_text: JSON.stringify([
          { type: 'paragraph', content: [{ type: 'text', text: 'emerald city rollout' }] },
        ]),
      });

      expect(matchesTaskFilters(rich, { searchQuery: 'emerald' })).toBe(true);
    });
  });

  describe('priority and task type', () => {
    const subject = task({ task_id: 't1', priority_id: 'p-high', task_type_key: 'bug' });

    it('filters by priority id', () => {
      expect(matchesTaskFilters(subject, { priorityId: 'p-high' })).toBe(true);
      expect(matchesTaskFilters(subject, { priorityId: 'p-low' })).toBe(false);
    });

    it('filters by task type key', () => {
      expect(matchesTaskFilters(subject, { taskTypeKey: 'bug' })).toBe(true);
      expect(matchesTaskFilters(subject, { taskTypeKey: 'story' })).toBe(false);
    });

    it('ignores unset tasks when a value is required', () => {
      const untyped = task({ task_id: 't2', priority_id: null });
      expect(matchesTaskFilters(untyped, { priorityId: 'p-high' })).toBe(false);
    });
  });

  describe('tags', () => {
    const ctx: TaskFilterContext = {
      tags: {
        t1: [{ tag_text: 'urgent' }, { tag_text: 'client-facing' }],
        t2: [],
      },
    };

    it('matches when the task carries any selected tag', () => {
      expect(matchesTaskFilters(task({ task_id: 't1' }), { tags: ['urgent'] }, ctx)).toBe(true);
      expect(matchesTaskFilters(task({ task_id: 't1' }), { tags: ['later', 'urgent'] }, ctx)).toBe(true);
      expect(matchesTaskFilters(task({ task_id: 't1' }), { tags: ['later'] }, ctx)).toBe(false);
    });

    it('excludes untagged tasks once a tag filter is active', () => {
      expect(matchesTaskFilters(task({ task_id: 't2' }), { tags: ['urgent'] }, ctx)).toBe(false);
      expect(matchesTaskFilters(task({ task_id: 't9' }), { tags: ['urgent'] }, ctx)).toBe(false);
      expect(matchesTaskFilters(task({ task_id: 't2' }), {}, ctx)).toBe(true);
    });
  });

  describe('agents, teams and unassigned', () => {
    const ctx: TaskFilterContext = {
      resources: {
        't-extra': [{ additional_user_id: 'u-tin' }, { additional_user_id: null }],
      },
    };

    const assigned = task({ task_id: 't-assigned', assigned_to: 'u-dorothy' });
    const extra = task({ task_id: 't-extra', assigned_to: 'u-glinda' });
    const unassigned = task({ task_id: 't-none', assigned_to: null });
    const teamed = task({ task_id: 't-team', assigned_to: 'u-lion', assigned_team_id: 'team-oz' });

    it('matches the primary assignee', () => {
      expect(matchesTaskFilters(assigned, { agentIds: ['u-dorothy'] }, ctx)).toBe(true);
      expect(matchesTaskFilters(assigned, { agentIds: ['u-tin'] }, ctx)).toBe(false);
    });

    it('matches additional agents from task resources', () => {
      expect(matchesTaskFilters(extra, { agentIds: ['u-tin'] }, ctx)).toBe(true);
    });

    it('ignores additional agents when primaryAgentOnly is set for a single agent', () => {
      expect(matchesTaskFilters(extra, { agentIds: ['u-tin'], primaryAgentOnly: true }, ctx)).toBe(false);
      // primary-only only applies to a single-agent selection
      expect(matchesTaskFilters(extra, { agentIds: ['u-tin', 'u-scarecrow'], primaryAgentOnly: true }, ctx)).toBe(true);
    });

    it('includes unassigned tasks only when asked', () => {
      expect(matchesTaskFilters(unassigned, { includeUnassigned: true }, ctx)).toBe(true);
      expect(matchesTaskFilters(unassigned, { agentIds: ['u-dorothy'] }, ctx)).toBe(false);
      expect(matchesTaskFilters(unassigned, { agentIds: ['u-dorothy'], includeUnassigned: true }, ctx)).toBe(true);
      expect(matchesTaskFilters(assigned, { includeUnassigned: true }, ctx)).toBe(false);
    });

    it('matches the assigned team', () => {
      expect(matchesTaskFilters(teamed, { teamIds: ['team-oz'] }, ctx)).toBe(true);
      expect(matchesTaskFilters(teamed, { teamIds: ['team-kansas'] }, ctx)).toBe(false);
      expect(matchesTaskFilters(assigned, { teamIds: ['team-oz'] }, ctx)).toBe(false);
    });

    it('matches either the agent or the team when both are selected', () => {
      expect(matchesTaskFilters(assigned, { agentIds: ['u-dorothy'], teamIds: ['team-kansas'] }, ctx)).toBe(true);
      expect(matchesTaskFilters(teamed, { agentIds: ['u-dorothy'], teamIds: ['team-oz'] }, ctx)).toBe(true);
    });
  });

  it('requires every active dimension to match', () => {
    const ctx: TaskFilterContext = { tags: { t1: [{ tag_text: 'urgent' }] } };
    const subject = task({
      task_id: 't1',
      task_name: 'Patch the firewall',
      priority_id: 'p-high',
      task_type_key: 'bug',
      assigned_to: 'u-dorothy',
    });

    expect(matchesTaskFilters(subject, {
      searchQuery: 'firewall',
      priorityId: 'p-high',
      taskTypeKey: 'bug',
      tags: ['urgent'],
      agentIds: ['u-dorothy'],
    }, ctx)).toBe(true);

    // one dimension off is enough to exclude the task
    expect(matchesTaskFilters(subject, {
      searchQuery: 'firewall',
      priorityId: 'p-high',
      taskTypeKey: 'story',
      tags: ['urgent'],
      agentIds: ['u-dorothy'],
    }, ctx)).toBe(false);
  });
});

describe('filterTasks', () => {
  it('keeps the matching tasks in their original order', () => {
    const tasks = [
      task({ task_id: 't1', task_name: 'Patch firewall', task_type_key: 'bug' }),
      task({ task_id: 't2', task_name: 'Patch switch', task_type_key: 'task' }),
      task({ task_id: 't3', task_name: 'Document firewall', task_type_key: 'bug' }),
    ];

    expect(filterTasks(tasks, { searchQuery: 'patch' }).map(t => t.task_id)).toEqual(['t1', 't2']);
    expect(filterTasks(tasks, { taskTypeKey: 'bug' }).map(t => t.task_id)).toEqual(['t1', 't3']);
    expect(filterTasks(tasks, { searchQuery: 'patch', taskTypeKey: 'bug' }).map(t => t.task_id)).toEqual(['t1']);
    expect(filterTasks(tasks, {})).toHaveLength(3);
  });
});
