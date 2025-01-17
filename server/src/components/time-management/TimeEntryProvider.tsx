'use client';

import { createContext, useContext, useReducer, useEffect } from 'react';
import { ITimeEntry, ITimeEntryWithWorkItem, ITimePeriod } from '../../interfaces/timeEntry.interfaces';
import { IWorkItem } from '../../interfaces/workItem.interfaces';
import { TaxRegion } from '../../types/types.d';
import { fetchCompanyTaxRateForWorkItem, fetchServicesForTimeEntry, fetchTaxRegions } from '../../lib/actions/timeEntryActions';
import { formatISO, parseISO } from 'date-fns';

interface Service {
  id: string;
  name: string;
  type: string;
  is_taxable: boolean;
}

interface ITimeEntryWithNew extends Omit<ITimeEntry, 'tenant'> {
  isNew?: boolean;
  isDirty?: boolean;
  tempId?: string;
}

interface TimeEntryState {
  entries: ITimeEntryWithNew[];
  services: Service[];
  taxRegions: TaxRegion[];
  timeInputs: { [key: string]: string };
  editingIndex: number | null;
  totalDurations: number[];
  isLoading: boolean;
  error: string | null;
}

type TimeEntryAction =
  | { type: 'SET_INITIAL_DATA'; payload: { services: Service[]; taxRegions: TaxRegion[] } }
  | { type: 'SET_ENTRIES'; payload: ITimeEntryWithNew[] }
  | { type: 'SET_EDITING_INDEX'; payload: number | null }
  | { type: 'UPDATE_TIME_INPUTS'; payload: { [key: string]: string } }
  | { type: 'UPDATE_ENTRY'; payload: { index: number; entry: ITimeEntryWithNew } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'UPDATE_DURATIONS'; payload: number[] };

const initialState: TimeEntryState = {
  entries: [],
  services: [],
  taxRegions: [],
  timeInputs: {},
  editingIndex: null,
  totalDurations: [],
  isLoading: true,
  error: null,
};

function timeEntryReducer(state: TimeEntryState, action: TimeEntryAction): TimeEntryState {
  switch (action.type) {
    case 'SET_INITIAL_DATA':
      return {
        ...state,
        services: action.payload.services,
        taxRegions: action.payload.taxRegions,
        isLoading: false,
      };
    case 'SET_ENTRIES':
      return {
        ...state,
        entries: action.payload,
      };
    case 'SET_EDITING_INDEX':
      return {
        ...state,
        editingIndex: action.payload,
      };
    case 'UPDATE_TIME_INPUTS':
      return {
        ...state,
        timeInputs: {
          ...state.timeInputs,
          ...action.payload,
        },
      };
    case 'UPDATE_ENTRY':
      const newEntries = [...state.entries];
      newEntries[action.payload.index] = action.payload.entry;
      return {
        ...state,
        entries: newEntries,
      };
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      };
    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
      };
    case 'UPDATE_DURATIONS':
      return {
        ...state,
        totalDurations: action.payload,
      };
    default:
      return state;
  }
}

interface InitializeEntriesParams {
  existingEntries?: ITimeEntryWithWorkItem[];
  defaultStartTime?: Date;
  defaultEndTime?: Date;
  defaultTaxRegion?: string;
  workItem: Omit<IWorkItem, 'tenant'>;
  date: Date;
}

interface TimeEntryContextType extends TimeEntryState {
  initializeEntries: (params: InitializeEntriesParams) => Promise<void>;
  updateEntry: (index: number, entry: ITimeEntryWithNew) => void;
  setEditingIndex: (index: number | null) => void;
  updateTimeInputs: (inputs: { [key: string]: string }) => void;
}

const TimeEntryContext = createContext<TimeEntryContextType | undefined>(undefined);

export function TimeEntryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(timeEntryReducer, initialState);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        dispatch({ type: 'SET_LOADING', payload: true });
        const [services, taxRegions] = await Promise.all([
          fetchServicesForTimeEntry(),
          fetchTaxRegions(),
        ]);
        dispatch({
          type: 'SET_INITIAL_DATA',
          payload: { services, taxRegions },
        });
      } catch (error) {
        console.error('Error loading initial data:', error);
        dispatch({
          type: 'SET_ERROR',
          payload: 'Failed to load services and tax regions',
        });
      }
    };

    loadInitialData();
  }, []);

  const initializeEntries = async ({
    existingEntries,
    defaultStartTime,
    defaultEndTime,
    defaultTaxRegion,
    workItem,
    date,
  }: InitializeEntriesParams) => {
    let defaultTaxRegionFromCompany: string | undefined;

    if (workItem.type === 'ticket' || workItem.type === 'project_task') {
      try {
        defaultTaxRegionFromCompany = await fetchCompanyTaxRateForWorkItem(
          workItem.work_item_id,
          workItem.type
        );
      } catch (error) {
        console.error('Error fetching company tax rate:', error);
      }
    }

    let newEntries: ITimeEntryWithNew[] = [];

    if (existingEntries?.length) {
      newEntries = existingEntries.map(({ tenant: _tenant, ...rest }): ITimeEntryWithNew => ({
        ...rest,
        start_time: formatISO(parseISO(rest.start_time)),
        end_time: formatISO(parseISO(rest.end_time)),
        created_at: formatISO(parseISO(rest.created_at)),
        updated_at: formatISO(parseISO(rest.updated_at)),
        tax_region: rest.tax_region || defaultTaxRegion || defaultTaxRegionFromCompany || '',
        isNew: false,
        isDirty: false,
      }));
    } else if (defaultStartTime && defaultEndTime) {
      const duration = calculateDuration(defaultStartTime, defaultEndTime);
      newEntries = [{
        work_item_id: workItem.work_item_id,
        start_time: formatISO(defaultStartTime),
        end_time: formatISO(defaultEndTime),
        billable_duration: duration,
        work_item_type: workItem.type,
        notes: '',
        entry_id: '',
        user_id: '',
        created_at: formatISO(new Date()),
        updated_at: formatISO(new Date()),
        approval_status: 'DRAFT',
        service_id: '',
        tax_region: defaultTaxRegion || defaultTaxRegionFromCompany || '',
        isNew: true,
        tempId: crypto.randomUUID(),
      }];
    } else {
      const defaultStart = new Date(date);
      defaultStart.setHours(8, 0, 0, 0);
      const defaultEnd = new Date(defaultStart);
      defaultEnd.setHours(9, 0, 0, 0);
      const duration = calculateDuration(defaultStart, defaultEnd);

      newEntries = [{
        work_item_id: workItem.work_item_id,
        start_time: formatISO(defaultStart),
        end_time: formatISO(defaultEnd),
        billable_duration: duration,
        work_item_type: workItem.type,
        notes: '',
        entry_id: '',
        user_id: '',
        created_at: formatISO(new Date()),
        updated_at: formatISO(new Date()),
        approval_status: 'DRAFT',
        service_id: '',
        tax_region: defaultTaxRegion || '',
        isNew: true,
        tempId: crypto.randomUUID(),
      }];
    }

    const sortedEntries = [...newEntries].sort((a, b) =>
      parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime()
    );

    dispatch({ type: 'SET_ENTRIES', payload: sortedEntries });
    
    // Set initial editing index
    if (sortedEntries.length === 1 && !existingEntries?.length) {
      dispatch({ type: 'SET_EDITING_INDEX', payload: 0 });
    }

    // Calculate initial durations
    const durations = sortedEntries.map(entry =>
      calculateDuration(parseISO(entry.start_time), parseISO(entry.end_time))
    );
    dispatch({ type: 'UPDATE_DURATIONS', payload: durations });
  };

  const updateEntry = (index: number, entry: ITimeEntryWithNew) => {
    dispatch({ type: 'UPDATE_ENTRY', payload: { index, entry } });
  };

  const setEditingIndex = (index: number | null) => {
    dispatch({ type: 'SET_EDITING_INDEX', payload: index });
  };

  const updateTimeInputs = (inputs: { [key: string]: string }) => {
    dispatch({ type: 'UPDATE_TIME_INPUTS', payload: inputs });
  };

  return (
    <TimeEntryContext.Provider
      value={{
        ...state,
        initializeEntries,
        updateEntry,
        setEditingIndex,
        updateTimeInputs,
      }}
    >
      {children}
    </TimeEntryContext.Provider>
  );
}

export function useTimeEntry() {
  const context = useContext(TimeEntryContext);
  if (context === undefined) {
    throw new Error('useTimeEntry must be used within a TimeEntryProvider');
  }
  return context;
}

// Helper function
function calculateDuration(startTime: Date, endTime: Date): number {
  return Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 60000));
}