import express from 'express';
import OpenAI from 'openai';
import type { DecisionCreateParams } from 'openai/resources/decisions';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import { parse } from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { assets, products, fixtures, guidelines } from './catalog.ts';
import { CHECK_IDS, DEFAULT_SETTINGS, EFFORTS, validSettings, type Check, type Run, type Settings } from '../shared/domain.ts';
import { loadPrompts, PromptConfigurationError, responseSchema } from './questions.ts';
import { agreement, estimateCost, fingerprint, normalizeDecisions, normalizeResponses, normalizeUsage, route } from './measurements.ts';

const root = process.cwd();
export const assetDir = path.join(root, 'output/imagegen');
function environment() { try { return { ...process.env, ...parse(readFileSync(path.join(root, '.env'))) }; } catch { return process.env; } }
function availableAssets() { return assets.map(a => ({ ...a, available: existsSync(path.join(assetDir, a.file)) })); }
const schema = z.object({
  engine: z.enum(['decisions', 'responses']),
  listing: z.object({ productId: z.string(), title: z.string().trim().min(1).max(500), bullets: z.array(z.string().trim().min(1).max(1000)).length(3), imageId: z.string() }).strict(),
  settings: z.object({ model: z.enum(['gpt-6-luna','gpt-6.1-sol']), effort: z.enum(['none','low','medium','high']) }).optional(),
}).strict();
export interface Provider { decisions: { create: (...args: any[]) => Promise<any> }; responses: { create: (...args: any[]) => Promise<any> } }
export function createApp(options: { clientFactory?: (key: string) => Provider; key?: string; imageLoader?: (file: string) => Buffer; promptsDirectory?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req,res,next) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-store');
    const origin = req.get('origin');
    if (req.path.startsWith('/api') && origin && !/^http:\/\/(localhost|127\.0\.0\.1):(5173|3001)$/.test(origin)) { res.status(403).json({ error: 'This local demo accepts requests from its local workspace only.' }); return; }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/config', (_req,res) => {
    try {
      const prompts = loadPrompts(options.promptsDirectory);
      res.json({ keyConfigured: Boolean(options.key ?? environment().OPENAI_API_KEY), settings: DEFAULT_SETTINGS, efforts: EFFORTS, questionVersion: prompts.version, questions: prompts.questions, guidelines, assets: availableAssets() });
    } catch (error) {
      res.status(503).json({ error: error instanceof PromptConfigurationError ? error.message : 'Could not load the prompt files.', code: 'INVALID_PROMPTS' });
    }
  });
  app.get('/api/fixtures', (_req,res) => res.json({ products, fixtures }));
  app.use('/products', express.static(assetDir, { dotfiles: 'deny', index: false }));
  app.post('/api/preflight', async (req,res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Provide a title, exactly three nonempty bullets, a product image, and valid API settings.' }); return; }
    const { listing, engine } = parsed.data;
    const requestedSettings = parsed.data.settings ?? DEFAULT_SETTINGS;
    if (!validSettings(requestedSettings)) { res.status(400).json({ error: 'This model does not support the selected reasoning setting.' }); return; }
    const settings: Settings = engine === 'decisions' ? DEFAULT_SETTINGS : requestedSettings;
    const product = products.find(p => p.id === listing.productId);
    const asset = assets.find(a => a.id === listing.imageId && a.productId === product?.id);
    if (!product || !asset) { res.status(400).json({ error: 'Choose an image belonging to this demo product.' }); return; }
    const key = options.key ?? environment().OPENAI_API_KEY;
    if (!key) { res.status(503).json({ error: 'Add OPENAI_API_KEY to the project’s .env file, then try again. The key stays on the server.', code: 'MISSING_KEY' }); return; }
    let image: Buffer;
    try { image = options.imageLoader ? options.imageLoader(asset.file) : readFileSync(path.join(assetDir, asset.file)); }
    catch { res.status(503).json({ error: 'This product photo has not been generated yet. See README.md for the Sunburst preparation commands.', code: 'MISSING_ASSET' }); return; }
    let prompts: ReturnType<typeof loadPrompts>;
    try { prompts = loadPrompts(options.promptsDirectory); }
    catch (error) {
      res.status(503).json({ error: error instanceof PromptConfigurationError ? error.message : 'Could not load the prompt files.', code: 'INVALID_PROMPTS' });
      return;
    }
    const evidence = { reference_product_facts: product.facts, submitted_listing: { title: listing.title, bullets: listing.bullets } };
    const fixture = fixtures.find(f => JSON.stringify(f.listing) === JSON.stringify(listing));
    const run: Run = {
      id: randomUUID(), engine, settings, model: settings.model, timestamp: new Date().toISOString(),
      fingerprint: fingerprint({ evidence, image: createHash('sha256').update(image).digest('hex') }), questionVersion: prompts.version,
      fixtureId: fixture?.id ?? null, listing, checks: [], status: 'error', sdkMs: null, usage: null, cost: null, raw: null, request: null,
    };
    if (fixture) run.expected = fixture.expected;
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    let start: number | undefined;
    try {
      const client: Provider = options.clientFactory ? options.clientFactory(key) : new OpenAI({ apiKey: key, maxRetries: 0, timeout: 30_000 });
      const imagePart = { type: 'input_image' as const, image_url: `data:image/png;base64,${image.toString('base64')}`, detail: 'high' as const };
      const decisionsRequest: DecisionCreateParams = {
        model: settings.model,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompts.instructions }, { type: 'input_json', data: evidence }, imagePart] }],
        questions: prompts.questions.map(q => ({ type: 'choice', ...q, choices: prompts.choices })),
      };
      const responsesRequest: ResponseCreateParamsNonStreaming = {
        model: settings.model, reasoning: { effort: settings.effort }, service_tier: 'default', store: false, max_output_tokens: 4096,
        instructions: prompts.responsesInstructions,
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(evidence) }, imagePart] }],
        text: { format: { type: 'json_schema', name: 'listing_checks', strict: true, schema: responseSchema } },
      };
      const request = engine === 'decisions' ? decisionsRequest : responsesRequest;
      run.request = JSON.parse(JSON.stringify(request, (k,v) => k === 'image_url' ? `[inline PNG; ${image.length} bytes; sha256=${createHash('sha256').update(image).digest('hex').slice(0,16)}]` : v));
      start = performance.now();
      const raw = engine === 'decisions'
        ? await client.decisions.create(decisionsRequest, { signal: controller.signal })
        : await client.responses.create(responsesRequest, { signal: controller.signal });
      run.sdkMs = performance.now() - start;
      run.raw = raw;
      run.model = raw.model ?? settings.model;
      run.usage = normalizeUsage(raw.usage);
      run.cost = estimateCost(engine, settings.model, run.usage);
      let checks: Check[];
      if (engine === 'decisions') checks = normalizeDecisions(raw);
      else if (raw.status === 'incomplete') throw new Error('INCOMPLETE');
      else if (raw.output?.some((o: any) => o.content?.some((c: any) => c.type === 'refusal'))) checks = CHECK_IDS.map(id => ({ id, outcome: 'insufficient_evidence' }));
      else checks = normalizeResponses(raw.output_text ?? raw.output?.flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('') ?? '');
      run.checks = checks; run.status = route(checks);
      if (fixture) run.agreement = agreement(checks, fixture.expected);
    } catch (error) {
      if (start !== undefined && run.sdkMs === null) run.sdkMs = performance.now() - start;
      const e = error as { status?: number; name?: string; message?: string };
      run.status = 'error';
      run.errorCode = e.status ? `HTTP_${e.status}` : e.name === 'APIConnectionTimeoutError' ? 'TIMEOUT' : e.message === 'INCOMPLETE' ? 'INCOMPLETE' : e.message === 'INVALID_OUTPUT' || error instanceof SyntaxError ? 'INVALID_OUTPUT' : 'PROVIDER_ERROR';
      run.error = e.status === 401 ? 'The API key was not accepted. Check the server .env file.' : e.status === 429 ? 'The API returned a rate or quota limit. Wait and retry.' : e.status === 403 || e.status === 404 ? 'This model or endpoint is not available to this API project.' : run.errorCode === 'TIMEOUT' ? 'The request exceeded the 30-second timeout. Retry when ready.' : run.errorCode === 'INCOMPLETE' ? 'The model reached its output limit before completing all checks. This run is not a pass.' : run.errorCode === 'INVALID_OUTPUT' ? 'The API did not return all five valid checks. This run is not a pass.' : 'The API request failed. Check endpoint access and network connectivity, then retry.';
    }
    if (!controller.signal.aborted) res.json(run);
  });
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(root,'dist')));
    app.get('/{*path}', (_req,res) => res.sendFile(path.join(root,'dist/index.html')));
  }
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ error: 'The request could not be read. Check the input and try again.' }); });
  return app;
}
