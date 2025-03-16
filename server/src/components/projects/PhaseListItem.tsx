'use client';

import { IProjectPhase } from 'server/src/interfaces/project.interfaces';
import { Pencil, Check, X, Trash2 } from 'lucide-react';
import { TextArea } from '../ui/TextArea';
import { DatePicker } from 'server/src/components/ui/DatePicker';

interface PhaseListItemProps {
  phase: IProjectPhase;
  isSelected: boolean;
  isEditing: boolean;
  isDragOver: boolean;
  editingName: string;
  editingStartDate?: Date;
  editingEndDate?: Date;
  onSelect: (phase: IProjectPhase) => void;
  onEdit: (phase: IProjectPhase) => void;
  onSave: (phase: IProjectPhase) => void;
  onCancel: () => void;
  onDelete: (phase: IProjectPhase) => void;
  onNameChange: (name: string) => void;
  onStartDateChange?: (date: Date | undefined) => void;
  onEndDateChange?: (date: Date | undefined) => void;
  onDragOver: (e: React.DragEvent, phaseId: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, phase: IProjectPhase) => void;
}

export const PhaseListItem: React.FC<PhaseListItemProps> = ({
  phase,
  isSelected,
  isEditing,
  isDragOver,
  editingName,
  editingStartDate,
  editingEndDate,
  onSelect,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onNameChange,
  onStartDateChange,
  onEndDateChange,
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  return (
    <li
      className={`flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer group transition-colors
        ${isSelected ? 'bg-purple-50' : 'hover:bg-gray-50'}
        ${isDragOver ? 'bg-purple-50/50' : ''}
      `}
      onClick={() => {
        if (!isEditing) {
          onSelect(phase);
        }
      }}
      onDragOver={(e) => onDragOver(e, phase.phase_id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, phase)}
    >
      {isEditing ? (
        <div className="flex items-start justify-between w-full gap-3">
          <div className="flex-1 min-w-0 pr-1">
            <div className="mb-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Phase Name</label>
              <TextArea
                value={editingName}
                onChange={(e) => onNameChange(e.target.value)}
                className="w-full px-3 py-1 border border-gray-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            </div>
            <div className="mb-2">
              <label className="block text-sm font-medium text-gray-700 mb-0.5">Start Date</label>
              <DatePicker
                value={editingStartDate}
                onChange={(date: Date) => onStartDateChange?.(date)}
                placeholder="Start date"
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-0.5">End Date</label>
              <DatePicker
                value={editingEndDate}
                onChange={(date: Date) => onEndDateChange?.(date)}
                placeholder="End date"
                className="w-full"
              />
            </div>
          </div>
          <div className="flex gap-1 ml-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSave(phase);
              }}
              className="text-green-600 hover:text-green-800 p-1 rounded-md hover:bg-green-50 transition-colors"
              title="Save changes"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="text-red-600 hover:text-red-800 p-1 rounded-md hover:bg-red-50 transition-colors"
              title="Cancel editing"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col">
            <span className="text-lg font-bold text-gray-900">{phase.wbs_code.split('.').pop()} {phase.phase_name}</span>
            {phase.description && (
              <span className="text-sm text-gray-600 mt-1">{phase.description}</span>
            )}
            <div className="mt-1 text-xs text-gray-500 space-y-1">
              <div>
                Start: {phase.start_date ? 
                  new Date(phase.start_date).toLocaleDateString() : 
                  'Not set'}
              </div>
              <div>
                Due: {phase.end_date ? 
                  new Date(phase.end_date).toLocaleDateString() : 
                  'Not set'}
              </div>
            </div>
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(phase);
              }}
              className="p-1 rounded-md hover:bg-gray-50 transition-colors"
              title="Edit phase"
            >
              <Pencil className="w-4 h-4 text-gray-500 hover:text-gray-700" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(phase);
              }}
              className="p-1 rounded-md hover:bg-red-50 transition-colors"
              title="Delete phase"
            >
              <Trash2 className="w-4 h-4 text-red-600 hover:text-red-800" />
            </button>
          </div>
        </>
      )}
    </li>
  );
};

export default PhaseListItem;
