import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Draft, Evidence, KnowledgeTrace } from '../shared/workflow.ts';
import { criteria } from './workflow-db.ts';

const text = z.string().trim().min(1);
const concept = z.object({ definition: text, requirement: text });
const ontologySchema = z.object({
  version: text,
  products: z.record(text, z.object({ type: text, categoryPath: z.array(text).min(1), concept: text })),
  concepts: z.record(text, z.discriminatedUnion('source', [
    concept.extend({ source: z.literal('pim'), criterionId: z.literal('bullet_facts'), field: text }),
    concept.extend({ source: z.literal('asset'), criterionId: z.literal('asset_approval') }),
  ])),
}).refine(model => Object.values(model.products).every(p => Object.hasOwn(model.concepts, p.concept))
  && Object.values(model.concepts).every(c =>
    criteria.some(rule => rule.id === c.criterionId && rule.evidence.includes(c.source))),
  'Unknown concept, policy criterion or evidence source');

export function parseOntology(data: unknown) {
  return ontologySchema.parse(data);
}
function loadOntology() {
  try {
    const file = new URL('../data/commerce-ontology.json', import.meta.url);
    return parseOntology(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    console.warn('Commerce ontology unavailable. Using baseline checks.', String(error));
    return undefined;
  }
}
const ontology = loadOntology();

// Match a direct product assertion. Questions, exclusions and flavor descriptions
// can mention the beverage without asserting that the appliance makes it.
export function espressoBullet(bullets: string[]) {
  return bullets.find(bullet => bullet.split(/[.!;\n]/).some(sentence => {
    if (/\?|\b(?:no|not|never|cannot|without|if|whether|wish|could)\b|n['’]t\b/i.test(sentence)) return false;
    // The demo bullets optionally start with a short label, as in “Café at home: Brews …”.
    const assertion = sentence.slice(sentence.lastIndexOf(':') + 1).trim();
    return /^(?:(?:it|this (?:machine|appliance|(?:drip )?coffee maker)) (?:can )?)?(?:brews?|makes?)\s+(?:(?:rich|real|authentic|caf[ée]-quality)[,\s]+)*espresso\b(?![-\s]+(?:style|flavo[u]?r\w*|grounds|beans|roast)\b)/i.test(assertion);
  }));
}

export function resolveKnowledgeTrace(
  draft: Draft, evidence: Evidence[], model = ontology,
): KnowledgeTrace | undefined {
  const product = model?.products[draft.product];
  if (!model || !product || product.categoryPath[0] !== draft.category) return;
  const concept = model.concepts[product.concept];
  const listing = evidence.find(e => e.ref.startsWith('listing/'));
  const source = evidence.find(e => e.ref.startsWith(concept.source + '/'));
  if (!listing || !source) return;
  let subject: string, observation: string;
  if (concept.source === 'pim') {
    const bullet = espressoBullet(draft.bullets);
    if (!bullet) return;
    subject = bullet;
    observation = draft.facts[concept.field]?.trim() || 'Undocumented in this manufacturer record.';
  } else {
    if (draft.placement !== 'main') return;
    subject = 'Main photo for ' + draft.sku;
    observation = source.text;
  }
  return {
    domain: {
      version: model.version, productType: product.type, categoryPath: product.categoryPath,
      concept: product.concept, ...concept,
    },
    subject, listingRef: listing.ref, sourceRef: source.ref, observation,
  };
}
