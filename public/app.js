'use strict';
const $ = id => document.getElementById(id);
const state = { authenticated: false, configured: false, conversation: null, jobs: [], attachments: [], busy: false, online: false, ready: false, conversations: [] };
const notice = (message, error = false) => { $('notice').textContent = message; $('notice').hidden = !message; $('notice').classList.toggle('error', error); };

async function api(path, data) {
  const result = await fetch(`/api${path}`, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const value = await result.json().catch(() => ({ error: 'The workspace server is unavailable.' }));
  if (!result.ok) {
    if (result.status === 401 && path !== '/login') { state.authenticated = false; showAccess(); }
    throw new Error(value.error || 'The request failed.');
  }
  return value;
}
function showAccess() {
  if (!state.configured) return;
  if (!$('access-dialog').open) $('access-dialog').showModal();
}
function setConnection() {
  $('engine-status').textContent = !state.configured ? 'Setup required' : !state.authenticated ? 'Workspace locked' : state.ready ? 'Granite connected' : state.online ? 'Model not ready' : 'Computer offline';
  $('engine-dot').className = `dot ${state.ready ? 'online' : 'warning'}`;
  $('info-status').textContent = state.ready ? 'Your PC is connected and Granite is ready.' : 'Requests stay queued until your PC and its Granite worker are running.';
}
async function checkSession() {
  const session = await api('/session');
  Object.assign(state, { authenticated: session.authenticated, configured: session.configured, online: session.workerOnline, ready: session.modelReady });
  $('logout').hidden = !state.authenticated;
  setConnection();
  if (!state.configured) notice(session.setupIssue || 'Add SITE_PASSWORD in Netlify, then redeploy this site.');
  else if (!state.authenticated) { clearView(); $('conversations').replaceChildren(); showAccess(); }
}
async function loadList() {
  if (!state.authenticated) return;
  state.conversations = (await api('/conversations')).conversations;
  const nav = $('conversations'); nav.replaceChildren();
  if (!state.conversations.length) { const p = document.createElement('p'); p.className = 'sidebar-empty'; p.textContent = 'Your conversations will appear here.'; nav.append(p); }
  for (const conversation of state.conversations) {
    const button = document.createElement('button'); button.textContent = conversation.title;
    button.className = conversation.id === state.conversation ? 'active' : '';
    button.addEventListener('click', () => openConversation(conversation.id).catch(error => notice(error.message, true)));
    nav.append(button);
  }
}
function download(text, name = 'granite-response.md') {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function message(role, text, files = [], exportable = false) {
  const article = document.createElement('article'); article.className = `message ${role}`;
  const header = document.createElement('div'); header.className = 'message-header';
  const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = role === 'user' ? 'Y' : 'G';
  header.append(avatar, document.createTextNode(role === 'user' ? 'You' : 'Granite'));
  const content = document.createElement('div'); content.className = 'message-body'; content.textContent = text;
  article.append(header, content);
  if (files.length) { const element = document.createElement('div'); element.className = 'message-files'; element.textContent = `Attached: ${files.join(' · ')}`; article.append(element); }
  if (exportable) { const actions = document.createElement('div'); actions.className = 'message-actions'; const button = document.createElement('button'); button.className = 'quiet'; button.textContent = 'Download as Markdown ↓'; button.addEventListener('click', () => download(text)); actions.append(button); article.append(actions); }
  return article;
}
function renderJobs() {
  const area = $('messages'); area.replaceChildren();
  $('welcome').hidden = state.jobs.length > 0;
  state.busy = state.jobs.some(job => !['completed', 'failed'].includes(job.status));
  $('send').disabled = state.busy;
  for (const job of state.jobs) {
    area.append(message('user', job.message, job.fileNames));
    if (job.result?.error) { const p = document.createElement('p'); p.className = 'pending'; p.textContent = `This request failed: ${job.result.error}`; area.append(p); }
    else if (job.result?.text) area.append(message('assistant', job.result.text, [], true));
    else {
      const panel = document.createElement('div'); panel.className = 'activity';
      const progress = job.progress;
      const labels = { received: 'Request received by your computer', waiting: 'Request sent to Ollama - waiting for first output', generating: 'Receiving response from Granite', saving: 'Saving and delivering the response' };
      const line = document.createElement('div'); line.className = 'activity-status';
      line.textContent = progress ? labels[progress.stage] : job.status === 'running' ? 'Worker is processing this request. Live output requires the updated connection script.' : state.ready ? 'Queued - waiting for your computer' : 'Queued - waiting for your computer to reconnect';
      panel.append(line);
      if (progress) {
        const detail = document.createElement('div'); detail.className = 'activity-detail';
        detail.textContent = `${Math.floor(progress.elapsed)}s elapsed | ${progress.characters.toLocaleString()} characters received`;
        if (progress.characters > 30000) detail.textContent += ' | Preview shows the first 30,000 characters; full answer follows on completion';
        panel.append(detail);
        if (Date.now() - progress.updatedAt > 15000) { const stale = document.createElement('div'); stale.textContent = 'Waiting for a fresh worker update...'; panel.append(stale); }
      }
      area.append(panel);
      if (progress?.text) area.append(message('assistant', progress.text));
    }
  }
}
async function openConversation(id) {
  if (state.conversation !== id && $('prompt').value.trim()) { notice('Your unsent draft stays in the message box.'); }
  const conversation = await api(`/conversations/${id}`);
  state.conversation = id; state.jobs = conversation.jobs;
  $('chat-title').textContent = conversation.title;
  renderJobs(); await loadList();
  $('sidebar').classList.remove('open'); $('menu').setAttribute('aria-expanded', 'false');
}
function renderAttachments() {
  $('attachments').replaceChildren();
  for (const file of state.attachments) {
    const chip = document.createElement('span'); chip.className = 'attachment'; chip.append(document.createTextNode(file.name));
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${file.name}`);
    remove.addEventListener('click', () => { state.attachments = state.attachments.filter(x => x.id !== file.id); renderAttachments(); });
    chip.append(remove); $('attachments').append(chip);
  }
}
function clearView() {
  state.conversation = null; state.jobs = []; state.attachments = []; state.busy = false;
  $('chat-title').textContent = 'New conversation'; $('messages').replaceChildren(); $('welcome').hidden = false; $('send').disabled = false;
  renderAttachments();
}
$('access-dialog').addEventListener('cancel', event => event.preventDefault());
$('access-form').addEventListener('submit', async event => {
  event.preventDefault(); $('access-submit').disabled = true; $('access-error').textContent = '';
  try {
    await api('/login', { password: $('password').value }); $('password').value = '';
    $('access-dialog').close(); notice(''); await checkSession(); await loadList();
  } catch (error) { $('access-error').textContent = error.message; }
  finally { $('access-submit').disabled = false; }
});
$('composer').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.configured) { await checkSession(); return; }
  if (!state.authenticated) { showAccess(); return; }
  const text = $('prompt').value.trim(); if (!text || state.busy) return;
  state.busy = true; $('send').disabled = true; notice('');
  try {
    if (!state.conversation) {
      const conversation = await api('/conversations', { title: text.slice(0, 70) });
      state.conversation = conversation.id; $('chat-title').textContent = conversation.title;
    }
    const request = { id: crypto.randomUUID(), conversationId: state.conversation, message: text, fileIds: state.attachments.map(x => x.id) };
    // Reuse the same id on a transport retry: an accepted request isn't enqueued twice.
    let job;
    try { job = await api('/messages', request); }
    catch (error) { if (!(error instanceof TypeError)) throw error; job = await api('/messages', request); }
    state.jobs.push(job); $('prompt').value = ''; state.attachments = []; renderAttachments(); renderJobs(); await loadList();
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  } catch (error) { state.busy = false; $('send').disabled = false; notice(error.message, true); }
});
$('prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit(); } });
$('attach').addEventListener('click', () => { if (!state.authenticated) { if (!state.configured) notice('Configure the workspace before uploading documents.'); else showAccess(); return; } $('file-input').click(); });
$('file-input').addEventListener('change', async event => {
  $('attach').disabled = true;
  try {
    for (const file of event.target.files) {
      if (state.attachments.length >= 3) throw new Error('Attach up to three documents per message.');
      if (file.size > 100_000 || !/\.(txt|md|csv|json)$/i.test(file.name)) throw new Error('Choose TXT, Markdown, CSV, or JSON files under 100 KB.');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      state.attachments.push(await api('/files', { name: file.name, content })); renderAttachments();
    }
    notice('Attachments are stored in your Netlify workspace and will be sent to Granite with your message.');
  } catch (error) { notice(error.message, true); }
  finally { $('file-input').value = ''; $('attach').disabled = false; }
});
$('new-chat').addEventListener('click', async () => { clearView(); notice(''); await loadList().catch(error => notice(error.message, true)); $('prompt').focus(); });
$('logout').addEventListener('click', async () => { try { await api('/logout', {}); clearView(); $('prompt').value = ''; $('conversations').replaceChildren(); await checkSession(); } catch (error) { notice(error.message, true); } });
$('connection-info').addEventListener('click', () => $('info-dialog').showModal());
$('close-info').addEventListener('click', () => $('info-dialog').close());
$('menu').addEventListener('click', () => { const open = $('sidebar').classList.toggle('open'); $('menu').setAttribute('aria-expanded', String(open)); });
async function refresh() {
  if (document.hidden) return;
  try {
    await checkSession();
    if (state.authenticated && state.conversation) {
      const conversation = await api(`/conversations/${state.conversation}`);
      if (JSON.stringify(conversation.jobs) !== JSON.stringify(state.jobs)) { state.jobs = conversation.jobs; renderJobs(); }
    }
  } catch (error) { state.online = false; state.ready = false; setConnection(); notice(error.message, true); }
}
checkSession().then(loadList).catch(error => notice(error.message, true));
async function pollView() { await refresh(); setTimeout(pollView, state.busy ? 3000 : 10000); }
setTimeout(pollView, 3000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
