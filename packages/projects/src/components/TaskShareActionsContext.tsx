'use client';

import * as React from 'react';

export type TaskShareActionsRegistration = {
  triggerPrint: () => void | Promise<void>;
  openPrintOptions: () => void;
  isPrinting: boolean;
};

type TaskShareActionsContextValue = {
  registration: TaskShareActionsRegistration | null;
  register: (value: TaskShareActionsRegistration) => void;
  unregister: () => void;
};

const TaskShareActionsContext = React.createContext<TaskShareActionsContextValue>({
  registration: null,
  register: () => {},
  unregister: () => {},
});

export function TaskShareActionsProvider({ children }: { children: React.ReactNode }) {
  const [registration, setRegistration] = React.useState<TaskShareActionsRegistration | null>(null);

  const register = React.useCallback((value: TaskShareActionsRegistration) => {
    setRegistration(value);
  }, []);

  const unregister = React.useCallback(() => {
    setRegistration(null);
  }, []);

  const value = React.useMemo(
    () => ({ registration, register, unregister }),
    [registration, register, unregister]
  );

  return (
    <TaskShareActionsContext.Provider value={value}>
      {children}
    </TaskShareActionsContext.Provider>
  );
}

export function useTaskShareActions() {
  return React.useContext(TaskShareActionsContext);
}

/** Hook used by TaskListView to publish its print actions to the header. */
export function useRegisterTaskShareActions(value: TaskShareActionsRegistration | null) {
  const { register, unregister } = useTaskShareActions();

  React.useEffect(() => {
    if (!value) return;
    register(value);
    return () => {
      unregister();
    };
  }, [register, unregister, value]);
}
