import { ITimeEntry } from '../../interfaces/timeEntry.interfaces';
import { TaxRegion } from '../../types/types.d';

export interface Service {
  id: string;
  name: string;
  type: string;
  is_taxable: boolean;
}

export interface ITimeEntryWithNew extends Omit<ITimeEntry, 'tenant'> {
  isNew?: boolean;
  isDirty?: boolean;
  tempId?: string;
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
  onCollapse: () => void;
  onUpdateEntry: (index: number, entry: ITimeEntryWithNew) => void;
  onUpdateTimeInputs: (inputs: TimeInputs) => void;
  lastNoteInputRef?: React.RefObject<HTMLInputElement>;
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