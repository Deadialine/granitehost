import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../netlify/functions/lib/core.mjs';

test('thinking streams are bounded, saved and excluded from later chat context', async () => {
  const f = fixture(); await f.login();
  const conversation = await f.conversation();
  const job = (await f.message(conversation.id)).value;
  await f.call('/worker/heartbeat', { ready:true, jobId:job.id, progress:{stage:'thinking',text:'',thinking:'x'.repeat(31000),thinkingCharacters:31000,elapsed:2} }, {worker:true});
  let jobs = (await f.call(`/conversations/${conversation.id}`)).value.jobs;
  assert.equal(jobs[0].progress.stage, 'thinking');
  assert.equal(jobs[0].progress.thinking.length, 30000);
  assert.equal(jobs[0].progress.thinkingCharacters, 31000);
  assert.equal((await f.call(`/conversations/${conversation.id}`,undefined,{authenticated:false})).status,401);
  await f.call('/worker/result', {id:job.id,text:'The answer',thinking:'private-reasoning-marker'}, {worker:true});
  jobs = (await f.call(`/conversations/${conversation.id}`)).value.jobs;
  assert.equal(jobs[0].result.thinking, 'private-reasoning-marker');
  f.advance(1);
  await f.message(conversation.id,'Next question');
  const next = (await f.call('/worker/poll',{ready:true},{worker:true})).value.job;
  assert.equal(next.messages[1].content,'The answer');
  assert.ok(!JSON.stringify(next.messages).includes('private-reasoning-marker'));
});

test('worker progress is bounded, authenticated, expires, and yields to final results', async () => {
  const f = fixture(); await f.login();
  const conversation = await f.conversation();
  const job = (await f.message(conversation.id)).value;
  const payload = { ready: true, jobId: job.id, progress: { stage: 'generating', text: '<script>untrusted</script>' + 'a'.repeat(31000), characters: 31025, elapsed: 12 } };
  assert.equal((await f.call('/worker/heartbeat', payload, { authenticated: false })).status, 401);
  assert.equal((await f.call('/worker/heartbeat', payload, { worker: true })).status, 200);
  const current = async () => (await f.call(`/conversations/${conversation.id}`)).value.jobs[0];
  assert.equal((await current()).status, 'running');
  assert.equal((await current()).progress.text.length, 30000);
  assert.equal((await current()).progress.elapsed, 12);
  f.advance(91000);
  assert.equal((await current()).progress, null);
  await f.call('/worker/heartbeat', payload, { worker: true });
  await f.call('/worker/result', { id: job.id, text: 'Final answer' }, { worker: true });
  assert.equal((await current()).status, 'completed');
  assert.equal((await current()).result.text, 'Final answer');
  assert.equal((await current()).progress, undefined);
});

const ORIGIN = 'https://granite-test.netlify.app';
const env = { SITE_PASSWORD: 'a-long-test-password-for-testing-only' };
class MemoryStore {
  data = new Map();
  async get(key) { return structuredClone(this.data.get(key) ?? null); }
  async setJSON(key, value, options = {}) {
    if (options.onlyIfNew && this.data.has(key)) return { modified: false };
    this.data.set(key, structuredClone(value)); return { modified: true };
  }
  async list({ prefix, cursor }) {
    const keys = [...this.data.keys()].filter(key => key.startsWith(prefix)).sort();
    const start = Number(cursor || 0); const end = start + 2;
    return { blobs: keys.slice(start, end).map(key => ({ key })), ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}
function fixture() {
  const store = new MemoryStore(); let clock = 1_800_000_000_000;
  const handler = createHandler({ store, env, now: () => clock });
  let cookie;
  async function call(path, data, { authenticated = true, worker = false, origin = ORIGIN, headers = {} } = {}) {
    const response = await handler(new Request(ORIGIN + '/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { ...(cookie && authenticated ? { cookie } : {}), ...(worker ? { authorization: `Bearer ${env.SITE_PASSWORD}` } : {}), ...(data === undefined ? {} : { 'content-type': 'application/json', origin }), ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }));
    return { response, status: response.status, value: await response.clone().json() };
  }
  async function login() { const result = await call('/login', { password: env.SITE_PASSWORD }); cookie = result.response.headers.get('set-cookie').split(';')[0]; return result; }
  async function conversation() { return (await call('/conversations', { title: 'Test conversation' })).value; }
  async function message(conversationId, text = 'Explain the document.', fileIds = [], id = randomUUID()) { return call('/messages', { id, conversationId, message: text, fileIds }); }
  return { store, handler, call, login, conversation, message, advance: ms => { clock += ms; } };
}

test('unconfigured workspace fails closed and only exposes setup state', async () => {
  const handler = createHandler({ store: new MemoryStore(), env: {} });
  const session = await handler(new Request(ORIGIN + '/api/session'));
  assert.deepEqual(await session.json(), { configured: false, authenticated: false, setupIssue: 'Add SITE_PASSWORD in Netlify, then redeploy this site.' });
  assert.equal((await handler(new Request(ORIGIN + '/api/conversations'))).status, 503);
});
test('private conversation and file endpoints reject unauthenticated callers', async () => {
  const f = fixture();
  assert.equal((await f.call('/conversations')).status, 401);
  assert.equal((await f.call(`/files/${randomUUID()}`)).status, 401);
  assert.equal((await f.call('/messages', {})).status, 401);
});
test('one password is sufficient and obsolete credential values grant no access', async () => {
  const f = fixture();
  assert.equal((await f.login()).status, 200);
  assert.equal((await f.call('/worker/poll', { ready: true }, { worker: true })).status, 200);
  const handler = createHandler({ store: new MemoryStore(), env: { ...env, WORKER_TOKEN: 'obsolete-value', SESSION_SECRET: 'obsolete-value' } });
  const denied = await handler(new Request(ORIGIN + '/api/worker/poll', { method: 'POST', headers: { authorization: 'Bearer obsolete-value', 'content-type': 'application/json' }, body: JSON.stringify({ ready: true }) }));
  assert.equal(denied.status, 401);
});
test('a short password produces a specific instruction without revealing it', async () => {
  const handler = createHandler({ store: new MemoryStore(), env: { SITE_PASSWORD: 'too-short' } });
  const result = await handler(new Request(ORIGIN + '/api/session'));
  const value = await result.json();
  assert.equal(value.configured, false);
  assert.ok(value.setupIssue.includes('at least 16 characters'));
  assert.ok(!JSON.stringify(value).includes('too-short'));
});
test('login rejects wrong passwords and cross-origin requests', async () => {
  const f = fixture();
  assert.equal((await f.call('/login', { password: 'incorrect' })).status, 401);
  assert.equal((await f.call('/login', { password: env.SITE_PASSWORD }, { origin: 'https://other.example' })).status, 403);
});
test('session cookies have secure attributes, expire, and never contain the password', async () => {
  const f = fixture(); const { response } = await f.login();
  const cookie = response.headers.get('set-cookie');
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes(env.SITE_PASSWORD));
  assert.equal((await f.call('/session')).value.authenticated, true);
  f.advance(43_200_001);
  assert.equal((await f.call('/conversations')).status, 401);
});
test('tampered session cookies are rejected', async () => {
  const f = fixture(); const login = await f.login();
  const cookie = login.response.headers.get('set-cookie').split(';')[0] + 'x';
  assert.equal((await f.call('/conversations', undefined, { headers: { cookie } })).status, 401);
});
test('worker and owner permissions are separate', async () => {
  const f = fixture(); await f.login();
  assert.equal((await f.call('/worker/poll', { ready: true })).status, 401);
  assert.equal((await f.call('/conversations', undefined, { authenticated: false, worker: true })).status, 401);
  assert.equal((await f.call('/worker/poll', { ready: true }, { authenticated: false, worker: true })).status, 200);
});
test('queue persists while offline, carries attachments, and saves a result', async () => {
  const f = fixture(); await f.login(); const conversation = await f.conversation();
  const file = (await f.call('/files', { name: 'notes.txt', content: 'The experiment has three stages.' })).value;
  const job = await f.message(conversation.id, 'Summarize these notes.', [file.id]);
  assert.equal(job.status, 202); assert.equal(job.value.status, 'queued');
  const poll = await f.call('/worker/poll', { ready: true }, { worker: true });
  assert.equal(poll.value.job.id, job.value.id);
  assert.ok(poll.value.job.messages[0].content.includes('untrusted source text'));
  assert.ok(poll.value.job.messages[0].content.includes('three stages'));
  await f.call('/worker/heartbeat', { ready: true, jobId: job.value.id }, { worker: true });
  assert.equal((await f.call(`/conversations/${conversation.id}`)).value.jobs[0].status, 'running');
  await f.call('/worker/result', { id: job.value.id, text: 'Three stages.' }, { worker: true });
  const saved = (await f.call(`/conversations/${conversation.id}`)).value;
  assert.equal(saved.jobs[0].status, 'completed'); assert.equal(saved.jobs[0].result.text, 'Three stages.');
  assert.equal((await f.call('/worker/poll', { ready: true }, { worker: true })).value.job, null);
});
test('transport retries are idempotent and cannot overwrite another request', async () => {
  const f = fixture(); await f.login(); const conversation = await f.conversation();
  const id = randomUUID();
  await f.message(conversation.id, 'First', [], id);
  assert.equal((await f.message(conversation.id, 'First', [], id)).status, 200);
  assert.equal((await f.message(conversation.id, 'Different', [], id)).status, 409);
  assert.equal((await f.call(`/conversations/${conversation.id}`)).value.jobs.length, 1);
});
test('result retries preserve the first completed output', async () => {
  const f = fixture(); await f.login(); const c = await f.conversation(); const { value: job } = await f.message(c.id);
  await f.call('/worker/result', { id: job.id, text: 'Original.' }, { worker: true });
  await f.call('/worker/result', { id: job.id, text: 'Duplicate.' }, { worker: true });
  assert.equal((await f.call(`/conversations/${c.id}`)).value.jobs[0].result.text, 'Original.');
});
test('saved jobs are recovered by a fresh handler after a worker restart', async () => {
  const f = fixture(); await f.login(); const c = await f.conversation(); const { value: job } = await f.message(c.id);
  const freshHandler = createHandler({ store: f.store, env });
  const result = await freshHandler(new Request(ORIGIN + '/api/worker/poll', { method: 'POST', headers: { authorization: `Bearer ${env.SITE_PASSWORD}`, 'content-type': 'application/json' }, body: JSON.stringify({ ready: true }) }));
  assert.equal((await result.json()).job.id, job.id);
});
test('offline model does not collect jobs and stale heartbeats expire', async () => {
  const f = fixture(); await f.login(); const c = await f.conversation(); await f.message(c.id);
  assert.equal((await f.call('/worker/poll', { ready: false }, { worker: true })).value.job, null);
  assert.equal((await f.call('/session')).value.modelReady, false);
  await f.call('/worker/heartbeat', { ready: true }, { worker: true });
  assert.equal((await f.call('/session')).value.workerOnline, true);
  f.advance(90_001);
  assert.equal((await f.call('/session')).value.workerOnline, false);
});
test('context includes completed turns and pagination preserves every record', async () => {
  const f = fixture(); await f.login(); const c = await f.conversation();
  for (let i = 0; i < 4; i++) {
    const { value: job } = await f.message(c.id, `Question ${i}`);
    await f.call('/worker/result', { id: job.id, text: `Answer ${i}` }, { worker: true });
    f.advance(100);
  }
  await f.message(c.id, 'Follow-up');
  const { value } = await f.call('/worker/poll', { ready: true }, { worker: true });
  assert.equal(value.job.messages.length, 9);
  assert.deepEqual(value.job.messages.slice(0, 2), [{ role: 'user', content: 'Question 0' }, { role: 'assistant', content: 'Answer 0' }]);
});
test('uploads reject binary/unsupported/oversized text and unsafe file references', async () => {
  const f = fixture(); await f.login();
  assert.equal((await f.call('/files', { name: 'file.pdf', content: 'x' })).status, 400);
  assert.equal((await f.call('/files', { name: 'file.txt', content: '\u0000' })).status, 413);
  assert.equal((await f.call('/files', { name: 'file.txt', content: 'x'.repeat(24_001) })).status, 413);
  const c = await f.conversation();
  assert.equal((await f.message(c.id, 'Read', ['../../secret'])).status, 400);
  assert.equal((await f.message(c.id, 'Read', [randomUUID()])).status, 404);
});
test('request bodies are bounded before parsing', async () => {
  const f = fixture(); await f.login();
  assert.equal((await f.call('/files', { name: 'big.txt', content: 'x'.repeat(360_000) })).status, 413);
});
test('logout clears session and API responses prohibit caching', async () => {
  const f = fixture(); await f.login(); const result = await f.call('/logout', {});
  assert.ok(result.response.headers.get('set-cookie').includes('Max-Age=0'));
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
});
