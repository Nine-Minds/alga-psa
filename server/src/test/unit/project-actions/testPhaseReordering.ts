import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyBetween } from 'fractional-indexing';

describe('Phase Reordering Implementation Test', () => {
  describe('Phase order key generation', () => {
    const mockPhases = [
      { phase_id: 'p1', phase_name: 'Phase 1', order_key: 'a0' },
      { phase_id: 'p2', phase_name: 'Phase 2', order_key: 'a1' },
      { phase_id: 'p3', phase_name: 'Phase 3', order_key: 'a2' },
      { phase_id: 'p4', phase_name: 'Phase 4', order_key: 'a3' },
    ];

    it('should correctly calculate before/after when dropping Phase 3 before Phase 1', () => {
      const draggedPhaseId: string = 'p3';
      const targetPhaseId: string = 'p1';
      const isDropBefore = true;
      
      // Sort phases
      const sortedPhases = [...mockPhases].sort((a, b) => {
        const aKey = a.order_key || 'zzz';
        const bKey = b.order_key || 'zzz';
        return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
      });
      
      const targetIndex = sortedPhases.findIndex(p => p.phase_id === targetPhaseId);
      let beforePhaseId: string | null = null;
      let afterPhaseId: string | null = null;
      
      if (targetIndex !== -1 && isDropBefore) {
        // Find the phase that will be before our dropped phase
        let searchIndex = targetIndex - 1;
        while (searchIndex >= 0) {
          if (sortedPhases[searchIndex].phase_id !== draggedPhaseId) {
            beforePhaseId = sortedPhases[searchIndex].phase_id;
            break;
          }
          searchIndex--;
        }
        
        // The target phase will be after our dropped phase
        if (targetPhaseId !== draggedPhaseId) {
          afterPhaseId = targetPhaseId;
        }
      }
      
      expect(beforePhaseId).toBe(null); // No phase before
      expect(afterPhaseId).toBe('p1'); // Phase 1 comes after
      
      // Generate new key
      const beforeKey = beforePhaseId ? mockPhases.find(p => p.phase_id === beforePhaseId)?.order_key || null : null;
      const afterKey = afterPhaseId ? mockPhases.find(p => p.phase_id === afterPhaseId)?.order_key || null : null;
      
      const newKey = generateKeyBetween(beforeKey, afterKey);
      console.log(`Moving Phase 3 before Phase 1: new key = ${newKey} (should be < 'a0')`);
      
      expect(newKey).toBeDefined();
      expect(newKey < 'a0').toBe(true);
    });

    it('should correctly calculate before/after when dropping Phase 1 after Phase 4', () => {
      const draggedPhaseId: string = 'p1';
      const targetPhaseId: string = 'p4';
      const isDropBefore = false; // Dropping after
      
      const sortedPhases = [...mockPhases].sort((a, b) => {
        const aKey = a.order_key || 'zzz';
        const bKey = b.order_key || 'zzz';
        return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
      });
      
      const targetIndex = sortedPhases.findIndex(p => p.phase_id === targetPhaseId);
      let beforePhaseId: string | null = null;
      let afterPhaseId: string | null = null;
      
      if (targetIndex !== -1 && !isDropBefore) {
        // The target phase will be before our dropped phase
        if (targetPhaseId !== draggedPhaseId) {
          beforePhaseId = targetPhaseId;
        }
        
        // Find the phase that will be after our dropped phase
        let searchIndex = targetIndex + 1;
        while (searchIndex < sortedPhases.length) {
          if (sortedPhases[searchIndex].phase_id !== draggedPhaseId) {
            afterPhaseId = sortedPhases[searchIndex].phase_id;
            break;
          }
          searchIndex++;
        }
      }
      
      expect(beforePhaseId).toBe('p4'); // Phase 4 comes before
      expect(afterPhaseId).toBe(null); // No phase after
      
      // Generate new key
      const beforeKey = beforePhaseId ? mockPhases.find(p => p.phase_id === beforePhaseId)?.order_key || null : null;
      const afterKey = afterPhaseId ? mockPhases.find(p => p.phase_id === afterPhaseId)?.order_key || null : null;
      
      const newKey = generateKeyBetween(beforeKey, afterKey);
      console.log(`Moving Phase 1 after Phase 4: new key = ${newKey} (should be > 'a3')`);
      
      expect(newKey).toBeDefined();
      expect(newKey > 'a3').toBe(true);
    });

    it('should correctly calculate before/after when dropping Phase 1 between Phase 2 and Phase 3', () => {
      const draggedPhaseId: string = 'p1';
      const targetPhaseId: string = 'p2';
      const isDropBefore = false; // Dropping after Phase 2
      
      const sortedPhases = [...mockPhases].sort((a, b) => {
        const aKey = a.order_key || 'zzz';
        const bKey = b.order_key || 'zzz';
        return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
      });
      
      const targetIndex = sortedPhases.findIndex(p => p.phase_id === targetPhaseId);
      let beforePhaseId: string | null = null;
      let afterPhaseId: string | null = null;
      
      if (targetIndex !== -1 && !isDropBefore) {
        // The target phase will be before our dropped phase
        if (targetPhaseId !== draggedPhaseId) {
          beforePhaseId = targetPhaseId;
        }
        
        // Find the phase that will be after our dropped phase
        let searchIndex = targetIndex + 1;
        while (searchIndex < sortedPhases.length) {
          if (sortedPhases[searchIndex].phase_id !== draggedPhaseId) {
            afterPhaseId = sortedPhases[searchIndex].phase_id;
            break;
          }
          searchIndex++;
        }
      }
      
      expect(beforePhaseId).toBe('p2'); // Phase 2 comes before
      expect(afterPhaseId).toBe('p3'); // Phase 3 comes after
      
      // Generate new key
      const beforeKey = beforePhaseId ? mockPhases.find(p => p.phase_id === beforePhaseId)?.order_key || null : null;
      const afterKey = afterPhaseId ? mockPhases.find(p => p.phase_id === afterPhaseId)?.order_key || null : null;
      
      const newKey = generateKeyBetween(beforeKey, afterKey);
      console.log(`Moving Phase 1 between Phase 2 and 3: new key = ${newKey} (should be between 'a1' and 'a2')`);
      
      expect(newKey).toBeDefined();
      expect(newKey > 'a1').toBe(true);
      expect(newKey < 'a2').toBe(true);
    });
  });
});