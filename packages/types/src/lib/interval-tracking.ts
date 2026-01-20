export interface TicketInterval {
  id: string;
  ticketId: string;
  ticketNumber: string;
  ticketTitle: string;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  autoClosed: boolean;
  userId: string;
}

export interface TicketIntervalGroup {
  ticketId: string;
  ticketNumber: string;
  ticketTitle: string;
  intervals: TicketInterval[];
  totalDuration: number;
}

export interface IntervalDBIndex {
  name: string;
  keyPath: string | string[];
  options?: IDBIndexParameters;
}

export interface IntervalDBObjectStoreSchema {
  name: string;
  keyPath: string | string[];
  indexes: IntervalDBIndex[];
}

export interface IntervalDBSchema {
  name: string;
  version: number;
  stores: IntervalDBObjectStoreSchema[];
}

