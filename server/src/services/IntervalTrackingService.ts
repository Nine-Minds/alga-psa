import { v4 as uuidv4 } from 'uuid';
import { TicketInterval, IntervalDBSchema } from '../types/interval-tracking';

/**
 * Service for managing ticket viewing intervals using IndexedDB
 */
export class IntervalTrackingService {
  private readonly dbSchema: IntervalDBSchema = {
    name: 'TicketTimeTrackingDB',
    version: 1,
    stores: [
      {
        name: 'intervals',
        keyPath: 'id',
        indexes: [
          { name: 'ticketId', keyPath: 'ticketId' },
          { name: 'userId', keyPath: 'userId' },
          { name: 'startTime', keyPath: 'startTime' }
        ]
      }
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
        const store = this.dbSchema.stores[0];

        // Create the object store if it doesn't exist
        if (!db.objectStoreNames.contains(store.name)) {
          const objectStore = db.createObjectStore(store.name, {
            keyPath: store.keyPath
          });

          // Create indexes
          store.indexes.forEach((index) => {
            objectStore.createIndex(index.name, index.keyPath, index.options);
          });
        }
      };
    });
  }

  /**
   * Start a new interval when a ticket is opened
   */
  async startInterval(ticketId: string, ticketNumber: string, ticketTitle: string, userId: string): Promise<string> {
    const db = await this.initDatabase();
    
    // Check if there's an open interval for this ticket and user
    const existingInterval = await this.getOpenInterval(ticketId, userId);
    
    // If there's an open interval, use it instead of creating a new one
    if (existingInterval) {
      console.debug('Using existing open interval instead of creating a new one:', existingInterval.id);
      db.close(); // Make sure to close the database connection
      return existingInterval.id;
    }
    
    // Check if we should create an interval from a previous end time
    let startTime = new Date();
    const lastEndTimeStr = localStorage.getItem(`lastTicketEndTime_${ticketId}`);
    
    if (lastEndTimeStr) {
      const lastEndTime = new Date(lastEndTimeStr);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const lastEndTimeDay = new Date(lastEndTime);
      lastEndTimeDay.setHours(0, 0, 0, 0);
      
      // If the last end time was today, use it as the start time for the new interval
      if (lastEndTimeDay.getTime() === today.getTime()) {
        startTime = lastEndTime;
      } else {
        // If there's no interval today, use 8am as the start time
        startTime = new Date();
        startTime.setHours(8, 0, 0, 0);
        
        // If current time is before 8am, use current time
        if (new Date() < startTime) {
          startTime = new Date();
        }
      }
      
      // Clear the stored end time after using it
      localStorage.removeItem(`lastTicketEndTime_${ticketId}`);
    }
    
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
    
    // Double-check for an existing open interval right before creating a new one
    // This helps prevent race conditions where multiple calls might create duplicate intervals
    const doubleCheckInterval = await this.getOpenInterval(ticketId, userId);
    if (doubleCheckInterval) {
      console.debug('Found existing interval during double-check, using it instead:', doubleCheckInterval.id);
      db.close(); // Make sure to close the database connection
      return doubleCheckInterval.id;
    }
    
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