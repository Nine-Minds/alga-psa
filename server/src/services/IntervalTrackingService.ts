import { v4 as uuidv4 } from 'uuid';
import { TicketInterval, IntervalDBSchema } from '../types/interval-tracking';

/**
 * Service for managing ticket viewing intervals using IndexedDB
 */
export class IntervalTrackingService {
  private readonly dbSchema: IntervalDBSchema = {
    name: 'TicketTimeTrackingDB',
    version: 3,
    stores: [
      {
        name: 'intervals',
        keyPath: 'id',
        indexes: [
          { name: 'ticketId', keyPath: 'ticketId' },
          { name: 'userId', keyPath: 'userId' },
          { name: 'startTime', keyPath: 'startTime' }
        ]
      },
      {
        name: 'tracking',
        keyPath: 'ticketId',
        indexes: [
          { name: 'ticketId', keyPath: 'ticketId' },
          { name: 'userId', keyPath: 'userId' },
          { name: 'updatedAt', keyPath: 'updatedAt' },
        ]
      },
    ]
  };

  /**
   * Initialize the IndexedDB database for interval tracking
   */
  async initDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      // Check if IndexedDB is available
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is not supported in this browser'));
        return;
      }

      const request = window.indexedDB.open(
        this.dbSchema.name,
        this.dbSchema.version
      );

      request.onerror = (event) => {
        console.error('Failed to open IndexedDB:', event);
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        for (const store of this.dbSchema.stores) {
          if (!db.objectStoreNames.contains(store.name)) {
            const objectStore = db.createObjectStore(store.name, {
              keyPath: store.keyPath
            });
            store.indexes.forEach((index) => {
              objectStore.createIndex(index.name, index.keyPath, index.options);
            });
          }
        }
      };
    });
  }

  // Simplified tracking: use a table to mark whether a ticket is currently tracked
  private async getTracking(ticketId: string): Promise<{ ticketId: string; userId: string; holderId: string; updatedAt: string } | null> {
    const db = await this.initDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['tracking'], 'readonly');
      const store = tx.objectStore('tracking');
      const req = store.get(ticketId);
      req.onsuccess = (e) => {
        const rec = (e.target as IDBRequest).result;
        db.close();
        resolve(rec || null);
      };
      req.onerror = (e) => { console.error('Error getting tracking:', e); db.close(); reject(new Error('Failed to get tracking')); };
    });
  }

  async acquireLock(ticketId: string, userId: string, holderId: string, force = false): Promise<boolean> {
    const db = await this.initDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['tracking'], 'readwrite');
      const store = tx.objectStore('tracking');
      const getReq = store.get(ticketId);
      getReq.onsuccess = (e) => {
        const existing = (e.target as IDBRequest).result as any | undefined;
        const nowIso = new Date().toISOString();
        const write = (record: any) => {
          const putReq = store.put(record);
          putReq.onsuccess = () => { db.close(); resolve(true); };
          putReq.onerror = (err) => { console.error('Error acquiring tracking:', err); db.close(); reject(new Error('Failed to acquire tracking')); };
        };
        if (!existing) {
          write({ ticketId, userId, holderId, updatedAt: nowIso });
          return;
        }
        if (existing.holderId === holderId || force) {
          write({ ticketId, userId, holderId, updatedAt: nowIso });
        } else {
          db.close();
          resolve(false);
        }
      };
      getReq.onerror = (err) => { console.error('Error reading tracking:', err); db.close(); reject(new Error('Failed to read tracking')); };
    });
  }

  async releaseLock(ticketId: string, holderId: string): Promise<void> {
    const db = await this.initDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['tracking'], 'readwrite');
      const store = tx.objectStore('tracking');
      const getReq = store.get(ticketId);
      getReq.onsuccess = (e) => {
        const existing = (e.target as IDBRequest).result as any | undefined;
        if (existing && existing.holderId === holderId) {
          const delReq = store.delete(ticketId);
          delReq.onsuccess = () => { db.close(); resolve(); };
          delReq.onerror = (err) => { console.error('Error clearing tracking:', err); db.close(); reject(new Error('Failed to clear tracking')); };
        } else {
          db.close();
          resolve();
        }
      };
      getReq.onerror = (err) => { console.error('Error reading tracking for clear:', err); db.close(); reject(new Error('Failed to clear tracking')); };
    });
  }

  async heartbeatLock(ticketId: string, holderId: string): Promise<void> {
    // No-op in simplified model; optionally update updatedAt
    const db = await this.initDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(['tracking'], 'readwrite');
      const store = tx.objectStore('tracking');
      const getReq = store.get(ticketId);
      getReq.onsuccess = (e) => {
        const existing = (e.target as IDBRequest).result as any | undefined;
        if (existing && existing.holderId === holderId) {
          existing.updatedAt = new Date().toISOString();
          store.put(existing).onsuccess = () => { db.close(); resolve(); };
        } else {
          db.close(); resolve();
        }
      };
      getReq.onerror = () => { db.close(); resolve(); };
    });
  }

  async isLockedByOther(ticketId: string, holderId: string): Promise<boolean> {
    const rec = await this.getTracking(ticketId);
    if (!rec) return false;
    return rec.holderId !== holderId;
  }

  /**
   * Start a new interval when a ticket is opened
   */
  async startInterval(ticketId: string, ticketNumber: string, ticketTitle: string, userId: string): Promise<string> {
    const db = await this.initDatabase();
    
    // Always start new intervals from "now"; never continue from previous intervals
    const startTime = new Date();
    
    // Create a new interval
    const intervalId = uuidv4();
    
    const interval: TicketInterval = {
      id: intervalId,
      ticketId,
      ticketNumber,
      ticketTitle,
      startTime: startTime.toISOString(),
      endTime: null,
      duration: null,
      autoClosed: false,
      userId
    };
    
    // With pessimistic locking, duplicate intervals for the same ticket/user should not occur.
    // We intentionally do not continue an existing open interval here.
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readwrite');
      const objectStore = transaction.objectStore('intervals');
      
      const request = objectStore.add(interval);
      
      request.onsuccess = () => {
        console.debug('Successfully created new interval:', intervalId);
        db.close();
        resolve(intervalId);
      };
      
      request.onerror = (event) => {
        console.error('Error adding interval:', event);
        db.close();
        reject(new Error('Failed to create interval'));
      };
    });
  }

  /**
   * End an interval when a ticket is closed
   */
  async endInterval(intervalId: string): Promise<void> {
    const db = await this.initDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readwrite');
      const objectStore = transaction.objectStore('intervals');
      
      // First, get the interval to update
      const getRequest = objectStore.get(intervalId);
      
      getRequest.onsuccess = (event) => {
        const interval = (event.target as IDBRequest<TicketInterval>).result;
        
        if (!interval) {
          db.close();
          reject(new Error('Interval not found'));
          return;
        }
        
        // Calculate end time and duration
        const endTime = new Date().toISOString();
        const startDate = new Date(interval.startTime);
        const endDate = new Date(endTime);
        const duration = Math.floor((endDate.getTime() - startDate.getTime()) / 1000); // Duration in seconds
        
        // Update the interval
        interval.endTime = endTime;
        interval.duration = duration;
        
        // Save the updated interval
        const updateRequest = objectStore.put(interval);
        
        updateRequest.onsuccess = () => {
          db.close();
          resolve();
        };
        
        updateRequest.onerror = (error) => {
          console.error('Error updating interval:', error);
          db.close();
          reject(new Error('Failed to update interval'));
        };
      };
      
      getRequest.onerror = (event) => {
        console.error('Error retrieving interval:', event);
        db.close();
        reject(new Error('Failed to retrieve interval'));
      };
    });
  }

  /**
   * Get an open interval for a specific ticket and user (if one exists)
   */
  async getOpenInterval(ticketId: string, userId: string): Promise<TicketInterval | null> {
    const db = await this.initDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readonly');
      const objectStore = transaction.objectStore('intervals');
      const ticketIndex = objectStore.index('ticketId');
      
      // Get all intervals for this ticket
      const request = ticketIndex.getAll(ticketId);
      
      request.onsuccess = (event) => {
        const intervals = (event.target as IDBRequest<TicketInterval[]>).result;
        
        // Find open intervals for this user
        const openInterval = intervals.find(interval => 
          interval.userId === userId && interval.endTime === null
        );
        
        db.close();
        resolve(openInterval || null);
      };
      
      request.onerror = (event) => {
        console.error('Error retrieving open interval:', event);
        db.close();
        reject(new Error('Failed to retrieve open interval'));
      };
    });
  }

  /**
   * Get all intervals for a specific ticket
   */
  async getIntervalsByTicket(ticketId: string): Promise<TicketInterval[]> {
    const db = await this.initDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readonly');
      const objectStore = transaction.objectStore('intervals');
      const ticketIndex = objectStore.index('ticketId');
      
      const request = ticketIndex.getAll(ticketId);
      
      request.onsuccess = (event) => {
        const intervals = (event.target as IDBRequest<TicketInterval[]>).result;
        const processedIntervals = this.autoCloseOpenIntervals(intervals);
        db.close();
        resolve(processedIntervals);
      };
      
      request.onerror = (event) => {
        console.error('Error retrieving intervals by ticket:', event);
        db.close();
        reject(new Error('Failed to retrieve intervals'));
      };
    });
  }

  /**
   * Get all intervals (utility for maintenance tasks)
   */
  async getAllIntervals(): Promise<TicketInterval[]> {
    const db = await this.initDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readonly');
      const objectStore = transaction.objectStore('intervals');
      const request = objectStore.getAll();
      request.onsuccess = (event) => {
        const intervals = (event.target as IDBRequest<TicketInterval[]>).result || [];
        db.close();
        resolve(intervals);
      };
      request.onerror = (event) => {
        console.error('Error retrieving all intervals:', event);
        db.close();
        reject(new Error('Failed to retrieve intervals'));
      };
    });
  }

  /**
   * Cleanup orphaned open intervals: open intervals with no corresponding tracking marker
   * We assume the user closed the screen and did not intend to keep these.
   */
  async cleanupOrphanOpenIntervals(): Promise<number> {
    try {
      const all = await this.getAllIntervals();
      const open = all.filter(iv => !iv.endTime);
      if (open.length === 0) return 0;

      const idsToDelete: string[] = [];
      for (const iv of open) {
        try {
          const tracking = await this.getTracking(iv.ticketId);
          if (!tracking) {
            idsToDelete.push(iv.id);
          }
        } catch (e) {
          // If we fail to read tracking, skip deletion for safety
        }
      }
      if (idsToDelete.length) {
        await this.deleteIntervals(idsToDelete);
      }
      return idsToDelete.length;
    } catch (e) {
      console.error('Failed to cleanup orphan open intervals:', e);
      return 0;
    }
  }

  /**
   * Trim intervals for a ticket to most recent `keep` by startTime (descending).
   * Deletes older intervals and returns the count deleted.
   */
  async trimIntervalsForTicket(ticketId: string, keep: number = 20): Promise<number> {
    try {
      const db = await this.initDatabase();
      const intervals: TicketInterval[] = await new Promise((resolve, reject) => {
        const tx = db.transaction(['intervals'], 'readonly');
        const store = tx.objectStore('intervals');
        const idx = store.index('ticketId');
        const req = idx.getAll(ticketId);
        req.onsuccess = (e) => {
          const rows = (e.target as IDBRequest<TicketInterval[]>).result || [];
          db.close();
          resolve(rows);
        };
        req.onerror = (e) => {
          console.error('Error retrieving intervals for trimming:', e);
          db.close();
          reject(new Error('Failed to retrieve intervals'));
        };
      });

      if (intervals.length <= keep) return 0;

      // Sort by startTime desc, keep most recent
      const sorted = [...intervals].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
      const toDelete = sorted.slice(keep).map(iv => iv.id);
      if (toDelete.length) {
        await this.deleteIntervals(toDelete);
      }
      return toDelete.length;
    } catch (e) {
      console.error('Failed to trim intervals:', e);
      return 0;
    }
  }

  /**
   * Get all intervals for the current user
   */
  async getUserIntervals(userId: string): Promise<TicketInterval[]> {
    const db = await this.initDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readonly');
      const objectStore = transaction.objectStore('intervals');
      const userIndex = objectStore.index('userId');
      
      const request = userIndex.getAll(userId);
      
      request.onsuccess = (event) => {
        const intervals = (event.target as IDBRequest<TicketInterval[]>).result;
        const processedIntervals = this.autoCloseOpenIntervals(intervals);
        
        // Sort by start time (most recent first)
        processedIntervals.sort((a, b) => {
          return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
        });
        
        db.close();
        resolve(processedIntervals);
      };
      
      request.onerror = (event) => {
        console.error('Error retrieving user intervals:', event);
        db.close();
        reject(new Error('Failed to retrieve intervals'));
      };
    });
  }

  /**
   * Get count of open intervals for the current user
   */
  async getOpenIntervalCount(userId: string): Promise<number> {
    const intervals = await this.getUserIntervals(userId);
    return intervals.filter(interval => interval.endTime === null).length;
  }

  /**
   * Delete specified intervals
   */
  async deleteIntervals(intervalIds: string[]): Promise<void> {
    if (intervalIds.length === 0) return;
    
    const db = await this.initDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readwrite');
      const objectStore = transaction.objectStore('intervals');
      
      let completedOps = 0;
      let hasError = false;
      
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      
      transaction.onerror = (event) => {
        console.error('Error deleting intervals:', event);
        hasError = true;
        db.close();
        reject(new Error('Failed to delete intervals'));
      };
      
      intervalIds.forEach(id => {
        const request = objectStore.delete(id);
        
        request.onsuccess = () => {
          completedOps++;
          
          if (completedOps === intervalIds.length && !hasError) {
            // All operations completed successfully
          }
        };
      });
    });
  }

  /**
   * Merge multiple intervals into a single interval
   */
  async mergeIntervals(intervalIds: string[]): Promise<TicketInterval | null> {
    if (intervalIds.length < 2) {
      return null;
    }
    
    const db = await this.initDatabase();
    
    // Get all intervals to merge
    const intervals: TicketInterval[] = [];
    
    for (const id of intervalIds) {
      try {
        const interval = await this.getInterval(id);
        if (interval) {
          intervals.push(interval);
        }
      } catch (error) {
        console.error('Error retrieving interval:', error);
      }
    }
    
    if (intervals.length < 2) {
      return null;
    }
    
    // Verify all intervals are for the same ticket
    const ticketId = intervals[0].ticketId;
    const allSameTicket = intervals.every(interval => interval.ticketId === ticketId);
    
    if (!allSameTicket) {
      throw new Error('Cannot merge intervals from different tickets');
    }
    
    // Find earliest start time and latest end time
    let earliestStart = new Date(intervals[0].startTime);
    let latestEnd = intervals[0].endTime ? new Date(intervals[0].endTime) : new Date();
    let hasOpenInterval = false;
    
    intervals.forEach(interval => {
      const start = new Date(interval.startTime);
      
      if (start < earliestStart) {
        earliestStart = start;
      }
      
      if (interval.endTime) {
        const end = new Date(interval.endTime);
        if (end > latestEnd) {
          latestEnd = end;
        }
      } else {
        // If any interval is still open, use current time for comparison
        // but mark the merged interval as open
        const now = new Date();
        if (now > latestEnd) {
          latestEnd = now;
        }
        hasOpenInterval = true;
      }
    });
    
    // If any of the original intervals were open, keep the merged interval open
    const finalEndTime = hasOpenInterval ? null : latestEnd.toISOString();
    
    // Calculate duration based on latest end time (even for open intervals)
    const duration = Math.floor((latestEnd.getTime() - earliestStart.getTime()) / 1000);
    
    // Create a new merged interval
    const mergedInterval: TicketInterval = {
      id: uuidv4(),
      ticketId: intervals[0].ticketId,
      ticketNumber: intervals[0].ticketNumber,
      ticketTitle: intervals[0].ticketTitle,
      startTime: earliestStart.toISOString(),
      endTime: finalEndTime,
      duration: hasOpenInterval ? null : duration,
      autoClosed: false,
      userId: intervals[0].userId
    };
    
    // Save the merged interval
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readwrite');
      const objectStore = transaction.objectStore('intervals');
      
      // Add the new merged interval
      const addRequest = objectStore.add(mergedInterval);
      
      addRequest.onsuccess = async () => {
        try {
          // Delete the original intervals
          await this.deleteIntervals(intervalIds);
          db.close();
          resolve(mergedInterval);
        } catch (error) {
          reject(error);
        }
      };
      
      addRequest.onerror = (event) => {
        console.error('Error creating merged interval:', event);
        db.close();
        reject(new Error('Failed to create merged interval'));
      };
    });
  }

  /**
   * Get a specific interval by ID
   */
  private async getInterval(intervalId: string): Promise<TicketInterval | null> {
    const db = await this.initDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readonly');
      const objectStore = transaction.objectStore('intervals');
      
      const request = objectStore.get(intervalId);
      
      request.onsuccess = (event) => {
        const interval = (event.target as IDBRequest<TicketInterval>).result;
        db.close();
        resolve(interval || null);
      };
      
      request.onerror = (event) => {
        console.error('Error retrieving interval:', event);
        db.close();
        reject(new Error('Failed to retrieve interval'));
      };
    });
  }

  /**
   * Auto-close any open intervals from previous days
   * Applied when intervals are retrieved, not as a scheduled process
   */
  private autoCloseOpenIntervals(intervals: TicketInterval[]): TicketInterval[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    
    return intervals.map(interval => {
      // If interval has no end time and started on a previous day
      if (!interval.endTime) {
        const startDate = new Date(interval.startTime);
        const startDay = new Date(startDate);
        startDay.setHours(0, 0, 0, 0);
        
        if (startDay < today) {
          // Create end time at 5:00 PM of the start date
          const endDate = new Date(startDate);
          endDate.setHours(17, 0, 0, 0);
          
          // If start time was after 5:00 PM, use start time instead
          if (startDate > endDate) {
            endDate.setTime(startDate.getTime());
          }
          
          const updatedInterval = {
            ...interval,
            endTime: endDate.toISOString(),
            autoClosed: true,
            duration: Math.floor((endDate.getTime() - startDate.getTime()) / 1000)
          };
          
          // Update in database (async, don't wait for completion)
          this.updateAutoClosedInterval(updatedInterval).catch(error => {
            console.error('Error auto-closing interval:', error);
          });
          
          return updatedInterval;
        }
      }
      return interval;
    });
  }

  /**
   * Update an auto-closed interval in the database
   */
  private async updateAutoClosedInterval(interval: TicketInterval): Promise<void> {
    const db = await this.initDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readwrite');
      const objectStore = transaction.objectStore('intervals');
      
      const request = objectStore.put(interval);
      
      request.onsuccess = () => {
        db.close();
        resolve();
      };
      
      request.onerror = (event) => {
        console.error('Error updating auto-closed interval:', event);
        db.close();
        reject(new Error('Failed to update auto-closed interval'));
      };
    });
  }

  /**
   * Update a specific interval with new properties
   */
  async updateInterval(intervalId: string, updates: Partial<TicketInterval>): Promise<TicketInterval> {
    const db = await this.initDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readwrite');
      const objectStore = transaction.objectStore('intervals');
      
      const getRequest = objectStore.get(intervalId);
      
      getRequest.onsuccess = (event) => {
        const interval = (event.target as IDBRequest<TicketInterval>).result;
        
        if (!interval) {
          db.close();
          reject(new Error('Interval not found'));
          return;
        }
        
        // Apply updates
        const updatedInterval = { ...interval, ...updates };
        
        // Recalculate duration if start and end times are provided
        if (updatedInterval.startTime && updatedInterval.endTime) {
          const startDate = new Date(updatedInterval.startTime);
          const endDate = new Date(updatedInterval.endTime);
          updatedInterval.duration = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
        }
        
        const updateRequest = objectStore.put(updatedInterval);
        
        updateRequest.onsuccess = () => {
          db.close();
          resolve(updatedInterval);
        };
        
        updateRequest.onerror = (event) => {
          console.error('Error updating interval:', event);
          db.close();
          reject(new Error('Failed to update interval'));
        };
      };
      
      getRequest.onerror = (event) => {
        console.error('Error retrieving interval:', event);
        db.close();
        reject(new Error('Failed to retrieve interval'));
      };
    });
  }
}

// State machine for interval tracking per ticket/user/tab
export type IntervalTrackingState =
  | 'idle'
  | 'acquiring_lock'
  | 'active'
  | 'locked_by_other'
  | 'stopping'
  | 'error';

export interface IntervalStateSnapshot {
  state: IntervalTrackingState;
  intervalId: string | null;
  lastError?: string | null;
}

type Listener = (snapshot: IntervalStateSnapshot) => void;

export class IntervalTrackingStateMachine {
  private service: IntervalTrackingService;
  private ticketId: string;
  private ticketNumber: string;
  private ticketTitle: string;
  private userId: string;
  private holderId: string;
  private heartbeatMs: number;
  private state: IntervalTrackingState = 'idle';
  private intervalId: string | null = null;
  private listeners: Set<Listener> = new Set();
  private heartbeatTimer: number | null = null;
  private lastError: string | null = null;

  constructor(
    service: IntervalTrackingService,
    args: {
      ticketId: string;
      ticketNumber: string;
      ticketTitle: string;
      userId: string;
      holderId: string;
      heartbeatMs?: number;
    }
  ) {
    this.service = service;
    this.ticketId = args.ticketId;
    this.ticketNumber = args.ticketNumber;
    this.ticketTitle = args.ticketTitle;
    this.userId = args.userId;
    this.holderId = args.holderId;
    this.heartbeatMs = args.heartbeatMs ?? 5000;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    // Emit initial snapshot
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  getState(): IntervalStateSnapshot {
    return this.snapshot();
  }

  private snapshot(): IntervalStateSnapshot {
    return { state: this.state, intervalId: this.intervalId, lastError: this.lastError };
  }

  private emit() {
    const snap = this.snapshot();
    this.listeners.forEach((l) => l(snap));
  }

  private setState(state: IntervalTrackingState, err?: string | null) {
    const prev = this.state;
    this.state = state;
    this.lastError = err ?? null;
    try { console.log('[IntervalMachine] state change', prev, '->', state, 'intervalId=', this.intervalId, 'err=', err); } catch {}
    this.emit();
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startHeartbeat() {
    // Simplified model: heartbeat optional/no-op
    this.clearHeartbeat();
  }

  async refreshLockState(): Promise<boolean> {
    const locked = await this.service.isLockedByOther(this.ticketId, this.holderId);
    try { console.log('[IntervalMachine] refreshLockState lockedByOther=', locked, 'currentState=', this.state); } catch {}
    if (this.state === 'idle' || this.state === 'locked_by_other') {
      this.setState(locked ? 'locked_by_other' : 'idle');
    }
    return locked;
  }

  // Start event: attempts to acquire lock and start a new interval
  async start(force = false): Promise<boolean> {
    if (!this.ticketId || !this.userId) return false;
    try { console.log('[IntervalMachine] start called force=', force); } catch {}
    this.setState('acquiring_lock');
    try {
      const acquired = await this.service.acquireLock(this.ticketId, this.userId, this.holderId, force);
      try { console.log('[IntervalMachine] acquireLock ->', acquired); } catch {}
      if (!acquired) {
        this.setState('locked_by_other');
        return false;
      }

      if (force) {
        try {
          const intervals = await this.service.getIntervalsByTicket(this.ticketId);
          const openIds = intervals.filter(iv => !iv.endTime).map(iv => iv.id);
          if (openIds.length) {
            await this.service.deleteIntervals(openIds);
          }
        } catch {}
      } else {
        // Defensive cleanup: remove any of this user's stray open intervals for this ticket
        try {
          const intervals = await this.service.getIntervalsByTicket(this.ticketId);
          const openIds = intervals.filter(iv => !iv.endTime && iv.userId === this.userId).map(iv => iv.id);
          if (openIds.length) {
            await this.service.deleteIntervals(openIds);
          }
        } catch {}
      }

      const id = await this.service.startInterval(
        this.ticketId,
        this.ticketNumber,
        this.ticketTitle,
        this.userId
      );
      try { console.log('[IntervalMachine] startInterval -> id', id); } catch {}
      this.intervalId = id;
      this.startHeartbeat();
      this.setState('active');
      return true;
    } catch (e: any) {
      try { console.log('[IntervalMachine] start error', e); } catch {}
      this.setState('error', e?.message || 'Failed to start');
      return false;
    }
  }

  // Helper to delete an open interval by id (no duration persisted)
  private async deleteOpenInterval(intervalId: string) {
    try {
      const request = window.indexedDB.open('TicketTimeTrackingDB', 3);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = db.transaction(['intervals'], 'readwrite');
        const store = tx.objectStore('intervals');
        store.delete(intervalId);
      };
    } catch {}
  }

  // Stop event: ends the interval and releases lock
  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'locked_by_other') { try { console.log('[IntervalMachine] stop ignored in state', this.state); } catch {} return; }
    try { console.log('[IntervalMachine] stop called for interval', this.intervalId); } catch {}
    this.setState('stopping');
    this.clearHeartbeat();
    try {
      if (this.intervalId) {
        await this.service.endInterval(this.intervalId);
      }
    } catch (e) {
      // swallow
    }
    try {
      await this.service.releaseLock(this.ticketId, this.holderId);
    } catch {}
    this.intervalId = null;
    this.setState('idle');
  }

  // Visibility hidden: stop without prompting
  async onHidden() {
    await this.stop();
  }

  // Best-effort synchronous cleanup on beforeunload
  onBeforeUnloadSync() {
    try {
      const request = window.indexedDB.open('TicketTimeTrackingDB', 3);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // End interval
        if (this.intervalId) {
          const tx = db.transaction(['intervals'], 'readwrite');
          const store = tx.objectStore('intervals');
          const getReq = store.get(this.intervalId);
          getReq.onsuccess = (ev) => {
            const interval = (ev.target as IDBRequest).result;
            if (interval) {
              const endTime = new Date().toISOString();
              const startDate = new Date(interval.startTime);
              const endDate = new Date(endTime);
              const duration = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
              interval.endTime = endTime;
              interval.duration = duration;
              store.put(interval);
            }
          };
        }
        // Clear tracking marker
        const ttx = db.transaction(['tracking'], 'readwrite');
        const tstore = ttx.objectStore('tracking');
        const tget = tstore.get(this.ticketId);
        tget.onsuccess = (ev) => {
          const existing = (ev.target as IDBRequest).result;
          if (existing && existing.holderId === this.holderId) {
            tstore.delete(this.ticketId);
          }
        };
      };
    } catch {}
  }
}
