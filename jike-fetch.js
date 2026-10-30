// 即刻个人主页全量抓取（控制台脚本版）
// 用法：在 web.okjike.com 自己的个人主页打开浏览器控制台，整段粘贴运行。
// 扩展版见 extension/ 文件夹，功能相同、体验更好。
//
// CONFIG 说明：
//   username: 留空自动从当前页面 URL（/u/<UUID>）识别；识别不到再手动填。
//   floorId : 只收集 id 小于它的帖子（分段续抓用）；从最新开始全量抓设为 null。
//
// 机制：
//   - 令牌每页从 localStorage 的 JK_ACCESS_TOKEN 现读，页面刷新即换新令牌。
//   - localStorage 只存游标 {key, page}（几个字节，永不超配额）；帖子只存内存，
//     结束/中断时下载成本段文件。多段文件按 Post ID 去重合并（见 docs/WORKFLOW.md）。
//   - 401/关页后：刷新页面 -> 重新粘贴同一脚本 -> 自动从游标续跑（打印 RESUMING）。
//   - 节奏 2.5 秒/页，不要调小，不要并发，防限流/风控。
(async () => {
  const CONFIG = {
    username: '',
    floorId: null,
    storeKey: 'JIKE_FETCH_V4',
    pageDelayMs: 2500,
    limit: 20,
  };
  const username = CONFIG.username || (location.pathname.match(/\/u\/([0-9a-f-]{36})/) || [])[1];
  if (!username) { console.log('STOP: 没识别到账号 UUID，请在个人主页（/u/...）运行，或在 CONFIG.username 手动填写'); return; }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const nodes = [];
  const seen = new Set();
  let key = null, page = 0;
  try {
    const s = JSON.parse(localStorage.getItem(CONFIG.storeKey) || 'null');
    if (s && s.key) { key = s.key; page = s.page || 0; console.log(`RESUMING at page ${page}`); }
  } catch (e) { /* no saved cursor */ }
  const save = () => { try { localStorage.setItem(CONFIG.storeKey, JSON.stringify({ key, page })); } catch (e) {} };
  const download = tag => {
    const blob = new Blob([JSON.stringify({ downloadedAt: new Date().toISOString(), source: 'jike-fetch', count: nodes.length, nodes })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jike-seg-${tag}-${page}p-${nodes.length}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  while (true) {
    const token = localStorage.getItem('JK_ACCESS_TOKEN');
    if (!token) { console.log('STOP: no JK_ACCESS_TOKEN in localStorage — 页面没登录或令牌未生成'); download('notoken'); return; }
    let resp, body;
    try {
      resp = await fetch('https://api.ruguoapp.com/1.0/personalUpdate/single', {
        method: 'POST',
        headers: { 'x-jike-access-token': token, 'content-type': 'application/json' },
        body: JSON.stringify({ username, limit: CONFIG.limit, ...(key ? { loadMoreKey: key } : {}) }),
      });
    } catch (e) { console.log(`STOP: network error at page ${page}: ${e}`); download('partial'); return; }
    if (!resp.ok) { console.log(`STOP: HTTP ${resp.status} at page ${page} — 游标已存，刷新页面后重新粘贴本脚本续跑`); download('partial'); return; }
    body = await resp.json();
    const data = body.data || [];
    if (!data.length) { console.log('REACHED END - nothing older'); break; }
    for (const n of data) {
      if (CONFIG.floorId && !(n.id < CONFIG.floorId)) continue;
      if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); }
    }
    page++;
    key = body.loadMoreKey || null;
    save();
    console.log(`page ${page} | collected ${nodes.length} | nextKey ${key ? 'yes' : 'no'}`);
    if (!key) { console.log('REACHED END - no loadMoreKey'); break; }
    await sleep(CONFIG.pageDelayMs);
  }
  localStorage.removeItem(CONFIG.storeKey);
  download('done');
  console.log(`DONE. collected ${nodes.length} posts in this segment.`);
})();
