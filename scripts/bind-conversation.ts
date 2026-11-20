import { config } from 'dotenv';
import { Store } from '../server/workflow-db.ts';
config({ quiet: true });
const [id, link] = process.argv.slice(2);
if (!id || !/^https:\/\/chatgpt\.com\/c\/[a-zA-Z0-9-]+$/.test(link || ''))
  throw Error('Expected case ID and private ChatGPT conversation URL');
const store = new Store();
try {
  store.tx(() => {
    const c = store.case(id);
    if (c.prep !== 'Ready' || !c.brief || store.draft(c.draftId).revision !== c.revision)
      throw Error('Prepare the current revision first.');
    store.db
      .prepare('INSERT OR REPLACE INTO prepared_chats VALUES(?,?,?,?)')
      .run(c.id, c.brief.id, c.revision, link);
    console.log('Bound prepared conversation to ' + c.sku + ' revision ' + c.revision);
  });
} finally {
  store.db.close();
}
