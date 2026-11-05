export const CHECK_IDS = ['title_facts', 'bullet_facts', 'image_product', 'white_background', 'no_overlay'] as const;
export type CheckId = typeof CHECK_IDS[number];
export type Outcome = 'match' | 'mismatch' | 'insufficient_evidence';
export type Status = 'passed' | 'attention' | 'review';
export type Engine = 'decisions' | 'responses';
export type Model = 'gpt-6-luna' | 'gpt-6.1-sol';
export type Effort = 'none' | 'low' | 'medium' | 'high';
export interface Settings { model: Model; effort: Effort }
export const DEFAULT_SETTINGS: Settings = { model: 'gpt-6-luna', effort: 'none' };
export const EFFORTS: Record<Model, Effort[]> = { 'gpt-6-luna': ['none', 'low', 'medium', 'high'], 'gpt-6.1-sol': ['low', 'medium', 'high'] };
export interface Listing { productId: string; title: string; bullets: string[]; imageId: string }
export interface Asset { id: string; productId: string; label: string; file: string; available?: boolean }
export interface Product { id: string; name: string; brand: string; category: string; sku: string; facts: Record<string, string>; title: string; bullets: string[]; imageIds: string[]; thumbnail: string }
export interface Fixture { id: string; productId: string; label: string; variant: 'consistent' | 'attention'; listing: Listing; expected: Record<CheckId, Outcome> }
export interface Check { id: CheckId; outcome: Outcome }
export interface Usage { input: number; cached: number; cacheWrite: number; output: number; reasoning: number }
export interface Cost { usd: number | null; version: string; source: string; note: string; rates: { input: number; cached: number; cacheWrite: number; output: number } }
export interface Run {
  id: string; engine: Engine; settings: Settings; model: string; timestamp: string;
  fingerprint: string; questionVersion: string; fixtureId: string | null;
  listing: Listing; checks: Check[]; status: Status | 'error'; sdkMs: number | null; roundTripMs?: number;
  usage: Usage | null; cost: Cost | null; raw: unknown; request: unknown;
  error?: string; errorCode?: string; mode?: 'live' | 'repeat'; batchId?: string; repetition?: number;
  expected?: Record<CheckId, Outcome>; agreement?: { correct: number; total: number };
}
export const CHECK_LABELS: Record<CheckId, string> = {
  title_facts: 'Title matches product facts', bullet_facts: 'Bullets tell a consistent story',
  image_product: 'Photo matches the product', white_background: 'Main photo has a white background', no_overlay: 'No promotional overlays',
};
export const CHECK_HELP: Record<CheckId, string> = {
  title_facts: 'Review the title against the reference facts and correct conflicting claims.',
  bullet_facts: 'Review your bullets for claims that conflict with the title or reference facts.',
  image_product: 'Choose a photo showing the product type and color described in this listing.',
  white_background: 'Choose a clean, white-background photo for the main listing image.',
  no_overlay: 'Choose a main photo without promotional copy, badges, or added graphics.',
};
export function route(checks: Check[]): Status {
  if (checks.some(c => c.outcome === 'mismatch')) return 'attention';
  if (CHECK_IDS.some(id => !checks.some(c => c.id === id && c.outcome === 'match'))) return 'review';
  return 'passed';
}
export function validSettings(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false;
  const s = value as Settings;
  return Object.hasOwn(EFFORTS, s.model) && EFFORTS[s.model].includes(s.effort);
}
export const STATUS_LABEL = { passed: 'Preflight passed', attention: 'Needs attention', review: 'Needs a closer look', error: 'Check unavailable' };
export function formatMs(ms: number | null | undefined) { return ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`; }
export function money(usd: number | null | undefined) { return usd == null ? 'Unavailable' : `$${usd.toFixed(6)}`; }
