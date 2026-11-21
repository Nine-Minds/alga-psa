import { IBoard, IPriority } from '@alga-psa/types';

/**
 * One rule for "the default priority of this board", shared by the MSP Quick Add
 * and the client portal ticket form so a board's configured default is honoured
 * wherever a ticket is created.
 */

export const getDefaultPriorityId = (availablePriorities: IPriority[], priorityType?: 'custom' | 'itil'): string => {
  if (!availablePriorities.length) return '';

  if (priorityType === 'itil') {
    const itilPriorities = availablePriorities.filter(priority => priority.is_from_itil_standard);
    const mediumItilPriority = itilPriorities.find(priority => priority.itil_priority_level === 3);
    return mediumItilPriority?.priority_id || itilPriorities[0]?.priority_id || availablePriorities[0]?.priority_id || '';
  }

  const customPriorities = availablePriorities.filter(priority => !priority.is_from_itil_standard);
  return customPriorities[0]?.priority_id || availablePriorities[0]?.priority_id || '';
};

export const getBoardDefaultPriorityId = (board: IBoard | undefined, availablePriorities: IPriority[]): string => {
  if (!availablePriorities.length) return '';

  const boardDefault = board?.default_priority_id || '';
  if (boardDefault) {
    const match = availablePriorities.find(p => p.priority_id === boardDefault);
    if (match) {
      // Guard against misconfiguration: only use ITIL defaults for ITIL boards and vice versa.
      const priorityType = board?.priority_type || 'custom';
      if (priorityType === 'itil' && match.is_from_itil_standard) return boardDefault;
      if (priorityType !== 'itil' && !match.is_from_itil_standard) return boardDefault;
    }
  }

  return getDefaultPriorityId(availablePriorities, board?.priority_type);
};
