import type { Outcome } from './domain.ts';
export type Route = 'green' | 'yellow' | 'red';
export type Action = 'send_correction' | 'request_evidence' | 'dismiss';
export const actionLabels: Record<Action, string> = {
  send_correction: 'Send correction request',
  request_evidence: 'Request more evidence',
  dismiss: 'Dismiss report',
};
export interface Criterion {
  id: string;
  title: string;
  authority: string;
  field: string;
  placement: string;
  source: string;
  canonical: string;
  rule: string;
  remedy: string;
  owner: string;
  verification: string;
  evidence: string[];
  green: number;
  red: number;
}
export interface Draft {
  assetRef?: string;
  id: string;
  merchant: string;
  sku: string;
  category: string;
  product: string;
  name: string;
  revision: number;
  title: string;
  bullets: string[];
  imageId: string;
  placement: 'main' | 'secondary';
  facts: Record<string, string>;
  pimRef: string;
  choices: string[];
}
export interface Evidence {
  ref: string;
  label: string;
  text: string;
  image?: string;
}
export interface Finding {
  knowledgeTrace?: KnowledgeTrace;
  criterion: Criterion;
  policy: string;
  route: Route;
  reason: string;
  evidence: Evidence[];
  question?: string;
  probabilities?: Record<Outcome, number>;
  dependency?: string;
}
export interface KnowledgeTrace {
  domain: {
    version: string;
    productType: string;
    categoryPath: string[];
    concept: string;
    definition: string;
    criterionId: string;
    requirement: string;
    source: 'pim' | 'asset';
    field?: string;
  };
  subject: string;
  listingRef: string;
  sourceRef: string;
  observation: string;
}
export interface Validation {
  id: string;
  revision: number;
  route: Route;
  policy: string;
  prompt: string;
  findings: Finding[];
  model: string;
}
export interface ReviewBrief {
  id: string;
  revision: number;
  policy: string;
  prompt: string;
  model: string;
  recommendation: Action;
  suggestedText: string;
  rationale: string;
  uncertainties: string[];
  citations: string[];
  preparedAt: string;
}
export interface CaseEvent {
  at: string;
  actor: string;
  label: string;
  revision: number;
  policy: string;
  detail: string;
}
export interface ReviewCase {
  productName?: string;
  preparedChatUrl?: string;
  id: string;
  draftId: string;
  revision: number;
  version: number;
  sku: string;
  category: string;
  merchant: string;
  assigned: string;
  source: 'Seller request' | 'Shopper report' | 'Merchant feed';
  report: string;
  created: string;
  status: string;
  prep: string;
  finding: Finding;
  evidence: Evidence[];
  events: CaseEvent[];
  brief: ReviewBrief | null;
  actions: Action[];
  twin: boolean;
  attempts: { at: string; agent: string; merchant: string; locale: string; bullets: string[] }[];
}
export interface Workspace {
  drafts: Draft[];
  cases: ReviewCase[];
  assets: { id: string; file: string; label: string }[];
  role: string;
  policy: string;
  handoff: 'brief' | 'mcp-read' | 'mcp-write';
  chatUrl: string;
}
