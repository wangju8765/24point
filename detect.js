// ============================================================
// 能力检测模块 v2：难度分析 + 事件记录 + 检测模式 + 真实评分
// ============================================================

// ===================== 难度分析 ===========================

function countIntSolutions(n, path = [], visited = new Set()) {
  if (n.length === 1) {
    if (Math.abs(n[0] - 24) < 1e-4) {
      const key = path.map(x => {
        if (x.op === '+' || x.op === '×') {
          const s = [x.a, x.b].sort((a, b) => a - b);
          return s[0] + x.op + s[1];
        }
        return Math.max(x.a, x.b) + x.op + Math.min(x.a, x.b);
      }).join('→');
      visited.add(key);
      return 1;
    }
    return 0;
  }
  let solutions = 0;
  for (let i = 0; i < n.length; i++)
    for (let j = i + 1; j < n.length; j++) {
      const rem = n.filter((_, k) => k !== i && k !== j),
        a = n[i], b = n[j];
      for (const r of [a + b, a * b, Math.max(a, b) - Math.min(a, b)])
        solutions += countIntSolutions([...rem, r], [...path, { op: '?', a, b }], visited);
      const mn = Math.min(a, b), mx = Math.max(a, b);
      if (mn && mx % mn === 0)
        solutions += countIntSolutions([...rem, mx / mn], [...path, { op: '?', a: mx, b: mn }], visited);
    }
  return solutions;
}

function difficultyStars(nums) {
  const v = new Set();
  const c = countIntSolutions(nums, [], v);
  if (c === 0) return 0;
  if (c >= 15) return 1;
  if (c >= 8) return 2;
  if (c >= 4) return 3;
  if (c >= 2) return 4;
  return 5;
}

function genProblem(target) {
  const max = target >= 4 ? 13 : 10;
  for (let t = 0; t < 2000; t++) {
    const n = [1 + Math.random() * max | 0, 1 + Math.random() * max | 0, 1 + Math.random() * max | 0, 1 + Math.random() * max | 0];
    const s = difficultyStars(n);
    if (s > 0 && s === target) return n;
  }
  for (let t = 0; t < 1000; t++) {
    const n = [1 + Math.random() * max | 0, 1 + Math.random() * max | 0, 1 + Math.random() * max | 0, 1 + Math.random() * max | 0];
    const s = difficultyStars(n);
    if (s > 0 && Math.abs(s - target) <= 1) return n;
  }
  const fallback = { 1:[1,2,3,4], 2:[1,2,3,5], 3:[3,4,5,6], 4:[2,7,8,9] };
  return fallback[target] || [1,2,3,4];
}

function buildProblemMix() {
  const mix = [];
  [[1,2],[2,2],[3,2],[4,2]].forEach(([star, cnt]) => {
    for (let i = 0; i < cnt; i++) mix.push({ numbers: genProblem(star), stars: star });
  });
  return mix;
}

// ===================== 事件记录 ===========================

const eventLog = [];
function log(type, data) { eventLog.push({ ts: Date.now(), type, ...data }); }

function installEventHooks() {
  if (window._hooksInstalled) return;
  window._hooksInstalled = true;

  const _showBubbles = window.showBubbles;
  window.showBubbles = function(a, b) {
    const dc = getCardState(a), tc = getCardState(b);
    if (dc && tc) log('bubble_show', { a: dc.value, b: tc.value });
    _showBubbles(a, b);
  };

  // hideBubbles 被渲染和重置时频繁调用，不记录日志避免噪声

  const _performMerge = window.performMerge;
  window.performMerge = function(a, b, op, result, label) {
    const dc = getCardState(a), tc = getCardState(b);
    log('merge', { op, a: dc ? dc.value : null, b: tc ? tc.value : null });
    _performMerge(a, b, op, result, label);
  };

  const _undo = window.undo;
  window.undo = function() {
    log('undo', {});
    _undo();
  };
}

// ===================== 检测模式 ===========================

var detect = { active: false, probs: [], idx: 0, phase: 'idle', total: 8 };

function startDetection() {
  if (!window._detectInitDone) {
    if (typeof init === 'function') init();
    window._detectInitDone = true;
  }
  installEventHooks();
  eventLog.length = 0;
  log('detect_start', { total: 8 });
  detectShowUI(true);
  detect.active = true;
  detect.probs = buildProblemMix();
  detect.idx = 0;
  detect.phase = 'playing';
  setupProgressUI();
  startProblem(0);
}

function detectShowUI(hide) {
  document.querySelectorAll('#think-group,#mode-group,#rule-group,#new-game-btn')
    .forEach(el => { if (el) el.classList.toggle('detect-hide', hide); });
}

function setupProgressUI() {
  let bar = document.getElementById('detect-progress');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'detect-progress';
    bar.innerHTML = '<div class="dp-bar"><div class="dp-fill"></div></div><div class="dp-text">0/' + detect.total + '</div>';
    const controls = document.getElementById('controls');
    const app = document.getElementById('app');
    if (controls) app.insertBefore(bar, controls);
    else app.appendChild(bar);
  }
  bar.style.display = 'flex';
}

function updateProgress() {
  const bar = document.getElementById('detect-progress');
  if (!bar) return;
  const done = detect.probs.filter(p => p.solved).length;
  bar.querySelector('.dp-fill').style.width = (done / detect.probs.length * 100) + '%';
  bar.querySelector('.dp-text').textContent = done + '/' + detect.probs.length;
}

function startProblem(i) {
  if (i >= detect.probs.length) { finishDetection(); return; }
  detect.idx = i;
  const p = detect.probs[i];
  closeModal('win-modal');
  closeModal('hint-modal');
  for (const k in mergeParents) delete mergeParents[k];
  state.history = []; state.steps = 0; state.gameOver = false;
  state.mode = 'easy'; state.rule = 'int'; state.thinkMode = 'fast';
  state.draggedCard = null; state.targetCard = null; state.lockedCard = null;
  hideBubbles();
  const rect = cardContainer.getBoundingClientRect();
  const cw = rect.width || 340, ch = rect.height || 450;
  const pos = computeCardPositions(4, CARD_W, CARD_H, cw, ch);
  const nums = p.numbers;
  state.initialPuzzle = [...nums];
  state.cards = nums.map((v, i) => ({ id: state.nextId++, value: v, history: '', x: pos[i].x, y: pos[i].y, colorIdx: i, entering: true }));
  renderGame(true);
  startTimer();
  updateStatus();
  updateProgress();
  log('problem_start', { numbers: nums, stars: p.stars, index: i });
}

function afterProblemSolved() {
  if (!detect.active || detect.phase !== 'playing') return;
  const p = detect.probs[detect.idx];
  if (p) { p.solved = true; p.actualSteps = state.steps; p.totalTime = getElapsedSeconds(); }
  log('problem_solved', { steps: state.steps, time: getElapsedSeconds() });
  updateProgress();
  startProblem(detect.idx + 1);
}

function uploadDetectionData() {
  const data = {
    problems: detect.probs.map(p => ({ numbers: p.numbers, stars: p.stars, solved: !!p.solved })),
    events: eventLog,
    time: Date.now(),
    userAgent: navigator.userAgent || ''
  };
  const SU = 'https://pkxmsfyzcphzvuangrzs.supabase.co';
  const SK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBreG1zZnl6Y3BoenZ1YW5ncnpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNDkxNzcsImV4cCI6MjA5NDYyNTE3N30.K1_niR4ZylqzbDPFnmTs5HRo2aEbObkGw3V9clM1czo';
  fetch(SU + '/rest/v1/feedback', {
    method: 'POST',
    headers: { 'apikey': SK, 'Authorization': 'Bearer ' + SK, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ name: '_detect_', text: JSON.stringify(data), time: Date.now() })
  }).catch(function(e) { console.log('Upload failed:', e); });
}

function finishDetection() {
  detect.phase = 'report';
  const bar = document.getElementById('detect-progress');
  if (bar) bar.style.display = 'none';
  log('detect_end', {});
  uploadDetectionData();
  try {
    showReport(computeReport());
  } catch(e) {
    console.error('Report error:', e.message);
    showReport({
      solved: detect.probs.filter(p => p.solved).length,
      total: detect.probs.length, avgTime: null, totalUndos: 0,
      totalMerges: 0, totalExplores: 0, slowestIdx: -1, slowestTime: 0,
      patterns: ['⚠️ 报告计算遇到错误，请重试'],
      speedRank: '数据不足', speedEmoji: '⏳',
      rawAnalysis: [], rawProblems: detect.probs, rawEvents: []
    });
  }
}

// ===================== 评分引擎 v3（链式分析）===========================

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// 按题目拆分事件链
function splitEventsByProblem(events) {
  const problems = [];
  let current = [];
  events.forEach(e => {
    if (e.type === 'problem_start') {
      if (current.length > 0) problems.push(current);
      current = [e];
    } else if (current.length > 0) {
      current.push(e);
    }
  });
  if (current.length > 0) problems.push(current);
  return problems;
}

// 从事件链中提取一道题的关键指标
function analyzeProblem(evts) {
  const pStart = evts[0];
  const merges = evts.filter(e => e.type === 'merge');
  const undos = evts.filter(e => e.type === 'undo');
  const bubbles = evts.filter(e => e.type === 'bubble_show');
  const solved = evts.some(e => e.type === 'problem_solved');
  const pEnd = evts[evts.length - 1];
  const totalTime = solved ? ((pEnd.ts - pStart.ts) / 1000) : null;

  // 首次操作时间（策略快慢）
  const firstAction = evts.slice(1).find(e => e.type === 'merge' || e.type === 'bubble_show');
  const firstActionTime = firstAction ? ((firstAction.ts - pStart.ts) / 1000) : null;

  // 探索了多少对组合
  const uniquePairs = new Set();
  bubbles.forEach(b => {
    if (b.a != null && b.b != null) uniquePairs.add([Math.min(b.a, b.b), Math.max(b.a, b.b)].join(','));
  });

  // 看单次选择到执行的平均时间（排除300ms以下的误触和10s以上的断开）
  const dwells = [];
  bubbles.forEach(b => {
    const nextMerge = evts.slice(evts.indexOf(b) + 1).find(e => e.type === 'merge' && e.a === b.a && e.b === b.b);
    if (nextMerge) {
      const dw = nextMerge.ts - b.ts;
      if (dw > 200 && dw < 8000) dwells.push(dw);
    }
  });
  const avgDwell = dwells.length > 0 ? dwells.reduce((a, b) => a + b, 0) / dwells.length : null;

  // 思路转换：bubble_show改变了方向（与上一个bubble不同对）
  let switches = 0;
  for (let i = 1; i < bubbles.length; i++) {
    if (bubbles[i].a !== bubbles[i-1].a || bubbles[i].b !== bubbles[i-1].b) switches++;
  }

  return {
    solved,
    totalTime: totalTime ? Math.round(totalTime) : null,
    mergeCount: merges.length,
    undoCount: undos.length,
    exploreCount: uniquePairs.size,
    firstActionTime: firstActionTime !== null ? Math.round(firstActionTime * 10) / 10 : null,
    avgDwell: avgDwell !== null ? Math.round(avgDwell) : null,
    switchCount: switches
  };
}

function computeReport() {
  const ev = eventLog;
  if (ev.length < 3) return dummyReport();

  const problems = splitEventsByProblem(ev);
  const analysis = problems.map(analyzeProblem);

  const total = detect.probs.length;
  const solved = analysis.filter(a => a.solved).length;
  const solvedItems = analysis.filter(a => a.solved);
  const unsolvedItems = analysis.filter(a => !a.solved);

  // 基础统计
  const avgTime = solvedItems.length > 0
    ? Math.round(solvedItems.reduce((s, a) => s + a.totalTime, 0) / solvedItems.length)
    : null;
  const totalUndos = analysis.reduce((s, a) => s + a.undoCount, 0);
  const totalMerges = analysis.reduce((s, a) => s + a.mergeCount, 0);
  const totalExplores = analysis.reduce((s, a) => s + a.exploreCount, 0);

  // 找最慢和最难的题
  let slowestIdx = -1, slowestTime = 0;
  let mostUndoIdx = -1, mostUndo = 0;
  analysis.forEach((a, i) => {
    if (a.solved && a.totalTime > slowestTime) { slowestTime = a.totalTime; slowestIdx = i; }
    if (a.undoCount > mostUndo) { mostUndo = a.undoCount; mostUndoIdx = i; }
  });

  // 识别观察到的模式
  const patterns = [];

  // 模式1：沉思型（firstAction慢但全部解出）
  const avgFirstTime = solvedItems.length > 0
    ? solvedItems.reduce((s, a) => s + a.firstActionTime, 0) / solvedItems.length
    : 0;
  if (avgFirstTime > 5) patterns.push('🧠 偏好深思型：看牌后平均' + Math.round(avgFirstTime) + '秒才动手，倾向于在脑中算完再操作');
  if (avgFirstTime < 2) patterns.push('⚡ 反应型选手：看牌后快速动手，边操作边探索');

  // 模式2：探索范围
  const avgExplore = analysis.length > 0 ? totalExplores / analysis.length : 0;
  if (avgExplore > 6) patterns.push('🔍 探索范围广：每题平均探索' + Math.round(avgExplore) + '种组合，尝试不同路径');
  if (avgExplore < 3) patterns.push('🎯 目标明确：每题只探索少量组合，直奔解法');

  // 模式3：退回频率
  if (totalUndos === 0) patterns.push('✅ 零退回：整轮检测没撤销过操作，精度极高');
  else if (totalUndos <= 2) patterns.push('👍 退回很少：偶尔调整，整体操作流畅');
  else patterns.push('🔄 退回偏多：共撤销' + totalUndos + '次，可能需要加强计算准确性');

  // 模式4：未解出题
  const unsolvedCount = total - solved;
  if (unsolvedCount > 0) {
    const unsolvedStars = unsolvedItems.map((a, i) => detect.probs[analysis.indexOf(a)]).filter(Boolean);
    const stars = unsolvedStars.map(p => '★'.repeat(p.stars)).join('、');
    patterns.push('❌ 未解出' + unsolvedCount + '题（难度：' + stars + '），这些难点需要针对性练习');
  }

  // 速度评级
  let speedRank, speedEmoji;
  if (avgTime === null) { speedRank = '数据不足'; speedEmoji = '⏳'; }
  else if (avgTime < 5) { speedRank = '闪电速算'; speedEmoji = '⚡'; }
  else if (avgTime < 10) { speedRank = '反应敏捷'; speedEmoji = '🔥'; }
  else if (avgTime < 20) { speedRank = '稳健准确'; speedEmoji = '💪'; }
  else if (avgTime < 35) { speedRank = '需要提速'; speedEmoji = '🐢'; }
  else { speedRank = '练习不足'; speedEmoji = '🌱'; }

  return {
    solved, total, avgTime, totalUndos, totalMerges, totalExplores,
    slowestIdx, slowestTime,
    patterns,
    speedRank: speedRank + ' 平均每题' + (avgTime || '?') + '秒',
    speedEmoji,
    rawAnalysis: analysis,
    rawProblems: detect.probs,
    rawEvents: ev
  };
}

function dummyReport() {
  return {
    solved: 0, total: 8, avgTime: null, totalUndos: 0, totalMerges: 0, totalExplores: 0,
    slowestIdx: -1, slowestTime: 0,
    patterns: ['⏳ 检测数据不足，请完成检测后再查看'],
    speedRank: '数据不足', speedEmoji: '⏳',
    rawAnalysis: [], rawProblems: [], rawEvents: []
  };
}

function renderStars(n) {
  var s = '';
  for (var i = 0; i < n; i++) s += '★';
  return s;
}

function escapeHtml(t) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(t));
  return d.innerHTML;
}

function showReport(r) {
  var m = document.getElementById('report-modal');
  if (!m) return;
  m.style.display = 'flex';

  // 每道题的时间条
  var problemBars = '';
  if (r.rawProblems && r.rawAnalysis) {
    for (var i = 0; i < r.rawProblems.length; i++) {
      var p = r.rawProblems[i];
      var a = r.rawAnalysis[i] || {};
      var stars = renderStars(p.stars);
      var solvedMark = a.solved ? '✅' : '❌';
      var timeStr = a.totalTime ? a.totalTime + '秒' : '—';
      var undoStr = a.undoCount > 0 ? ('  ↩' + a.undoCount) : '';
      var maxTime = r.slowestTime > 0 ? r.slowestTime : 30;
      var barW = a.totalTime ? Math.min(100, (a.totalTime / maxTime) * 100) : 0;
      var barColor = a.solved ? (barW > 70 ? '#f59e0b' : '#10b981') : '#ef4444';
      problemBars += '<div class="pb-row"><div class="pb-label">第' + (i+1) + '题 ' + stars + '</div><div class="pb-bar"><div class="pb-fill" style="width:' + barW + '%;background:' + barColor + '"></div></div><div class="pb-info">' + solvedMark + ' ' + timeStr + undoStr + '</div></div>';
    }
  }

  // 模式列表
  var patternList = (r.patterns || []).map(function(p) {
    return '<div class="pat-item">' + p + '</div>';
  }).join('');

  m.querySelector('.report-body').innerHTML = '<div class="report-header"><div class="report-rank">' + r.speedEmoji + ' ' + r.speedRank + '</div><div class="report-score">完成 ' + r.solved + '/' + r.total + ' 题</div></div><div class="report-stats"><span>⏱ 平均每题 ' + (r.avgTime || '?') + '秒</span><span>🔄 撤销 ' + r.totalUndos + '次</span></div><div class="report-section"><div class="sec-title">📋 每题表现</div>' + problemBars + '</div><div class="report-section"><div class="sec-title">🔍 行为模式分析</div>' + patternList + '</div><div class="report-section" id="ai-analysis-section" style="display:none"><div class="sec-title">🤖 AI 深度分析</div><div id="ai-analysis-content" class="ai-content"></div></div>';

  // 触发异步 AI 分析
  triggerAIAnalysis();
}

function reportClose() {
  var m = document.getElementById('report-modal');
  m.style.display = 'none';
  detectShowUI(false);
  detect.active = false;
  detect.phase = 'idle';
  document.getElementById('mode-screen').style.display = 'flex';
}

// ===================== AI 深度分析（异步） ===========================

function triggerAIAnalysis() {
  // 构造简化的分析数据
  var data = {
    problems: detect.probs.map(function(p, i) {
      var a = analyzeProblem(splitEventsByProblem(eventLog)[i] || []);
      return {
        numbers: p.numbers,
        stars: p.stars,
        solved: a.solved,
        time: a.totalTime,
        undos: a.undoCount,
        explores: a.exploreCount,
        firstAction: a.firstActionTime
      };
    }),
    events: eventLog,
    time: Date.now()
  };

  // 提交到 Supabase 等待处理
  var SU = 'https://pkxmsfyzcphzvuangrzs.supabase.co';
  var SK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBreG1zZnl6Y3BoenZ1YW5ncnpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNDkxNzcsImV4cCI6MjA5NDYyNTE3N30.K1_niR4ZylqzbDPFnmTs5HRo2aEbObkGw3V9clM1czo';
  var id = Date.now();

  fetch(SU + '/rest/v1/feedback', {
    method: 'POST',
    headers: { 'apikey': SK, 'Authorization': 'Bearer ' + SK, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ name: '_detect_waiting', text: JSON.stringify(data), time: id })
  }).then(function() {
    console.log('AI analysis submitted, id:', id);
    // 开始轮询结果
    pollAIResult(id);
  }).catch(function(e) {
    console.log('Submit failed:', e);
  });
}

function pollAIResult(id) {
  var section = document.getElementById('ai-analysis-section');
  var content = document.getElementById('ai-analysis-content');
  if (!section || !content) return;

  content.innerHTML = '<div class="ai-loading">🤔 正在分析你的计算模式…</div>';
  section.style.display = 'block';

  var maxAttempts = 30;
  var attempt = 0;

  function check() {
    attempt++;
    if (attempt > maxAttempts) {
      content.innerHTML = '<div class="ai-error">⏳ 分析超时，请稍后重试</div>';
      return;
    }

    var SU = 'https://pkxmsfyzcphzvuangrzs.supabase.co';
    var SK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBreG1zZnl6Y3BoenZ1YW5ncnpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNDkxNzcsImV4cCI6MjA5NDYyNTE3N30.K1_niR4ZylqzbDPFnmTs5HRo2aEbObkGw3V9clM1czo';

    fetch(SU + '/rest/v1/feedback?select=text&name=eq._detect_result&order=time.desc&limit=1', {
      headers: { 'apikey': SK, 'Authorization': 'Bearer ' + SK }
    }).then(function(r) { return r.json(); }).then(function(records) {
      if (records && records.length > 0) {
        try {
          var result = JSON.parse(records[0].text);
          if (result.requestId === id) {
            // 匹配到我们的分析结果
            content.innerHTML = '<div class="ai-text">' + result.analysis + '</div>';
            if (result.suggestions) {
              content.innerHTML += '<div class="ai-suggestions"><div class="sec-title" style="margin-top:12px;font-size:13px">💡 练习建议</div>' +
                result.suggestions.map(function(s) { return '<div class="ai-suggestion">' + s + '</div>'; }).join('') + '</div>';
            }
            return;
          }
        } catch(e) { console.log('Parse error:', e); }
      }
      setTimeout(check, 2000);
    }).catch(function() { setTimeout(check, 2000); });
  }

  check();
}
