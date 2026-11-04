/* Offline desktop interface. No analytics, third-party assets, or network requests. */
'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const e = escapeHtml;
const icons = {
  overview:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  apps:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  websites:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18z"/>',
  records:'<path d="M8 3H5a2 2 0 0 0-2 2v15a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V5a2 2 0 0 0-2-2h-3M8 2h8v5H8zM7 12h10M7 16h7"/>',
  settings:'<path d="m9 3-1 3-3 1-2 4 2 3 1 3 4 3 3-1 4-1 3-4-1-3-1-4-4-2z"/><circle cx="12" cy="12" r="3"/>',
  pause:'<path d="M8 5v14M16 5v14"/>', play:'<path d="m8 4 12 8-12 8z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  scan:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 12h10M12 7v10"/>',
  search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  check:'<path d="m5 12 4 4L19 6"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  shield:'<path d="m12 3 8 3v6c0 4-5 8-8 9-3-1-8-5-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
  folder:'<path d="M3 7V4h7l2 3h9v13H3z"/>', chart:'<path d="M4 4v16h17M8 16v-5m5 5V7m5 9V4"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  link:'<path d="m10 14 4-4m-6 1-2 2a4 4 0 0 0 5 6l3-3m-4-8 3-3a4 4 0 0 1 6 5l-3 3"/>',
  sparkle:'<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3z"/>',
  keyboard:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h0M6 13h1m3 0h1m3 0h1m3 0h0M7 16h10"/>',
};
function icon(name, size = 17, cls = '') {
  return `<svg class="${e(cls)}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.apps}</svg>`;
}
const pageNames = {overview:'概览', apps:'学习软件', websites:'学习网站', records:'时间记录', settings:'设置'};
const appState = {page:'overview', range:'today', start:'', end:'', data:null, busy:false, connected:false, scanResults:[], browserSetup:null, appSearch:'', siteSearch:'', siteDraft:{domain:'',category:'research'}, renderedConfig:''};
const DEMO = new URLSearchParams(location.search).get('demo') === '1';
const TZ = 'Asia/Shanghai';
function dateKey(date = new Date()) { const parts=new Intl.DateTimeFormat('en-CA', {timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date); const get=type=>parts.find(part=>part.type===type).value;return `${get('year')}-${get('month')}-${get('day')}`; }
function shortTime(seconds) {
  const negative = Number(seconds) < 0;
  const s = Math.round(Math.abs(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  const result = h ? `${h} 小时 ${m} 分钟` : m ? `${m} 分钟` : `${s} 秒`;
  return (negative ? '−' : '') + result;
}
function compactTime(seconds) {
  const s = Math.round(Math.abs(Number(seconds) || 0));
  return (Number(seconds) < 0 ? '−' : '') + (s >= 3600 ? `${Math.floor(s / 3600)} 小时 ${Math.floor(s % 3600 / 60)} 分` : s >= 60 ? `${Math.floor(s / 60)} 分` : `${s} 秒`);
}
function formatStamp(value, includeDate = false) {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {timeZone:TZ,...(includeDate ? {month:'2-digit',day:'2-digit'} : {}),hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
}
function toast(message, error = false) {
  const node = document.createElement('div');
  node.className = `toast${error ? ' error' : ''}`;
  node.textContent = message;
  $('#toast-root').append(node);
  setTimeout(() => node.remove(), error ? 7000 : 4300);
}
async function api(method, ...args) {
  const bridge = DEMO ? demoApi : window.pywebview?.api;
  if (!bridge || typeof bridge[method] !== 'function') throw new Error('本机统计服务尚未就绪，请稍后重试。');
  const result = await bridge[method](...args);
  if (result && typeof result === 'object' && result.error) throw new Error(result.error);
  return result;
}
function params() { return {range:appState.range, ...(appState.range === 'custom' ? {start:appState.start,end:appState.end} : {})}; }
function categoryName(value) {
  const map = {ai:'AI 助手', agent:'AI 助手', coding:'编程开发', development:'编程开发', research:'论文研究', notes:'笔记整理', reading:'文献阅读', docs:'技术文档', academic:'学术检索', website:'学习网站', other:'其他学习', manual:'手动修正'};
  return map[value] || value || '学习工具';
}
function avatar(name, kind = '', index = 0) {
  const colors = ['','purple','green','gray'];
  return `<span class="source-avatar ${colors[index % colors.length]}">${kind === 'website' ? icon('websites',16) : e(String(name || '?').slice(0,1).toUpperCase())}</span>`;
}
function statusInfo() {
  const status = appState.data?.status || {};
  if (!appState.connected) return {text:'服务连接中',short:'连接中',dot:'gray'};
  if (status.paused) return {text:'统计已暂停',short:'已暂停',dot:'gray'};
  if (Number(status.idle_seconds) >= 180 || status.state === 'idle') return {text:'空闲中，计时已暂停',short:'空闲中',dot:'gray'};
  if (status.state === 'blocked') return String(status.message || '').includes('读取当前窗口') ? {text:'窗口识别暂不可用，等待恢复',short:'等待识别恢复',dot:'gray'} : {text:'当前暂未计时，等待恢复',short:'暂停统计',dot:'gray'};
  if (['locked','suspended'].includes(status.state)) return {text:'锁屏或休眠，暂停统计',short:'暂停统计',dot:'gray'};
  if (status.current_name) return {text:`正在记录 · ${status.current_name}`,short:'正在统计',dot:'green'};
  return {text:'等待学习应用进入前台',short:'后台守候中',dot:'blue'};
}
function updateChrome() {
  const status = statusInfo();
  const paused = !!appState.data?.status?.paused;
  $('#sidebar-status').innerHTML = `<span class="status-dot ${status.dot}"></span><span>${e(status.short)}</span>`;
  $('#pause-button').disabled = !appState.connected;
  $('#pause-button').innerHTML = `${icon(paused ? 'play' : 'pause',12)}${paused ? '恢复统计' : '暂停统计'}`;
  $('#version').textContent = `学习时长统计系统 · ${appState.data?.version || '1.0.0'}`;
  const serviceMessage=appState.data?.status?.message || '';
  $('#service-notice').hidden=!serviceMessage;
  $('#service-notice').innerHTML=serviceMessage ? `${icon('info',15)}<span>${e(serviceMessage)}</span>` : '';
  const browserStatus=$('#browser-connection-status');
  if(browserStatus){const connected=!!appState.data?.status?.browser_connected;browserStatus.innerHTML=`<span class="status-dot ${connected?'green':'gray'}"></span>${connected?'扩展已连接':'等待扩展连接'}`;}
  $('#breadcrumb').textContent = pageNames[appState.page];
  $('#today-label').textContent = new Intl.DateTimeFormat('zh-CN', {timeZone:TZ,month:'long',day:'numeric',weekday:'long'}).format(new Date());
  if ($('#navigation').dataset.page !== appState.page) {
    $('#navigation').innerHTML = Object.entries(pageNames).map(([key,label]) => `<a href="#${key}" class="nav-item${appState.page === key ? ' active' : ''}"${appState.page === key ? ' aria-current="page"' : ''}>${icon(key,18,'nav-icon')}<span>${label}</span></a>`).join('');
    $('#navigation').dataset.page=appState.page;
  }
}
function heading(eyebrow, title, subtitle, actions = '') {
  return `<div class="page-head"><div><div class="eyebrow">${e(eyebrow)}</div><h1>${e(title)}</h1><p class="subtitle">${e(subtitle)}</p></div>${actions ? `<div class="head-actions">${actions}</div>` : ''}</div>`;
}
function periodToolbar() {
  return `<div class="period-toolbar"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div class="segmented" role="group" aria-label="统计范围">${[['today','今日'],['week','本周'],['month','本月'],['custom','自定义']].map(([key,label])=>`<button data-action="range" data-value="${key}" class="${appState.range === key ? 'active' : ''}" aria-pressed="${appState.range === key}">${label}</button>`).join('')}</div>${appState.range === 'custom' ? `<div class="date-range"><input type="date" id="range-start" aria-label="起始日期" value="${e(appState.start)}"><span style="color:#aaa;font-size:10px">至</span><input type="date" id="range-end" aria-label="结束日期" value="${e(appState.end)}"><button class="btn btn-soft" data-action="apply-range" style="padding:7px 10px;min-height:30px">查看</button></div>` : ''}</div><span class="toolbar-note">${icon('clock',12)} 实时更新</span></div>`;
}
function emptyState(title, subtitle, symbol = 'chart', action = '') {
  return `<div class="empty-state"><span class="empty-icon">${icon(symbol,35)}</span><h3>${e(title)}</h3><p>${e(subtitle)}</p>${action}</div>`;
}
function chartSvg(daily) {
  const rows = Array.isArray(daily) ? daily : [];
  if (!rows.length || rows.every(row => !row.seconds)) return `<div class="chart-empty"><span class="empty-icon">${icon('chart',31)}</span><span>还没有记录，下一段专注从现在开始。</span></div>`;
  const w = 520, h = 180, left = 35, right = 10, top = 12, bottom = 28;
  const values = rows.map(row => Math.max(0, Number(row.seconds) || 0));
  const max = Math.max(...values, 60), maxHours = max / 3600;
  const scale = maxHours > 1 ? Math.ceil(maxHours) * 3600 : Math.max(300, Math.ceil(max / 300) * 300);
  const chartHeight = h - top - bottom, cell = (w - left - right) / rows.length;
  const barWidth = Math.min(32, cell * .52);
  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="每日学习时长柱状图"><defs><linearGradient id="bar-gradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5aa4fa"/><stop offset="1" stop-color="#a8cfff"/></linearGradient></defs>`;
  [0,.5,1].forEach(fraction => { const y = top + chartHeight * (1 - fraction); const value = scale * fraction; const label = scale >= 3600 ? `${Number((value/3600).toFixed(1))}h` : `${Math.round(value/60)}m`; svg += `<line x1="${left}" y1="${y}" x2="${w-right}" y2="${y}" stroke="#efeff4" stroke-dasharray="3 4"/><text x="${left-9}" y="${y+4}" text-anchor="end" fill="#6e6e73" font-size="12">${label}</text>`; });
  rows.forEach((row,index) => { const x = left + index * cell + (cell-barWidth)/2, barH = Math.max(values[index] > 0 ? 3 : 0, values[index]/scale*chartHeight), labelDate = String(row.date || '').slice(5).replace('-','/'); const labelStep = Math.max(1,Math.ceil(rows.length/8)); svg += `<rect x="${x}" y="${top+chartHeight-barH}" width="${barWidth}" height="${barH}" rx="${Math.min(5,barWidth/2)}" fill="url(#bar-gradient)"><title>${e(row.date)}：${e(shortTime(row.seconds))}</title></rect>`; if (index % labelStep === 0 || rows.length === 1) svg += `<text x="${x+barWidth/2}" y="${h-8}" text-anchor="middle" fill="#6e6e73" font-size="12">${e(labelDate)}</text>`; });
  return svg + '</svg>';
}
function renderOverview() {
  const {report = {},config = {},status = {}} = appState.data || {};
  const total = Math.max(0, Number(report.total_seconds) || 0), hours = Math.floor(total/3600), minutes = Math.floor(total%3600/60);
  const heroTime = total < 60 ? `<strong>${total > 0 && total < 1 ? '不足 1' : Math.floor(total)}</strong><span>秒</span>` : `<strong>${hours}</strong><span>小时</span><strong>${minutes}</strong><span>分钟</span>`;
  const items = (report.items || []).filter(item => item.seconds > 0).sort((a,b)=>b.seconds-a.seconds);
  const top = items.slice(0,5), max = Math.max(...top.map(item=>item.seconds),1);
  const names = {today:'今日学习时长',week:'本周学习时长',month:'本月学习时长',custom:'所选时段学习时长'};
  const info = statusInfo();
  const connection = !!status.browser_connected;
  return heading('YOUR LEARNING, IN FOCUS','每一份专注，都算数。','看见学习的积累，也为下一次投入留出空间。',`<button class="btn" data-action="export">${icon('download',14)}导出记录</button>`)+periodToolbar()+
    `<div class="hero-grid"><section class="card hero-card"><div class="hero-label">${e(names[appState.range])}</div><div class="total-time">${heroTime}</div><p class="hero-caption">包含 ${e(shortTime(report.pending_seconds || 0))} 待确认时长 · 连续空闲 3 分钟将自动回扣</p><div class="hero-bottom"><span class="current-source"><span class="status-dot ${info.dot}"></span><span>${e(info.text)}</span></span><span class="hint">只记录前台窗口</span></div></section><section class="card focus-card"><div><div class="card-kicker">A LITTLE MORE FOCUS.</div><h2>专注当下。<br>让成长自然发生。</h2><p>软件与学习网站分开统计，记录属于你的学习节奏。</p></div><div style="margin-top:18px"><div class="connection-status"><span class="status-dot ${connection ? 'green' : 'gray'}"></span>${connection ? '浏览器扩展已连接' : '浏览器扩展尚未连接'}</div><button class="btn btn-text" data-action="go-settings">${connection ? '管理统计设置' : '连接浏览器扩展'}${icon('arrow',13)}</button></div></section></div>
    <div class="metric-grid"><section class="card metric-card"><div><p class="metric-label">已确认时长</p><div class="metric-value">${e(compactTime(report.confirmed_seconds || 0))}</div><p class="metric-note">已写入本机记录</p></div><span class="metric-icon">${icon('check',18)}</span></section><section class="card metric-card"><div><p class="metric-label">待确认时长</p><div class="metric-value">${e(compactTime(report.pending_seconds || 0))}</div><p class="metric-note">等待下一次键鼠活动确认</p></div><span class="metric-icon">${icon('clock',17)}</span></section><section class="card metric-card"><div><p class="metric-label">已使用的学习来源</p><div class="metric-value">${items.length}<small>个</small></div><p class="metric-note">${(config.apps || []).filter(app=>app.enabled).length} 个软件 · ${(config.websites || []).filter(site=>site.enabled !== false).length} 个网站已启用</p></div><span class="metric-icon">${icon('apps',17)}</span></section></div>
    <div class="chart-grid"><section class="card chart-card"><div class="card-head"><h2>专注的轨迹</h2><small>每日学习时长</small></div>${chartSvg(report.daily)}</section><section class="card rank-card"><div class="card-head"><h2>时间花在哪里</h2><small>${items.length ? `前 ${top.length} 项` : '学习来源'}</small></div>${top.length ? top.map((item,index)=>`<div class="rank-row">${avatar(item.name,item.kind,index)}<div style="min-width:0"><div class="rank-name">${e(item.name)}</div><div class="rank-track"><i style="width:${Math.max(2,item.seconds/max*100)}%"></i></div></div><div class="rank-time">${e(compactTime(item.seconds))}</div></div>`).join('') : `<div class="chart-empty"><span class="empty-icon">${icon('sparkle',30)}</span><span>打开一个学习软件，开始积累。</span></div>`}</section></div>`;
}
function renderApps() {
  const apps = appState.data?.config?.apps || [];
  const needle = appState.appSearch.toLowerCase();
  const filtered = apps.filter(app => `${app.name} ${app.path || ''} ${app.exe || ''}`.toLowerCase().includes(needle));
  return heading('TOOLS FOR YOUR MIND','好工具，让学习更自在。','选择你希望记录的软件。只在它获得前台焦点时计时。',`<button class="btn" data-action="browse-app">${icon('plus',14)}手动添加</button><button class="btn btn-primary" data-action="scan">${icon('scan',14)}自动发现</button>`)+
    `<div class="info-banner">${icon('info',15)}<span>自动发现会检查安装信息和开始菜单，不读取文档内容。找不到的软件可以手动选择 .exe 文件添加。</span></div><section class="card list-card"><div class="list-toolbar"><label class="search-box">${icon('search',14)}<input id="app-search" placeholder="搜索软件" aria-label="搜索软件" value="${e(appState.appSearch)}"></label><span class="count-badge">已启用 ${apps.filter(app=>app.enabled).length} / ${apps.length} 个</span></div><div id="app-list">${renderAppRows(filtered,apps.length)}</div></section>`;
}
function renderAppRows(apps,totalCount) {
  if (!apps.length) return emptyState(totalCount ? '没有找到匹配的软件' : '添加你的第一件学习工具',totalCount ? '换一个名称试试。' : '点击“自动发现”查找电脑上的学习软件，或手动添加。','apps');
  return apps.map((app,index)=>`<div class="app-row${app.enabled ? '' : ' disabled'}">${avatar(app.name,'app',index)}<div class="app-info"><div class="app-name">${e(app.name)}</div><div class="app-path" title="${e(app.path || app.exe)}">${e(app.path || app.exe || '按应用身份匹配')}</div></div><span class="category-pill">${e(categoryName(app.category))}</span><button class="switch" role="switch" aria-checked="${!!app.enabled}" aria-label="${e(app.enabled ? '停用' : '启用')} ${e(app.name)}" data-action="toggle-app" data-id="${e(app.id)}"></button><button class="icon-button danger" data-action="remove-app" data-id="${e(app.id)}" aria-label="移除 ${e(app.name)}">${icon('trash',14)}</button></div>`).join('');
}
function renderWebsites() {
  const websites = appState.data?.config?.websites || [];
  return heading('A MORE INTENTIONAL WEB','让浏览，也成为积累。','只有白名单网站的前台活动标签页会计时。')+
    `<div class="info-banner">${icon('shield',15)}<span>Bilibili、YouTube 等视频网站不计时。这里只按域名判断；白名单网页内嵌视频仍随页面计时。</span></div><section class="card site-add-card"><label for="site-domain">添加学习网站</label><form id="add-site-form" class="add-site-form"><input class="text-input" id="site-domain" placeholder="域名，例如 docs.python.org" aria-label="网站域名" required autocomplete="off" spellcheck="false"><select class="select-input" id="site-category" aria-label="网站分类"><option value="research">论文研究</option><option value="academic">学术检索</option><option value="docs">技术文档</option><option value="ai">AI 助手</option><option value="coding">编程开发</option><option value="other">其他学习</option></select><button class="btn btn-primary" type="submit">${icon('plus',14)}添加网站</button></form><p class="field-note">仅记录域名，不保存完整网址、网页标题、正文或浏览历史。域名规则包含其子域名。</p></section><section class="card list-card"><div class="list-toolbar"><label class="search-box">${icon('search',14)}<input id="site-search" placeholder="搜索网站" aria-label="搜索网站" value="${e(appState.siteSearch)}"></label><span class="count-badge">${websites.filter(site=>site.enabled !== false).length} 个已启用</span></div><div id="website-list">${renderWebsiteRows(websites.filter(site=>site.domain.toLowerCase().includes(appState.siteSearch.toLowerCase())),websites.length)}</div></section>`;
}
function renderWebsiteRows(websites,totalCount) {
  if (!websites.length) return emptyState(totalCount ? '没有找到匹配的网站' : '为学习留一份白名单',totalCount ? '换一个域名试试。' : '添加你常用的论文、代码或技术文档网站。','websites');
  return websites.map(site=>`<div class="app-row website-row${site.enabled === false ? ' disabled' : ''}">${avatar(site.domain,'website')}<div class="app-info"><div class="app-name">${e(site.domain)}</div><div class="app-path">域名及其子域名</div></div><span class="category-pill">${e(categoryName(site.category))}</span><button class="switch" role="switch" aria-checked="${site.enabled !== false}" aria-label="${site.enabled !== false ? '停用' : '启用'} ${e(site.domain)}" data-action="toggle-site" data-domain="${e(site.domain)}"></button><button class="icon-button danger" data-action="remove-site" data-domain="${e(site.domain)}" aria-label="移除 ${e(site.domain)}">${icon('trash',14)}</button></div>`).join('');
}
function renderRecords() {
  const sessions = appState.data?.report?.sessions || [];
  return heading('MOMENTS THAT ADD UP','每一段时间，都有来处。','查看学习记录，或手动修正遗漏与误计的时长。',`<button class="btn" data-action="export">${icon('download',14)}导出 CSV</button><button class="btn btn-primary" data-action="manual">${icon('plus',14)}修正记录</button>`)+periodToolbar()+
    `<section class="card list-card">${sessions.length ? `<table class="records-table"><thead><tr><th>学习来源</th><th>日期 / 时间</th><th>分类</th><th>时长</th><th aria-label="操作"></th></tr></thead><tbody>${sessions.map(row=>`<tr><td><span>${e(row.name)}</span>${row.manual ? '<span class="manual-badge">修正</span>' : ''}</td><td class="time-cell">${e(formatStamp(row.start,true))}${row.manual ? '' : ` — ${e(formatStamp(row.end))}`}</td><td>${e(categoryName(row.category))}</td><td class="time-cell${Number(row.seconds)<0 ? ' negative' : ''}">${e(shortTime(row.seconds))}</td><td>${row.manual ? `<button class="icon-button danger" data-action="delete-manual" data-id="${e(row.id)}" aria-label="删除这条手动修正">${icon('trash',14)}</button>` : ''}</td></tr>`).join('')}</tbody></table><div class="record-info">显示 ${sessions.length} 条记录。待确认的空闲片段可能回扣；导出以本机保存的记录为准。</div>` : emptyState('这里会留下你的学习足迹','选定时间内暂无记录。打开已启用的软件开始学习，也可以添加手动修正。','records',`<button class="btn btn-soft" data-action="manual">添加手动记录</button>`)}</section>`;
}
function renderSettings() {
  const config = appState.data?.config || {}, connected = !!appState.data?.status?.browser_connected;
  return heading('MAKE IT YOURS','按你的节奏，安静记录。','不打扰专注，也不让数据离开你的电脑。')+
    `<div class="setting-grid"><div><section class="card settings-card"><h2>统计偏好</h2><div class="setting-row"><div><div class="setting-row-title">登录 Windows 后自动启动</div><div class="setting-row-note">在系统托盘中运行，随时开始或暂停统计。</div></div><button class="switch" role="switch" aria-checked="${!!config.autostart}" aria-label="登录 Windows 后自动启动" data-action="autostart"></button></div><div class="setting-row"><div><div class="setting-row-title">键鼠空闲回扣</div><div class="setting-row-note">连续 3 分钟无键盘或鼠标活动，回扣这段空闲时间；恢复操作后继续统计。</div></div><span class="setting-value">3 分钟</span></div><div class="setting-row"><div><div class="setting-row-title">只记录前台窗口</div><div class="setting-row-note">后台 Agent 执行、锁屏和休眠时间不计入。</div></div><span class="setting-value">已启用</span></div><div class="setting-row"><div><div class="setting-row-title">自然日划分</div><div class="setting-row-note">所有日期和跨午夜记录统一按北京时间计算。</div></div><span class="setting-value">UTC +8</span></div></section><section class="card settings-card"><h2>你的数据，留在你的电脑。</h2><div class="privacy-grid"><div class="privacy-item">${icon('shield',16)}<span>只保存应用或网站标识与时长，不收集键盘内容、屏幕截图或文档正文。</span></div><div class="privacy-item">${icon('folder',16)}<span>学习记录保存在本机。代码仓库不包含你的统计记录、应用清单或配对码。</span></div></div><div class="extension-actions"><button class="btn" data-action="open-data">${icon('folder',14)}打开数据目录</button><button class="btn" data-action="export">${icon('download',14)}导出记录</button></div></section><section class="card settings-card"><h2>退出程序</h2><p class="field-note">关闭窗口会留在系统托盘继续统计。完全退出后，统计暂停至下次启动；未确认片段会丢弃。</p><button class="btn" style="margin-top:16px" data-action="quit">完全退出</button></section></div><div><section class="card settings-card"><div class="extension-symbol">${icon('websites',25)}</div><h2 class="extension-title">把学习网页，也记录下来。</h2><p class="extension-copy">连接 Chrome 或 Edge 扩展，仅把当前活动标签页的域名发送给本机程序。</p><div id="browser-connection-status" class="connection-status" style="margin-top:16px;color:#6e6e73"><span class="status-dot ${connected ? 'green' : 'gray'}"></span>${connected ? '扩展已连接' : '等待扩展连接'}</div><ol class="extension-steps"><li><strong>打开扩展目录。</strong><br>点击下方按钮，定位到本程序附带的扩展文件。</li><li><strong>在浏览器中加载扩展。</strong><br>打开扩展管理页，启用开发者模式，选择“加载已解压的扩展”，选中该目录。</li><li><strong>完成本机配对。</strong><br>获取配对码，在扩展面板中填写，然后连接。Chrome 与 Edge 可分别配置。</li></ol><div class="extension-actions"><button class="btn btn-primary" data-action="open-extension">${icon('folder',14)}打开扩展目录</button><button class="btn" data-action="show-token">${icon('link',14)}${appState.browserSetup ? '隐藏配对码' : '获取配对码'}</button></div>${appState.browserSetup ? `<div class="token-box"><label>本机配对码 · 请勿分享</label><code>${e(appState.browserSetup.token)}</code><div class="field-note">本机端口：${e(appState.browserSetup.port)}</div><button class="btn btn-soft" data-action="copy-token">${icon('copy',13)}复制配对码</button></div>` : ''}<p class="field-note" style="margin-top:20px">未连接扩展时，桌面软件仍可正常统计；浏览器时间暂不计入。</p></section></div></div>`;
}
function render() {
  updateChrome();
  if (!appState.data) return;
  const renderers = {overview:renderOverview,apps:renderApps,websites:renderWebsites,records:renderRecords,settings:renderSettings};
  $('#content').innerHTML = renderers[appState.page]();
  if(appState.page==='websites'){$('#site-domain').value=appState.siteDraft.domain;$('#site-category').value=appState.siteDraft.category;}
  appState.renderedConfig=JSON.stringify(appState.data.config || {});
}
async function refresh(forceRender = false) {
  if (appState.busy) { if(!forceRender)return;await new Promise(resolve=>setTimeout(resolve,100));return refresh(true); }
  appState.busy = true;
  try {
    appState.data = await api('get_state',params());
    appState.connected = true;
    updateChrome();
    const editing = ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName);
    const changedConfig=appState.renderedConfig!==JSON.stringify(appState.data.config || {});
    if (forceRender || (!editing && !$('#modal-root').children.length && (appState.page === 'overview' || changedConfig))) {
      const focused=document.activeElement;
      const focusAction=focused?.dataset?.action;
      const focusValue=focused?.dataset?.value;
      render();
      if(!forceRender && focusAction) $$('[data-action]').find(button=>button.dataset.action===focusAction&&button.dataset.value===focusValue)?.focus({preventScroll:true});
    }
  } catch (error) {
    appState.connected = false;
    updateChrome();
    if (forceRender) {
      if (appState.data) toast(error.message,true);
      else $('#content').innerHTML = `<div class="loading-screen"><span style="color:#a4b1c7">${icon('link',34)}</span><h2>正在等待本机服务。</h2><p>${e(error.message)}</p><button class="btn btn-soft" style="margin-top:24px" data-action="retry">重新连接</button></div>`;
    }
  } finally { appState.busy = false; }
}
function closeModal() { $('#modal-root').innerHTML = ''; }
function showModal(title,body,footer,wide = false) {
  $('#modal-root').innerHTML = `<div class="modal-overlay"><section class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${e(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="关闭弹窗">${icon('close',17)}</button></div><div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</section></div>`;
  setTimeout(()=>$('.modal input:not([type=checkbox]),.modal .btn,.modal-head .icon-button')?.focus(),30);
}
function confirmAction(title,description,action,attributes = '') {
  showModal(title,`<p class="modal-description">${e(description)}</p>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn btn-danger" data-action="${action}" ${attributes}>确认${title.startsWith('删除') ? '删除' : title.startsWith('退出') ? '退出' : '移除'}</button>`);
}
async function scanApps() {
  showModal('发现你的学习工具',`<p class="modal-description">正在检查已安装应用、开始菜单和常见安装目录，不读取文档内容。</p><div class="loading-inline"><div class="loader"></div>正在发现学习软件…</div>`,`<button class="btn" data-action="close-modal">关闭</button>`,true);
  try {
    const results = await api('scan_apps');
    appState.scanResults = (Array.isArray(results) ? results : results.apps || []).filter((app,index,list)=>list.findIndex(other=>String(other.id)===String(app.id))===index);
    appState.scanResults.sort((a,b)=>Number(b.suggested)-Number(a.suggested)||String(a.name).localeCompare(String(b.name),'zh-CN'));
    if (!$('#modal-root').children.length) return;
    const known = new Set((appState.data?.config?.apps || []).map(app=>String(app.id)));
    showModal('发现你的学习工具',`<p class="modal-description">发现 ${appState.scanResults.length} 个候选。勾选要纳入统计的软件，已有配置会保留。</p><div class="scan-tools"><label class="search-box">${icon('search',14)}<input id="scan-search" placeholder="搜索候选软件" aria-label="搜索候选软件"></label><span class="count-badge">推荐的软件已预选</span></div><div class="scan-list">${appState.scanResults.length ? appState.scanResults.map(app=>`<label class="scan-row" data-search="${e(`${app.name} ${app.path || app.exe || ''}`.toLowerCase())}"><input type="checkbox" data-scan-id="${e(app.id)}" ${known.has(String(app.id)) || app.suggested || app.enabled ? 'checked' : ''} ${known.has(String(app.id)) ? 'disabled' : ''}><div class="app-info"><div class="app-name">${e(app.name)}</div><div class="app-path" title="${e(app.path || app.exe)}">${e(app.path || app.exe || '应用身份')}</div></div>${known.has(String(app.id)) ? '<span class="scan-tag">已添加</span>' : app.suggested ? '<span class="scan-tag">推荐</span>' : ''}</label>`).join('') : '<div class="notice-empty" style="padding:24px">未发现候选软件，你仍可通过“手动添加”选择应用文件。</div>'}</div>`,`<span class="left-note">只添加你选择的软件</span><button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-scan">添加所选软件</button>`,true);
  } catch (error) {
    if ($('#modal-root').children.length) showModal('自动发现暂未完成',`<div class="error-panel">${e(error.message)}</div><p class="field-note">你仍可手动选择应用文件添加。</p>`,`<button class="btn" data-action="close-modal">关闭</button><button class="btn btn-primary" data-action="scan">重试</button>`);
  }
}
function manualModal() {
  showModal('手动修正学习时长',`<p class="modal-description">正数补记，负数扣减。修正会单独保留，不改写自动记录，之后可以删除。</p><form id="manual-form"><div class="form-grid"><div class="form-field"><label for="manual-date">日期</label><input class="text-input" id="manual-date" type="date" value="${dateKey()}" required></div><div class="form-field"><label for="manual-minutes">修正分钟数</label><input class="text-input" id="manual-minutes" type="number" step="0.1" placeholder="例如 30 或 -10" required></div><div class="form-field full"><label for="manual-name">记录名称</label><input class="text-input" id="manual-name" placeholder="例如：补记论文阅读" maxlength="100" required></div><div class="form-field full"><label for="manual-category">分类</label><select class="select-input" id="manual-category"><option value="research">论文研究</option><option value="coding">编程开发</option><option value="notes">笔记整理</option><option value="ai">AI 助手</option><option value="other">其他学习</option></select></div></div><p class="field-note">手动修正不受三分钟空闲规则影响。负数扣减应与当天已记录的时长相符。</p></form>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-manual">保存修正</button>`);
}
async function browseApp() {
  const app = await api('browse_app');
  if (!app) return;
  if ((appState.data?.config?.apps || []).some(existing=>String(existing.id)===String(app.id) || (existing.path && String(existing.path).toLowerCase()===String(app.path).toLowerCase()))) { toast('这个软件已经在你的名单中。'); return; }
  appState.browsedApp = app;
  showModal('添加学习软件',`<div class="form-grid"><div class="form-field full"><label for="new-app-name">显示名称</label><input class="text-input" id="new-app-name" value="${e(app.name)}" maxlength="80" required></div><div class="form-field full"><label for="new-app-category">分类</label><select class="select-input" id="new-app-category"><option value="coding">编程开发</option><option value="ai">AI 助手</option><option value="research">论文研究</option><option value="notes">笔记整理</option><option value="other">其他学习</option></select></div></div><p class="field-note" style="word-break:break-all;margin-top:20px">${e(app.path || app.exe)}</p>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-browsed-app">添加软件</button>`);
}
async function persistApps(apps) { await api('save_apps',apps); await refresh(true); }
async function persistSites(websites) { await api('save_websites',websites); await refresh(true); }
async function runAction(button) {
  const action = button.dataset.action;
  if (action === 'close-modal') { closeModal(); return; }
  button.disabled = true;
  try {
    switch (action) {
      case 'retry': await refresh(true); break;
      case 'range': appState.range = button.dataset.value; if (!appState.start) appState.start = dateKey(); if (!appState.end) appState.end = dateKey(); await refresh(true); break;
      case 'apply-range': {
        const start = $('#range-start').value,end = $('#range-end').value;
        if (!start || !end || start>end) throw new Error('请填写有效的起止日期，开始日期不能晚于结束日期。');
        appState.start=start;appState.end=end;await refresh(true);break;
      }
      case 'go-settings': location.hash='settings'; break;
      case 'export': { const result=await api('export_csv',params()); if(result?.ok === false || result?.cancelled) break; if(result?.ok || result?.path) toast('CSV 已导出'+(result.path ? `：${result.path}` : '。')); break; }
      case 'scan': await scanApps();break;
      case 'save-scan': {
        const chosen=new Set($$('[data-scan-id]:checked:not(:disabled)').map(input=>input.dataset.scanId));
        const apps=[...(appState.data?.config?.apps || [])];
        const known=new Set(apps.map(app=>String(app.id)));
        let added=0;
        for(const app of appState.scanResults) if(chosen.has(String(app.id))&&!known.has(String(app.id))) {apps.push({...app,enabled:true});known.add(String(app.id));added++;}
        await persistApps(apps);closeModal();toast(added ? `已添加 ${added} 个学习软件。` : '已有软件配置已保留。');break;
      }
      case 'browse-app': await browseApp();break;
      case 'save-browsed-app': {
        const name=$('#new-app-name').value.trim();if(!name)throw new Error('请填写软件名称。');
        const app={...appState.browsedApp,name,category:$('#new-app-category').value,enabled:true};
        await persistApps([...(appState.data?.config?.apps || []),app]);closeModal();toast('已添加学习软件。');break;
      }
      case 'toggle-app': await persistApps((appState.data?.config?.apps || []).map(app=>String(app.id)===button.dataset.id?{...app,enabled:!app.enabled}:app));break;
      case 'remove-app': {const app=(appState.data?.config?.apps || []).find(app=>String(app.id)===button.dataset.id);confirmAction('移除学习软件',`从名单中移除“${app?.name || ''}”？已有学习记录会保留。`,'confirm-remove-app',`data-id="${e(button.dataset.id)}"`);break;}
      case 'confirm-remove-app': await persistApps((appState.data?.config?.apps || []).filter(app=>String(app.id)!==button.dataset.id));closeModal();toast('已移除软件，历史记录已保留。');break;
      case 'toggle-site': await persistSites((appState.data?.config?.websites || []).map(site=>site.domain===button.dataset.domain?{...site,enabled:site.enabled===false}:site));break;
      case 'remove-site': confirmAction('移除学习网站',`从白名单中移除 ${button.dataset.domain}？已有记录会保留。`,'confirm-remove-site',`data-domain="${e(button.dataset.domain)}"`);break;
      case 'confirm-remove-site': await persistSites((appState.data?.config?.websites || []).filter(site=>site.domain!==button.dataset.domain));closeModal();toast('已移除网站，历史记录已保留。');break;
      case 'manual': manualModal();break;
      case 'save-manual': {
        const form=$('#manual-form');if(!form.reportValidity())break;
        const minutes=Number($('#manual-minutes').value);if(!Number.isFinite(minutes)||minutes===0)throw new Error('请输入非零的有效分钟数。');
        const name=$('#manual-name').value.trim();if(!name)throw new Error('请填写记录名称。');
        await api('add_manual',{date:$('#manual-date').value,minutes,name,category:$('#manual-category').value});closeModal();await refresh(true);toast('手动修正已保存。');break;
      }
      case 'delete-manual': confirmAction('删除手动修正','删除后会恢复这条修正前的统计结果。自动记录不会受影响。','confirm-delete-manual',`data-id="${e(button.dataset.id)}"`);break;
      case 'confirm-delete-manual': await api('delete_manual',button.dataset.id);closeModal();await refresh(true);toast('手动修正已删除。');break;
      case 'autostart': await api('set_autostart',!appState.data?.config?.autostart);await refresh(true);toast(appState.data?.config?.autostart?'已启用登录自启。':'已关闭登录自启。');break;
      case 'open-data': await api('open_data_folder');break;
      case 'open-extension': await api('open_extension_folder');break;
      case 'show-token': appState.browserSetup=appState.browserSetup?null:await api('get_browser_setup');render();break;
      case 'copy-token': {
        const token=appState.browserSetup?.token;if(!token)break;
        let copied=false;
        try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(token);copied=true;}}catch(_error){}
        if(!copied){const textarea=document.createElement('textarea');textarea.value=token;textarea.style.position='fixed';textarea.style.opacity='0';document.body.append(textarea);textarea.select();copied=document.execCommand('copy');textarea.remove();}
        if(!copied)throw new Error('复制未成功，请选中配对码手动复制。');toast('配对码已复制，请粘贴到浏览器扩展中。');break;
      }
      case 'quit': confirmAction('退出程序','退出后将停止统计，尚未确认的片段会丢弃。下次打开程序后继续记录。','confirm-quit');break;
      case 'confirm-quit': await api('quit_app');break;
    }
  } catch(error) {toast(error.message || String(error),true);} finally { if(button.isConnected)button.disabled=false; }
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button&&!button.disabled)runAction(button);});
$('#pause-button').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{await api('set_paused',!appState.data?.status?.paused);await refresh(true);}catch(error){toast(error.message,true);}finally{button.disabled=false;}});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='add-site-form')return;
  event.preventDefault();
  const submit=event.target.querySelector('button[type=submit]');submit.disabled=true;
  try{
    const raw=$('#site-domain').value.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,'');
    let domain;
    try{const url=new URL(`https://${raw}`);if(url.pathname!=='/'||url.search||url.hash||url.port||url.username||url.password)throw new Error();domain=url.hostname;}catch(_error){throw new Error('请只填写域名，不包含网址路径、端口或查询参数。');}
    if(!domain.includes('.')||domain.startsWith('.')||domain.endsWith('.'))throw new Error('请输入有效域名，例如 arxiv.org。');
    const websites=appState.data?.config?.websites || [];
    if(websites.some(site=>site.domain===domain))throw new Error('这个网站已经在白名单中。');
    await api('save_websites',[...websites,{domain,category:$('#site-category').value,enabled:true}]);appState.siteDraft.domain='';await refresh(true);toast(`已添加 ${domain}。`);
  }catch(error){toast(error.message,true);}finally{if(submit.isConnected)submit.disabled=false;}
});
document.addEventListener('input',event=>{
  if(event.target.id==='site-domain')appState.siteDraft.domain=event.target.value;
  if(event.target.id==='app-search'){appState.appSearch=event.target.value;const apps=appState.data?.config?.apps||[];$('#app-list').innerHTML=renderAppRows(apps.filter(app=>`${app.name} ${app.path||''} ${app.exe||''}`.toLowerCase().includes(appState.appSearch.toLowerCase())),apps.length);}
  if(event.target.id==='site-search'){appState.siteSearch=event.target.value;const websites=appState.data?.config?.websites||[];$('#website-list').innerHTML=renderWebsiteRows(websites.filter(site=>site.domain.toLowerCase().includes(appState.siteSearch.toLowerCase())),websites.length);}
  if(event.target.id==='scan-search'){const value=event.target.value.toLowerCase();$$('.scan-row').forEach(row=>row.hidden=!row.dataset.search.includes(value));}
});
document.addEventListener('change',event=>{if(event.target.id==='site-category')appState.siteDraft.category=event.target.value;});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeModal();if(appState.browserSetup){appState.browserSetup=null;if(appState.page==='settings')render();}}
  if(event.key==='Tab'&&$('.modal')){const focusable=$$('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]',$('.modal')).filter(node=>!node.hidden);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
});
function onNavigate(){const key=location.hash.slice(1);appState.page=pageNames[key]?key:'overview';appState.browserSetup=null;closeModal();window.scrollTo(0,0);render();if(appState.connected)refresh(true);}
window.addEventListener('hashchange',onNavigate);
let started=false;
async function start(){if(started)return;started=true;appState.page=pageNames[location.hash.slice(1)]?location.hash.slice(1):'overview';appState.start=dateKey();appState.end=dateKey();$('#demo-banner').hidden=!DEMO;updateChrome();await refresh(true);setInterval(()=>refresh(false),2000);}
window.addEventListener('pywebviewready',start);

// Explicit opt-in visual demo, isolated from the real native bridge.
const demoConfig={apps:[{id:'demo-codex',name:'Codex',path:'示例应用 / Codex.exe',exe:'Codex.exe',category:'ai',enabled:true},{id:'demo-vscode',name:'Visual Studio Code',path:'示例应用 / Code.exe',exe:'Code.exe',category:'coding',enabled:true},{id:'demo-zotero',name:'Zotero',path:'示例应用 / zotero.exe',exe:'zotero.exe',category:'research',enabled:true},{id:'demo-obsidian',name:'Obsidian',path:'示例应用 / Obsidian.exe',exe:'Obsidian.exe',category:'notes',enabled:true}],websites:[{domain:'arxiv.org',category:'research',enabled:true},{domain:'github.com',category:'coding',enabled:true},{domain:'chatgpt.com',category:'ai',enabled:true},{domain:'docs.python.org',category:'docs',enabled:true}],autostart:true};
let demoPaused=false;
const demoApi={
  get_state:async()=>({version:'1.0.0 · 演示',config:demoConfig,status:{paused:demoPaused,idle_seconds:38,state:'active',current_name:'Visual Studio Code',browser_connected:true},report:{total_seconds:13320,confirmed_seconds:13260,pending_seconds:60,items:[{id:'demo-vscode',name:'Visual Studio Code',kind:'app',category:'coding',seconds:5040},{id:'demo-codex',name:'Codex',kind:'app',category:'ai',seconds:3780},{id:'demo-zotero',name:'Zotero',kind:'app',category:'research',seconds:2280},{id:'arxiv.org',name:'arxiv.org',kind:'website',category:'research',seconds:1320},{id:'demo-obsidian',name:'Obsidian',kind:'app',category:'notes',seconds:900}],daily:Array.from({length:7},(_,i)=>({date:dateKey(new Date(Date.now()-(6-i)*86400000)),seconds:[7200,9840,5400,16200,11100,8760,13320][i]})),sessions:[{id:1,start:Date.now()/1000-5040,end:Date.now()/1000,name:'Visual Studio Code',kind:'app',category:'coding',seconds:5040,manual:false}]}}),
  set_paused:async value=>{demoPaused=value;return{ok:true};},scan_apps:async()=>demoConfig.apps,save_apps:async apps=>{demoConfig.apps=apps;return{ok:true};},browse_app:async()=>null,save_websites:async sites=>{demoConfig.websites=sites;return{ok:true};},add_manual:async()=>{throw new Error('演示界面不保存记录。');},delete_manual:async()=>{throw new Error('演示界面不修改记录。');},export_csv:async()=>{throw new Error('演示界面不导出数据。');},set_autostart:async value=>{demoConfig.autostart=value;return{ok:true};},get_browser_setup:async()=>({token:'DEMO-ONLY-NOT-A-REAL-TOKEN',port:42821,extension_path:'演示目录'}),open_data_folder:async()=>{throw new Error('请在桌面程序中打开本机目录。');},open_extension_folder:async()=>{throw new Error('请在桌面程序中打开扩展目录。');},quit_app:async()=>{throw new Error('此处是演示界面。');}
};
if(DEMO)start();else if(window.pywebview?.api)start();else setTimeout(()=>{if(!started){$('#content').innerHTML='<div class="loading-screen"><span style="color:#a4b1c7">'+icon('apps',36)+'</span><h2>请从桌面程序打开。</h2><p>学习记录由本机服务提供，单独打开页面不会启动统计。</p></div>';}},5000);

