# App prompts

Edit these files, save, then run another listing check. The server reads them on every request, in both development and production; no restart or frontend rebuild is needed. Each request uses one snapshot for its full lifetime. An in-flight request keeps the prompts it started with. Save all related edits before starting a comparison or repeat batch.

| File | Purpose |
| --- | --- |
| `instructions.md` | Shared evaluation instructions for Decisions and Responses. |
| `checks/title_facts.md` | Title versus reference product facts. |
| `checks/bullet_facts.md` | Bullets versus title and reference facts. |
| `checks/image_product.md` | Photo product type and color. |
| `checks/white_background.md` | Main-image background. |
| `checks/no_overlay.md` | Promotional text and graphics. |
| `choices.json` | Descriptions of the three bounded outcomes, shared by both engines. |
| `responses.md` | Instructions template for the standard Responses call. |
| `images.json` | Image-generation prompt archive and provenance; used for preparing assets, not loaded during listing checks. Asset filenames and references refer to `output/imagegen/`. |

Markdown prompt files are sent as plain text. Keep them nonempty. In `responses.md`, keep `{{instructions}}`, `{{questions}}`, and `{{choices}}` exactly once each; these insert the shared instructions and JSON definitions. The initial template reproduces the previous inline prompt.

Edit the descriptions in `choices.json` freely, but retain the three values `match`, `mismatch`, and `insufficient_evidence`, once each. The five check IDs and output schema remain in code because the UI, routing, and evaluation depend on them. Missing, empty, or malformed prompt files return a clear error before any model call.

Runs and exports record an automatic content hash in `questionVersion`. A prompt edit produces a new version; older runs retain their original version and request text. The input fingerprint still identifies the product evidence and image, independently of the prompt version. Existing results are historical; run a fresh check after editing. The original twelve-request evaluation predates this extraction and the red coffee assets; it is not validation of subsequent prompt edits.

Image prompt edits do not regenerate images automatically. Prepare a new image separately, then update its catalog reference as needed. Include this directory when copying or deploying the app.
