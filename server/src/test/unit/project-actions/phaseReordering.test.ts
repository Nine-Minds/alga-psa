import { describe, it, expect } from 'vitest';
import { generateKeyBetween } from 'fractional-indexing';

describe('Phase Reordering Logic', () => {
  describe('Fractional Indexing Key Generation', () => {
    it('should generate correct key when placing phase at the beginning', () => {
      // Simulating: moving a phase before the first phase
      const beforeKey = null;
      const afterKey = 'a0'; // First phase's key
      
      const newKey = generateKeyBetween(beforeKey, afterKey);
      
      expect(newKey).toBeDefined();
      expect(newKey < afterKey).toBe(true);
      console.log(`Key for placing before first: ${newKey} (should be < ${afterKey})`);
    });
    
    it('should generate correct key when placing phase at the end', () => {
      // Simulating: moving a phase after the last phase
      const beforeKey = 'a5'; // Last phase's key
      const afterKey = null;
      
      const newKey = generateKeyBetween(beforeKey, afterKey);
      
      expect(newKey).toBeDefined();
      expect(newKey > beforeKey).toBe(true);
      console.log(`Key for placing after last: ${newKey} (should be > ${beforeKey})`);
    });
    
    it('should generate correct key when placing phase between two phases', () => {
      // Simulating: moving a phase between two existing phases
      const beforeKey = 'a1';
      const afterKey = 'a2';
      
      const newKey = generateKeyBetween(beforeKey, afterKey);
      
      expect(newKey).toBeDefined();
      expect(newKey > beforeKey).toBe(true);
      expect(newKey < afterKey).toBe(true);
      console.log(`Key for placing between: ${newKey} (should be between ${beforeKey} and ${afterKey})`);
    });
    
    it('should handle multiple insertions at the beginning', () => {
      // Test repeated insertions at the beginning
      let currentFirst = 'a0';
      const keys = [currentFirst];
      
      for (let i = 0; i < 5; i++) {
        const newKey = generateKeyBetween(null, currentFirst);
        expect(newKey < currentFirst).toBe(true);
        keys.unshift(newKey);
        currentFirst = newKey;
      }
      
      // Verify all keys are in correct order
      for (let i = 0; i < keys.length - 1; i++) {
        expect(keys[i] < keys[i + 1]).toBe(true);
      }
      
      console.log('Keys after multiple insertions at beginning:', keys);
    });
  });
  
  describe('Drop Position Calculation', () => {
    const mockPhases = [
      { phase_id: '1', phase_name: 'Phase 1', order_key: 'a0' },
      { phase_id: '2', phase_name: 'Phase 2', order_key: 'a1' },
      { phase_id: '3', phase_name: 'Phase 3', order_key: 'a2' },
      { phase_id: '4', phase_name: 'Phase 4', order_key: 'a3' },
    ];
    
    it('should calculate correct before/after when dropping before first phase', () => {
      const dropPosition = 'before';
      const targetPhaseId = '1';
      const targetIndex = 0;
      
      let beforePhaseId: string | null = null;
      let afterPhaseId: string | null = null;
      
      if (dropPosition === 'before') {
        if (targetIndex > 0) {
          beforePhaseId = mockPhases[targetIndex - 1].phase_id;
        }
        afterPhaseId = targetPhaseId;
      }
      
      expect(beforePhaseId).toBe(null);
      expect(afterPhaseId).toBe('1');
    });
    
    it('should calculate correct before/after when dropping after last phase', () => {
      const dropPosition = 'after';
      const targetPhaseId = '4';
      const targetIndex = 3;
      
      let beforePhaseId: string | null = null;
      let afterPhaseId: string | null = null;
      
      if (dropPosition === 'after') {
        beforePhaseId = targetPhaseId;
        if (targetIndex < mockPhases.length - 1) {
          afterPhaseId = mockPhases[targetIndex + 1].phase_id;
        }
      }
      
      expect(beforePhaseId).toBe('4');
      expect(afterPhaseId).toBe(null);
    });
    
    it('should calculate correct before/after when dropping between phases', () => {
      const dropPosition = 'after';
      const targetPhaseId = '2';
      const targetIndex = 1;
      
      let beforePhaseId: string | null = null;
      let afterPhaseId: string | null = null;
      
      if (dropPosition === 'after') {
        beforePhaseId = targetPhaseId;
        if (targetIndex < mockPhases.length - 1) {
          afterPhaseId = mockPhases[targetIndex + 1].phase_id;
        }
      }
      
      expect(beforePhaseId).toBe('2');
      expect(afterPhaseId).toBe('3');
    });
  });
  
  describe('Sorting with Standard Comparison', () => {
    it('should sort phases correctly with standard comparison', () => {
      const phases = [
        { order_key: 'a2' },
        { order_key: 'Zz' },
        { order_key: 'a0' },
        { order_key: 'a1' },
        { order_key: 'Zy' },
      ];
      
      // Using standard comparison (NOT localeCompare)
      const sorted = [...phases].sort((a, b) => {
        return a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : 0;
      });
      
      const sortedKeys = sorted.map(p => p.order_key);
      expect(sortedKeys).toEqual(['Zy', 'Zz', 'a0', 'a1', 'a2']);
      
      // Verify Zz comes before a0
      expect('Zz' < 'a0').toBe(true);
    });
  });
  
  describe('Real-world Phase Drag Scenario', () => {
    it('should handle dragging phase to before the first phase', () => {
      const phases = [
        { phase_id: '1', phase_name: 'Phase 1', order_key: 'a0' },
        { phase_id: '2', phase_name: 'Phase 2', order_key: 'a1' },
        { phase_id: '3', phase_name: 'Phase 3', order_key: 'a2' },
      ];
      
      // Simulate dragging Phase 3 before Phase 1
      const draggedPhaseId = '3';
      const targetPhaseId = '1';
      const dropPosition = 'before';
      
      // Sort phases
      const sortedPhases = [...phases].sort((a, b) => {
        return a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : 0;
      });
      
      const currentIndex = sortedPhases.findIndex(p => p.phase_id === targetPhaseId);
      let beforePhaseId: string | null = null;
      let afterPhaseId: string | null = null;
      
      if (dropPosition === 'before') {
        if (currentIndex > 0) {
          beforePhaseId = sortedPhases[currentIndex - 1].phase_id;
        }
        afterPhaseId = targetPhaseId;
      }
      
      expect(currentIndex).toBe(0); // Phase 1 is at index 0
      expect(beforePhaseId).toBe(null); // No phase before the first one
      expect(afterPhaseId).toBe('1'); // After null, before Phase 1
      
      // Generate new key
      const beforeKey = beforePhaseId ? phases.find(p => p.phase_id === beforePhaseId)?.order_key || null : null;
      const afterKey = afterPhaseId ? phases.find(p => p.phase_id === afterPhaseId)?.order_key || null : null;
      
      const newKey = generateKeyBetween(beforeKey, afterKey);
      
      expect(newKey).toBeDefined();
      expect(newKey < 'a0').toBe(true); // New key should be before 'a0'
      console.log(`Moving Phase 3 before Phase 1: new key = ${newKey}`);
    });
  });
});