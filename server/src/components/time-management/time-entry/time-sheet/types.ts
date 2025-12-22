import { ITimeEntry, ITimePeriodView } from 'server/src/interfaces';
import { TaxRegion } from 'server/src/types/types.d';

export interface Service {
  id: string;
  name: string;
  type: string;
  tax_rate_id: string | null;
  tax_percentage: number | null;
}

export interface ITimeEntryWithNew extends Omit<ITimeEntry, 'tenant'> {
  isNew?: boolean;
  isDirty?: boolean;
  tempId?: string;
  client_id?: string; // Added for contract line selection
  tax_rate_id?: string | null; // ID of the applied tax rate
  tax_percentage?: number | null; // Percentage of the applied tax rate
  // Service prefill tracking (only for new entries)
  _isServicePrefilled?: boolean; // True if service was auto-filled from work item
  _originalServiceId?: string | null; // Original prefilled service ID
  _serviceOverridden?: boolean; // True if user changed the prefilled service
}

export interface TimeInputs {
  [key: string]: string;
}

export interface TimeEntryFormProps {
  id: string;
  entry: ITimeEntryWithNew;
  index: number;
  isEditable: boolean;
  services: Service[];
  taxRegions: TaxRegion[];
  timeInputs: TimeInputs;
  totalDuration: number;
  onSave?: (index: number) => Promise<void>;
  onDelete: (index: number) => Promise<void>;
  onUpdateEntry: (index: number, entry: ITimeEntryWithNew) => void;
  onUpdateTimeInputs: (inputs: TimeInputs) => void;
  lastNoteInputRef?: React.RefObject<HTMLInputElement | null>;
  timePeriod?: ITimePeriodView;
  date?: Date;
  isNewEntry?: boolean;
}

export interface TimeEntryReadOnlyProps {
  id: string;
  entry: ITimeEntryWithNew;
  index: number;
  isEditable: boolean;
  services: Service[];
  onEdit: (index: number) => void;
  onDelete: (index: number) => Promise<void>;
}

export interface TimeSheetDateNavigatorState {
  dateRangeDisplay: string;
  canGoBack: boolean;
  canGoForward: boolean;
  hasMultiplePages: boolean;
  currentPage: number;
  totalPages: number;
  isAnimating: boolean;
  goToPreviousPage: () => void;
  goToNextPage: () => void;
}
