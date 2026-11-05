# Prototype rehearsal notes

Working name: **Listing Checker**

Tagline: **Helping sellers get listings right.**

Audience: Amazon seller-experience stakeholders. The seller and products are fictional. Selected OpenAI surface: Platform and APIs.

## Main sequence (about 90 seconds)

“A seller has a draft ready to submit. A small content mistake can create rework. Here, the listing says black headphones but the selected photo shows cream.”

Run **Check listing**, point to the photo consistency finding, select the black photo, and rerun. Explain that preflight success precedes Amazon's existing submission and policy systems.

“The model supplies a bounded decision; the application turns it into the seller's next action.”

## Comparison (about 45 seconds)

Use **Compare approaches** with Luna/no reasoning first. Same product evidence and same five check definitions; different endpoint and output mechanism. Show completion times, estimated cost, and agreement/disagreement. Let real results determine the claim. Sol/reasoning is an optional exploration, not the basis for a claim about endpoint speed alone.

## Other examples (optional)

- Coffee maker: the product specifications explicitly say drip-only; a bullet incorrectly claims espresso. The photo alone does not prove brewing capabilities.
- Plush: show the promotional overlay, then the clean image. Synthetic imagery is prepared in advance.

## Evidence for the future deck

Use repeat runs and exports. Measure representative cases, retain errors and cache information, and keep each configuration separate. The initial six-fixture report is not a held-out test set. Annual listing-check volume is an assumption until supported independently. Separate inference economics, seller rework, and potential revenue rather than treating a latency difference as automatic business savings.

The presentation deck is intentionally deferred until prototype learning is complete.
