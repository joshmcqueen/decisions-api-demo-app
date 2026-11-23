# Amazon onsite presenter guide

**Decision for the customer.** Across 1,000 eligible listings, how many need a specialist, and how much work does each remaining case take?

Open the [onsite deck](amazon-onsite.html), [seller workspace](http://127.0.0.1:5173/) and Maya’s reviewer queue in separate tabs. On this Mac, the prepared coffee conversations are bound in the local rehearsal database. The developer server uses port 5173 and the production preview uses 3001. Use the same browser profile you used to prepare the private ChatGPT conversations.

## Before the role-play

Run `npm run onsite:prepare` and verify three Ready briefs. The seeded queue has two assigned cases, grouped by SKU. The coffee maker’s shopper report links to the alternate manufacturer record under Independent evidence. One real merchant intake runs twice with two submission identifiers. Shopper reports use the same service as the intake endpoint. Preparation and first-time seeding use the billable API. The technical workspaces menu opens Release evidence, Policy review, Verified sources and Case audit.

**Proposed deployment.** IT manages the ChatGPT Enterprise workspace and reviewer group. Security approves evidence fields and retention, and reviews OpenAI’s SOC 2 Type 2 report and ISO/IEC certificates. Catalog Operations trains reviewers and owns decision quality. The MCP service checks case assignments. [Business data controls](https://openai.com/business-data/) · [OpenAI Trust Portal](https://trust.openai.com/)

**Current presentation path.** The Plus account has a custom MCP setup form. The two private conversations contain synthetic snapshots, and each returned the appropriate recommendation. Say “I’m using ChatGPT Plus with synthetic evidence to show Maya’s workflow. In production she would use ChatGPT Enterprise. I’m opening a prepared revision for this simulated handoff. Maya records the decision in the local case system.” The queue opens a conversation only when the case, revision and brief ID match. For a newly prepared case it offers the synthetic brief for a fresh conversation. Reopening an old conversation from browser history cannot authorize a write.

For a connected rehearsal, configure the external issuer and dedicated HTTPS MCP resource following the [run instructions](../../README.md). Verify hosted read, card, evidence lookup, then confirmation and seller receipt. Select `mcp-read` or `mcp-write` after testing the corresponding path. A read-only grant leaves confirmation on the local case page. The test suite verifies the protocol on loopback with a signed test token. Hosted acceptance succeeded on this Plus account with the temporary HTTPS connection. The connected card fetched the manufacturer record, committed Maya’s confirmed correction, returned a receipt and rejected a stale write. The silent twin returned Request more evidence. [Recorded timeline and ten verified private traces](../../eval/hosted-acceptance.json).

**Reset.** The prepared database is ready for the onsite. With both local processes stopped, `npm run onsite:restore` archives the completed run and restores the starting cases and private conversation bindings. `npm run onsite:checkpoint` creates a fresh checkpoint from the three Ready starting cases. To create a fresh scenario, stop the API and MCP listener, then run `npm run onsite:reset`. The command archives the original dedicated database and seeds fresh case IDs. Prepare and bind new conversations after a reset. To rehearse against copies while preserving the private chat bindings, use SQLite’s backup facility with both processes stopped and set `ONSITE_DB` to the copy.

### Commerce ontology walkthrough · 45 seconds

Use a fresh rehearsal database for these findings. From the repo root, run
`ONSITE_DB=tmp/onsite/ontology-demo.sqlite npm run onsite:prepare`, then
`ONSITE_DB=tmp/onsite/ontology-demo.sqlite npm run dev`. Preparation calls the live APIs on first use.
Set the same `ONSITE_DB` for the MCP listener when using a connected handoff. Previously bound conversations retain their original briefs.

1. In **Seller studio → Graphite headphone variant**, expand **Why this photo was flagged**. Compare the requested graphite SKU with the matte-black SKU approved by the asset library. Request specialist help to carry that reference into Maya’s case.
2. In **Reviewer queue**, open the coffee shopper report and expand **Product capability**. Ask Maya “Which capability does this bullet claim, and which manufacturer field settles it?” The espresso claim selects the exact-SKU manufacturer specification. Open the cited field and read the explicit exclusion.
3. In the espresso case, select **What if the manufacturer record omitted espresso?**. The policy and capability are identical. The manufacturer reference changes and the field is absent. Maya can request substantiation.

In one fresh live Decisions call per fixture, the explicit coffee bullet routed red (3,070 input tokens, 1.95 s), the silent record yellow (3,050 tokens, 1.65 s), and graphite's separate asset check yellow (the accompanying Decisions call used 2,299 tokens, 0.82 s). Maya's live briefs recommended correction for the explicit claim and additional evidence for the other two. These are single rehearsal observations.

### Verified API measurements

| Final release fixture | Returned model | Input / cached / output tokens | Estimated USD |
|---|---|---:|---:|
| Cream photo, black headphone SKU | `gpt-6-luna` | 2,301 / 1,241 / 0 | $0.00011841 |
| Silent manufacturer preparation | `gpt-6.2-sol` | 601 / 0 / 198 | $0.003182 |

These are single application requests from the final release run. Prices use the recorded standard short-context schedules. Hosted ChatGPT usage is outside these measurements. [Sol pricing](https://developers.openai.com/api/docs/models/gpt-6.2-sol) · [Decisions pricing](https://developers.openai.com/api/docs/guides/decisions)

## Customer discovery · 3 minutes

“I came from AWS, and I chose Amazon because a small change in the work behind each listing could matter at this scale.” Ask the Selling Partner Experience executive which submissions reach a specialist today and how long the seller waits. Ask the catalog engineering leader which system can establish the fact for an exact SKU when a listing and catalog disagree. Capture one answer from each and use it to narrow the proposed pilot.

## Capabilities and solution · 6 minutes

Start with the seller workflow Amazon already supports. Show the photo check during editing, the versioned evidence retrieved on escalation, and the human decision that produces a seller-visible receipt. Use slide 3 to introduce the Decisions API and ChatGPT Enterprise. Slides 4 and 5 show the seller and reviewer architectures. Slide 6 opens the live product. Ask which system the engineering owner would connect first. The catalog, marketplace integrations, merchant, reports, people and volumes are synthetic. The models, hosted ChatGPT responses and linked LangSmith runs were exercised live.

## Demo and customer questions · 18 minutes

| Clock | Presenter action | Customer decision or evidence |
|---|---|---|
| 0:00–2:15 | Seller studio → Matte-black headphones. Select **Warm cream**, pause, open **Why this photo was flagged → Product and color**. Point to all three named probabilities and the selected source records. Select **Midnight black**. | FORM-H01-BLK clears after an edit. Neither the mismatch nor the fix creates a specialist case. |
| 2:15–3:45 | Open **Promotional main photo**. Open **Why this photo was flagged → Added artwork on the main image**, inspect the badge, confirm Main placement, and select **Clean product photo**. | The seller can see the criterion, check, remedy and owner. An integral embroidered mark has a separate observation. A secondary placement requires its applicable checks. The refund example is available in its own draft for Q&A. |
| 3:45–5:30 | Open **Graphite headphone variant**. Choose **Request specialist help**. Enter “Can I use this family photo for this SKU?” and **Send request**. | The asset belongs to a sibling variant. One case preserves the question, revision and evidence. Read its status from the seller timeline. |
| 5:30–7:00 | Open **Reviewer queue**. Show all three entries. Select the merchant case and expand its submission history. | Two distinct submissions to the en-US feed produced a single assigned case. A transport retry replays the original result. Maya sees merchant configuration separately from Amazon policy. |
| 7:00–10:30 | Select the COM-D08-RED shopper report. Read the disputed bullet and the original allegation. Choose **Review in ChatGPT**. Ask “What evidence would justify asking this seller to change the espresso claim?” Open the exact-SKU source on the local evidence page or connected card. | The independent manufacturer record explicitly excludes espresso. The published claim supplies the other half of the contradiction. Pause for a customer question. |
| 10:30–12:45 | As Maya, select **Send correction request**, then **Confirm decision** in the supported surface. Expand the decision receipt. Switch to **Seller studio → Published coffee maker**. | The receipt identifies the actor, brief, policy and revision. A seller receives an actionable request and the supporting sources. |
| 12:45–14:00 | Set Bullet 1 to “Filter-basket drip brewing with an 8-cup glass carafe.” Pause for validation. Reopen the seller timeline. | The new draft passes. The original published revision and shopper allegation remain available in the case history. Publishing is a separate operation. |
| 14:00–16:15 | Open **Reviewer queue → Espresso capability disputed → What if the manufacturer record omitted espresso? → Review in ChatGPT**. Ask the same question. Open **Technical workspaces → Release evidence** and compare the failed assertion with the corrected trace. | Only the capability fact changed. The case permits a request for evidence or dismissal. The deliberately flawed evaluation candidate tried to treat missing information as a contradiction. |
| 16:15–18:00 | Open **Pilot impact**. Set both review rates to 10% and both times to 20 minutes, then move the pilot rate to 9% and handling time to 15 minutes. Ask “Which of these two levers would you fund us to validate first?” | Ten fewer cases per thousand free 200 minutes. Five fewer minutes on each of the remaining 90 cases free another 450. |

If Q&A runs long, shorten merchant history and the trace walkthrough. Preserve the ChatGPT follow-up, seller receipt and silent twin.

## Pilot close · 3 minutes

Request one US small-appliance category, a baseline from Seller Operations, an exact-SKU evidence owner and a reviewer lead. Baseline and shadow first. Choose a stable seller-level treatment and comparison cohort. Count eligible submissions once across retries. Keep shopper reports in a separate cohort.

Report cases per 1,000 eligible submissions, active minutes per remaining case, seller waiting time and total cost per eligible submission. Sample both random and near-threshold clears for missed defects. Adjudicate incorrect corrections, target sampling precision and stop thresholds with the reviewer lead before rollout. Validate start, pause and heartbeat timing against a sampled time study. Count any cash benefit against realized staffing or overtime changes. Roll back if quality or cost exceeds the agreed limits.

## Reflection · 15 minutes

- **Staleness.** On a disposable case, leave its brief open, change the seller draft in another tab, then confirm the old disposition. The server returns 409. A new check and preparation are required.
- **Policy change.** Technical workspaces → Policy review. Compare the actual photo, old and candidate outcomes, and expected labels. Show false clears and abstentions. In the saved shadow, the baseline matched all four labels. The candidate abstained on the clearly embroidered logo. It had zero false clears and one unnecessary abstention. A held comparison disables promotion. A passing run can be promoted and rolled back. Prior decision receipts retain their original policy snapshot.
- **Trace visibility.** The app records allowlisted diagnostic fields, linked by opaque case and revision. The MCP boundary starts at our server. Hosted ChatGPT conversation history, model reasoning and usage are outside these traces. LangSmith project write and readback were verified. The project read API returned no retention setting. Enterprise RBAC and workspace retention have no verified demonstration here.
- **Model comparison.** Open **Comparison lab → Repeat runs**. Use Luna on both sides to compare endpoints. The historical 808 ms versus 2.46 s medians compare different model configurations across five paired repetitions. The original 12-request fixture set predates red coffee assets.
- **Pilot economics.** The $2.4 million illustration uses 12 million assumed eligible submissions and routing alone. Obtain actual eligibility, exact-SKU coverage, baseline defects and labor cost from the customer. Include inference across all edits and retries, review sampling, integration and support.
