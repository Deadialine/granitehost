import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../netlify/functions/lib/core.mjs';

test('PDF upload, capability gating, extraction, result and authenticated download', async () => {
  const data = new Map();
  const store = { get: async k => data.get(k), setJSON: async (k,v,o={}) => { if (o.onlyIfNew && data.has(k)) return {modified:false}; data.set(k,v); return {modified:true}; }, list: async ({prefix}) => ({blobs:[...data.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))}) };
  const password = 'pdf-test-password-for-tests';
  const handler = createHandler({store,env:{SITE_PASSWORD:password}});
  let cookie;
  async function call(path, value, worker=false, anonymous=false) {
    const r = await handler(new Request('https://test.example/api'+path, { method:value===undefined?'GET':'POST', headers: { origin:'https://test.example', ...(value===undefined?{}:{'content-type':'application/json'}), ...(worker?{authorization:`Bearer ${password}`} : cookie&&!anonymous?{cookie}: {}) }, ...(value===undefined?{}:{body:JSON.stringify(value)}) }));
    return r;
  }
  cookie = (await call('/login',{password})).headers.get('set-cookie').split(';')[0];
  const base64 = Buffer.from('%PDF-1.7\nTest fixture\n%%EOF').toString('base64');
  assert.equal((await call('/files',{name:'test.pdf',base64:'invalid'})).status,400);
  const file = await (await call('/files',{name:'test.pdf',base64})).json();
  assert.equal(file.kind,'pdf');
  const conversation = await (await call('/conversations',{title:'PDF test'})).json();
  const request = {id:randomUUID(),conversationId:conversation.id,message:'Rewrite this as a PDF',fileIds:[file.id],output:'pdf'};
  assert.equal((await call('/messages',request)).status,202);
  assert.equal((await call('/messages',{...request,output:'chat'})).status,409);
  assert.equal((await (await call('/worker/poll',{ready:true},true)).json()).job,null);
  const job = (await (await call('/worker/poll',{ready:true,pdfVersion:1},true)).json()).job;
  assert.equal(job.documents[0].id,file.id);
  assert.equal((await call('/worker/file',{id:file.id,jobId:job.id})).status,401);
  assert.equal((await call('/worker/file',{id:randomUUID(),jobId:job.id},true)).status,404);
  assert.equal((await call('/worker/extracted',{id:file.id,jobId:job.id,content:'[Page 1] Source text'},true)).status,200);
  assert.equal((await call('/worker/result',{id:job.id,text:'Done'},true)).status,400);
  assert.equal((await call('/worker/result',{id:job.id,text:'Done',artifact:{base64,validation:'not-validated'}},true)).status,400);
  assert.equal((await call('/worker/result',{id:job.id,text:'Done',artifact:{base64,validation:'machine-gates-passed'}},true)).status,200);
  const response = await (await call(`/conversations/${conversation.id}`)).json();
  assert.equal(response.jobs[0].status,'completed');
  assert.equal(response.jobs[0].result.artifact.url,`/api/artifacts/${job.id}`);
  assert.equal(response.jobs[0].result.artifact.base64,undefined);
  assert.equal((await call(`/artifacts/${job.id}`,undefined,false,true)).status,401);
  const download=await call(`/artifacts/${job.id}`);
  assert.equal(download.headers.get('content-type'),'application/pdf');
  assert.equal(Buffer.from(await download.arrayBuffer()).toString('base64'),base64);
  const original=await call(`/files/${file.id}`);
  assert.equal(Buffer.from(await original.arrayBuffer()).toString('base64'),base64);
  assert.equal((await call('/worker/result',{id:job.id,text:'Changed'},true)).status,200);
  assert.equal(data.get(`results/${job.id}`).text,'Done');
});
