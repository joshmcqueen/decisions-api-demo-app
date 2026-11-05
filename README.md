# Listing Checker

**Helping sellers get listings right.** A local, independent interview demo using fictional product data and generated photos. Nothing is sent to Amazon or published.

## Run

Requires Node **22.12+** (validated here with Node 26) and npm.

```sh
npm install
# .env has already been created; set OPENAI_API_KEY there.
npm run dev
```

Open **http://127.0.0.1:5173/**. The API listens only on 127.0.0.1:3001. The `.env` key is read server-side and can be updated without restarting the server. Do not prefix it with `VITE_`. API calls and image generation incur charges on your API project.

For a production-mode local preview:

```sh
npm run build
npm start
# http://127.0.0.1:3001/
```

The Vite dev proxy expects the API on port 3001. If changing `PORT`, update `vite.config.ts` and the local-origin allowlist too.

## Try the workflow

1. Start on the headphone needs-attention example. The text says black; the photo is cream. Select **Check listing**.
2. Choose the black photo and check again. Changing any input invalidates previous results and cancels pending requests.
3. Select **Compare approaches** to send the same listing snapshot and exact image bytes to Decisions and Responses. Each result appears independently.
4. In **Settings**, choose Luna with no reasoning for the closest same-model baseline, or Sol with reasoning to explore a larger-model baseline.
5. Explore the drip-coffee/espresso bullet contradiction and the plush's promotional overlay. Each product also has a consistent preset.
6. Use **Repeat runs** for alternating sequential comparisons. Export JSON for the full evidence or CSV for analysis. Run history lives only in the browser tab and is lost on refresh.

The lifestyle coffee photo is an additional exploration option: it intentionally fails the white-background criterion. Corrections are manual, not AI-generated rewrites.

## What is being compared

The five checks are title vs. reference facts, bullets vs. title/facts, photo product type/color, white backdrop, and promotional overlays. Product facts and check definitions are server-owned. Text-only checks explicitly ignore photographs; photo checks cannot establish hidden capabilities, actual physical dimensions, safety certifications, or age suitability.

- **Decisions:** `client.decisions.create`, `gpt-6-luna`, five named choice questions.
- **Responses:** `client.responses.create`, chosen model/reasoning effort, the same evidence and check definitions, compact strict JSON output. Standard processing, `store: false`, no tools, no artificial delay.
- Both normalize to `match`, `mismatch`, or `insufficient_evidence`. Any mismatch means needs attention. Missing evidence/refusals mean review. Malformed or incomplete output is a failed call, never a pass.
- Decisions probability estimates remain in the inspector; the app does not treat those as measured accuracy or ask Responses for invented confidence. This prototype uses categorical routing, not purportedly calibrated probability thresholds.
- SDK retries are disabled; SDK timeout is 30 seconds. Stop/edit actions abort requests. An abort may occur after a provider has already incurred usage, so exports can undercount cancelled requests; use platform billing for final reconciliation.

This is an endpoint comparison when both calls use Luna. Selecting Sol changes both the endpoint and the model. Different reasoning efforts also change the workload. No winning approach or speedup is hardcoded.

## Timing, cost, and evaluation

**SDK round trip** measures server time around the SDK request, including network and provider processing. **Browser round trip** measures the local browser/backend exchange as well. Neither is pure inference time. Both endpoints complete their bounded task before timing stops; no time-to-first-token comparison is substituted.

Live comparisons run concurrently for visible feedback. Repeat runs execute one request at a time and alternate endpoint order. The panel summarizes only its current immutable batch and configuration. Default: five repetitions (ten API requests); maximum twenty repetitions. Small samples are exploratory; p95 is withheld below twenty successful observations per approach. Failed calls remain in the denominator and exports.

Costs are USD **estimates** using reported input, cached input, cache-write, and output usage with a versioned standard short-context rate card. Reasoning output is already part of output-token totals and is not charged twice. Decisions output has no token charge. Missing or inconsistent usage yields an unavailable estimate. Costs exclude regional premiums, tax, hosting, and asset preparation. Image generation is a separate, one-time preparation expense; the bundled CLI did not retain billable usage here, so its actual cost is not claimed.

The initial real twelve-request evaluation is saved in [output/evaluation/initial-results.json](output/evaluation/initial-results.json) and CSV. All five checks matched the expected labels on all six prepared fixtures through both endpoints in that run. These tiny synthetic examples were also used during prompt development, so this is rehearsal coverage, not a held-out accuracy evaluation or production forecast. An initial v1 probe incorrectly treated a wrong image as a bullet inconsistency; v2 scopes text checks explicitly. No real or mock result is preloaded into the runtime UI.

To run the live fixture evaluation again with the local servers running:

```sh
npm run evaluate
```

This makes **12 billable API calls** and replaces the local initial-results report. It preserves errors and disagreements. The evaluation uses Luna/no reasoning for Responses.

The later business case should use **annual checks × measured cost per check**, with checks including listing attempts, edits, and reruns. Annual new listings, delayed listings, genuinely incremental sales, support cost, and error rates need separate evidence. Items sold is not listing volume. Latency savings alone are not labor savings or incremental revenue.

## Product images

Six 1024×1024 PNGs are in `output/imagegen/`. All were generated or edited via the Images API with **`gpt-image-2.6-sunburst`**, medium quality. See [the complete prompt manifest](output/imagegen/manifest.json) for exact prompts, source images, and provenance. Generation took place before the demo; it is never included in listing-check timing.

The bundled imagegen skill CLI was used, with `uv run --with openai --env-file .env python <imagegen-skill>/scripts/image_gen.py`. For a new generation, use `generate --model gpt-image-2.6-sunburst --size 1024x1024 --quality medium --prompt '<manifest prompt>' --out <new-path>`. For a controlled variant, use `edit` and add `--image <manifest reference>`. Save new outputs under a new filename; inspect identity, color, overlays, and background before using them. The manifest is the final prompt set, not model output used as ground truth.

## Validation

```sh
npm test                      # unit and local API contract tests; no live OpenAI calls
npm run build                 # TypeScript + production Vite build
npx playwright install chromium
npm run test:browser          # mocked inference only; does not spend API credits
```

Browser tests cover correction/rerun, persisted settings, independent completion, stale-request cancellation, repeat ordering, exports, request failure, and mobile layout. API tests inject a fake provider only in test code. There is no runtime replay/mock toggle.

## Sources and limits

- [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [API pricing](https://developers.openai.com/api/docs/pricing) — rate card recorded November 5, 2026
- [Image generation](https://developers.openai.com/api/docs/guides/image-generation)
- [Amazon listing guide](https://sell.amazon.com/blog/amazon-product-listings), [photography guidance](https://sell.amazon.com/blog/product-photos)

All three original Seller Central links, plus a bullet-point reference, are preserved in **Listing guidelines**. Those pages returned sign-in shells during research; their full policy text and category-specific numeric limits are not represented as verified. The white-background/overlay checks are focused demo criteria and cannot establish full Amazon compliance. Amazon already has listing validation and AI assistance; this demonstrates a potential complementary consistency layer.

For production, next steps include a held-out, category-diverse labeled dataset; false-acceptance/false-rejection analysis; calibrated routing if probability thresholds are added; authenticated access; retention/audit policies; concurrency/rate-limit testing; pricing reconciliation; and integration with authoritative catalog systems. This local demo has none of those production guarantees.
