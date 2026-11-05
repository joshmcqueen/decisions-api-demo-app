import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { CHECK_IDS, type Outcome } from '../shared/domain.ts';

export const promptsDirectory = fileURLToPath(new URL('../prompts/', import.meta.url));
const OUTCOMES = ['match', 'mismatch', 'insufficient_evidence'] as const;
const choicesSchema = z.array(z.object({
  value: z.enum(OUTCOMES), description: z.string().trim().min(1),
}).strict()).length(OUTCOMES.length).refine(
  choices => new Set(choices.map(c => c.value)).size === OUTCOMES.length,
  'Include each of match, mismatch, and insufficient_evidence exactly once.',
);

export class PromptConfigurationError extends Error {}

// Read a fresh, complete snapshot for each request; no module or mtime cache.
export function loadPrompts(directory = promptsDirectory) {
  function read(file: string) {
    try {
      const text = readFileSync(path.join(directory, file), 'utf8').trim();
      if (!text) throw new Error('Empty prompt');
      return text;
    } catch {
      throw new PromptConfigurationError(`Could not read prompts/${file}. Check that the file exists and is not empty.`);
    }
  }
  const instructions = read('instructions.md');
  const questions = CHECK_IDS.map(name => ({ name, instructions: read(`checks/${name}.md`) }));
  let choices: z.infer<typeof choicesSchema>;
  try { choices = choicesSchema.parse(JSON.parse(read('choices.json'))); }
  catch { throw new PromptConfigurationError('Check prompts/choices.json: provide valid JSON with one nonempty description for each of match, mismatch, and insufficient_evidence.'); }
  const template = read('responses.md');
  const variables = { instructions, questions: JSON.stringify(questions), choices: JSON.stringify(choices) };
  const tokens = template.match(/\{\{[^{}]*\}\}/g) ?? [];
  if (tokens.length !== 3 || Object.keys(variables).some(key => tokens.filter(t => t === `{{${key}}}`).length !== 1)) {
    throw new PromptConfigurationError('Keep {{instructions}}, {{questions}}, and {{choices}} exactly once each in prompts/responses.md.');
  }
  const responsesInstructions = template.replace(/\{\{(instructions|questions|choices)\}\}/g,
    (_, key: keyof typeof variables) => variables[key]);
  const version = `listing-checks-${createHash('sha256').update(JSON.stringify({ instructions, questions, choices, template })).digest('hex').slice(0, 16)}`;
  return { instructions, questions, choices, responsesInstructions, version };
}

// Output keys and values are an application contract, independent of editable prose.
export const responseSchema = {
  type: 'object', properties: Object.fromEntries(CHECK_IDS.map(id => [id, { type: 'string', enum: [...OUTCOMES] }])),
  required: [...CHECK_IDS], additionalProperties: false,
};
export function isOutcome(v: unknown): v is Outcome { return OUTCOMES.some(outcome => outcome === v); }
