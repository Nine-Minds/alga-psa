import { v4 as uuidv4 } from 'uuid';
import { TicketInterval, IntervalDBSchema } from '@alga-psa/types';

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
          { name: 'startTime', keyPath: 'startTime' },
        ],
      },
      {
        name: 'tracking',
        keyPath: 'ticketId',
        indexes: [
          { name: 'ticketId', keyPath: 'ticketId' },
          { name: 'userId', keyPath: 'userId' },
          { name: 'updatedAt', keyPath: 'updatedAt' },
        ],
      },
    ],
  };

  async initDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        try {
          console.log('[lock:block]', 'Not starting: IndexedDB is not supported in this browser');
        } catch {}
        reject(new Error('IndexedDB is not supported in this browser'));
        return;
      }

      const request = window.indexedDB.open(this.dbSchema.name, this.dbSchema.version);

      request.onerror = (event) => {
        console.error('Failed to open IndexedDB:', event);
        try {
          console.log('[lock:block]', 'Not starting: Failed to open IndexedDB');
        } catch {}
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
              keyPath: store.keyPath,
            });
            store.indexes.forEach((index) => {
              objectStore.createIndex(index.name, index.keyPath, index.options);
            });
          }
        }
      };
    });
  }

  private async getTracking(
    ticketId: string
  ): Promise<{ ticketId: string; userId: string; holderId: string; updatedAt: string } | null> {
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
      req.onerror = (e) => {
        console.error('Error getting tracking:', e);
        db.close();
        reject(new Error('Failed to get tracking'));
      };
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
          putReq.onsuccess = () => {
            try {
              console.log(
                '[lock:lock]',
                `Acquired lock for ticket ${ticketId} as holder ${holderId} (user ${userId})`
              );
            } catch {}
            db.close();
            resolve(true);
          };
          putReq.onerror = (err) => {
            console.error('Error acquiring tracking:', err);
            db.close();
            reject(new Error('Failed to acquire tracking'));
          };
        };
        if (!existing) {
          write({ ticketId, userId, holderId, updatedAt: nowIso });
          return;
        }
        if (existing.holderId === holderId || force) {
          if (force && existing.holderId !== holderId) {
            try {
              console.log(
                '[lock:move]',
                `Reassigned lock for ticket ${ticketId} from holder ${existing.holderId} to ${holderId} (user ${userId})`
              );
            } catch {}
          }
          write({ ticketId, userId, holderId, updatedAt: nowIso });
        } else {
          try {
            console.log(
              '[lock:block]',
              `Blocked by existing lock on ticket ${ticketId} held by holder ${existing.holderId} (user ${existing.userId})`
            );
          } catch {}
          db.close();
          resolve(false);
        }
      };
      getReq.onerror = (err) => {
        console.error('Error reading tracking:', err);
        db.close();
        reject(new Error('Failed to read tracking'));
      };
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
          delReq.onsuccess = () => {
            try {
              console.log('[lock:unlock]', `Released lock for ticket ${ticketId} held by holder ${holderId}`);
            } catch {}
            db.close();
            resolve();
          };
          delReq.onerror = (err) => {
            console.error('Error clearing tracking:', err);
            db.close();
            reject(new Error('Failed to clear tracking'));
          };
        } else {
          db.close();
          resolve();
        }
      };
      getReq.onerror = (err) => {
        console.error('Error reading tracking for clear:', err);
        db.close();
        reject(new Error('Failed to clear tracking'));
      };
    });
  }

  async heartbeatLock(ticketId: string, holderId: string): Promise<void> {
    const db = await this.initDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(['tracking'], 'readwrite');
      const store = tx.objectStore('tracking');
      const getReq = store.get(ticketId);
      getReq.onsuccess = (e) => {
        const existing = (e.target as IDBRequest).result as any | undefined;
        if (existing && existing.holderId === holderId) {
          existing.updatedAt = new Date().toISOString();
          store.put(existing).onsuccess = () => {
            db.close();
            resolve();
          };
        } else {
          db.close();
          resolve();
        }
      };
      getReq.onerror = () => {
        db.close();
        resolve();
      };
    });
  }

  async isLockedByOther(ticketId: string, holderId: string): Promise<boolean> {
    const rec = await this.getTracking(ticketId);
    if (!rec) return false;
    return rec.holderId !== holderId;
  }

  async startInterval(ticketId: string, ticketNumber: string, ticketTitle: string, userId: string): Promise<string> {
    const db = await this.initDatabase();
    const startTime = new Date();
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
      userId,
    };

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

  async endInterval(intervalId: string): Promise<void> {
    const db = await this.initDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readwrite');
      const objectStore = transaction.objectStore('intervals');
      const request = objectStore.get(intervalId);

      request.onsuccess = (event) => {
        const interval = (event.target as IDBRequest).result as TicketInterval | undefined;

        if (!interval) {
          db.close();
          reject(new Error('Interval not found'));
          return;
        }

        if (interval.endTime) {
          db.close();
          resolve();
          return;
        }

        const endTime = new Date();
        const startTime = new Date(interval.startTime);
        const duration = endTime.getTime() - startTime.getTime();

        interval.endTime = endTime.toISOString();
        interval.duration = duration;

        const updateRequest = objectStore.put(interval);

        updateRequest.onsuccess = () => {
          console.debug('Successfully ended interval:', intervalId);
          db.close();
          resolve();
        };

        updateRequest.onerror = (updateEvent) => {
          console.error('Error updating interval:', updateEvent);
          db.close();
          reject(new Error('Failed to end interval'));
        };
      };

      request.onerror = (event) => {
        console.error('Error getting interval:', event);
        db.close();
        reject(new Error('Failed to get interval'));
      };
    });
  }

  async getOpenIntervalCount(userId: string): Promise<number> {
    const db = await this.initDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['intervals'], 'readonly');
      const store = tx.objectStore('intervals');
      const idx = store.index('userId');
      const req = idx.getAll(userId);
      req.onsuccess = (e) => {
        const intervals = ((e.target as IDBRequest).result as TicketInterval[]) || [];
        db.close();
        resolve(intervals.filter((i) => i.endTime === null).length);
      };
      req.onerror = (e) => {
        console.error('Error getting intervals by userId:', e);
        db.close();
        reject(new Error('Failed to get intervals'));
      };
    });
  }

  async cleanupOrphanOpenIntervals(): Promise<number> {
    const db = await this.initDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['intervals'], 'readwrite');
      const store = tx.objectStore('intervals');
      const req = store.getAll();
      req.onsuccess = (e) => {
        const intervals = ((e.target as IDBRequest).result as TicketInterval[]) || [];
        const open = intervals.filter((i) => i.endTime === null);
        let removed = 0;

        const now = new Date();
        for (const interval of open) {
          const startTime = new Date(interval.startTime);
          const duration = now.getTime() - startTime.getTime();
          interval.endTime = now.toISOString();
          interval.duration = duration;
          interval.autoClosed = true;
          store.put(interval);
          removed++;
        }

        tx.oncomplete = () => {
          db.close();
          resolve(removed);
        };
        tx.onerror = (err) => {
          console.error('Error cleaning up intervals:', err);
          db.close();
          reject(new Error('Failed to cleanup intervals'));
        };
      };
      req.onerror = (err) => {
        console.error('Error reading intervals:', err);
        db.close();
        reject(new Error('Failed to read intervals'));
      };
    });
  }

  async trimIntervalsForTicket(ticketId: string, keepLastN: number): Promise<number> {
    const db = await this.initDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['intervals'], 'readwrite');
      const store = tx.objectStore('intervals');
      const idx = store.index('ticketId');
      const req = idx.getAll(ticketId);
      req.onsuccess = (e) => {
        const intervals = ((e.target as IDBRequest).result as TicketInterval[]) || [];
        intervals.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
        const toDelete = intervals.slice(keepLastN);
        for (const interval of toDelete) {
          store.delete(interval.id);
        }
        tx.oncomplete = () => {
          db.close();
          resolve(toDelete.length);
        };
        tx.onerror = (err) => {
          console.error('Error trimming intervals:', err);
          db.close();
          reject(new Error('Failed to trim intervals'));
        };
      };
      req.onerror = (err) => {
        console.error('Error reading intervals by ticketId:', err);
        db.close();
        reject(new Error('Failed to read intervals'));
      };
    });
  }

  async getOpenInterval(ticketId: string, userId: string): Promise<TicketInterval | null> {
    const db = await this.initDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readonly');
      const objectStore = transaction.objectStore('intervals');
      const ticketIndex = objectStore.index('ticketId');
      const request = ticketIndex.getAll(ticketId);
      request.onsuccess = (event) => {
        const intervals = (event.target as IDBRequest<TicketInterval[]>).result;
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

  async deleteIntervals(intervalIds: string[]): Promise<void> {
    if (intervalIds.length === 0) return;
    const db = await this.initDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readwrite');
      const objectStore = transaction.objectStore('intervals');
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = (event) => {
        console.error('Error deleting intervals:', event);
        db.close();
        reject(new Error('Failed to delete intervals'));
      };
      for (const id of intervalIds) {
        objectStore.delete(id);
      }
    });
  }

  async mergeIntervals(intervalIds: string[]): Promise<TicketInterval | null> {
    if (intervalIds.length < 2) {
      return null;
    }
    const intervals: TicketInterval[] = [];
    for (const id of intervalIds) {
      const interval = await this.getInterval(id);
      if (interval) {
        intervals.push(interval);
      }
    }
    if (intervals.length < 2) {
      return null;
    }
    // Sort by start time
    intervals.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    const first = intervals[0];
    const last = intervals[intervals.length - 1];
    // Calculate total duration
    let totalDuration = 0;
    for (const interval of intervals) {
      if (interval.duration) {
        totalDuration += interval.duration;
      }
    }
    // Create merged interval
    const mergedInterval: TicketInterval = {
      id: uuidv4(),
      ticketId: first.ticketId,
      ticketNumber: first.ticketNumber,
      ticketTitle: first.ticketTitle,
      startTime: first.startTime,
      endTime: last.endTime,
      duration: totalDuration,
      autoClosed: false,
      userId: first.userId,
    };
    // Delete old intervals
    await this.deleteIntervals(intervalIds);
    // Save merged interval
    const db = await this.initDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['intervals'], 'readwrite');
      const objectStore = transaction.objectStore('intervals');
      const request = objectStore.add(mergedInterval);
      request.onsuccess = () => {
        db.close();
        resolve(mergedInterval);
      };
      request.onerror = (event) => {
        console.error('Error saving merged interval:', event);
        db.close();
        reject(new Error('Failed to save merged interval'));
      };
    });
  }

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

  private autoCloseOpenIntervals(intervals: TicketInterval[]): TicketInterval[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return intervals.map(interval => {
      if (!interval.endTime) {
        const startDate = new Date(interval.startTime);
        const startDay = new Date(startDate);
        startDay.setHours(0, 0, 0, 0);
        if (startDay < today) {
          const endDate = new Date(startDate);
          endDate.setHours(17, 0, 0, 0);
          if (startDate > endDate) {
            endDate.setTime(startDate.getTime());
          }
          return {
            ...interval,
            endTime: endDate.toISOString(),
            autoClosed: true,
            duration: Math.floor((endDate.getTime() - startDate.getTime()) / 1000)
          };
        }
      }
      return interval;
    });
  }
}

export type IntervalTrackingSnapshot = {
  state: 'idle' | 'active' | 'locked_by_other';
  intervalId: string | null;
};

export class IntervalTrackingStateMachine {
  private state: IntervalTrackingSnapshot = { state: 'idle', intervalId: null };
  private subs = new Set<(snap: IntervalTrackingSnapshot) => void>();
  private heartbeatTimer: any | null = null;

  constructor(
    private service: IntervalTrackingService,
    private ctx: {
      ticketId: string;
      ticketNumber: string;
      ticketTitle: string;
      userId: string;
      holderId: string;
      heartbeatMs: number;
    }
  ) {}

  subscribe(fn: (snap: IntervalTrackingSnapshot) => void): () => void {
    this.subs.add(fn);
    fn(this.state);
    return () => this.subs.delete(fn);
  }

  private emit(next: IntervalTrackingSnapshot) {
    this.state = next;
    for (const fn of this.subs) fn(next);
  }

  async refreshLockState(): Promise<boolean> {
    const locked = await this.service.isLockedByOther(this.ctx.ticketId, this.ctx.holderId);
    if (locked) {
      this.stopHeartbeat();
      this.emit({ state: 'locked_by_other', intervalId: null });
      return true;
    }
    if (this.state.state === 'locked_by_other') {
      this.emit({ state: 'idle', intervalId: null });
    }
    return false;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.service.heartbeatLock(this.ctx.ticketId, this.ctx.holderId).catch(() => {});
    }, this.ctx.heartbeatMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async start(force = false): Promise<boolean> {
    const acquired = await this.service.acquireLock(
      this.ctx.ticketId,
      this.ctx.userId,
      this.ctx.holderId,
      force
    );
    if (!acquired) {
      this.stopHeartbeat();
      this.emit({ state: 'locked_by_other', intervalId: null });
      return false;
    }

    const intervalId = await this.service.startInterval(
      this.ctx.ticketId,
      this.ctx.ticketNumber,
      this.ctx.ticketTitle,
      this.ctx.userId
    );
    this.startHeartbeat();
    this.emit({ state: 'active', intervalId });
    return true;
  }

  async stop(): Promise<void> {
    if (this.state.intervalId) {
      await this.service.endInterval(this.state.intervalId);
    }
    await this.service.releaseLock(this.ctx.ticketId, this.ctx.holderId);
    this.stopHeartbeat();
    this.emit({ state: 'idle', intervalId: null });
  }
}

