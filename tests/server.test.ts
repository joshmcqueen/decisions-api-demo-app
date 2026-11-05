import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, type Provider } from '../server/app.ts';
import { fixtures } from '../server/catalog.ts';
import { promptsDirectory } from '../server/questions.ts';
import { CHECK_IDS } from '../shared/domain.ts';
let server:Server, url:string, testPrompts:string, seen:any[]=[];
let behavior='ok';
const usage={input_tokens:2000,output_tokens:50,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}};
const factory=():Provider=>({decisions:{create:async(request:any)=>{seen.push(request);if(behavior==='error')throw {status:429,message:'sensitive provider error'};return {model:'gpt-6-luna',usage:{...usage,output_tokens:0},answers:CHECK_IDS.map(name=>({name,type:behavior==='refusal'?'refusal':'choice',choice:'match',probabilities:[{value:'match',probability:.98}],confidence:.97}))};}},responses:{create:async(request:any)=>{seen.push(request);return {model:request.model,status:behavior==='incomplete'?'incomplete':'completed',usage,output_text:JSON.stringify(Object.fromEntries(CHECK_IDS.map(id=>[id,'match'])))};}}});
beforeAll(async()=>{testPrompts=mkdtempSync(path.join(tmpdir(),'listing-prompts-'));cpSync(promptsDirectory,testPrompts,{recursive:true});server=createApp({key:'test-secret-do-not-export',clientFactory:factory,imageLoader:()=>Buffer.from('same-image-bytes'),promptsDirectory:testPrompts}).listen(0,'127.0.0.1');await new Promise<void>(r=>server.on('listening',r));url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));rmSync(testPrompts,{recursive:true,force:true});});
async function post(engine='decisions',extra:Record<string,unknown>={}){return fetch(`${url}/api/preflight`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({engine,listing:fixtures[0].listing,...extra})});}
describe('API contract and credential boundaries',()=>{
  it('never returns the key in public configuration',async()=>{const text=await(await fetch(`${url}/api/config`)).text();expect(text).not.toContain('test-secret');expect(JSON.parse(text).keyConfigured).toBe(true);});
  it('uses identical evidence bytes and does not send fixture labels',async()=>{seen=[];const a=await(await post()).json();const b=await(await post('responses')).json();expect(a.fingerprint).toBe(b.fingerprint);expect(a.status).toBe('passed');expect(seen[0].input[0].content.at(-1).image_url).toBe(seen[1].input[0].content.at(-1).image_url);expect(JSON.stringify(seen)).not.toContain('expected');expect(JSON.stringify(a)).not.toContain('test-secret');expect(JSON.stringify(a.request)).not.toContain('base64');expect(a.agreement).toEqual({correct:5,total:5});});
  it('validates product-image associations and unsupported reasoning',async()=>{expect((await post('responses',{settings:{model:'gpt-6.1-sol',effort:'none'}})).status).toBe(400);expect((await post('decisions',{listing:{...fixtures[0].listing,imageId:'plush-clean'}})).status).toBe(400);});
  it('keeps reference facts server-owned',async()=>{expect((await post('decisions',{listing:{...fixtures[0].listing,facts:{Color:'cream'}}})).status).toBe(400);});
  it('records failed calls without leaking provider error text',async()=>{behavior='error';const r=await(await post()).json();behavior='ok';expect(r.status).toBe('error');expect(r.errorCode).toBe('HTTP_429');expect(JSON.stringify(r)).not.toContain('sensitive provider error');expect(r.cost).toBeNull();});
  it('keeps refusals and incomplete generations from passing',async()=>{behavior='refusal';const r=await(await post()).json();expect(r.status).toBe('review');behavior='incomplete';const b=await(await post('responses')).json();expect(b.status).toBe('error');expect(b.errorCode).toBe('INCOMPLETE');expect(b.usage.output).toBe(50);behavior='ok';});
  it('rejects requests from unrelated browser origins',async()=>{const r=await fetch(`${url}/api/config`,{headers:{Origin:'https://unrelated.example'}});expect(r.status).toBe(403);});
  it('reloads prompt edits for both engines without restarting and versions the exact snapshot',async()=>{
    const before=await(await post()).json();
    const edits={
      'instructions.md':'Shared instruction revision with literal $& and {{choices}}.',
      'checks/title_facts.md':'Edited title check.',
      'choices.json':JSON.stringify([
        {value:'match',description:'Edited match description.'},
        {value:'mismatch',description:'Edited mismatch description.'},
        {value:'insufficient_evidence',description:'Edited uncertainty description.'},
      ]),
      'responses.md':'Responses revision.\n{{instructions}}\n{{questions}}\n{{choices}}',
    };
    const originals=Object.keys(edits).map(file=>[file,readFileSync(path.join(testPrompts,file),'utf8')]);
    try {
      for(const [file,text] of Object.entries(edits))writeFileSync(path.join(testPrompts,file),text);
      seen=[];
      const a=await(await post()).json(),b=await(await post('responses')).json();
      expect(a.status).toBe('passed');expect(b.status).toBe('passed');
      expect(a.questionVersion).not.toBe(before.questionVersion);expect(a.questionVersion).toBe(b.questionVersion);
      expect(seen[0].input[0].content[0].text).toBe(edits['instructions.md']);
      expect(seen[0].questions[0]).toMatchObject({name:'title_facts',instructions:edits['checks/title_facts.md'],choices:JSON.parse(edits['choices.json'])});
      expect(seen[1].instructions).toBe(`Responses revision.\n${edits['instructions.md']}\n${JSON.stringify(seen[0].questions.map(({name,instructions}:any)=>({name,instructions})))}\n${edits['choices.json']}`);
      const config=await(await fetch(`${url}/api/config`)).json();expect(config.questionVersion).toBe(a.questionVersion);expect(config.questions[0].instructions).toBe(edits['checks/title_facts.md']);
    } finally { for(const [file,text] of originals)writeFileSync(path.join(testPrompts,file),text); }
    expect((await(await post()).json()).questionVersion).toBe(before.questionVersion);
  });
  it('rejects broken prompt files before contacting either provider and recovers after correction',async()=>{
    for(const [file,broken] of [
      ['instructions.md','   '],['checks/image_product.md',''],['choices.json','{'],
      ['choices.json',JSON.stringify(Array(3).fill({value:'match',description:'Duplicate'}))],
      ['responses.md','{{instructions}} {{questions}}'],
    ]) {
      const target=path.join(testPrompts,file),original=readFileSync(target,'utf8');
      try {
        writeFileSync(target,broken);seen=[];
        for(const engine of ['decisions','responses']) {
          const response=await post(engine);expect(response.status).toBe(503);
          expect(await response.json()).toMatchObject({code:'INVALID_PROMPTS',error:expect.stringContaining(`prompts/${file}`)});
        }
        expect((await fetch(`${url}/api/config`)).status).toBe(503);expect(seen).toHaveLength(0);
      } finally { writeFileSync(target,original); }
    }
    expect((await(await post()).json()).status).toBe('passed');
  });
});
