// @ts-nocheck
// TODO: TicketIntervalGroup missing totalDuration property
import { TicketInterval, TicketIntervalGroup } from '@alga-psa/types';

/**
 * Format seconds into HH:MM:SS format
 */
export function formatDuration(seconds: number): string {
  if (!seconds && seconds !== 0) return '00:00:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
}

/**
 * Group intervals by ticket
 */
export function groupIntervalsByTicket(intervals: TicketInterval[]): TicketIntervalGroup[] {
  const groupMap: Record<string, TicketIntervalGroup> = {};
  
  intervals.forEach(interval => {
    if (!groupMap[interval.ticketId]) {
      groupMap[interval.ticketId] = {
        ticketId: interval.ticketId,
        ticketNumber: interval.ticketNumber,
        ticketTitle: interval.ticketTitle,
        intervals: []
      };
    }
    
    groupMap[interval.ticketId].intervals.push(interval);
  });
  
  // Sort intervals within each group by start time (most recent first)
  Object.values(groupMap).forEach(group => {
    group.intervals.sort((a, b) => {
      return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
    });
  });
  
  return Object.values(groupMap);
}

/**
 * Calculate total duration for a group of intervals
 */
export function calculateTotalDuration(intervals: TicketInterval[]): number {
  return intervals.reduce((total, interval) => {
    const duration = interval.duration ?? (
      interval.endTime
        ? Math.floor((new Date(interval.endTime).getTime() - new Date(interval.startTime).getTime()) / 1000)
        : Math.floor((new Date().getTime() - new Date(interval.startTime).getTime()) / 1000)
    );
    
    return total + duration;
  }, 0);
}

/**
 * Convert seconds to minutes, rounding to nearest minute
 */
export function secondsToMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

/**
 * Filter intervals that are shorter than the specified threshold (in seconds)
 */
export function filterShortIntervals(intervals: TicketInterval[], thresholdSeconds: number = 60): TicketInterval[] {
  return intervals.filter(interval => {
    const duration = interval.duration ?? (
      interval.endTime
        ? Math.floor((new Date(interval.endTime).getTime() - new Date(interval.startTime).getTime()) / 1000)
        : Math.floor((new Date().getTime() - new Date(interval.startTime).getTime()) / 1000)
    );
    
    return duration >= thresholdSeconds;
  });
}
