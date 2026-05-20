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

var _lastBubble = null; // { a, b, ts } when bubble is shown
var _mergeInProgress = false; // flag to skip dismiss log after merge

function installEventHooks() {
  if (window._hooksInstalled) return;
  window._hooksInstalled = true;

  // bubble_show：记录显示的组合和时间
  const _showBubbles = window.showBubbles;
  window.showBubbles = function(a, b) {
    const dc = getCardState(a), tc = getCardState(b);
    if (dc && tc) {
      log('bubble_show', { a: dc.value, b: tc.value });
      _lastBubble = { a: dc.value, b: tc.value, ts: Date.now() };
    }
    _showBubbles(a, b);
  };

  // hideBubbles：记录放弃当前组合（排除 merge 后的自动清理）
  const _hideBubbles = window.hideBubbles;
  window.hideBubbles = function() {
    if (_lastBubble && !_mergeInProgress && detect.active && detect.phase === 'playing') {
      var dwell = Date.now() - _lastBubble.ts;
      log('bubble_dismiss', { a: _lastBubble.a, b: _lastBubble.b, dwellMs: dwell });
    }
    _lastBubble = null;
    _mergeInProgress = false;
    _hideBubbles();
  };

  // merge：记录合并，清除 bubble 状态
  const _performMerge = window.performMerge;
  window.performMerge = function(a, b, op, result, label) {
    const dc = getCardState(a), tc = getCardState(b);
    log('merge', { op, a: dc ? dc.value : null, b: tc ? tc.value : null });
    _lastBubble = null;
    _mergeInProgress = true; // 接下来的 hideBubbles 由 merge 触发，不视为放弃
    _performMerge(a, b, op, result, label);
  };

  const _undo = window.undo;
  window.undo = function() {
    log('undo', {});
    _undo();
  };

  // 提示按钮 hook：记录点击提示
  var hintBtn = document.getElementById('hint-btn');
  if (hintBtn && !hintBtn._detectHook) {
    hintBtn._detectHook = true;
    var _origHintClick = hintBtn.onclick;
    hintBtn.onclick = function() {
      if (detect.active && detect.phase === 'playing') {
        log('hint_used', { problemIndex: detect.idx });
      }
      if (typeof _origHintClick === 'function') _origHintClick();
      else hintBtn.click();
    };
  }
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

function checkHintUsedDuringProblem() {
  var hintModal = document.getElementById('hint-modal');
  return hintModal && hintModal.style.display === 'flex';
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
  _lastBubble = null;
  _mergeInProgress = false;
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
  toggleSkipButton(true);
}

function toggleSkipButton(show) {
  var controls = document.getElementById('controls');
  if (!controls) return;
  var skipBtn = document.getElementById('detect-skip-btn');
  var newBtn = document.getElementById('new-game-btn');
  if (!skipBtn) {
    skipBtn = document.createElement('button');
    skipBtn.id = 'detect-skip-btn';
    skipBtn.textContent = '⏭ 跳过';
    skipBtn.className = 'btn-skip';
    skipBtn.onclick = function(){
      if (detect.phase !== 'playing') return;
      log('problem_skip', {});
      const p = detect.probs[detect.idx];
      if (p) p.skipped = true;
      startProblem(detect.idx + 1);
    };
    controls.appendChild(skipBtn);
  }
  // 检测模式：显示skip，隐藏新题
  skipBtn.style.display = show ? 'inline-flex' : 'none';
  if (newBtn) newBtn.style.display = show ? 'none' : 'inline-flex';
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
  toggleSkipButton(false);
  log('detect_end', {});
  uploadDetectionData();
  try {
    showReport(computeReport());
  } catch(e) {
    console.error('Report error:', e.message);
    showReport({
      solved: detect.probs.filter(p => p.solved).length,
      total: detect.probs.length, skipped: 0, unsolved: 0, allTimes: [],
      totalUndos: 0, totalMerges: 0, totalExplores: 0, totalHints: 0,
      fastCount: 0, mediumCount: 0, slowCount: 0,
      slowestIdx: -1, slowestTime: 0,
      userType: '—', typeIcon: '', typeDesc: '',
      evidence: ['⚠️ 报告计算遇到错误，请重试'],
      rank: '数据不足', emoji: '⏳',
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
  const skipped = detect.probs.filter(p => p.skipped).length;
  const unsolved = total - solved - skipped;
  const solvedItems = analysis.filter(a => a.solved);

  // 每题时间数组（不聚合）
  const solvedTimes = solvedItems.map(a => a.totalTime).filter(t => t !== null);
  const allTimes = analysis.map((a, i) => ({
    index: i,
    solved: a.solved,
    skipped: detect.probs[i] && detect.probs[i].skipped,
    time: a.totalTime,
    undos: a.undoCount,
    explores: a.exploreCount
  }));

  // 统计信息（不用平均数）
  const totalUndos = analysis.reduce((s, a) => s + a.undoCount, 0);
  const totalMerges = analysis.reduce((s, a) => s + a.mergeCount, 0);
  const totalExplores = analysis.reduce((s, a) => s + a.exploreCount, 0);
  const hintEvents = ev.filter(function(e) { return e.type === 'hint_used'; });
  const totalHints = hintEvents.length;

  // 速度分布（代替平均值）
  let fastCount = 0, mediumCount = 0, slowCount = 0;
  solvedItems.forEach(function(a) {
    if (!a.totalTime) return;
    if (a.totalTime <= 10) fastCount++;
    else if (a.totalTime <= 30) mediumCount++;
    else slowCount++;
  });

  // 找出最慢题
  let slowestIdx = -1, slowestTime = 0;
  solvedItems.forEach(function(a, i) {
    if (a.totalTime && a.totalTime > slowestTime) {
      slowestTime = a.totalTime;
      slowestIdx = analysis.indexOf(a);
    }
  });

  // 段位评估（基于综合表现）
  // 容忍1个长时outlier：至少6题≤30秒 或 中位数≤20秒
  var fastCount_ = solvedTimes.filter(function(t) { return t <= 30; }).length;
  var sortedTimes = solvedTimes.slice().sort(function(a,b){return a-b});
  var medianTime = sortedTimes.length > 0 ? sortedTimes[Math.floor(sortedTimes.length/2)] : 999;
  const isExpert = solved >= 7 && (fastCount_ >= 7 || medianTime <= 20) && totalUndos <= 1;
  const isSolid = solved >= 6 && (fastCount_ >= 5 || medianTime <= 35);

  let rank, emoji;
  if (solved === total && isExpert) { rank = '⚡ 速算高手'; emoji = '⚡'; }
  else if (solved === total && isSolid) { rank = '💪 稳健完成'; emoji = '💪'; }
  else if (solved >= total - 1) { rank = '🌱 基本过关'; emoji = '🌱'; }
  else if (skipped > 0 && solved > 0) { rank = '🔄 中途放弃'; emoji = '🔄'; }
  else { rank = '📚 需要练习'; emoji = '📚'; }

  // 用户类型判断
  var firstTimes = solvedItems.map(function(a) { return a.firstActionTime; }).filter(function(t) { return t !== null; });
  firstTimes.sort(function(a, b) { return a - b; });
  var medianFirst = firstTimes.length > 0 ? firstTimes[Math.floor(firstTimes.length / 2)] : null;

  var explores = analysis.map(function(a) { return a.exploreCount; });
  var avgExp = explores.length > 0 ? explores.reduce(function(s, a) { return s + a; }, 0) / explores.length : 0;

  // 判断类型：基于中位首次操作时间 + 探索范围 + 撤销
  var isThinker = medianFirst !== null && medianFirst >= 5 && avgExp <= 4;
  var isReactor = medianFirst !== null && medianFirst <= 3;
  var isSystematic = avgExp >= 5 && totalUndos <= 2;
  var isRandom = avgExp >= 5 && totalUndos > 2;
  var isPrecise = totalUndos === 0 && avgExp <= 4;

  var userType = '';
  var typeIcon = '';
  var typeDesc = '';

  if (isThinker) {
    userType = '冷静思考型';
    typeIcon = '🧊';
    typeDesc = '先想清楚再动手，操作精炼准确';
  } else if (isReactor && isPrecise) {
    userType = '直觉型';
    typeIcon = '⚡';
    typeDesc = '凭直觉快速锁定正确方向，操作快准稳';
  } else if (isReactor && !isPrecise) {
    userType = '快速反应型';
    typeIcon = '🔥';
    typeDesc = '快速动手边做边调整，行动力强';
  } else if (isSystematic) {
    userType = '系统探索型';
    typeIcon = '🔍';
    typeDesc = '有条不紊地尝试各种组合，覆盖面广';
  } else if (isRandom) {
    userType = '随机尝试型';
    typeIcon = '🎲';
    typeDesc = '四处尝试但方向不够明确，建议先想策略';
  } else if (isPrecise) {
    userType = '精准操作型';
    typeIcon = '🎯';
    typeDesc = '目标清晰，精准执行，极少误操作';
  } else {
    userType = '边做边想型';
    typeIcon = '🔀';
    typeDesc = '在操作中思考，边探索边调整方向';
  }

  // 补充行为特征（纵向排列，带emoji）
  var evidence = [];
  if (totalUndos === 0) evidence.push('✅ 精确度 · 零撤销，操作一步到位');
  else if (totalUndos <= 2) evidence.push('👍 纠错力 · 偶尔调整，及时纠正');
  else evidence.push('🔄 稳定性 · 撤销偏多');

  if (totalHints === 0 && solved > 0) evidence.push('💡 独立性 · 全程独立解题，未使用提示');
  else if (totalHints > 0) evidence.push('❓ 求助倾向 · 遇到困难时使用了提示');

  if (skipped > 0) evidence.push('⏭ 持续性 · 卡住时选择跳过，放弃' + skipped + '题');
  else if (unsolved > 0) {
    var usStars = [];
    for (var ui = 0; ui < detect.probs.length; ui++) {
      var pa2 = analysis[ui];
      if (pa2 && !pa2.solved && !detect.probs[ui].skipped) {
        usStars.push('★'.repeat(detect.probs[ui].stars));
      }
    }
    evidence.push('❌ 完成度 · 未解出' + unsolved + '题（难度：' + (usStars.join('、') || '') + '）');
  }

  if (medianFirst !== null) {
    var actionLabel = medianFirst <= 3 ? '⚡ 反应速度 · 快速启动' : (medianFirst >= 8 ? '🧠 思考深度 · 深思后行动' : '⚖️ 节奏感 · 边想边做');
    evidence.push(actionLabel);
  }

  return {
    solved: solved, total: total, skipped: skipped, unsolved: unsolved,
    allTimes: allTimes,
    totalUndos: totalUndos, totalMerges: totalMerges,
    totalExplores: totalExplores, totalHints: totalHints,
    fastCount: fastCount, mediumCount: mediumCount, slowCount: slowCount,
    slowestIdx: slowestIdx, slowestTime: slowestTime,
    userType: userType, typeIcon: typeIcon, typeDesc: typeDesc,
    evidence: evidence,
    rank: rank, emoji: emoji,
    rawAnalysis: analysis,
    rawProblems: detect.probs,
    rawEvents: ev
  };
}

function dummyReport() {
  return {
    solved: 0, total: 8, skipped: 0, unsolved: 0,
    allTimes: [],
    totalUndos: 0, totalMerges: 0, totalExplores: 0, totalHints: 0,
    fastCount: 0, mediumCount: 0, slowCount: 0,
    slowestIdx: -1, slowestTime: 0,
    userType: '—', typeIcon: '', typeDesc: '',
    evidence: ['⏳ 检测数据不足，请完成检测后再查看'],
    rank: '数据不足', emoji: '⏳',
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

  // 每题时间分布（不聚合、不平均）
  var gridRows = '';
  if (r.allTimes && r.rawProblems) {
    for (var i = 0; i < r.rawProblems.length; i++) {
      var p = r.rawProblems[i];
      var at = r.allTimes[i] || {};
      var stars = renderStars(p.stars);
      var statusIcon = at.skipped ? '⏭' : (at.solved ? '✅' : '❌');
      var timeStr = at.time ? at.time + '"': '—';
      var undoStr = at.undos > 0 ? ' ↩' + at.undos : '';
      var hintStr = '';
      // 实际没为每题独立记录hint，但整体hint次数在下方显示
      var maxTime = r.slowestTime > 15 ? r.slowestTime : 30;
      var barW = at.time ? Math.min(100, Math.round(at.time / maxTime * 100)) : 0;
      var barColor = at.skipped ? '#6b7280' : (at.solved ? (at.time <= 10 ? '#10b981' : at.time <= 30 ? '#f59e0b' : '#f97316') : '#ef4444');
      gridRows += '<div class="pg-row"><div class="pg-num">' + (i+1) + '</div><div class="pg-stars">' + stars + '</div><div class="pg-bar"><div class="pg-fill" style="width:' + barW + '%;background:' + barColor + '"></div></div><div class="pg-time">' + timeStr + '</div><div class="pg-status">' + statusIcon + '</div><div class="pg-undo">' + undoStr + '</div></div>';
    }
  }

  // 速度分布标签（代替平均值）
  var speedTags = '';
  if (r.fastCount > 0) speedTags += '<span class="speed-tag fast">≤10秒 ' + r.fastCount + '题</span>';
  if (r.mediumCount > 0) speedTags += '<span class="speed-tag medium">11-30秒 ' + r.mediumCount + '题</span>';
  if (r.slowCount > 0) speedTags += '<span class="speed-tag slow">30秒+ ' + r.slowCount + '题</span>';
  if (r.unsolved > 0) speedTags += '<span class="speed-tag unsolved">未解出 ' + r.unsolved + '题</span>';
  if (r.skipped > 0) speedTags += '<span class="speed-tag skipped">跳过 ' + r.skipped + '题</span>';

  // 用户类型 + 行为证据
  var typeHtml = '<div class="user-type"><span class="type-icon">' + (r.typeIcon || '') + '</span><span class="type-name">' + (r.userType || '') + '</span><span class="type-desc">' + (r.typeDesc || '') + '</span></div>';
  var evidenceHtml = (r.evidence || []).map(function(e) {
    return '<div class="ev-item">' + e + '</div>';
  }).join('');

  // 底部统计行（含派生指标）
  var mergeExploreRatio = r.totalExplores > 0 ? (r.totalMerges / r.totalExplores).toFixed(1) : '—';
  // 操作/探索比仅用于内部类型判断
  var mergeExploreRatio = r.totalExplores > 0 ? (r.totalMerges / r.totalExplores).toFixed(1) : '—';

  m.querySelector('.report-body').innerHTML =
    '<div class="report-header"><div class="report-rank">' + r.rank + '</div><div class="report-score">' + r.solved + '/' + r.total + '</div></div>' +
    '<div class="speed-tags">' + speedTags + '</div>' +
    '<div class="report-section"><div class="sec-title">每题用时分布</div><div class="pg-grid">' + gridRows + '</div></div>' +
    '<div class="report-section"><div class="sec-title">计算风格</div>' + typeHtml + '<div class="ev-list">' + evidenceHtml + '</div></div>' +
    '<div class="report-section" id="ai-analysis-section" style="display:none">' +
      '<div class="sec-title">能力评估</div>' +
      '<div id="ai-analysis-content" class="ai-content"></div>' +
    '</div>';

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
  // 发送完整事件链给 LLM
  var data = {
    problems: detect.probs.map(function(p) {
      return { numbers: p.numbers, stars: p.stars, solved: !!p.solved, skipped: !!p.skipped };
    }),
    eventLog: eventLog.slice(), // 完整事件链
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

  content.innerHTML = '<div class="ai-loading">🤔 正在评估各项能力…</div>';
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
            // 解析结构化输出
            var analysisText = result.analysis || '';
            var html = renderAIResult(analysisText);
            content.innerHTML = html;
            return;
          }
        } catch(e) { console.log('Parse error:', e); }
      }
      setTimeout(check, 2000);
    }).catch(function() { setTimeout(check, 2000); });
  }

  check();
}

function renderAIResult(text) {
  // 尝试解析JSON
  var data = null;
  if (typeof text === 'object' && text !== null) {
    data = text;
  } else if (typeof text === 'string') {
    try {
      var p = JSON.parse(text);
      if (p.scores && p.interpretations) data = p;
    } catch(e) {}
  }

  if (!data) {
    // 旧格式fallback
    return '<div class="ai-text">' + String(text).replace(/\n/g, '<br>') + '</div>';
  }

  // 雷达图
  var dims = Object.keys(data.scores || {});
  var canvas = '<canvas id="radar-canvas" width="240" height="200"></canvas>';

  // 总结
  var html = '<div class="ai-summary">' + (data.summary || '') + '</div>';
  html += '<div style="text-align:center">' + canvas + '</div>';

  // 维度解读
  var interpretations = data.interpretations || {};
  var dimColors = ['#f59e0b','#10b981','#f472b6','#818cf8','#a78bfa'];
  var dimIcons = ['🧮','⚡','🎯','🧠','🤔'];
  var idx = 0;
  for (var key in interpretations) {
    var val = data.scores[key] || 50;
    var icon = dimIcons[idx] || '';
    var htmlColor = dimColors[idx] || '#888';
    html += '<div class="ai-dim-row">' +
      '<div class="ai-dim-header">' +
        '<span class="ai-dim-icon">' + icon + '</span>' +
        '<span class="ai-dim-name">' + key + '</span>' +
        '<span class="ai-dim-score">' + val + '</span>' +
      '</div>' +
      '<div class="ai-dim-bar"><div class="ai-dim-fill" style="width:' + val + '%;background:' + htmlColor + '"></div></div>' +
      '<div class="ai-dim-desc">' + stripEvidence(interpretations[key]) + '</div>' +
    '</div>';
    idx++;
  }

  // 建议
  if (data.advice) {
    html += '<div class="ai-section" style="margin-top:8px"><div class="ai-sec-title">💡 练习建议</div><div class="ai-suggestion">' + data.advice + '</div></div>';
  }

  // 延迟绘制雷达图
  setTimeout(function() {
    drawRadarChart(data.scores);
  }, 100);

  return html;
}

// 去掉解释中的证据前缀，只保留结论
function stripEvidence(t) {
  // 常见模式："简单题2-4秒内完成，说明核心运算已形成直觉" → "核心运算已形成直觉"
  var idx = t.indexOf('说明');
  if (idx >= 0) return t.substring(idx + 2).trim();
  // "如...，说明..."
  var idx2 = t.indexOf('，说明');
  if (idx2 >= 0) return t.substring(idx2 + 3).trim();
  return t;
}

function drawRadarChart(scores) {
  var canvas = document.getElementById('radar-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var cx = W/2, cy = H/2 + 8, R = 72;

  var dims = Object.keys(scores || {});
  if (dims.length < 3) return;

  var n = dims.length;
  ctx.clearRect(0, 0, W, H);

  // 网格（3层）
  var gridColors = ['rgba(255,255,255,.03)','rgba(255,255,255,.05)','rgba(255,255,255,.08)'];
  for (var g = 0; g < 3; g++) {
    var r = R * (g + 1) / 3;
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      var angle = -Math.PI/2 + 2*Math.PI*i/n;
      var x = cx + r * Math.cos(angle);
      var y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 轴线
  for (var i = 0; i < n; i++) {
    var angle = -Math.PI/2 + 2*Math.PI*i/n;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(angle), cy + R * Math.sin(angle));
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.stroke();
  }

  // 评分多边形
  ctx.beginPath();
  var dimColors = ['#f59e0b','#10b981','#f472b6','#818cf8','#a78bfa'];
  var vals = dims.map(function(k) { return Math.min(100, Math.max(0, scores[k] || 0)); });
  for (var i = 0; i <= n; i++) {
    var angle = -Math.PI/2 + 2*Math.PI*i/n;
    var v = vals[i % n] / 100;
    var x = cx + R * v * Math.cos(angle);
    var y = cy + R * v * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(129,140,248,.15)';
  ctx.fill();
  ctx.strokeStyle = '#818cf8';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 标签
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (var i = 0; i < n; i++) {
    var angle = -Math.PI/2 + 2*Math.PI*i/n;
    var labelR = R + 14;
    var x = cx + labelR * Math.cos(angle);
    var y = cy + labelR * Math.sin(angle);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillText(dims[i], x, y);
  }
}
