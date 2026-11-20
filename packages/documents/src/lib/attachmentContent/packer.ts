import type { ContentBudget, LimitName } from './limits';
import type { ContentBlock, UnitCost } from './types';

/** Actual cost of a unit's body blocks (labels are not counted). */
export function costOfBlocks(blocks: readonly ContentBlock[]): UnitCost {
  let images = 0;
  let encodedBytes = 0;
  let textChars = 0;
  for (const b of blocks) {
    if (b.type === 'image') {
      images += 1;
      encodedBytes += b.data.length;
    } else if (b.type === 'resource') {
      encodedBytes += b.resource.blob.length;
    } else if (b.type === 'text') {
      textChars += b.text.length;
    }
  }
  return { images, encodedBytes, textChars };
}

/**
 * Running budget of one call. `check` answers "would this unit exceed a limit?" and names the limit; the
 * caller applies the always-progress rule (the first unit of a call is admitted regardless, because
 * producers guarantee a single unit fits an empty budget).
 */
export class CallBudget {
  private images = 0;
  private encodedBytes = 0;
  private textChars = 0;
  private readonly deadlineAt: number;

  constructor(
    private readonly budget: ContentBudget,
    private readonly now: () => number,
  ) {
    this.deadlineAt = now() + budget.deadlineMs;
  }

  deadlineReached(): boolean {
    return this.now() >= this.deadlineAt;
  }

  check(cost: UnitCost): LimitName | null {
    if (this.images + cost.images > this.budget.maxImages) return 'max_images';
    if (this.encodedBytes + cost.encodedBytes > this.budget.maxEncodedBytes) return 'max_encoded_bytes';
    if (this.textChars + cost.textChars > this.budget.maxTextChars) return 'max_text_chars';
    return null;
  }

  add(cost: UnitCost): void {
    this.images += cost.images;
    this.encodedBytes += cost.encodedBytes;
    this.textChars += cost.textChars;
  }
}
