import { config } from 'dotenv';
import { presenterOAuth } from './presenter-oauth.ts';
import { Store } from './workflow-db.ts';
import { Workflow } from './workflow.ts';
import { configuredOAuth, reviewerMcp } from './reviewer-mcp.ts';
config({ quiet: true });
const store = new Store(),
  flow = new Workflow(store);
const rehearsal =
  process.env.MCP_PRESENTER_OAUTH === '1'
    ? presenterOAuth(store, new URL(process.env.MCP_RESOURCE!))
    : undefined;
const app = reviewerMcp(flow, rehearsal?.auth ?? configuredOAuth());
if (rehearsal) app.use(rehearsal.router);
app.listen(Number(process.env.MCP_PORT || 3002), '127.0.0.1', () =>
  console.log('Reviewer MCP listening on its dedicated loopback port.'),
);
