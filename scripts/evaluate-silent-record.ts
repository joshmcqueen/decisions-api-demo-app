import 'dotenv/config';
import { Client } from 'langsmith';
import { evaluate } from 'langsmith/evaluation';
import { evaluateScenario } from '../eval/scenarios.ts';
import { policyVersion } from '../server/workflow-db.ts';
import { readFileSync, writeFileSync } from 'node:fs';

const client = new Client({ autoBatchTracing: false });
const datasetName = 'Seller validator · silent exact-SKU record';
const dataset = (await client.hasDataset({ datasetName }))
  ? await client.readDataset({ datasetName })
  : await client.createDataset(datasetName, {
      description:
        'One synthetic coffee report. The exact-SKU source does not document the disputed capability.',
    });
const examples = [];
for await (const e of client.listExamples({ datasetId: dataset.id, limit: 1 })) examples.push(e);
if (!examples.length)
  examples.push(
    await client.createExample({
      dataset_id: dataset.id,
      inputs: {
        scenario: 'silent',
        capability: 'undocumented',
        source: 'exact-SKU manufacturer record',
      },
      reference_outputs: { action: 'request_evidence' },
    }),
  );
const resultFile = new URL('../eval/rehearsal-results.json', import.meta.url);
const reports = JSON.parse(readFileSync(resultFile, 'utf8'));
for (const mode of ['flawed', 'live'] as const) {
  const experiment = await evaluate(
    async () => {
      const r = await evaluateScenario('silent', mode);
      return {
        action: r.observed,
        retainedEvidenceAndState: r.persisted,
        permitted: r.permitted,
        citations: r.citations,
        serviceSpans: r.traceIds,
      };
    },
    {
      client,
      data: examples,
      experimentPrefix: 'seller-silent-' + mode,
      metadata: { policy: policyVersion, provider: mode },
      maxConcurrency: 1,
      evaluators: [
        ({ outputs, referenceOutputs }) => ({
          key: 'supported_disposition',
          score: Number(
            outputs.action === referenceOutputs?.action && outputs.retainedEvidenceAndState,
          ),
        }),
      ],
    },
  );
  const result = experiment.results[0],
    score = result.evaluationResults.results[0]?.score;
  if (score !== (mode === 'flawed' ? 0 : 1))
    throw Error('Unexpected labeled experiment result for ' + mode);
  const report = reports.find((r: { mode: string }) => r.mode === mode);
  report.experimentUrl = await client.getProjectUrl({ projectName: experiment.experimentName });
  report.experimentScore = score;
  console.log(mode, score, report.experimentUrl);
}
writeFileSync(resultFile, JSON.stringify(reports, null, 2) + '\n');
