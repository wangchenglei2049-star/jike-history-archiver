// 即刻历史抓取扩展 - content script（注入 web.okjike.com 页面）
// 接口与节奏同 jike-fetch.js；进度（含已抓帖子）存 chrome.storage.local，
// manifest 里配了 unlimitedStorage，不存在 localStorage 的配额问题。
const API = 'https://api.ruguoapp.com/1.0/personalUpdate/single';
const SKEY = 'jikeExtStateV1';
let running = false;
let status = { state: 'idle', page: 0, count: 0, msg: '' };

function profileUsername() {
  const m = location.pathname.match(/\/u\/([0-9a-f-]{36})/);
  return m ? m[1] : null;
}
async function loadState() { return (await chrome.storage.local.get(SKEY))[SKEY] || null; }
async function saveState(s) { await chrome.storage.local.set({ [SKEY]: s }); }
async function clearState() { await chrome.storage.local.remove(SKEY); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function download(nodes, tag) {
  const blob = new Blob([JSON.stringify({ downloadedAt: new Date().toISOString(), source: 'jike-extension', count: nodes.length, nodes })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jike-seg-${tag}-${nodes.length}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function run(opts) {
  if (running) return;
  const username = profileUsername() || (opts.username || '').trim();
  if (!username) { status = { state: 'error', page: 0, count: 0, msg: '没识别到账号：请在个人主页（/u/...）打开本扩展' }; return; }
  const floorId = (opts.floorId || '').trim() || null;
  const delayMs = Math.max(1000, parseInt(opts.delayMs, 10) || 2500);
  let nodes = [], seen = new Set(), key = null, page = 0;
  const st = await loadState();
  if (st && !opts.fresh && st.username === username && (st.floorId || null) === floorId && Array.isArray(st.nodes)) {
    nodes = st.nodes; seen = new Set(nodes.map(n => n.id)); key = st.key; page = st.page || 0;
    console.log(`[jike-ext] RESUMING: page ${page}, already ${nodes.length} posts`);
  } else if (opts.fresh) {
    await clearState();
  }
  running = true;
  status = { state: 'running', page, count: nodes.length, msg: '' };
  const persist = () => saveState({ username, floorId, key, page, nodes });
  while (running) {
    const token = localStorage.getItem('JK_ACCESS_TOKEN');
    if (!token) { status = { state: 'error', page, count: nodes.length, msg: '没有令牌：页面未登录或令牌未生成' }; await persist(); break; }
    let resp;
    try {
      resp = await fetch(API, {
        method: 'POST',
        headers: { 'x-jike-access-token': token, 'content-type': 'application/json' },
        body: JSON.stringify({ username, limit: 20, ...(key ? { loadMoreKey: key } : {}) }),
      });
    } catch (e) { status = { state: 'error', page, count: nodes.length, msg: '网络错误：' + e }; await persist(); break; }
    if (!resp.ok) { status = { state: 'error', page, count: nodes.length, msg: `HTTP ${resp.status}（多半是令牌过期）：已自动下载本段，刷新页面后点「开始 / 续跑」` }; await persist(); download(nodes, 'partial'); break; }
    const body = await resp.json();
    const data = body.data || [];
    if (!data.length) { status = { state: 'done', page, count: nodes.length, msg: '已到历史尽头，文件已下载' }; await clearState(); download(nodes, 'done'); break; }
    for (const n of data) {
      if (floorId && !(n.id < floorId)) continue;
      if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); }
    }
    page++;
    key = body.loadMoreKey || null;
    status = { state: 'running', page, count: nodes.length, msg: '' };
    if (page % 5 === 0) await persist();
    if (!key) { status = { state: 'done', page, count: nodes.length, msg: '已到历史尽头，文件已下载' }; await clearState(); download(nodes, 'done'); break; }
    await sleep(delayMs);
  }
  if (!running && status.state === 'running') {
    status = { state: 'stopped', page, count: nodes.length, msg: '已停止，进度已保存，点「开始 / 续跑」继续；本段文件已下载' };
    await persist();
    download(nodes, 'partial');
  }
  running = false;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.cmd === 'start') { run(msg.opts || {}); sendResponse({ ok: true }); }
  else if (msg.cmd === 'stop') { running = false; sendResponse({ ok: true }); }
  else if (msg.cmd === 'status') { sendResponse(status); }
  else if (msg.cmd === 'clear') { clearState().then(() => sendResponse({ ok: true })); return true; }
});
