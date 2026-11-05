import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp, type Provider } from '../server/app.ts';
import { fixtures } from '../server/catalog.ts';
import { CHECK_IDS } from '../shared/domain.ts';
let server:Server, url:string, seen:any[]=[];
let behavior='ok';
const usage={input_tokens:2000,output_tokens:50,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}};
const factory=():Provider=>({decisions:{create:async(request:any)=>{seen.push(request);if(behavior==='error')throw {status:429,message:'sensitive provider error'};return {model:'gpt-6-luna',usage:{...usage,output_tokens:0},answers:CHECK_IDS.map(name=>({name,type:behavior==='refusal'?'refusal':'choice',choice:'match',probabilities:[{value:'match',probability:.98}],confidence:.97}))};}},responses:{create:async(request:any)=>{seen.push(request);return {model:request.model,status:behavior==='incomplete'?'incomplete':'completed',usage,output_text:JSON.stringify(Object.fromEntries(CHECK_IDS.map(id=>[id,'match'])))};}}});
beforeAll(async()=>{server=createApp({key:'test-secret-do-not-export',clientFactory:factory,imageLoader:()=>Buffer.from('same-image-bytes')}).listen(0,'127.0.0.1');await new Promise<void>(r=>server.on('listening',r));url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));});
async function post(engine='decisions',extra:Record<string,unknown>={}){return fetch(`${url}/api/preflight`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({engine,listing:fixtures[0].listing,...extra})});}
describe('API contract and credential boundaries',()=>{
  it('never returns the key in public configuration',async()=>{const text=await(await fetch(`${url}/api/config`)).text();expect(text).not.toContain('test-secret');expect(JSON.parse(text).keyConfigured).toBe(true);});
  it('uses identical evidence bytes and does not send fixture labels',async()=>{seen=[];const a=await(await post()).json();const b=await(await post('responses')).json();expect(a.fingerprint).toBe(b.fingerprint);expect(a.status).toBe('passed');expect(seen[0].input[0].content.at(-1).image_url).toBe(seen[1].input[0].content.at(-1).image_url);expect(JSON.stringify(seen)).not.toContain('expected');expect(JSON.stringify(a)).not.toContain('test-secret');expect(JSON.stringify(a.request)).not.toContain('base64');expect(a.agreement).toEqual({correct:5,total:5});});
  it('validates product-image associations and unsupported reasoning',async()=>{expect((await post('responses',{settings:{model:'gpt-6.1-sol',effort:'none'}})).status).toBe(400);expect((await post('decisions',{listing:{...fixtures[0].listing,imageId:'plush-clean'}})).status).toBe(400);});
  it('keeps reference facts server-owned',async()=>{expect((await post('decisions',{listing:{...fixtures[0].listing,facts:{Color:'cream'}}})).status).toBe(400);});
  it('records failed calls without leaking provider error text',async()=>{behavior='error';const r=await(await post()).json();behavior='ok';expect(r.status).toBe('error');expect(r.errorCode).toBe('HTTP_429');expect(JSON.stringify(r)).not.toContain('sensitive provider error');expect(r.cost).toBeNull();});
  it('keeps refusals and incomplete generations from passing',async()=>{behavior='refusal';const r=await(await post()).json();expect(r.status).toBe('review');behavior='incomplete';const b=await(await post('responses')).json();expect(b.status).toBe('error');expect(b.errorCode).toBe('INCOMPLETE');expect(b.usage.output).toBe(50);behavior='ok';});
  it('rejects requests from unrelated browser origins',async()=>{const r=await fetch(`${url}/api/config`,{headers:{Origin:'https://unrelated.example'}});expect(r.status).toBe(403);});
});
