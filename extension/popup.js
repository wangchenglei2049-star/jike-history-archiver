// 即刻历史抓取扩展 - popup
const $ = id => document.getElementById(id);
let tabId = null;

async function send(cmd, opts) {
  if (tabId == null) return null;
  try { return await chrome.tabs.sendMessage(tabId, { cmd, opts }); }
  catch (e) { return null; }
}
async function refresh() {
  const s = await send('status');
  if (!s) { $('status').textContent = '没连上页面脚本：请在 web.okjike.com 的标签页打开本弹窗（最好是个人主页）。'; return; }
  const names = { idle: '待机', running: '抓取中', done: '完成', error: '出错', stopped: '已停止' };
  $('status').textContent = `状态：${names[s.state] || s.state}\n已抓：${s.count} 条（第 ${s.page} 页）` + (s.msg ? `\n${s.msg}` : '');
}
$('start').addEventListener('click', async () => {
  await send('start', { floorId: $('floor').value, delayMs: $('delay').value, fresh: false });
  refresh();
});
$('stop').addEventListener('click', async () => { await send('stop'); setTimeout(refresh, 300); });
$('clear').addEventListener('click', async () => { await send('clear'); refresh(); });
(async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tabs && tabs[0] ? tabs[0].id : null;
  refresh();
  setInterval(refresh, 1000);
})();
