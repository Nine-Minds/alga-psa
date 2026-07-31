import type { WhySentence } from '@alga-psa/types';

/**
 * The why-sentence composer — the module's voice (F114).
 *
 * Every sentence is assembled from structured facts the caller proves from
 * data. The output is structured translation data, never server-composed
 * English. Nothing here invents; nothing here needs AI. Rules:
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

const seg = (
  key: string,
  params?: Record<string, string | number>,
  emphasis?: boolean,
) => ({
  message: { key, ...(params ? { params } : {}) },
  ...(emphasis ? { emphasis: true as const } : {}),
});

export function composeWhy(facts: WhyFacts): WhySentence {
  switch (facts.kind) {
    case 'action_due': {
      if (facts.daysOverdue > 0) {
        const chased = facts.inboundSinceLastTouch && facts.inboundSinceLastTouch > 0
          ? [seg('opportunities.why.actionDue.inboundChase', {
              count: facts.inboundSinceLastTouch,
            })]
          : [];
        if (facts.daysSinceProposal != null) {
          return {
            segments: [
              seg('opportunities.why.actionDue.proposalAge', {
                count: facts.daysSinceProposal,
              }, true),
              seg('opportunities.why.actionDue.deadlinePast', {
                count: facts.daysOverdue,
              }),
              ...chased,
            ],
          };
        }
        return {
          segments: [
            seg('opportunities.why.actionDue.pastDue', {
              count: facts.daysOverdue,
            }, true),
            seg('opportunities.why.forClient', { clientName: facts.clientName }),
            ...chased,
          ],
        };
      }
      if (facts.daysSinceProposal != null && facts.quoteNumber) {
        return {
          segments: [
            seg('opportunities.why.actionDue.quoteIntro', {
              clientName: facts.clientName,
              quoteNumber: facts.quoteNumber,
            }),
            seg('opportunities.why.actionDue.proposalAgeShort', {
              count: facts.daysSinceProposal,
            }, true),
          ],
        };
      }
      return {
        segments: [
          seg('opportunities.why.actionDue.dueToday', undefined, true),
          seg('opportunities.why.forClient', { clientName: facts.clientName }),
        ],
      };
    }

    case 'going_quiet': {
      if (facts.daysSinceVerbal != null) {
        return {
          segments: [
            seg('opportunities.why.goingQuiet.verbalAge', {
              count: facts.daysSinceVerbal,
            }, true),
            seg('opportunities.why.goingQuiet.paperworkMissing'),
          ],
        };
      }
      return {
        segments: [
          seg('opportunities.why.goingQuiet.quietAge', {
            count: facts.daysSinceActivity,
          }, true),
          seg('opportunities.why.goingQuiet.nudge', { clientName: facts.clientName }),
        ],
      };
    }

    case 'suggestion_renewal':
      return {
        segments: [
          seg('opportunities.why.renewal.age', {
            count: facts.daysToRenewal,
          }, true),
          seg('opportunities.why.renewal.startNow'),
        ],
      };

    case 'suggestion_tm_conversion': {
      const who =
        facts.clientNames.length <= 3
          ? facts.clientNames.join(', ')
          : null;
      return {
        segments: [
          who
            ? seg('opportunities.why.tmConversion.named', { clientNames: who }, true)
            : seg('opportunities.why.tmConversion.counted', { count: facts.clientCount }, true),
          seg('opportunities.why.tmConversion.trailing'),
        ],
      };
    }

    case 'suggestion_whitespace':
      return {
        segments: [
          seg('opportunities.why.whitespace.missing', {
            clientName: facts.clientName,
            serviceName: facts.missingServiceName,
          }, true),
          seg('opportunities.why.whitespace.comparable'),
        ],
      };

    case 'suggestion_inbound_lead':
      return {
        segments: [
          seg('opportunities.why.inboundLead.raisedHand', {
            clientName: facts.clientName,
          }, true),
          seg('opportunities.why.inboundLead.source', { formName: facts.formName }),
        ],
      };

    case 'suggestion_asset_aging':
      return {
        segments: [
          seg('opportunities.why.assetAging.age', {
            count: facts.assetCount,
            oldestYears: facts.oldestYears,
          }, true),
          seg('opportunities.why.assetAging.quoteRefresh', { clientName: facts.clientName }),
        ],
      };

    case 'lesson_assessment_conversion':
      return {
        segments: [
          seg('opportunities.why.lesson.assessmentRate', {
            wonPerFive: facts.wonPerFive,
          }, true),
          seg('opportunities.why.lesson.assessmentGap', {
            count: facts.monthsSinceLastProposed,
          }),
        ],
      };

    case 'lesson_quote_velocity':
      return {
        segments: [
          seg('opportunities.why.lesson.quoteVelocity', {
            ratio: facts.weekCloseRatio,
          }, true),
          seg('opportunities.why.lesson.quoteVelocityCompared'),
        ],
      };
  }
}
