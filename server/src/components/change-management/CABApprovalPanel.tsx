'use client'

import React, { useState, useEffect } from 'react';
import { IChangeRequest } from '../../interfaces/change.interfaces';

interface CABMember {
  id: string;
  name: string;
  role: string;
  email: string;
  vote?: 'approve' | 'reject' | 'abstain';
  comments?: string;
  votedAt?: string;
}

interface CABMeeting {
  id: string;
  changeId: string;
  meetingDate: Date;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  decision?: 'approved' | 'rejected' | 'deferred';
  members: CABMember[];
  quorum: number;
  votingDeadline?: Date;
  chairperson: string;
}

interface CABApprovalPanelProps {
  changeRequest: IChangeRequest;
  meeting?: CABMeeting;
  currentUserId: string;
  userRole: string;
  onVote?: (vote: 'approve' | 'reject' | 'abstain', comments?: string) => Promise<void>;
  onScheduleMeeting?: (meetingData: Partial<CABMeeting>) => Promise<void>;
  onFinalizeDecision?: (decision: 'approved' | 'rejected' | 'deferred', reason?: string) => Promise<void>;
}

export function CABApprovalPanel({
  changeRequest,
  meeting,
  currentUserId,
  userRole,
  onVote,
  onScheduleMeeting,
  onFinalizeDecision
}: CABApprovalPanelProps) {
  const [showVoteForm, setShowVoteForm] = useState(false);
  const [voteComments, setVoteComments] = useState('');
  const [selectedVote, setSelectedVote] = useState<'approve' | 'reject' | 'abstain'>('approve');
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [newMeetingDate, setNewMeetingDate] = useState('');
  const [loading, setLoading] = useState(false);

  const currentUserMember = meeting?.members.find(m => m.id === currentUserId);
  const hasVoted = !!currentUserMember?.vote;
  const isChairperson = meeting?.chairperson === currentUserId;
  const canVote = meeting && ['scheduled', 'in_progress'].includes(meeting.status) && !hasVoted;
  const canFinalize = isChairperson && meeting?.status === 'in_progress';

  useEffect(() => {
    if (currentUserMember?.comments) {
      setVoteComments(currentUserMember.comments);
    }
  }, [currentUserMember]);

  const getVoteStats = () => {
    if (!meeting) return { approve: 0, reject: 0, abstain: 0, total: 0, voted: 0 };

    const votes = meeting.members.reduce(
      (acc, member) => {
        if (member.vote) {
          acc.voted++;
          acc[member.vote]++;
        }
        acc.total++;
        return acc;
      },
      { approve: 0, reject: 0, abstain: 0, total: 0, voted: 0 }
    );

    return votes;
  };

  const getQuorumStatus = () => {
    const stats = getVoteStats();
    const quorumMet = stats.voted >= (meeting?.quorum || 0);
    return { quorumMet, current: stats.voted, required: meeting?.quorum || 0 };
  };

  const getRecommendedDecision = () => {
    const stats = getVoteStats();
    const { quorumMet } = getQuorumStatus();

    if (!quorumMet) return 'insufficient_quorum';
    
    const approvalThreshold = Math.ceil(stats.voted * 0.6); // 60% approval required
    
    if (stats.approve >= approvalThreshold) return 'approve';
    if (stats.reject > stats.approve) return 'reject';
    return 'defer';
  };

  const handleVoteSubmit = async () => {
    if (!onVote || !selectedVote) return;

    setLoading(true);
    try {
      await onVote(selectedVote, voteComments);
      setShowVoteForm(false);
    } catch (error) {
      console.error('Error submitting vote:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleScheduleMeeting = async () => {
    if (!onScheduleMeeting || !newMeetingDate) return;

    setLoading(true);
    try {
      await onScheduleMeeting({
        changeId: changeRequest.change_id,
        meetingDate: new Date(newMeetingDate),
        status: 'scheduled'
      });
      setShowScheduleForm(false);
      setNewMeetingDate('');
    } catch (error) {
      console.error('Error scheduling meeting:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizeDecision = async (decision: 'approved' | 'rejected' | 'deferred') => {
    if (!onFinalizeDecision) return;

    const reason = decision === 'deferred' ? 'Insufficient consensus reached' : undefined;
    
    setLoading(true);
    try {
      await onFinalizeDecision(decision, reason);
    } catch (error) {
      console.error('Error finalizing decision:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (date: Date | string) => {
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getVoteIcon = (vote: string) => {
    switch (vote) {
      case 'approve':
        return <span className="text-green-600">✓</span>;
      case 'reject':
        return <span className="text-red-600">✗</span>;
      case 'abstain':
        return <span className="text-gray-600">—</span>;
      default:
        return <span className="text-gray-400">◯</span>;
    }
  };

  const getRiskBadgeColor = (risk: string) => {
    switch (risk) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (!meeting) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">CAB Approval Required</h2>
          <p className="text-gray-600 mb-6">
            This change requires Change Advisory Board approval. A CAB meeting needs to be scheduled.
          </p>
          
          {userRole === 'change_manager' && (
            <button
              onClick={() => setShowScheduleForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Schedule CAB Meeting
            </button>
          )}
        </div>

        {showScheduleForm && (
          <div className="mt-6 p-4 border border-gray-200 rounded-lg">
            <h3 className="text-lg font-medium mb-4">Schedule CAB Meeting</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Meeting Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={newMeetingDate}
                  onChange={(e) => setNewMeetingDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handleScheduleMeeting}
                  disabled={!newMeetingDate || loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Scheduling...' : 'Schedule Meeting'}
                </button>
                <button
                  onClick={() => setShowScheduleForm(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const voteStats = getVoteStats();
  const quorumStatus = getQuorumStatus();
  const recommendedDecision = getRecommendedDecision();

  return (
    <div className="bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">CAB Approval Panel</h2>
            <p className="text-gray-600 mt-1">
              Change: {changeRequest.change_number} - {changeRequest.title}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRiskBadgeColor(changeRequest.risk_level || 'medium')}`}>
              {changeRequest.risk_level?.toUpperCase()} RISK
            </span>
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
              meeting.status === 'completed' ? 'bg-green-100 text-green-800' :
              meeting.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
              meeting.status === 'scheduled' ? 'bg-yellow-100 text-yellow-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {meeting.status.replace('_', ' ').toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* Meeting Details */}
      <div className="p-6 border-b border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <h3 className="text-sm font-medium text-gray-500">Meeting Date</h3>
            <p className="text-sm text-gray-900">{formatDateTime(meeting.meetingDate)}</p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-500">Chairperson</h3>
            <p className="text-sm text-gray-900">{meeting.chairperson}</p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-500">Quorum Status</h3>
            <p className={`text-sm font-medium ${quorumStatus.quorumMet ? 'text-green-600' : 'text-red-600'}`}>
              {quorumStatus.current}/{quorumStatus.required} {quorumStatus.quorumMet ? '(Met)' : '(Not Met)'}
            </p>
          </div>
        </div>
      </div>

      {/* Voting Summary */}
      <div className="p-6 border-b border-gray-200">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Voting Summary</h3>
        
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{voteStats.approve}</div>
            <div className="text-sm text-green-600">Approve</div>
          </div>
          <div className="text-center p-3 bg-red-50 rounded-lg">
            <div className="text-2xl font-bold text-red-600">{voteStats.reject}</div>
            <div className="text-sm text-red-600">Reject</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-gray-600">{voteStats.abstain}</div>
            <div className="text-sm text-gray-600">Abstain</div>
          </div>
        </div>

        {quorumStatus.quorumMet && (
          <div className={`p-3 rounded-lg ${
            recommendedDecision === 'approve' ? 'bg-green-50 border border-green-200' :
            recommendedDecision === 'reject' ? 'bg-red-50 border border-red-200' :
            'bg-yellow-50 border border-yellow-200'
          }`}>
            <h4 className="font-medium mb-1">Recommended Decision:</h4>
            <p className="text-sm">
              {recommendedDecision === 'approve' && 'Approve - Majority consensus reached'}
              {recommendedDecision === 'reject' && 'Reject - Majority opposition'}
              {recommendedDecision === 'defer' && 'Defer - No clear consensus'}
              {recommendedDecision === 'insufficient_quorum' && 'Cannot decide - Quorum not met'}
            </p>
          </div>
        )}
      </div>

      {/* CAB Members */}
      <div className="p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">CAB Members</h3>
        
        <div className="space-y-3">
          {meeting.members.map(member => (
            <div key={member.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="text-lg">
                  {getVoteIcon(member.vote || '')}
                </div>
                <div>
                  <div className="font-medium text-gray-900">{member.name}</div>
                  <div className="text-sm text-gray-500">{member.role}</div>
                </div>
              </div>
              
              <div className="text-right">
                {member.vote && (
                  <>
                    <div className={`text-sm font-medium ${
                      member.vote === 'approve' ? 'text-green-600' :
                      member.vote === 'reject' ? 'text-red-600' :
                      'text-gray-600'
                    }`}>
                      {member.vote.charAt(0).toUpperCase() + member.vote.slice(1)}
                    </div>
                    {member.votedAt && (
                      <div className="text-xs text-gray-500">
                        {formatDateTime(member.votedAt)}
                      </div>
                    )}
                  </>
                )}
                {!member.vote && member.id === currentUserId && canVote && (
                  <button
                    onClick={() => setShowVoteForm(true)}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Cast Vote
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Vote Form */}
        {showVoteForm && canVote && (
          <div className="mt-6 p-4 border border-blue-200 rounded-lg bg-blue-50">
            <h4 className="font-medium text-gray-900 mb-4">Cast Your Vote</h4>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Your Vote</label>
                <div className="flex space-x-4">
                  {(['approve', 'reject', 'abstain'] as const).map(vote => (
                    <label key={vote} className="flex items-center">
                      <input
                        type="radio"
                        name="vote"
                        value={vote}
                        checked={selectedVote === vote}
                        onChange={(e) => setSelectedVote(e.target.value as typeof selectedVote)}
                        className="mr-2"
                      />
                      <span className="text-sm font-medium">
                        {vote.charAt(0).toUpperCase() + vote.slice(1)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Comments (Optional)
                </label>
                <textarea
                  value={voteComments}
                  onChange={(e) => setVoteComments(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Provide reasoning for your vote..."
                />
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={handleVoteSubmit}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Submitting...' : 'Submit Vote'}
                </button>
                <button
                  onClick={() => setShowVoteForm(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Finalize Decision */}
        {canFinalize && quorumStatus.quorumMet && (
          <div className="mt-6 p-4 border border-green-200 rounded-lg bg-green-50">
            <h4 className="font-medium text-gray-900 mb-4">Finalize CAB Decision</h4>
            <div className="flex space-x-2">
              <button
                onClick={() => handleFinalizeDecision('approved')}
                disabled={loading}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                Approve Change
              </button>
              <button
                onClick={() => handleFinalizeDecision('rejected')}
                disabled={loading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                Reject Change
              </button>
              <button
                onClick={() => handleFinalizeDecision('deferred')}
                disabled={loading}
                className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 transition-colors"
              >
                Defer Decision
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CABApprovalPanel;