import { IBoard, IPriority } from '@alga-psa/types';

/**
 * The client half of the board field rules: which priorities a board offers, and which of them is
 * its default. The server half is `@alga-psa/shared/lib/tickets/boardFieldRules`
 * (`listPrioritiesForBoard`, `defaultPriorityForBoard`); these two agree on R3 and R7 and exist
 * separately only because a picker filters a list it has already fetched.
 *
 * Every picker uses {@link filterPrioritiesForBoard} rather than its own copy of the family test,
 * so a board never offers a priority the server then refuses
 * (ee/plans/2026-11-21-itil-remediation, R3/F092).
 */

/** R3: a priority's family must match the board's `priority_type`. A missing kind is the tenant's own. */
export const priorityFitsBoardKind = (
  priority: { is_from_itil_standard?: boolean | null },
  priorityType?: string | null,
): boolean => Boolean(priority.is_from_itil_standard) === (priorityType === 'itil');

/**
 * The priorities a board offers. `keep` lists a value anyway — a ticket's own stored priority, so
 * a legacy row still renders in its picker (R5/D3); nothing else is added.
 */
export const filterPrioritiesForBoard = <T extends { is_from_itil_standard?: boolean | null }>(
  priorities: readonly T[],
  priorityType?: string | null,
  options?: { keep?: (priority: T) => boolean },
): T[] => priorities.filter(
  (priority) => priorityFitsBoardKind(priority, priorityType) || options?.keep?.(priority) === true,
);

export const getDefaultPriorityId = (availablePriorities: IPriority[], priorityType?: 'custom' | 'itil'): string => {
  if (!availablePriorities.length) return '';

  if (priorityType === 'itil') {
    const itilPriorities = filterPrioritiesForBoard(availablePriorities, 'itil');
    const mediumItilPriority = itilPriorities.find(priority => priority.itil_priority_level === 3);
    return mediumItilPriority?.priority_id || itilPriorities[0]?.priority_id || availablePriorities[0]?.priority_id || '';
  }

  const customPriorities = filterPrioritiesForBoard(availablePriorities, 'custom');
  return customPriorities[0]?.priority_id || availablePriorities[0]?.priority_id || '';
};

export const getBoardDefaultPriorityId = (board: IBoard | undefined, availablePriorities: IPriority[]): string => {
  if (!availablePriorities.length) return '';

  const boardDefault = board?.default_priority_id || '';
  if (boardDefault) {
    const match = availablePriorities.find(p => p.priority_id === boardDefault);
    if (match) {
      // Guard against misconfiguration: only use ITIL defaults for ITIL boards and vice versa.
      if (priorityFitsBoardKind(match, board?.priority_type)) return boardDefault;
    }
  }

  return getDefaultPriorityId(availablePriorities, board?.priority_type);
};
