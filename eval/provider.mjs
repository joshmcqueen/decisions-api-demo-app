import { tsImport } from 'tsx/esm/api';
if (!process.env.ONSITE_EVAL_MODE) process.env.ONSITE_TRACE = 'off';
const { evaluateScenario } = await tsImport('./scenarios.ts', import.meta.url);
export default class WorkflowProvider {
  id() {
    return 'onsite-workflow';
  }
  async callApi(_prompt, context) {
    return {
      output: await evaluateScenario(
        context.vars.scenario,
        process.env.ONSITE_EVAL_MODE || 'controlled',
      ),
    };
  }
}
