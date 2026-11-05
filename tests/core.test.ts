import { describe, expect, it } from 'vitest';
import { CHECK_IDS, route, validSettings, type Run } from '../shared/domain.ts';
import { estimateCost, normalizeDecisions, normalizeResponses, normalizeUsage } from '../server/measurements.ts';
import { csv, summarize } from '../shared/statistics.ts';
const checks = CHECK_IDS.map(id=>({id,outcome:'match' as const}));
describe('safe routing and bounded provider outputs',()=>{
  it('passes only a complete set of matching checks',()=>{expect(route(checks)).toBe('passed');expect(route(checks.slice(1))).toBe('review');expect(route([])).toBe('review');});
  it('routes contradictions and uncertainty distinctly',()=>{expect(route([{id:'title_facts',outcome:'mismatch'}])).toBe('attention');expect(route([{id:'title_facts',outcome:'insufficient_evidence'}])).toBe('review');});
  it('normalizes answers by name rather than relying on provider order',()=>{expect(normalizeDecisions({answers:checks.map(c=>({type:'choice',name:c.id,choice:c.outcome})).reverse()})).toEqual(checks);});
  it('does not pass missing, duplicated, or invalid provider answers',()=>{expect(()=>normalizeDecisions({answers:[]})).toThrow();expect(()=>normalizeDecisions({answers:CHECK_IDS.map(()=>({type:'choice',name:'title_facts',choice:'match'}))})).toThrow();expect(()=>normalizeResponses('{}')).toThrow();expect(()=>normalizeResponses(JSON.stringify({...Object.fromEntries(checks.map(c=>[c.id,c.outcome])),extra:'match'}))).toThrow();});
  it('routes a refusal to review',()=>{const answers=checks.map(c=>({type:'choice',name:c.id,choice:c.outcome}));answers[0]={type:'refusal',name:'title_facts',choice:'match'};expect(route(normalizeDecisions({answers}))).toBe('review');});
  it('rejects unsupported model settings',()=>{expect(validSettings({model:'gpt-6.1-sol',effort:'none'})).toBe(false);expect(validSettings({model:'gpt-6-luna',effort:'none'})).toBe(true);expect(validSettings({model:'toString',effort:'none'})).toBe(false);});
});
describe('measurements and costs',()=>{
  const usage={input:2000,cached:500,cacheWrite:500,output:100,reasoning:50};
  it('accounts for cached and cache-write tokens without double charging',()=>{expect(estimateCost('responses','gpt-6-luna',usage).usd).toBeCloseTo(.0002175,9);expect(estimateCost('decisions','gpt-6-luna',usage).usd).toBeCloseTo(.0001675,9);});
  it('does not double bill reasoning or invent absent usage',()=>{expect(normalizeUsage(null)).toBeNull();expect(estimateCost('responses','gpt-6-luna',null).usd).toBeNull();expect(estimateCost('responses','gpt-6-luna',{...usage,cached:3000}).usd).toBeNull();});
  it('keeps failures visible and withholds small-sample p95',()=>{const runs=[{status:'passed',sdkMs:100,cost:{usd:.01},agreement:{correct:5,total:5}},{status:'error',sdkMs:900,cost:null}] as Run[];expect(summarize(runs)).toMatchObject({count:2,successes:1,errors:1,median:100,p95:null,cost:.01,costCount:1,agreement:1});});
  it('exports escaped CSV and neutralizes formula cells',()=>{const run={id:'=danger',timestamp:'now',engine:'decisions',model:'model',settings:{effort:'none'},checks:[],error:'a,"b"\nc'} as unknown as Run;const result=csv([run]);expect(result).toContain('"\'=danger"');expect(result).toContain('a,""b""\nc');});
});
