export interface DragState {
  sourceId: string;
  sourceType: 'workItem' | 'scheduleEntry';
  originalStart: Date;
  originalEnd: Date;
  currentStart: Date;
  currentEnd: Date;
  currentTechId: string;
  clickOffset15MinIntervals: number;
}
