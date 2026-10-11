import { generateKeyBetween } from 'fractional-indexing';

export class OrderingService {
    static generateInitialKeys(count: number): string[] {
        const keys: string[] = [];
        let lastKey: string | null = null;
        
        for (let i = 0; i < count; i++) {
            const newKey = generateKeyBetween(lastKey, null);
            keys.push(newKey);
            lastKey = newKey;
        }
        
        return keys;
    }
    
    static generateKeyForPosition(
        beforeKey: string | null | undefined, 
        afterKey: string | null | undefined
    ): string {
        // Convert undefined to null for consistency
        const normalizedBeforeKey = beforeKey === undefined ? null : beforeKey;
        const normalizedAfterKey = afterKey === undefined ? null : afterKey;
        
        // Validate inputs to prevent fractional-indexing errors
        if (normalizedBeforeKey && normalizedAfterKey) {
            // Ensure beforeKey < afterKey
            if (normalizedBeforeKey >= normalizedAfterKey) {
                console.error('Invalid key order: beforeKey must be less than afterKey', {
                    beforeKey: normalizedBeforeKey,
                    afterKey: normalizedAfterKey
                });
                throw new Error(`Invalid key order: beforeKey (${normalizedBeforeKey}) must be less than afterKey (${normalizedAfterKey})`);
            }
        }
        
        // Handle edge case where both keys are the same (should not happen with proper logic)
        if (normalizedBeforeKey && normalizedAfterKey && normalizedBeforeKey === normalizedAfterKey) {
            console.error('Identical keys provided', { beforeKey: normalizedBeforeKey, afterKey: normalizedAfterKey });
            throw new Error('Cannot generate key between identical keys');
        }
        
        try {
            const newKey = generateKeyBetween(normalizedBeforeKey, normalizedAfterKey);
            console.log('Generated new key:', newKey, 'for position between', normalizedBeforeKey, 'and', normalizedAfterKey);
            return newKey;
        } catch (error) {
            console.error('Error generating key between:', { beforeKey: normalizedBeforeKey, afterKey: normalizedAfterKey, error });
            throw error;
        }
    }
}
