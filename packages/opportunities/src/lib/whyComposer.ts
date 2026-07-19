import type { WhySentence } from '@alga-psa/types';

/**
 * The why-sentence composer — the module's voice (F114).
 *
 * Every sentence is assembled from structured facts the caller proves from
 * data. Nothing here invents; nothing here needs AI. The AI seam may later
 * rephrase for fluency, never for content. Rules:
 *   - one emphasized clause per sentence: the fact that matters most
 *   - short declaratives, plain verbs, no em-dashes (house voice)
 *   - state only what the facts parameter carries
 */

export type WhyFacts =
  | {
      kind: 'action_due';
      clientName: string;
      daysOverdue: number;
      /** Days since a linked quote was sent, when one exists. */
      daysSinceProposal?: number | null;
      /** Inbound interactions logged since our last outbound touch. */
      inboundSinceLastTouch?: number | null;
      quoteNumber?: string | null;
    }
  | {
      kind: 'going_quiet';
      clientName: string;
      daysSinceActivity: number;
      /** Present when the deal reached Verbal before going quiet. */
      daysSinceVerbal?: number | null;
    }
  | {
      kind: 'suggestion_renewal';
      clientName: string;
      daysToRenewal: number;
    }
  | {
      kind: 'suggestion_tm_conversion';
      clientCount: number;
      clientNames: string[];
    }
  | {
      kind: 'suggestion_whitespace';
      clientName: string;
      missingServiceName: string;
    }
  | {
      kind: 'suggestion_asset_aging';
      clientName: string;
      assetCount: number;
      oldestYears: number;
    }
  | {
      kind: 'suggestion_inbound_lead';
      clientName: string;
      formName: string;
    }
  | {
      kind: 'lesson_assessment_conversion';
      wonPerFive: number;
      monthsSinceLastProposed: number;
    }
  | {
      kind: 'lesson_quote_velocity';
      weekCloseRatio: number;
    };

const seg = (text: string, emphasis?: boolean) => (emphasis ? { text, emphasis: true as const } : { text });

const plural = (n: number, singular: string, pluralWord?: string) =>
  `${n} ${n === 1 ? singular : (pluralWord ?? `${singular}s`)}`;

export function composeWhy(facts: WhyFacts): WhySentence {
  switch (facts.kind) {
    case 'action_due': {
      if (facts.daysOverdue > 0) {
        const chased =
          facts.inboundSinceLastTouch && facts.inboundSinceLastTouch > 0
            ? ` They have written ${plural(facts.inboundSinceLastTouch, 'time')} since your last reply.`
            : '';
        if (facts.daysSinceProposal != null) {
          return {
            segments: [
              seg(`Day ${facts.daysSinceProposal} since the proposal`, true),
              seg(` and ${plural(facts.daysOverdue, 'day')} past your own deadline.${chased}`),
            ],
          };
        }
        return {
          segments: [
            seg(`${plural(facts.daysOverdue, 'day')} past due`, true),
            seg(` for ${facts.clientName}.${chased}`),
          ],
        };
      }
      if (facts.daysSinceProposal != null && facts.quoteNumber) {
        return {
          segments: [
            seg(`${facts.clientName} has had quote ${facts.quoteNumber} for `),
            seg(plural(facts.daysSinceProposal, 'day'), true),
            seg('.'),
          ],
        };
      }
      return { segments: [seg('Due today'), seg(` for ${facts.clientName}.`)] };
    }

    case 'going_quiet': {
      if (facts.daysSinceVerbal != null) {
        return {
          segments: [
            seg(`${plural(facts.daysSinceVerbal, 'day')} since their verbal yes`, true),
            seg('. The paperwork never went out.'),
          ],
        };
      }
      return {
        segments: [
          seg(`Quiet for ${plural(facts.daysSinceActivity, 'day')}`, true),
          seg(` at ${facts.clientName}. Deals this quiet usually die without a nudge.`),
        ],
      };
    }

    case 'suggestion_renewal':
      return {
        segments: [
          seg(`Renews in ${plural(facts.daysToRenewal, 'day')}`, true),
          seg('. Starting now means the renewal conversation is not rushed.'),
        ],
      };

    case 'suggestion_tm_conversion': {
      const who =
        facts.clientNames.length <= 3
          ? facts.clientNames.join(', ')
          : `${plural(facts.clientCount, 'client')}`;
      return {
        segments: [
          seg(`${who} paid more on T&M than an agreement costs`, true),
          seg(' over the trailing 12 months. The one-pager makes it their idea.'),
        ],
      };
    }

    case 'suggestion_whitespace':
      return {
        segments: [
          seg(`${facts.clientName} does not buy ${facts.missingServiceName}`, true),
          seg(' from you yet. Every comparable client does.'),
        ],
      };

    case 'suggestion_inbound_lead':
      return {
        segments: [
          seg(`${facts.clientName} raised their hand`, true),
          seg(` via ${facts.formName}. Inbound interest cools fast.`),
        ],
      };

    case 'suggestion_asset_aging':
      return {
        segments: [
          seg(
            `${plural(facts.assetCount, 'asset')} past ${plural(facts.oldestYears, 'year')} old`,
            true
          ),
          seg(` at ${facts.clientName}. Quote the refresh before it becomes an outage ticket.`),
        ],
      };

    case 'lesson_assessment_conversion':
      return {
        segments: [
          seg(`You close ${facts.wonPerFive} of every 5 assessments you propose.`, true),
          seg(
            ` You have not proposed one in ${plural(facts.monthsSinceLastProposed, 'month')}. Paid assessments are your strongest opening move.`
          ),
        ],
      };

    case 'lesson_quote_velocity':
      return {
        segments: [
          seg(`Quotes you send within a week close ${facts.weekCloseRatio}x as often`, true),
          seg(' as the ones that wait.'),
        ],
      };
  }
}
