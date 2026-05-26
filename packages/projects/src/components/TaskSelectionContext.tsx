'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

export interface TaskSelectionContextValue {
  selectedTaskIds: Set<string>;
  isSelected: (taskId: string) => boolean;
  toggleTask: (taskId: string) => void;
  setTasksSelected: (taskIds: string[], selected: boolean) => void;
  clearSelection: () => void;
}

const noopContext: TaskSelectionContextValue = {
  selectedTaskIds: new Set<string>(),
  isSelected: () => false,
  toggleTask: () => {},
  setTasksSelected: () => {},
  clearSelection: () => {},
};

const TaskSelectionContext = createContext<TaskSelectionContextValue>(noopContext);

export function TaskSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  const toggleTask = useCallback((taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const setTasksSelected = useCallback((taskIds: string[], selected: boolean) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      for (const id of taskIds) {
        if (selected) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedTaskIds(new Set());
  }, []);

  const isSelected = useCallback(
    (taskId: string) => selectedTaskIds.has(taskId),
    [selectedTaskIds],
  );

  const value = useMemo<TaskSelectionContextValue>(
    () => ({ selectedTaskIds, isSelected, toggleTask, setTasksSelected, clearSelection }),
    [selectedTaskIds, isSelected, toggleTask, setTasksSelected, clearSelection],
  );

  return <TaskSelectionContext.Provider value={value}>{children}</TaskSelectionContext.Provider>;
}

export function useTaskSelection(): TaskSelectionContextValue {
  return useContext(TaskSelectionContext);
}
