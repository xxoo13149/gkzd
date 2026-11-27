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
const PUNCT = /^[，。、；：？！）》」』」』%·…—\/\s]+$/;
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
/* 旧数据只有 type 没有 topic/kind：映射成板块+训练类型，保证筛选/标签不空 */
const LEGACY_TOPIC = {'刷题':'全卷综合','听课':'全卷综合','模考':'全卷综合','复盘':'全卷综合',
  '工具落地':'全卷综合','用工具':'全卷综合','装工具':'全卷综合','定标':'全卷综合','随手记':'全卷综合'};
function traceTopic(t){
  if (t.topic) return t.topic;
  return LEGACY_TOPIC[t.type] || '全卷综合';
}
function traceKind(t){
  return t.kind || t.type || '随手记';
}
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

/* ---------- 今日清单（规划 v6：按当天在周期里的位置生成，三档可切） ----------
   周节奏模板为原文；「隔天半组练」按周期第几天的奇偶取、「第 1 周不排软件练」
   （第 1 周 1.2–1.5h ＝ 中午数量＋晚上 1 讲＋睡前，容不下练）这两条是落地时的推断。 */
let tier = 'normal';
function curTier(){
  const t = store.get('tier:' + todayKey(), null);
  return CY.tiers.some(x => x.id === t) ? t : 'normal';
}
function planFor(key){
  const P = CY.weekPlan, d = parseDT(key + 'T00:00:00'), dow = d.getDay(), pos = cyclePos(d);
  const mk = (id, o, text) => ({ id: id, text: text || o.text, min: o.min });
  const out = { tasks: [], empty: false };
  const exam = CY.exams.find(e => e.date === key);
  if (exam) return Object.assign(out, { tasks: P.exam.map((o, i) => mk('exam' + i, o)) });
  if (!pos.inCycle) return Object.assign(out, { empty: true });
  if (tier === 'low') return Object.assign(out, { tasks: P.low.map((o, i) => mk('low' + i, o)) });
  const seg = CY.lectures.find(s => key >= s.from && key <= s.to) || {};
  const extra = CY.extra.filter(e => e.date === key).map(e => e.course);
  const tasks = [], sat = dow === 6, sun = dow === 0, wk = pos.week, good = tier === 'good';
  const lecture = n => mk('lecture', {min: P.lecture.min * n}, P.lecture.text.replace('{n}', n).replace('{course}', seg.course));
  if (seg.kind === 'final'){
    /* 期末块：中午数量照旧；晚上 20 分钟软件练；每周 3 讲（申论 1 + 科学推理 2）按周一/周五科学、周三申论摊开 */
    tasks.push(mk('noon', P.noon), mk('keep', P.keep));
    if (dow === 3) extra.push('申论');
    else if (dow === 1 || dow === 5) extra.push('科学推理');
  } else if (seg.kind === 'buffer'){
    tasks.push(mk('main', P.buffer));
  } else if (seg.kind === 'wrap'){
    tasks.push(mk('a', P.wrapA), mk('b', P.wrapB));
  } else {
    const dbl = !!seg.weekendDouble && (sat || sun);
    if (!sat || good) tasks.push(mk('noon', P.noon));
    if (sat){
      tasks.push(lecture(2), mk('review', P.review));
      if (wk >= 2) tasks.push(mk('drill', P.drillFull));
    } else if (sun){
      tasks.push(lecture(dbl ? 2 : 1), mk('makeup', P.makeup));
    } else {
      tasks.push(lecture(good ? 2 : 1));
      if (wk >= 2 && (good || pos.idx % 2 === 0)) tasks.push(mk('drill', good ? P.drillFull : P.drillHalf));
    }
    if (!sat || good) tasks.push(mk('night', P.night));
    if (dow === 3) extra.push('申论');
    if (dow === 5 && seg.course !== '科学推理') extra.push('科学推理');
  }
  extra.forEach((c, i) => tasks.push({ id: 'extra' + i, text: c + ' 1 讲', min: 55 }));
  return Object.assign(out, { tasks: tasks });
}
function renderTasks(){
  const key = todayKey(), d = now(), pos = cyclePos(d), plan = planFor(key), list = plan.tasks;
  tier = curTier();
  const tkey = 'tasks:' + key;
  const done = store.get(tkey, []), marks = Array.isArray(done) ? done : [];
  const goal = pos.inCycle ? weekGoal(pos.week) : null, t = CY.tiers.find(x => x.id === tier);
  $('#taskTitle').textContent = pos.inCycle ? 'W' + pos.week + ' · 周' + WEEK[d.getDay()] : '今日清单';
  $('#taskRing').textContent = list.length ? marks.filter(id => list.some(x => x.id === id)).length + ' / ' + list.length : '—';
  $('#taskList').innerHTML = list.length ? list.map(x => {
    const on = marks.indexOf(x.id) >= 0;
    return '<li><button class="task' + (on ? ' is-done' : '') + '" type="button" data-task="' + x.id + '" aria-pressed="' + on + '">' +
      '<span class="task__box"></span><span class="task__txt">' + segStr(x.text) + '</span><span class="task__min">' + x.min + ' MIN</span></button></li>';
  }).join('') : '<li class="task-empty">' + (pos.idx < 0 ? '本期 ' + CY_DAYS + ' 天从 ' + md(CY_START) + ' 开始' : '本期已收口') + '</li>';
  $('#tiers').innerHTML = CY.tiers.map(x =>
    '<button class="tier' + (x.id === tier ? ' is-active' : '') + '" type="button" data-tier="' + x.id + '" aria-pressed="' + (x.id === tier) + '">' +
    segStr(x.label) + '<span>' + x.total + '</span></button>').join('');
  $$('#tiers [data-tier]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.tier === tier) return;
    tier = b.dataset.tier; store.set('tier:' + key, tier);
    renderTasks();
    const items = $$('#taskList .task');
    if (window.gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      gsap.from(items, {opacity: 0, y: 6, duration: .26, ease: 'power2.out', stagger: .04, clearProps: 'all'});
  }));
  const foot = $('#taskFoot');
  foot.innerHTML = (plan.empty ? '' : segStr(t.label + '（' + t.total + '）：' + t.split)) +
    (goal ? '<span class="panel__ramp">本周 ' + goal.hours + ' · ' + segStr(goal.goal) + '</span>' : '');
  $$('[data-task]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.task, cur = list.map(x => x.id);
    let m = store.get(tkey, []);
    if (!Array.isArray(m)) m = [];
    const wasFull = cur.every(x => m.indexOf(x) >= 0);
    const on = m.indexOf(id) < 0;
    m = on ? m.concat([id]) : m.filter(x => x !== id);
    store.set(tkey, m);
    btn.classList.toggle('is-done', on);
    btn.setAttribute('aria-pressed', String(on));
    $('#taskRing').textContent = m.filter(x => cur.indexOf(x) >= 0).length + ' / ' + list.length;

    /* 清单全部划掉 = 今天真的留下一道痕迹，写入真实数据，格历/统计/痕迹流同源更新。
       取消勾选时移除这条自动记录，操作可逆，不制造假数据。 */
    const isFull = cur.every(x => m.indexOf(x) >= 0);
    const autoId = 'auto-' + todayKey();
    if (isFull !== wasFull){
      let mine = store.get('traces', []);
      if (!Array.isArray(mine)) mine = [];
      if (isFull){
        if (!mine.some(t => t.id === autoId)) mine.push({
          id: autoId, date: todayKey(), topic: '全卷综合', kind: '随手记', type: '随手记', title: '今日清单全部划掉',
          body: list.map(x => x.text).join('、') + '，都做完了。',
          note: null, questions: null, minutes: null, score: null,
          src: '作战台 · 今日清单自动留痕', by: 'me'
        });
      } else mine = mine.filter(t => t.id !== autoId);
      store.set('traces', mine);
      renderCycle.played = true; renderCalendar.played = true;
      renderCalendar(); renderCycle(); renderStats(); renderFilters(); renderTraces(); renderClock(); renderTrack();
      const cell = $('#calGrid .cell--today');
      if (cell && window.gsap && isFull){
        gsap.fromTo(cell,
          {backgroundColor:'#F4F6F5', boxShadow:'inset 0 0 0 0px rgba(23,70,58,0)'},
          {backgroundColor:'#17463A', boxShadow:'inset 0 0 0 2px rgba(23,70,58,1)', duration:.5, ease:'power2.out', clearProps:'backgroundColor,boxShadow'});
      }
      toast(isFull ? '清单都划掉了，今天这一格已经填上' : '已取消一条勾选，今天这一格回到空格');
    }
  }));
}

/* ---------- 90 天周期（规划 v6） ----------
   记忆点仍是「一格一天」：90 格 = 13 周 × 7 天，一行一周（按 v6 周次，周六起），
   格子状态由 traces 的真实日期驱动；整卷日、块首日、期末周、爬坡目标都落在格子上。 */
const CY = C.cycle;
const CY_START = parseDT(CY.start + 'T00:00:00');
const CY_END = parseDT(CY.end + 'T00:00:00');
const CY_DAYS = dayDiff(CY_END, CY_START) + 1;
const EXAM_N = '①②③④';
function cyclePos(d){
  const idx = dayDiff(d, CY_START);
  return { idx: idx, week: Math.floor(idx / 7) + 1, inCycle: idx >= 0 && idx < CY_DAYS };
}
function blockOf(key){ return CY.blocks.find(b => key >= b.start && key <= b.end) || null; }
/* 周目标：第 1 / 2 周取爬坡曲线；周起始日落在块 B 即「期末」；其余为常态 */
function weekGoal(week){
  const b = blockOf(dateKey(addDays(CY_START, (week - 1) * 7)));
  return CY.ramp.find(r => Array.isArray(r.weeks) ? r.weeks.indexOf(week) >= 0
    : (r.weeks === 'final') === !!(b && b.id === 'B')) || CY.ramp[CY.ramp.length - 1];
}
const isFinalWeek = week => weekGoal(week).weeks === 'final';
const SHORT = { '资料分析': '资', '判断推理': '判', '数量关系': '数', '言语理解': '言', '科学推理': '科', '申论': '申' };
const shortOf = c => SHORT[c] || String(c || '').charAt(0);
function weekRange(week){
  const a = addDays(CY_START, (week - 1) * 7);
  return md(a) + '–' + md(addDays(a, 6));
}

function renderCycle(){
  const g = $('#cycleGrid'); if (!g) return;
  const traceDays = new Set(allTraces().map(t => t.date)), tkey = todayKey(), n = now();
  const exams = {}; CY.exams.forEach(e => { exams[e.date] = e.n; });
  const weeks = Math.ceil(CY_DAYS / 7);
  let html = '<div class="cyc__cor" aria-hidden="true"></div>';
  html += ['六','日','一','二','三','四','五'].map(h => '<div class="cyc__h" aria-hidden="true">' + h + '</div>').join('');
  let passed = 0, marked = 0;
  for (let w = 0; w < weeks; w++){
    const final = isFinalWeek(w + 1), goal = weekGoal(w + 1);
    html += '<div class="cyc__wk' + (final ? ' is-final' : '') + '"><b>W' + (w + 1) + '</b><span>' + weekRange(w + 1) + '</span>' +
      '<em>' + (final ? '期末' : goal.hours) + '</em></div>';
    for (let i = 0; i < 7; i++){
      const idx = w * 7 + i;
      if (idx >= CY_DAYS){ html += '<div class="cyc__day cyc__day--pad" aria-hidden="true"></div>'; continue; }
      const d = addDays(CY_START, idx), k = dateKey(d), dd = dayDiff(d, n);
      const done = traceDays.has(k), today = k === tkey, blk = blockOf(k);
      if (dd < 0) passed++;
      if (done) marked++;
      const cls = ['cyc__day', 'is-b-' + (blk ? blk.id : 'none'),
        done ? 'is-done' : '', today ? 'is-today' : '', dd > 0 ? 'is-future' : 'is-past',
        exams[k] ? 'is-exam' : '', (blk && k === blk.start) ? 'is-first' : ''];
      /* 格子里写当天主讲课：整卷 > 期末 / 缓冲 / 收口 > 主讲（周六与双讲段周日标 ×2）＋ 穿插讲 */
      const seg = CY.lectures.find(x => k >= x.from && k <= x.to) || {};
      const ex = CY.extra.filter(e => e.date === k).map(e => e.course);
      let name = '', short = '';
      /* 周六一律双讲（周节奏模板：周六 2 讲）；周日只在「周末双讲」段双讲 */
      const dbl = (i === 0 && seg.kind === 'main') || (!!seg.weekendDouble && i === 1);
      /* 格内一行 =「日号 + 当天主讲课」，不折行（短文本按钮不允许末行孤字）；
         「双讲」与穿插讲放在 .cyc__x，中窄屏隐藏，最窄屏退成单字简称 */
      let full2 = '';
      if (exams[k]){ name = '整卷 ' + EXAM_N[exams[k] - 1]; short = EXAM_N[exams[k] - 1]; }
      else if (seg.kind === 'final'){ name = '期末'; short = '末'; }
      else if (seg.kind === 'buffer'){ name = '补讲'; full2 = '补讲 / 缓冲'; short = '补'; }
      else if (seg.kind === 'wrap'){ name = 'A4 收口'; full2 = '三张 A4 收口'; short = '收'; }
      else if (seg.course){
        name = seg.course; short = shortOf(seg.course) + (dbl ? '双' : '');
        if (dbl) full2 = seg.course + ' 双讲';
        if (ex.length) full2 = (full2 || seg.course) + ' ＋' + ex.join('／');
      }
      else if (ex.length){ name = ex.join(' / ') + ' 1 讲'; short = ex.map(shortOf).join('/'); }
      const shown = full2 || name;
      const label = full(d) + ' · 第 ' + (idx + 1) + ' 天' + (blk ? ' · ' + blk.label : '') +
        (shown ? '，' + shown : '') + (done ? '，留过痕迹' : '') + (today ? '，今天' : '');
      let body = segStr(name);
      if (full2 !== name && full2){
        /* 把主讲之后的「双讲 / 穿插」包进可隐藏的 .cyc__x */
        const head = segStr(seg.course || name), rest = full2.slice((seg.course || name).length);
        body = head + '<span class="cyc__x">' + segStr(rest) + '</span>';
      }
      html += '<button class="' + cls.join(' ') + '" type="button" data-day="' + k + '" aria-label="' + esc(label) + '">' +
        '<b class="cyc__d">' + d.getDate() + '</b><span class="cyc__c" data-s="' + esc(short) + '">' + body + '</span>' +
        (done ? '<span class="cyc__tick" aria-hidden="true"></span>' : '') + '</button>';
    }
  }
  g.innerHTML = html;
  $$('#cycleGrid [data-day]').forEach(b => b.addEventListener('click', () => openDay(b.dataset.day, b)));

  /* 状态行：全部来自真实日期与痕迹 */
  const p = cyclePos(n);
  const papers = CY.exams.filter(e => dayDiff(parseDT(e.date + 'T00:00:00'), n) < 0).length;
  const goal = p.inCycle ? weekGoal(p.week) : null;
  $('#cycStatus').innerHTML =
    '<span>' + (p.inCycle ? '周期第 <b>' + (p.idx + 1) + '</b> / ' + CY_DAYS + ' 天'
      : p.idx < 0 ? '本期 <b>' + CY_DAYS + '</b> 天还没开始' : '本期已收口') + '</span>' +
    '<span>已过 ' + passed + ' 天 · 留痕 ' + marked + ' 天</span>' +
    (goal ? '<span>本周 W' + p.week + ' · ' + goal.hours + ' · ' + segStr(goal.goal) + '</span>' : '') +
    '<span>整卷 ' + papers + ' / ' + CY.exams.length + ' 次</span>';

  /* 块图例：点一下只看这一块（键盘可达），再点取消 */
  $('#cycBudget').textContent = '时间预算 ' + CY.budget.need + ' / 可用 ' + CY.budget.have + '，余量 ' + CY.budget.left;
  const bl = $('#cycleBlocks');
  if (bl && !bl.dataset.built){
    bl.dataset.built = '1';
    bl.innerHTML = CY.blocks.map(b => '<button class="cycblk" type="button" data-block="' + b.id + '" aria-pressed="false">' +
      '<b>' + b.label + '</b><span>' + md(parseDT(b.start + 'T00:00:00')) + ' → ' + md(parseDT(b.end + 'T00:00:00')) + '</span>' +
      '<span>' + b.lectures + ' 讲</span></button>').join('');
    $$('#cycleBlocks [data-block]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.block, on = btn.getAttribute('aria-pressed') !== 'true';
      $$('#cycleBlocks [data-block]').forEach(x => x.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', String(on));
      g.classList.toggle('is-focus', on);
      g.dataset.focus = on ? id : '';
    }));
  }
  /* 首屏逐格铺开：90 格，总 stagger 恒定 ≤ .5s；带静态兜底时不重放 */
  const cells = $$('#cycleGrid .cyc__day:not(.cyc__day--pad)');
  if (window.gsap && !renderCycle.played && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    renderCycle.played = true;
    gsap.from(cells, {opacity:0, y:6, duration:.36, ease:'power2.out',
      stagger:Math.min(.008, .5 / Math.max(1, cells.length)), clearProps:'all'});
  }
}

/* ---------- 课程总账 / 本期目标（细线表格，数据取 v6 原文） ---------- */
function renderTables(){
  const cs = CY.courses;
  const tot = cs.reduce((a,c) => a + c.total, 0), dn = cs.reduce((a,c) => a + c.done, 0);
  $('#courseTable').innerHTML =
    '<div class="ptable__head"><span>课程总账</span><span class="ptable__sum">' + dn + ' / ' + tot + ' 讲已学 · 剩 ' + (tot - dn) + ' 讲</span></div>' +
    '<table class="ptable"><thead><tr><th>课程</th><th>已学 / 总讲</th><th>剩余</th><th>排期</th></tr></thead><tbody>' +
    cs.map(c => '<tr><th scope="row">' + segStr(c.name) + '<span class="pbar"><i style="width:0%" data-w="' + Math.round(c.done / c.total * 100) + '"></i></span></th>' +
      '<td class="num">' + c.done + ' / ' + c.total + '</td><td class="num">' + (c.total - c.done) + '</td><td>' + segStr(c.plan) + '</td></tr>').join('') +
    '<tr class="is-sum"><th scope="row">合计</th><td class="num">' + dn + ' / ' + tot + '</td><td class="num">' + (tot - dn) + '</td>' +
      '<td>时间预算 ' + CY.budget.need + ' / 可用 ' + CY.budget.have + '，余量 ' + CY.budget.left + '</td></tr></tbody></table>' +
    '<p class="ptable__foot">已学为规划 v6 成文时的口径，不随页面自动变动</p>';
  $('#goalTable').innerHTML =
    '<div class="ptable__head"><span>本期目标</span><span class="ptable__sum">仍然不设分数线、不刷模拟题、不看排名</span></div>' +
    '<table class="ptable"><thead><tr><th>#</th><th>目标</th><th>证据</th></tr></thead><tbody>' +
    CY.goals.map(g => '<tr><td class="num">' + g.n + '</td><th scope="row">' + segStr(g.text) + '</th><td>' + segStr(g.proof) + '</td></tr>').join('') +
    '</tbody></table>';
  /* 进度条：进入视口后从 0 长到真实比例（无 GSAP / 减少动态时直接到位） */
  $$('[data-w]').forEach(el => {
    const w = el.dataset.w + '%';
    if (!window.gsap || !window.ScrollTrigger || window.matchMedia('(prefers-reduced-motion: reduce)').matches){ el.style.width = w; return; }
    gsap.to(el, {width: w, duration:.9, ease:'power2.out',
      scrollTrigger:{trigger: el, start:'top 92%', once: true}});
  });
}

/* ---------- 限时练得分率轨道（数据 = 痕迹里带得分的限时记录） ---------- */
function trackPoints(){
  return allTraces().filter(t => typeof t.score === 'number' && !isNaN(t.score))
    .filter(t => ['限时真题', '套卷', '诊断基线'].indexOf(traceKind(t)) >= 0)
    .slice().sort((a,b) => a.date.localeCompare(b.date)).slice(-8);
}
function renderTrack(){
  const box = $('#scoreTrack'); if (!box) return;
  const pts = trackPoints(), lo = 50, hi = 100, last = pts[pts.length - 1];
  $('#scoreGap').textContent = pts.length ? '最近 ' + last.score + '% · ' + md(parseDT(last.date + 'T00:00:00')) : '还没有限时记录';
  if (pts.length < 2){
    box.innerHTML = '<p class="track__empty">做过限时练后，这里会按日期画出得分率</p>';
    $('#scoreNow').textContent = ''; $('#scoreTarget').textContent = CY.target + '% 线 · 连续 3 次 ≥80%';
    return;
  }
  const X = i => 4 + i * 92 / (pts.length - 1);              // 留 4% 边距，点不被裁
  const Y = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  const line = pts.map((p, i) => X(i).toFixed(2) + ',' + (100 - Y(p.score)).toFixed(2)).join(' ');
  const refTop = 100 - Y(CY.target);
  box.innerHTML =
    '<span class="track__ref" style="top:' + refTop + '%"><i></i>' + CY.target + '%</span>' +
    '<svg class="track__line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + line + '"/></svg>' +
    pts.map((p, i) => '<span class="track__pt' + (p.score >= CY.target ? ' is-ok' : '') + (i === pts.length - 1 ? ' is-last' : '') + '"' +
      ' style="left:' + X(i) + '%;top:' + (100 - Y(p.score)) + '%"' +
      ' title="' + md(parseDT(p.date + 'T00:00:00')) + ' · ' + p.score + '% · ' + esc(traceTopic(p)) + '"' +
      ' aria-label="' + md(parseDT(p.date + 'T00:00:00')) + '，' + p.score + '%"></span>').join('') +
    '<span class="track__lab" style="left:4%">' + md(parseDT(pts[0].date + 'T00:00:00')) + '</span>' +
    '<span class="track__lab" style="left:96%">' + md(parseDT(last.date + 'T00:00:00')) + '</span>';
  if (window.gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    const pl = box.querySelector('polyline'), len = pl.getTotalLength();
    gsap.fromTo(pl, {strokeDasharray: len, strokeDashoffset: len}, {strokeDashoffset: 0, duration: .9, ease: 'power2.out'});
    gsap.from(box.querySelectorAll('.track__pt'), {opacity: 0, scale: .4, duration: .3, ease: 'power2.out',
      stagger: .07, clearProps: 'opacity,transform'});
  }
  $('#scoreNow').textContent = traceTopic(last) + ' · ' + md(parseDT(last.date + 'T00:00:00'));
  $('#scoreTarget').textContent = '实心 = ≥' + CY.target + '% · 空心 = 未到';
}

/* ---------- 排期节点（规划 v6 的绝对日期） ---------- */
const msDate = m => parseDT(m.date + 'T00:00:00');
function nextMilestone(){
  for (const m of C.milestones) if (dayDiff(msDate(m), now()) >= 0) return m;
  return C.milestones[C.milestones.length - 1];
}
function renderAxis(){
  const m = nextMilestone(), dt = msDate(m), left = dayDiff(dt, now());
  const blk = CY.blocks.find(b => b.id === m.block);
  $('#nextLabel').textContent = m.label;
  $('#nextDesc').innerHTML = segStr(m.desc);
  $('#nextDate').textContent = full(dt);
  $('#nextLeft').textContent = left > 0 ? '还有 ' + left + ' 天' : left === 0 ? '就是今天' : '本期已过';
  $('#nextBlock').textContent = blk ? blk.label + ' · ' + md(parseDT(blk.start + 'T00:00:00')) + ' → ' + md(parseDT(blk.end + 'T00:00:00')) : '';

  const done = store.get('milestones', []), nx = nextMilestone(), t = now();
  const marks = (Array.isArray(done) ? done : []).map(String).filter(x => C.milestones.some(y => y.id === x));
  $('#milestoneList').innerHTML = C.milestones.map(x => {
    const d = msDate(x), passed = dayDiff(d, t) < 0, ok = marks.indexOf(x.id) >= 0;
    const isNext = x.id === nx.id && !passed;
    const cls = [passed ? 'is-past' : '', isNext ? 'is-next' : ''].filter(Boolean).join(' ');
    return '<li class="' + cls + '"><div class="axis__d">' + segStr('块 ' + x.block) + '</div><div class="axis__date">' + md(d) + '</div>' +
      '<div class="axis__label">' + segStr(x.label) + '</div><p class="axis__desc">' + segStr(x.desc) + '</p>' +
      '<button class="axis__btn' + (ok ? ' is-done' : '') + '" type="button" data-ms="' + x.id + '" aria-pressed="' + ok + '">' +
      '<i data-lucide="' + (ok ? 'check' : 'circle') + '"></i>' + (ok ? '已过' : '标完成') + '</button></li>';
  }).join('');
  $$('[data-ms]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.ms;
    let cur = (Array.isArray(store.get('milestones', [])) ? store.get('milestones', []) : []).map(String).filter(x => C.milestones.some(y => y.id === x));
    const on = cur.indexOf(id) < 0;
    store.set('milestones', on ? cur.concat([id]) : cur.filter(x => x !== id));
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
function matchFilter(t){
  if (filter === '全部') return true;
  if (filter.indexOf('topic:') === 0) return traceTopic(t) === filter.slice(6);
  if (filter.indexOf('kind:') === 0) return traceKind(t) === filter.slice(5);
  /* 兼容旧的单值筛选（外部若直接设了旧 type） */
  return traceKind(t) === filter || traceTopic(t) === filter;
}
function renderFilters(){
  const topics = (C.taxonomy && C.taxonomy.topics) || [];
  const kinds = (C.taxonomy && C.taxonomy.kinds) || [];
  const useTopics = Array.from(new Set(allTraces().map(traceTopic).filter(Boolean)));
  const useKinds = Array.from(new Set(allTraces().map(traceKind).filter(Boolean)));
  const topicList = topics.filter(x => useTopics.indexOf(x) >= 0).concat(useTopics.filter(x => topics.indexOf(x) < 0));
  const kindList = kinds.filter(x => useKinds.indexOf(x) >= 0).concat(useKinds.filter(x => kinds.indexOf(x) < 0));
  const chips = ['全部']
    .concat(topicList.map(x => 'topic:' + x))
    .concat(kindList.map(x => 'kind:' + x));
  if (chips.indexOf(filter) < 0) filter = '全部';
  const label = f => f === '全部' ? '全部' : f.slice(f.indexOf(':') + 1);
  const dim = f => f.indexOf('topic:') === 0 ? 'topic' : f.indexOf('kind:') === 0 ? 'kind' : '';
  $('#traceFilters').innerHTML = chips.map(f =>
    '<button class="chip' + (f === filter ? ' is-active' : '') + (dim(f) ? ' chip--' + dim(f) : '') + '" type="button" data-filter="' + esc(f) + '" data-dim="' + dim(f) + '">' + segStr(label(f)) + '</button>').join('');
  $$('[data-filter]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.filter; pendingDel = null; renderFilters(); renderTraces(); }));
}
function renderTraces(){
  let list = allTraces().filter(matchFilter);
  if (keyword.trim()){
    const k = keyword.trim().toLowerCase();
    list = list.filter(t => [t.title,t.body,t.note,t.src,traceTopic(t),traceKind(t),t.date].join(' ').toLowerCase().indexOf(k) >= 0);
  }
  $('#traceEmpty').hidden = list.length > 0;
  $('#traceList').innerHTML = list.map(t => {
    const d = parseDT(t.date + 'T00:00:00');
    const nums = [t.questions ? t.questions + ' 题' : '', t.minutes ? t.minutes + ' 分钟' : '', typeof t.score === 'number' ? t.score + ' 分' : ''].filter(Boolean).join(' · ');
    const by = t.by === 'ai' ? 'AI 代记' : t.by === 'me' ? '自己记的' : '知识库';
    return '<li class="trace"><div class="trace__when"><div class="trace__date">' + md(d) + '</div>' +
      '<div class="trace__week">' + d.getFullYear() + ' / 周' + WEEK[d.getDay()] + '</div></div>' +
      '<article class="trace__card' + (t.id === freshId ? ' is-fresh' : '') + (pendingDel === t.id ? ' is-deleting' : '') + '">' +
        '<div class="trace__top"><span class="trace__type">' + segStr(traceTopic(t)) + '</span>' +
          '<span class="trace__kind">' + segStr(traceKind(t)) + '</span>' +
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
  renderCalendar(); renderCycle(); renderStats(); renderFilters(); renderTraces(); renderClock(); renderTrack();
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
  renderCalendar(); renderCycle(); renderStats(); renderFilters(); renderTraces(); renderClock(); renderTrack();
  toast('已撤销，痕迹回到原处');
}
function exportTraces(){
  const list = allTraces();
  const lines = ['# 公考作战台 · 学习痕迹', '', '导出日期：' + full(now()), '考试：' + EX.name + ' · ' + full(EX.date), '共 ' + list.length + ' 条', ''];
  list.forEach(t => {
    lines.push('## ' + t.date + ' · ' + traceTopic(t) + ' · ' + traceKind(t) + ' · ' + t.title, '');
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
  const topics = (C.taxonomy && C.taxonomy.topics) || ['全卷综合'];
  const kinds = (C.taxonomy && C.taxonomy.kinds) || ['随手记'];
  $('#fType').innerHTML = topics.map(t => '<option>' + t + '</option>').join('');
  $('#fKind').innerHTML = kinds.map(t => '<option>' + t + '</option>').join('');
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
    const tp = $('#fType').value, kd = $('#fKind').value;
    const rec = {
      id: 'me-' + Date.now(), date: $('#fDate').value || todayKey(), topic: tp, kind: kd, type: kd,
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
  ['#refBtn', '#refBtn2'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', e => openRefs(e.currentTarget)); });
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
  renderClock(); renderCalendar(); renderCycle(); renderStats(); renderTasks(); renderAxis(); renderTrack(); renderFilters(); renderTraces();
  segmentStatic(); icons();
}

function init(){
  /* 若 HTML 已带静态兜底（不跑 JS 的预览环境也能看完整页面），JS 直接接管，
     不重放首屏逐格淡入，避免先闪一下再出现。 */
  if ($('#calGrid .cell')) renderCalendar.played = true;
  if ($('#cycleGrid .cyc__day')) renderCycle.played = true;
  segmentStatic(); initGlobal(); initQuote(); initForms(); renderAll(); renderTables(); initMotion();
  let lastDay = todayKey();
  setInterval(() => { if (todayKey() !== lastDay){ lastDay = todayKey(); renderCalendar.played = false; renderAll(); } }, 60000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
