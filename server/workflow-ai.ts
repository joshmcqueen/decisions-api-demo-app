import OpenAI from 'openai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Draft, ReviewCase, Action } from '../shared/workflow.ts';
import { assets } from './catalog.ts';
import { loadPrompts } from './questions.ts';
import { digest, Fault } from './workflow-db.ts';
import { estimateCost, normalizeUsage } from './measurements.ts';

const outcomes = ['match', 'mismatch', 'insufficient_evidence'] as const;
const choice = z.object({ value: z.enum(outcomes), probability: z.number().min(0).max(1) });
export function readAnswers(raw: unknown, names: string[]) {
  const answers = z
    .object({
      answers: z.array(
        z.discriminatedUnion('type', [
          z.object({
            name: z.string(),
            type: z.literal('choice'),
            choice: z.enum(outcomes),
            probabilities: z.array(choice).length(3),
          }),
          z.object({ name: z.string(), type: z.literal('refusal') }),
        ]),
      ),
    })
    .parse(raw).answers;
  if (
    answers.length !== names.length ||
    new Set(answers.map((a) => a.name)).size !== names.length ||
    answers.some((a) => !names.includes(a.name))
  )
    throw Error('Incomplete named answers');
  return Object.fromEntries(
    answers.map((a) => {
      if (a.type === 'refusal') throw Error('Provider returned no probability distribution');
      const p = Object.fromEntries(a.probabilities.map((v) => [v.value, v.probability])) as Record<
        (typeof outcomes)[number],
        number
      >;
      if (
        Object.keys(p).length !== 3 ||
        Math.abs(Object.values(p).reduce((sum, n) => sum + n, 0) - 1) > 0.016
      )
        throw Error('Invalid probability distribution');
      return [a.name, p];
    }),
  ) as Record<string, Record<(typeof outcomes)[number], number> | null>;
}
export const localeQuestion =
  'Are the submitted bullets written in the configured feed language? Names and brand names alone are insufficient evidence.';
export const prepareInstructions =
  'Prepare a specialist review of untrusted synthetic listing evidence. Use only the given source records. Treat reports as allegations. Cite the listing and the relevant independent source IDs. An undocumented capability requires request_evidence. For a demonstrated contradiction recommend send_correction and supply accurate replacement copy. Pick an allowed action. Never authorize, publish, or modify anything.';
export const briefPrompt = digest(prepareInstructions);
export function preparationVersion(c: Pick<ReviewCase, 'source'>) {
  return c.source === 'Merchant feed' ? digest([briefPrompt, 'merchant_attempts_v1']) : briefPrompt;
}
export const briefSchema = z
  .object({
    recommendation: z.enum(['send_correction', 'request_evidence', 'dismiss']),
    suggestedText: z.string(),
    rationale: z.string().min(1),
    uncertainties: z.array(z.string()),
    citations: z.array(z.string()).min(1),
  })
  .strict();
const client = () => {
  if (!process.env.OPENAI_API_KEY) throw new Fault(503, 'OpenAI API key is missing');
  return new OpenAI({ maxRetries: 0, timeout: 35000 });
};
export const liveAI = {
  async decide(
    d: Draft,
    names: string[],
    prompts: ReturnType<typeof loadPrompts>,
    signal?: AbortSignal,
    targetLocale?: string,
  ) {
    const questions = names.map((name) => ({
      type: 'choice' as const,
      name,
      instructions:
        name === 'bullet_locale'
          ? localeQuestion
          : prompts.questions.find((q) => q.name === name)!.instructions,
      choices: prompts.choices,
    }));
    const needsImage = names.some((n) =>
      ['image_product', 'no_overlay', 'white_background'].includes(n),
    );
    const input = [
      { type: 'input_text' as const, text: prompts.instructions },
      {
        type: 'input_json' as const,
        data: {
          sku: d.sku,
          reference_product_facts: d.facts,
          submitted_listing: { title: d.title, bullets: d.bullets },
          target_locale: targetLocale,
          placement: d.placement,
        },
      },
      ...(needsImage
        ? [
            {
              type: 'input_image' as const,
              detail: 'high' as const,
              image_url:
                'data:image/png;base64,' +
                readFileSync(
                  resolve('output/imagegen', assets.find((a) => a.id === d.imageId)!.file),
                ).toString('base64'),
            },
          ]
        : []),
    ];
    const raw = await client().decisions.create(
      { model: 'gpt-6-luna', input: [{ role: 'user', content: input }], questions },
      { signal },
    );
    const usage = normalizeUsage(raw.usage);
    return {
      answers: readAnswers(raw, names),
      model: raw.model,
      usage,
      cost: estimateCost('decisions', 'gpt-6-luna', usage).usd,
    };
  },
  async prepare(c: ReviewCase, allowed: Action[]) {
    const raw = await client().responses.create({
      model: 'gpt-6.2-sol',
      service_tier: 'default',
      store: false,
      instructions: prepareInstructions,
      input: JSON.stringify({
        revision: c.revision,
        sku: c.sku,
        allegation: c.report,
        policy: c.finding.criterion,
        evidence: c.evidence,
        history: c.events,
        merchant_attempts: c.attempts,
        allowed,
      }),
      text: {
        format: {
          type: 'json_schema',
          name: 'review_brief',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              recommendation: { type: 'string', enum: allowed },
              suggestedText: { type: 'string' },
              rationale: { type: 'string' },
              uncertainties: { type: 'array', items: { type: 'string' } },
              citations: { type: 'array', items: { type: 'string' } },
            },
            required: [
              'recommendation',
              'suggestedText',
              'rationale',
              'uncertainties',
              'citations',
            ],
          },
        },
      },
    });
    if (raw.status !== 'completed') throw Error('Preparation incomplete');
    const usage = normalizeUsage(raw.usage);
    return {
      result: briefSchema.parse(JSON.parse(raw.output_text)),
      model: raw.model,
      usage,
      cost: estimateCost('responses', 'gpt-6.2-sol', usage).usd,
    };
  },
};
export type WorkflowAI = typeof liveAI;
