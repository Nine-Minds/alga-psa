// server/src/components/projects/PhaseQuickAdd.tsx
'use client'
import React, { useState, useEffect } from 'react';
import { IProjectPhase } from 'server/src/interfaces/project.interfaces';
import { IProjectPhaseComment } from 'server/src/interfaces';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { TextArea } from 'server/src/components/ui/TextArea';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { toast } from 'react-hot-toast';
import { addProjectPhase } from 'server/src/lib/actions/project-actions/projectActions';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import PhaseComments from './PhaseComments';
import { addPhaseComment, getCommentUserMap } from 'server/src/lib/actions/project-actions/projectCommentActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';

interface PhaseQuickAddProps {
  projectId: string;
  onClose: () => void;
  onPhaseAdded: (newPhase: IProjectPhase) => void;
  onCancel: () => void;
}


const PhaseQuickAdd: React.FC<PhaseQuickAddProps> = ({ 
  projectId,
  onClose, 
  onPhaseAdded,
  onCancel
}) => {
  const [phaseName, setPhaseName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [phaseComments, setPhaseComments] = useState<IProjectPhaseComment[]>([]);
  const [commentUserMap, setCommentUserMap] = useState<Record<string, any>>({});
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [tempPhaseId] = useState<string>(`temp-phase-${Date.now()}`);

  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const user = await getCurrentUser();
        if (user) {
          setCurrentUserId(user.user_id);
          setCurrentUser(user);
        }
      } catch (error) {
        console.error('Error loading current user:', error);
      }
    };
    loadCurrentUser();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    if (phaseName.trim() === '') return;

    console.log('PhaseQuickAdd handleSubmit started');
    setIsSubmitting(true);

    try {
      const phaseData = {
        project_id: projectId,
        phase_name: phaseName.trim(),
        description: description || null,
        start_date: startDate || null,
        end_date: endDate || null,
        status: 'In Progress',
        order_number: 0, // Will be set by server
        wbs_code: '', // Will be set by server
      };

      const newPhase = await addProjectPhase(phaseData);

      // Save any comments that were added during creation
      if (phaseComments.length > 0) {
        console.log('Processing phase comments - count:', phaseComments.length);
        try {
          for (const comment of phaseComments) {
            if (comment.note) {
              console.log('Adding phase comment:', comment.project_phase_comment_id);
              await addPhaseComment(newPhase.phase_id, comment.note);
            }
          }
          console.log('Phase comment processing completed');
        } catch (error) {
          console.error('Error saving comments:', error);
          toast.error('Phase created but failed to save comments');
        }
      }

      console.log('Calling onPhaseAdded and onClose');
      onPhaseAdded(newPhase);
      onClose();
    } catch (error) {
      console.error('Error adding phase:', error);
      toast.error('Failed to add phase. Please try again.');
    } finally {
      console.log('PhaseQuickAdd finally block - setting isSubmitting to false');
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    onCancel();
    onClose();
  };

  return (
    <Dialog 
      isOpen={true} 
      onClose={() => {
        setHasAttemptedSubmit(false);
        onClose();
      }}
      title="Add New Phase"
      className="max-w-2xl"
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto">
          {hasAttemptedSubmit && !phaseName.trim() && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                Phase name is required
              </AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col">
            <div className="space-y-4 mb-2 mt-2">
              <TextArea
                value={phaseName}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPhaseName(e.target.value)}
                placeholder="Phase name... *"
                className={`w-full px-3 py-3 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 text-lg font-semibold ${hasAttemptedSubmit && !phaseName.trim() ? 'border-red-500' : 'border-gray-300'}`}
                rows={1}
              />
              <TextArea
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                placeholder="Description"
                className="w-full p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                rows={3}
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <DatePicker
                    value={startDate}
                    onChange={setStartDate}
                    placeholder="Select start date"
                    clearable={true}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <DatePicker
                    value={endDate}
                    onChange={setEndDate}
                    placeholder="Select end date"
                    clearable={true}
                  />
                </div>
              </div>

              {/* Comments section */}
              <div className="mt-6">
                <PhaseComments
                  phaseId={tempPhaseId}
                  comments={phaseComments}
                  userMap={commentUserMap}
                  currentUser={{
                    id: currentUserId,
                    name: currentUser ? `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() : null,
                    email: currentUser?.email || null,
                    avatarUrl: null
                  }}
                  onAddComment={async (content) => {
                    // For create mode, just add to local state - will be saved when phase is created
                    const newComment = {
                      project_phase_comment_id: `temp-${Date.now()}`,
                      tenant: '',
                      project_phase_id: tempPhaseId,
                      user_id: currentUserId,
                      note: content,
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString()
                    };
                    setPhaseComments([newComment, ...phaseComments]);
                    return true;
                  }}
                  onEditComment={async (commentId, updates) => {
                    // For create mode, update local state
                    setPhaseComments(phaseComments.map(c =>
                      c.project_phase_comment_id === commentId ? { ...c, note: updates } : c
                    ));
                  }}
                  onDeleteComment={async (commentId) => {
                    // For create mode, remove from local state
                    setPhaseComments(phaseComments.filter(c => c.project_phase_comment_id !== commentId));
                  }}
                  isSubmitting={false}
                  className="mb-6"
                  isCreateMode={true}
                />
              </div>
              <div className="flex justify-between mt-6">
                <Button id="cancel-phase-button" variant="ghost" onClick={handleCancel} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button id="save-phase-button" type="submit" disabled={isSubmitting} className={!phaseName.trim() ? 'opacity-50' : ''}>
                  {isSubmitting ? 'Adding...' : 'Save'}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
    </Dialog>
  );
};

export default PhaseQuickAdd;
