/* 公考作战台 v2 · 交互层
   核心机制：格历格子由 traces.js 的真实日期数据驱动，不是背景图。
   GSAP 负责编排，Lenis 负责滚动手感，Lucide 提供图标；
   任一库缺失时降级为原生行为，不抛错。
   中文短文本用 Intl.Segmenter + <wbr> 按词断行（修 check-text-wrap）。 */
(function(){
'use strict';

const C = window.GK_CONFIG;
const SEED = window.GK_TRACES || [];
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const WEEK = ['日','一','二','三','四','五','六'];

let SEG = null;
try { SEG = new Intl.Segmenter('zh', {granularity:'word'}); } catch(e){}
/* 文本节点专用：按词插 <wbr>，配合 CSS keep-all 避免中文被拆词 */
/* 标点不单独断开，跟随前一个词，否则会跑到行首 */
const PUNCT = /^[，。、；：？！）》」』」』%·…—\s]+$/;
function segParts(t){
  const parts = SEG ? Array.from(SEG.segment(String(t))).map(x => x.segment) : [String(t)];
  return parts.map((p,i) => (i && !PUNCT.test(p) ? '<wbr>' : '') + esc(p)).join('');
}
function segStr(s){ return segParts(s == null ? '' : s); }
function segmentStatic(root){
  $$('[data-seg]', root || document).forEach(el => {
    if (el.dataset.segDone) return;
    el.innerHTML = segParts(el.textContent);
    el.dataset.segDone = '1';
  });
}

const store = {
  get(k, f){ try { const v = localStorage.getItem('gk:' + k); return v == null ? f : JSON.parse(v); } catch(e){ return f; } },
  set(k, v){ try { localStorage.setItem('gk:' + k, JSON.stringify(v)); } catch(e){} },
  del(k){ try { localStorage.removeItem('gk:' + k); } catch(e){} }
};

const dateKey = d => d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
const md = d => pad(d.getMonth()+1) + '.' + pad(d.getDate());
const full = d => d.getFullYear() + '.' + md(d);
const parseDT = s => new Date(s);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayDiff = (a, b) => Math.floor((new Date(a.getFullYear(),a.getMonth(),a.getDate()) - new Date(b.getFullYear(),b.getMonth(),b.getDate())) / 86400000);
const now = () => new Date();
const todayKey = () => dateKey(now());

function icons(){ if (window.lucide && lucide.createIcons) { try { lucide.createIcons(); } catch(e){} } }

/* ---------- 考试配置 ---------- */
function examCfg(){
  const o = store.get('exam', null), b = C.exam;
  const s = o && o.date ? o : b;
  let date = parseDT(s.date), start = parseDT((s.start || b.start) + 'T00:00:00');
  /* 非法日期（含旧版缓存里的怪值）一律回退默认，避免 NaN 让格历整个空掉 */
  if (isNaN(date.getTime())) date = parseDT(b.date);
  if (isNaN(start.getTime())) start = parseDT(b.start + 'T00:00:00');
  if (isNaN(date.getTime())) date = new Date(2027, 10, 28, 9, 0, 0);
  if (isNaN(start.getTime())) start = new Date(2026, 10, 2, 0, 0, 0);
  /* 开卷日不能晚于考试日，否则格历会退化成 0 格 */
  if (start > date) start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return {
    name: s.name || b.name,
    date: date,
    start: start,
    subtitle: s.subtitle || b.subtitle || ''
  };
}
let EX = examCfg();

/* ---------- 痕迹 ---------- */
function allTraces(){
  const mine = store.get('traces', []);
  const gone = store.get('deletedTraces', []);
  const removed = Array.isArray(gone) ? gone : [];
  return SEED.concat(Array.isArray(mine) ? mine : [])
    .filter(t => t && t.date && t.title && removed.indexOf(t.id) < 0)
    .slice().sort((a,b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
}
function latestScore(list){
  const s = list.filter(t => typeof t.score === 'number' && !isNaN(t.score));
  return s.length ? s[0].score : C.baseline.score;
}

/* ---------- 倒计时与状态行 ---------- */
function renderClock(){
  const n = now(), diff = EX.date - n, past = diff <= 0;
  const days = past ? 0 : Math.floor(diff / 86400000);
  const rest = past ? 0 : diff % 86400000;
  const h = Math.floor(rest/3600000), m = Math.floor(rest%3600000/60000), s = Math.floor(rest%60000/1000);
  $('#topDate').textContent = full(n) + ' 周' + WEEK[n.getDay()];
  $('#calSub').textContent = past
    ? EX.name + ' 已经到了 · ' + full(EX.date)
    : '距离 ' + EX.name + ' · ' + EX.subtitle + ' ' + full(EX.date);
  $('#cdLine').innerHTML = past ? '已经上场了' : '还剩 <b>' + days + '</b> 天 ' + pad(h) + ':' + pad(m) + ':' + pad(s);

  const total = Math.max(1, dayDiff(EX.date, EX.start));
  const gone = Math.max(0, Math.min(total, dayDiff(n, EX.start)));
  const pct = Math.round(gone / total * 100);
  $('#phaseLine').innerHTML = '格历走过 <b>' + pct + '%</b> · 第 ' + gone + ' / ' + total + ' 天';
  const keys = Array.from(new Set(allTraces().map(t => t.date))).sort();
  let streak = 0;
  for (let i = keys.length - 1; i >= 0; i--){
    const d = parseDT(keys[i] + 'T00:00:00');
    if (dayDiff(now(), d) === streak) streak++; else break;
  }
  $('#streakLine').textContent = '连续留痕 ' + streak + ' 天';
}

/* ---------- 月份翻页 ----------
   格历按「月」分页：每月固定 7 列 × 5~6 行，最多 42 格，不再受备考总跨度影响；
   备考区间外的月份仍可翻看、可点开补记。翻页是真实视图切换，
   方向性短位移由 GSAP 编排，不是整页淡入，也不是背景图位移。 */
const MONTH_MIN = new Date(2000, 0, 1), MONTH_MAX = new Date(2100, 11, 1);
let viewMonth = null;                        // null = 跟随今天所在月
const monthStart = d => new Date(d.getFullYear(), d.getMonth(), 1);
const monthLabel = d => d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月';
const curMonth = () => viewMonth || monthStart(now());
function monthStep(d, n){
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return (x < MONTH_MIN || x > MONTH_MAX) ? null : x;
}
function animateMonth(dir){
  if (!window.gsap || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cells = $$('#calGrid .cell:not(.cell--pad)');
  if (!cells.length) return;
  gsap.fromTo(cells,
    {opacity:0, x: dir > 0 ? 14 : dir < 0 ? -14 : 0},
    {opacity:1, x:0, duration:.28, ease:'power2.out',
     stagger:{each:Math.min(.009, .3 / cells.length), from:'start'},
     clearProps:'opacity,transform'});
}
function goMonth(dir){
  const m = monthStep(curMonth(), dir);
  if (!m){ toast('已经翻到头了'); return; }
  viewMonth = m;
  renderCalendar();
  animateMonth(dir);
}
function goToday(){
  const t = monthStart(now()), c = curMonth();
  if (c.getFullYear() === t.getFullYear() && c.getMonth() === t.getMonth()){
    const cell = $('#calGrid .cell--today');
    if (cell && window.gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      gsap.fromTo(cell, {boxShadow:'inset 0 0 0 2px rgba(192,57,43,1)'},
        {boxShadow:'inset 0 0 0 6px rgba(192,57,43,0)', duration:.55, ease:'power2.out', clearProps:'boxShadow'});
    toast('今天就在这一格');
    return;
  }
  viewMonth = null;
  renderCalendar();
  animateMonth(0);
  toast('回到今天这一月');
}
function initCalNav(){
  const nav = $('#calNav');
  if (nav) nav.addEventListener('click', e => {
    const b = e.target.closest('[data-cal]');
    if (!b || b.disabled) return;
    if (b.dataset.cal === 'prev') goMonth(-1);
    else if (b.dataset.cal === 'next') goMonth(1);
    else if (b.dataset.cal === 'today') goToday();
  });
  /* 键盘 ← → 翻月；输入框聚焦或弹层打开时不抢按键 */
  document.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (typing || $$('.modal.is-open,.drawer.is-open').length) return;
    e.preventDefault();
    goMonth(e.key === 'ArrowRight' ? 1 : -1);
  });
  /* 触屏左右轻扫翻月：只认水平位移主导，不抢纵向滚动 */
  const panel = $('.cal-panel');
  if (!panel) return;
  let x0 = 0, y0 = 0;
  panel.addEventListener('touchstart', e => {
    if (e.touches.length !== 1){ x0 = 0; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, {passive:true});
  panel.addEventListener('touchend', e => {
    if (!x0 || !e.changedTouches.length) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = 0;
    if (Math.abs(dx) > 48 && Math.abs(dy) < 40) goMonth(dx < 0 ? 1 : -1);
  }, {passive:true});
}

/* ---------- 格历墙（核心） ---------- */
/* 格历命脉自愈：外部 styles.css 若被缓存成旧版/未加载，CSS Grid 会退化成块级流，
   所有格子竖排成一列。渲染后检测 computed display，异常就用 inline 强制回 7 列。 */
function ensureGrid(){
  const g = $('#calGrid'); if (!g) return;
  const cs = getComputedStyle(g);
  const cols = cs.gridTemplateColumns ? cs.gridTemplateColumns.split(/\s+/).filter(Boolean).length : 0;
  if (cs.display !== 'grid' || cols !== 7){
    g.style.display = 'grid';
    g.style.gridTemplateColumns = 'repeat(7,minmax(0,1fr))';
    g.style.gap = '1px';
  }
  const wh = document.querySelector('.cal-weekhead');
  if (wh && getComputedStyle(wh).display !== 'grid'){
    wh.style.display = 'grid'; wh.style.gridTemplateColumns = 'repeat(7,minmax(0,1fr))';
  }
}

function renderCalendar(){
  const list = allTraces(), tkey = todayKey();
  const traceDays = new Set(list.map(t => t.date));
  const m = curMonth(), y = m.getFullYear(), mo = m.getMonth();
  const offset = (new Date(y, mo, 1).getDay() + 6) % 7;   // 周一为第一列
  const days = new Date(y, mo + 1, 0).getDate();
  const cells = Math.ceil((offset + days) / 7) * 7;       // 35 或 42 格，恒定上限
  const startK = dateKey(EX.start), examK = dateKey(EX.date);
  let html = '', monthDone = 0;
  for (let i = 0; i < cells; i++){
    const idx = i - offset + 1;
    if (idx < 1 || idx > days){ html += '<div class="cell cell--pad" aria-hidden="true"></div>'; continue; }
    const d = new Date(y, mo, idx), k = dateKey(d);
    const done = traceDays.has(k), isToday = k === tkey, future = dayDiff(d, now()) > 0;
    const outside = k < startK || k > examK;
    if (done) monthDone++;
    const cls = ['cell', done ? 'cell--done' : '', isToday ? 'cell--today' : '',
      (!done && !isToday && future) ? 'cell--future' : '',
      (!done && !isToday && !future) ? 'cell--past' : '',
      outside ? 'cell--outside' : ''].filter(Boolean).join(' ');
    /* 状态用图形标记，不在按钮里放单字，避免中文短文本出现孤字 */
    const mark = done ? '<span class="cell__tick" aria-hidden="true"></span>' : '';
    const label = full(d) + (done ? '，留过痕迹' : isToday ? '，今天' : future ? '，还没到' : '') +
      (outside ? '，不在备考区间' : '');
    html += '<button class="' + cls + '" type="button" data-day="' + k + '" aria-label="' + esc(label) + '">' +
            '<span class="cell__d">' + pad(d.getDate()) + '</span><span class="cell__mark">' + mark + '</span></button>';
  }
  $('#calGrid').innerHTML = html;
  $('#calGrid').setAttribute('aria-label', '备考格历 · ' + monthLabel(m));
  ensureGrid();
  $$('[data-day]').forEach(b => b.addEventListener('click', () => openDay(b.dataset.day, b)));
  renderCalNav(m, monthDone);
  /* 首屏逐格铺开：月视图最多 42 格，总 stagger 恒定 ≤ .5s；
     有静态兜底时不重放，避免先闪一下再出现。 */
  const animCells = $$('#calGrid .cell:not(.cell--pad)').length;
  if (window.gsap && !renderCalendar.played && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    renderCalendar.played = true;
    gsap.from('#calGrid .cell:not(.cell--pad)', {opacity:0, y:8, duration:.42, ease:'power2.out',
      stagger:Math.min(.012, .5 / Math.max(1, animCells)), clearProps:'all'});
  }
}

function renderCalNav(m, monthDone){
  const el = $('#calMonth'); if (!el) return;
  el.textContent = monthLabel(m);
  const r = $('#calRange');
  if (r) r.textContent = '本月留痕 ' + monthDone + ' 天 · 开卷 ' + md(EX.start) + ' → 上场 ' + md(EX.date);
  const pm = monthStep(m, -1), nm = monthStep(m, 1);
  const pv = $('#calPrev'), nx = $('#calNext');
  if (pv){ pv.disabled = !pm; pv.setAttribute('aria-label', pm ? '上一个月 · ' + monthLabel(pm) : '已经翻到头了'); }
  if (nx){ nx.disabled = !nm; nx.setAttribute('aria-label', nm ? '下一个月 · ' + monthLabel(nm) : '已经翻到头了'); }
  const td = $('#calToday');
  if (td) td.classList.toggle('is-current', !viewMonth);
}

/* ---------- 统计 ---------- */
function renderStats(){
  const list = allTraces();
  const days = new Set(list.map(t => t.date)).size;
  const qs = list.reduce((a,t) => a + (Number(t.questions) || 0), 0);
  const score = latestScore(list);
  $('#stats').innerHTML =
    '<div><dt>留痕天数</dt><dd><span data-count="' + days + '">0</span><small>天</small></dd></div>' +
    '<div><dt>累计题量</dt><dd><span data-count="' + qs + '">0</span><small>题</small></dd></div>' +
    '<div><dt>当前基线</dt><dd><span data-count="' + score + '" data-dec="1">0</span><small>分</small></dd></div>';
  $$('[data-count]').forEach(el => {
    const target = parseFloat(el.dataset.count) || 0, dec = el.dataset.dec ? 1 : 0;
    if (window.gsap){
      const o = {v:0};
      gsap.to(o, {v:target, duration:1.05, ease:'power2.out', onUpdate(){ el.textContent = o.v.toFixed(dec); }, onComplete(){ el.textContent = target.toFixed(dec); }});
    } else el.textContent = target.toFixed(dec);
  });
  const f = $('#todayFlag'), has = list.some(t => t.date === todayKey());
  f.classList.toggle('is-done', has);
  f.innerHTML = '<i data-lucide="' + (has ? 'check-check' : 'circle-dot') + '"></i>' +
    segStr(has ? '今天已经留过痕迹了，继续保持' : '今天还是空格，点上面记一笔或点今天那一格');
  icons();
}

/* ---------- 打气语：洗牌袋，一轮走完不重复，刷新换起点 ---------- */
let qi = -1, quoteBag = [];
function reshuffleQuote(){
  quoteBag = C.quotes.map((_, i) => i);
  for (let i = quoteBag.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    const t = quoteBag[i]; quoteBag[i] = quoteBag[j]; quoteBag[j] = t;
  }
  /* 避免新一轮首句和上一句相同 */
  if (quoteBag.length > 1 && quoteBag[quoteBag.length - 1] === qi){
    const t = quoteBag[0]; quoteBag[0] = quoteBag[quoteBag.length - 1]; quoteBag[quoteBag.length - 1] = t;
  }
}
function nextQuote(){
  if (!quoteBag.length) reshuffleQuote();
  qi = quoteBag.pop();
  setQuote(qi);
}
function setQuote(i){
  const q = C.quotes[i], el = $('#quoteText');
  el.classList.add('is-swap');
  setTimeout(() => { el.innerHTML = segStr(q.text); $('#quoteSrc').textContent = '— ' + q.src; el.classList.remove('is-swap'); }, 200);
}
function initQuote(){ reshuffleQuote(); nextQuote(); }

/* ---------- 今日任务 ---------- */
function renderTasks(){
  const key = 'tasks:' + todayKey(), done = store.get(key, []), list = C.dailyTasks;
  $('#taskRing').textContent = done.length + ' / ' + list.length;
  $('#taskList').innerHTML = list.map(t =>
    '<li><button class="task' + (done.indexOf(t.id) >= 0 ? ' is-done' : '') + '" type="button" data-task="' + t.id + '" aria-pressed="' + (done.indexOf(t.id) >= 0) + '">' +
      '<span class="task__box"></span><span class="task__txt">' + segStr(t.text) + '</span><span class="task__min">' + t.min + ' MIN</span></button></li>').join('');
  $$('[data-task]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.task;
    let cur = store.get(key, []);
    const wasFull = cur.length === list.length;
    const on = cur.indexOf(id) < 0;
    cur = on ? cur.concat([id]) : cur.filter(x => x !== id);
    store.set(key, cur);
    btn.classList.toggle('is-done', on);
    btn.setAttribute('aria-pressed', String(on));
    $('#taskRing').textContent = cur.length + ' / ' + list.length;

    /* 四件事全部划掉 = 今天真的留下一道痕迹，写入真实数据，格历/统计/痕迹流同源更新。
       取消勾选时移除这条自动记录，操作可逆，不制造假数据。 */
    const isFull = cur.length === list.length;
    const autoId = 'auto-' + todayKey();
    if (isFull !== wasFull){
      let mine = store.get('traces', []);
      if (isFull){
        if (!mine.some(t => t.id === autoId)) mine.push({
          id: autoId, date: todayKey(), type: '随手记', title: '今日四件事全部划掉',
          body: '资料分析、数量关系、错题复盘、一页纸，四件都做完了。',
          note: '划掉比记住更重要', questions: null, minutes: null, score: null,
          src: '作战台 · 今日清单自动留痕', by: 'me'
        });
      } else mine = mine.filter(t => t.id !== autoId);
      store.set('traces', mine);
      renderCalendar.played = true;
      renderCalendar(); renderStats(); renderFilters(); renderTraces(); renderClock();
      const cell = $('#calGrid .cell--today');
      if (cell && window.gsap && isFull){
        gsap.fromTo(cell,
          {backgroundColor:'#F4F6F5', boxShadow:'inset 0 0 0 0px rgba(23,70,58,0)'},
          {backgroundColor:'#17463A', boxShadow:'inset 0 0 0 2px rgba(23,70,58,1)', duration:.5, ease:'power2.out', clearProps:'backgroundColor,boxShadow'});
      }
      toast(isFull ? '四件事都划掉了，今天这一格已经填上' : '已取消一条勾选，今天这一格回到空格');
    }
  }));
}

/* ---------- 时间轴 ---------- */
const msDate = d => addDays(EX.date, -d);
function nextMilestone(){
  for (const m of C.milestones) if (dayDiff(msDate(m.d), now()) >= 0) return m;
  return C.milestones[C.milestones.length - 1];
}
function renderAxis(){
  const m = nextMilestone(), dt = msDate(m.d), left = dayDiff(dt, now());
  $('#nextLabel').textContent = m.label + (m.d === 0 ? '' : ' · D-' + m.d);
  $('#nextDesc').innerHTML = segStr(m.desc);
  $('#nextDate').textContent = full(dt);
  $('#nextLeft').textContent = left === 0 ? '就是今天' : '还有 ' + left + ' 天';
  const sc = latestScore(allTraces()), target = C.baseline.target;
  const pct = Math.max(0, Math.min(100, sc / target * 100));
  $('#scoreFill').style.width = pct + '%';
  $('#scoreDot').style.left = pct + '%';
  $('#scoreNow').textContent = sc.toFixed(1) + ' 分 · 当前';
  $('#scoreTarget').textContent = target + ' 分 · 目标';
  $('#scoreGap').textContent = sc >= target ? ('已超目标 ' + (sc-target).toFixed(1) + ' 分') : ('还差 ' + (target-sc).toFixed(1) + ' 分');

  const done = store.get('milestones', []), nx = nextMilestone(), t = now();
  $('#milestoneList').innerHTML = C.milestones.map(x => {
    const d = msDate(x.d), passed = dayDiff(d, t) < 0, ok = done.indexOf(x.d) >= 0;
    const isNext = x.d === nx.d && !passed;
    const cls = [passed ? 'is-past' : '', isNext ? 'is-next' : ''].filter(Boolean).join(' ');
    return '<li class="' + cls + '"><div class="axis__d">D-' + x.d + '</div><div class="axis__date">' + md(d) + '</div>' +
      '<div class="axis__label">' + segStr(x.label) + '</div><p class="axis__desc">' + segStr(x.desc) + '</p>' +
      '<button class="axis__btn' + (ok ? ' is-done' : '') + '" type="button" data-ms="' + x.d + '" aria-pressed="' + ok + '">' +
      '<i data-lucide="' + (ok ? 'check' : 'circle') + '"></i>' + (ok ? '已过' : '标完成') + '</button></li>';
  }).join('');
  $$('[data-ms]').forEach(b => b.addEventListener('click', () => {
    const d = Number(b.dataset.ms);
    let cur = store.get('milestones', []);
    const on = cur.indexOf(d) < 0;
    store.set('milestones', on ? cur.concat([d]) : cur.filter(x => x !== d));
    b.classList.toggle('is-done', on);
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = '<i data-lucide="' + (on ? 'check' : 'circle') + '"></i>' + (on ? '已过' : '标完成');
    icons(); toast(on ? '这一坎记下了' : '已取消标记');
  }));
  icons();
}

/* ---------- 学习痕迹 ---------- */
let filter = '全部', keyword = '', freshId = null, pendingDel = null;
let undoDel = null;
function renderFilters(){
  const types = ['全部'].concat(Array.from(new Set(allTraces().map(t => t.type).filter(Boolean))));
  if (types.indexOf(filter) < 0) filter = '全部';
  $('#traceFilters').innerHTML = types.map(t =>
    '<button class="chip' + (t === filter ? ' is-active' : '') + '" type="button" data-type="' + esc(t) + '">' + segStr(t) + '</button>').join('');
  $$('[data-type]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.type; pendingDel = null; renderFilters(); renderTraces(); }));
}
function renderTraces(){
  let list = allTraces();
  if (filter !== '全部') list = list.filter(t => t.type === filter);
  if (keyword.trim()){
    const k = keyword.trim().toLowerCase();
    list = list.filter(t => [t.title,t.body,t.note,t.src,t.type,t.date].join(' ').toLowerCase().indexOf(k) >= 0);
  }
  $('#traceEmpty').hidden = list.length > 0;
  $('#traceList').innerHTML = list.map(t => {
    const d = parseDT(t.date + 'T00:00:00');
    const nums = [t.questions ? t.questions + ' 题' : '', t.minutes ? t.minutes + ' 分钟' : '', typeof t.score === 'number' ? t.score + ' 分' : ''].filter(Boolean).join(' · ');
    const by = t.by === 'ai' ? 'AI 代记' : t.by === 'me' ? '自己记的' : '知识库';
    return '<li class="trace"><div class="trace__when"><div class="trace__date">' + md(d) + '</div>' +
      '<div class="trace__week">' + d.getFullYear() + ' / 周' + WEEK[d.getDay()] + '</div></div>' +
      '<article class="trace__card' + (t.id === freshId ? ' is-fresh' : '') + (pendingDel === t.id ? ' is-deleting' : '') + '">' +
        '<div class="trace__top"><span class="trace__type">' + segStr(t.type || '随手记') + '</span>' +
          '<span class="trace__by' + (t.by === 'ai' ? ' trace__by--ai' : '') + '">' + segStr(by) + '</span>' +
          (nums ? '<span class="trace__nums">' + segStr(nums) + '</span>' : '<span class="trace__nums" aria-hidden="true"></span>') +
          '<button class="trace__del" type="button" data-del="' + esc(t.id) + '" aria-label="删除这道痕迹"><i data-lucide="trash-2"></i></button></div>' +
        '<h3 class="trace__title">' + segStr(t.title) + '</h3>' +
        (t.body ? '<p class="trace__body">' + segStr(t.body) + '</p>' : '') +
        (t.note ? '<p class="trace__note">' + segStr(t.note) + '</p>' : '') +
        (t.src ? '<span class="trace__src">出处 / ' + segStr(t.src) + '</span>' : '') +
        (pendingDel === t.id
          ? '<div class="trace__confirm"><span>' + segStr('删掉这道痕迹，格子和统计会一起变') + '</span>' +
            '<div class="trace__confirm-acts"><button class="tbtn" type="button" data-del-cancel>取消</button>' +
            '<button class="tbtn tbtn--danger" type="button" data-del-ok="' + esc(t.id) + '">删除</button></div></div>'
          : '') +
      '</article></li>';
  }).join('');
  freshId = null;
  icons();
  /* 删除是就地两段式：先进入确认态，再执行；取消与 Esc 都可退出，焦点回到取消按钮 */
  $$('[data-del]').forEach(b => b.addEventListener('click', () => {
    pendingDel = b.dataset.del;
    renderTraces();
    const c = $('[data-del-cancel]');
    if (c) c.focus();
  }));
  $$('[data-del-cancel]').forEach(b => b.addEventListener('click', () => { pendingDel = null; renderTraces(); }));
  $$('[data-del-ok]').forEach(b => b.addEventListener('click', () => softDelete(b.dataset.delOk)));
}

/* ---------- 删除痕迹（可逆） ----------
   自己记的直接从 localStorage 移出；文件里的种子痕迹用 id 黑名单屏蔽，
   否则刷新后会被 SEED 重新拼回来。撤销按来源分别还原。 */
function softDelete(id){
  const t = allTraces().find(x => x.id === id);
  if (!t) return;
  const mine = store.get('traces', []);
  const isMine = Array.isArray(mine) && mine.some(x => x.id === id);
  const rec = (Array.isArray(mine) ? mine : []).find(x => x.id === id) || t;
  if (isMine) store.set('traces', mine.filter(x => x.id !== id));
  const gone = store.get('deletedTraces', []);
  const removed = Array.isArray(gone) ? gone : [];
  if (!isMine && removed.indexOf(id) < 0) store.set('deletedTraces', removed.concat([id]));
  undoDel = { id: id, isMine: isMine, rec: rec };
  pendingDel = null;
  renderCalendar.played = true;
  renderCalendar(); renderStats(); renderFilters(); renderTraces(); renderClock();
  toast('已删除这道痕迹', true);
}
function undoDelete(){
  if (!undoDel) return;
  const u = undoDel; undoDel = null;
  if (u.isMine){
    const mine = store.get('traces', []);
    const arr = Array.isArray(mine) ? mine : [];
    if (!arr.some(x => x.id === u.id)) store.set('traces', arr.concat([u.rec]));
  } else {
    const gone = store.get('deletedTraces', []);
    store.set('deletedTraces', (Array.isArray(gone) ? gone : []).filter(x => x !== u.id));
  }
  renderCalendar.played = true;
  renderCalendar(); renderStats(); renderFilters(); renderTraces(); renderClock();
  toast('已撤销，痕迹回到原处');
}
function exportTraces(){
  const list = allTraces();
  const lines = ['# 公考作战台 · 学习痕迹', '', '导出日期：' + full(now()), '考试：' + EX.name + ' · ' + full(EX.date), '共 ' + list.length + ' 条', ''];
  list.forEach(t => {
    lines.push('## ' + t.date + ' · ' + (t.type || '随手记') + ' · ' + t.title, '');
    if (t.body) lines.push(t.body, '');
    if (t.note) lines.push('> 红笔批注：' + t.note, '');
    const meta = [t.questions ? '题量 ' + t.questions : '', t.minutes ? '用时 ' + t.minutes + ' 分钟' : '', typeof t.score === 'number' ? '分数 ' + t.score : '', t.src ? '出处 ' + t.src : ''].filter(Boolean);
    if (meta.length) lines.push('`' + meta.join(' · ') + '`', '');
  });
  const blob = new Blob([lines.join('\n')], {type:'text/markdown;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = '公考作战台-学习痕迹-' + todayKey() + '.md';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  toast('已导出 ' + list.length + ' 条痕迹');
}

/* ---------- 抽屉与弹层（焦点管理适配 shadcn Dialog 模式） ---------- */
let lastFocus = null;
function openLayer(el, trigger){
  lastFocus = trigger || document.activeElement;
  $$('[aria-controls]').forEach(b => { if (b.getAttribute('aria-controls') === el.id) b.setAttribute('aria-expanded','true'); });
  el.classList.add('is-open'); el.setAttribute('aria-hidden','false');
  document.body.style.overflow = 'hidden';
  const f = el.querySelector('input,button,[tabindex]');
  if (f) setTimeout(() => f.focus(), 240);
}
function closeLayer(el){
  el.classList.remove('is-open'); el.setAttribute('aria-hidden','true');
  $$('[aria-controls]').forEach(b => { if (b.getAttribute('aria-controls') === el.id) b.setAttribute('aria-expanded','false'); });
  if (!$$('.modal.is-open,.drawer.is-open').length) document.body.style.overflow = '';
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
let toastTimer;
function toast(msg, canUndo){
  const el = $('#toast');
  el.innerHTML = '<span>' + esc(msg) + '</span>' +
    (canUndo ? '<button class="toast__undo" type="button" id="toastUndo">撤销</button>' : '');
  el.classList.add('is-on');
  const u = $('#toastUndo');
  if (u) u.addEventListener('click', () => { el.classList.remove('is-on'); undoDelete(); });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('is-on'); undoDel = null; }, canUndo ? 5200 : 2500);
}

function openDay(key, trigger){
  const list = allTraces().filter(t => t.date === key);
  const d = parseDT(key + 'T00:00:00');
  $('#drawerTitle').textContent = full(d) + ' · 周' + WEEK[d.getDay()];
  $('#drawerBody').innerHTML = list.length
    ? list.map(t => '<section class="dayitem"><div class="dayitem__t">' + segStr(t.title) + '</div>' +
        (t.body ? '<div class="dayitem__b">' + segStr(t.body) + '</div>' : '') +
        (t.note ? '<div class="dayitem__n">' + segStr(t.note) + '</div>' : '') + '</section>').join('')
    : '<p class="dayempty">这一格还是空的。今天做的事，写下来它就被填上了。</p>';
  $('#drawerBody').insertAdjacentHTML('beforeend',
    '<button class="tbtn tbtn--solid" id="dayAdd" type="button" style="margin-top:18px"><i data-lucide="plus"></i>给这天记一笔</button>');
  $('#dayAdd').addEventListener('click', () => {
    closeLayer($('#drawer'));
    openAdd(trigger, key);
  });
  icons(); openLayer($('#drawer'), trigger);
}
function openRefs(trigger){
  $('#drawerTitle').textContent = '临场锦囊';
  $('#drawerBody').innerHTML = C.quickRefs.map(r =>
    '<section class="ref"><div class="ref__tag">' + segStr(r.tag) + '</div><h3 class="ref__title">' + segStr(r.title) + '</h3>' +
    '<ul>' + r.items.map(x => '<li>' + segStr(x) + '</li>').join('') + '</ul></section>').join('');
  openLayer($('#drawer'), trigger);
}

/* ---------- 表单 ---------- */
let openAdd = function(){};
function initForms(){
  const types = ['刷题','复盘','模考','听课','装工具','用工具','工具落地','随手记','定标'];
  $('#fType').innerHTML = types.map(t => '<option>' + t + '</option>').join('');
  openAdd = (trigger, date) => {
    $('#traceForm').reset(); $('#fDate').value = date || todayKey();
    openLayer($('#traceModal'), trigger);
    setTimeout(() => $('#fTitle').focus(), 260);
  };
  $('#addBtn').addEventListener('click', e => openAdd(e.currentTarget));
  $('#addBtn2').addEventListener('click', e => openAdd(e.currentTarget));
  $('#traceForm').addEventListener('submit', e => {
    e.preventDefault();
    const num = id => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };
    const rec = {
      id: 'me-' + Date.now(), date: $('#fDate').value || todayKey(), type: $('#fType').value,
      title: $('#fTitle').value.trim(), body: $('#fBody').value.trim(), note: $('#fNote').value.trim() || null,
      questions: num('#fQuestions'), minutes: num('#fMinutes'), score: num('#fScore'),
      src: '自己在作战台记的', by: 'me'
    };
    if (!rec.title) return;
    const mine = store.get('traces', []); mine.push(rec); store.set('traces', mine);
    freshId = rec.id; filter = '全部'; keyword = ''; $('#traceSearch').value = '';
    closeLayer($('#traceModal')); renderAll();
    toast('记下了 · 这一格已经填上');
  });

  $('#editExamBtn').addEventListener('click', e => {
    $('#eName').value = EX.name;
    $('#eDate').value = EX.date.getFullYear() + '-' + pad(EX.date.getMonth()+1) + '-' + pad(EX.date.getDate());
    $('#eTime').value = pad(EX.date.getHours()) + ':' + pad(EX.date.getMinutes());
    $('#eStart').value = EX.start.getFullYear() + '-' + pad(EX.start.getMonth()+1) + '-' + pad(EX.start.getDate());
    openLayer($('#examModal'), e.currentTarget);
  });
  $('#examPresets').innerHTML = [30,60,90,120].map(d =>
    '<button class="preset" type="button" data-days="' + d + '">' + d + ' 天后 · ' + md(addDays(now(), d)) + '</button>').join('');
  $$('[data-days]').forEach(b => b.addEventListener('click', () => {
    const d = addDays(now(), Number(b.dataset.days));
    $('#eDate').value = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
    toast('已填好日期，改完名称点确认');
  }));
  $('#examReset').addEventListener('click', () => {
    store.del('exam'); EX = examCfg(); viewMonth = null; closeLayer($('#examModal')); renderCalendar.played = false; renderAll(); toast('已用回默认考试日');
  });
  $('#examForm').addEventListener('submit', e => {
    e.preventDefault();
    const date = $('#eDate').value, time = $('#eTime').value || '09:00', start = $('#eStart').value;
    if (!date || !start) return;
    store.set('exam', {name: $('#eName').value.trim() || C.exam.name, date: date + 'T' + time + ':00', start: start, subtitle: C.exam.subtitle});
    EX = examCfg(); viewMonth = null; closeLayer($('#examModal'));
    renderCalendar.played = false; renderAll(); toast('格历与时间轴已按新考试日重算');
  });
}

/* ---------- 全局 ---------- */
function initGlobal(){
  $('#quoteBtn').addEventListener('click', nextQuote);
  $('#refBtn').addEventListener('click', e => openRefs(e.currentTarget));
  $('#drawerClose').addEventListener('click', () => closeLayer($('#drawer')));
  $('#exportBtn').addEventListener('click', exportTraces);
  initCalNav();
  $('#traceSearch').addEventListener('input', e => { keyword = e.target.value; pendingDel = null; renderTraces(); });
  $$('[data-close]').forEach(b => b.addEventListener('click', () => closeLayer(b.closest('.modal,.drawer'))));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape'){
      $$('.modal.is-open,.drawer.is-open').forEach(closeLayer);
      if (pendingDel){ pendingDel = null; renderTraces(); }
    }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (!typing && (e.key === 'n' || e.key === 'N')){ e.preventDefault(); $('#addBtn').click(); }
    if (!typing && e.key === '/'){ e.preventDefault(); $('#traceSearch').focus(); $('#traces').scrollIntoView({block:'start'}); }
  });
  setInterval(renderClock, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderClock(); });
}

/* ---------- 滚动编排 ---------- */
function initMotion(){
  if (window.gsap && window.ScrollTrigger){
    gsap.registerPlugin(ScrollTrigger);
    const line = document.createElement('div');
    line.style.cssText = 'position:fixed;left:0;top:0;height:2px;width:0;background:var(--red);z-index:40;pointer-events:none';
    document.body.appendChild(line);
    ScrollTrigger.create({start:0, end:'max', onUpdate: self => { line.style.width = (self.progress*100) + '%'; }});
  }
  if (window.Lenis && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    const lenis = new Lenis({duration:.95, smoothWheel:true});
    window.__lenis = lenis;
    if (window.ScrollTrigger) lenis.on('scroll', ScrollTrigger.update);
    (function raf(t){ lenis.raf(t); requestAnimationFrame(raf); })(0);
  }
}

function renderAll(){
  renderClock(); renderCalendar(); renderStats(); renderTasks(); renderAxis(); renderFilters(); renderTraces();
  segmentStatic(); icons();
}

function init(){
  /* 若 HTML 已带静态兜底（不跑 JS 的预览环境也能看完整页面），JS 直接接管，
     不重放首屏逐格淡入，避免先闪一下再出现。 */
  if ($('#calGrid .cell')) renderCalendar.played = true;
  segmentStatic(); initGlobal(); initQuote(); initForms(); renderAll(); initMotion();
  let lastDay = todayKey();
  setInterval(() => { if (todayKey() !== lastDay){ lastDay = todayKey(); renderCalendar.played = false; renderAll(); } }, 60000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
