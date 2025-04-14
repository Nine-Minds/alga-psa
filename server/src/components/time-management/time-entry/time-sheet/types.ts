import { ITimeEntry, ITimePeriodView } from 'server/src/interfaces';
import { TaxRegion } from 'server/src/types/types.d';

export interface Service {
  id: string;
  name: string;
  type: string;
  tax_rate_id: string | null; // Use tax_rate_id instead
}

export interface ITimeEntryWithNew extends Omit<ITimeEntry, 'tenant'> {
  isNew?: boolean;
  isDirty?: boolean;
  tempId?: string;
  company_id?: string; // Added for billing plan selection
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
  onSave: (index: number) => Promise<void>;
  onDelete: (index: number) => Promise<void>;
  onUpdateEntry: (index: number, entry: ITimeEntryWithNew) => void;
  onUpdateTimeInputs: (inputs: TimeInputs) => void;
  lastNoteInputRef?: React.RefObject<HTMLInputElement>;
  timePeriod?: ITimePeriodView;
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
