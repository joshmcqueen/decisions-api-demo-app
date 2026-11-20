import { preparationVersion } from './workflow-ai.ts';
import { Store } from './workflow-db.ts';
import { Workflow } from './workflow.ts';
export const shopperReport =
  'The listing advertises espresso with crema. Does this drip coffee maker actually make espresso?';
export const frenchBullets = [
  'Écoute sans fil avec Bluetooth',
  'Coussinets confortables pour vos oreilles',
  'Un casque et un câble de recharge inclus',
];
export async function seedIntake(flow: Workflow) {
  for (const id of ['coffee', 'silent']) {
    if (!flow.store.cases().some((c) => c.draftId === id && c.source === 'Shopper report'))
      flow.report(id, shopperReport);
  }
  for (const key of ['initial-agent-1', 'initial-agent-2'])
    await flow.submitFeed(key, frenchBullets, 'agent');
  for (const c of flow.store.cases()) {
    if (
      c.assigned === 'Maya' &&
      c.status === 'In review' &&
      c.prep === 'Ready' &&
      c.brief?.prompt !== preparationVersion(c)
    )
      flow.refresh(c.id, 'maya');
  }
}
export function startWorkflow() {
  const flow = new Workflow(new Store());
  // Billing only on first seed. Previously handled attempts return persisted receipts.
  void seedIntake(flow).catch(() =>
    console.warn('Merchant seed unavailable. Run npm run onsite:prepare to retry.'),
  );
  let working = false;
  const worker = setInterval(async () => {
    if (working) return;
    working = true;
    try {
      await flow.prepareNext();
    } catch {
      console.warn('Preparation worker unavailable');
    } finally {
      working = false;
    }
  }, 750);
  worker.unref();
  return flow;
}
