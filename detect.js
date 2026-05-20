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

  // 提示按钮 hook
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
  showSkipButton();
}

function showSkipButton() {
  var btn = document.getElementById('detect-skip-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'detect-skip-btn';
    btn.textContent = '⏭ 跳过本题';
    btn.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,.08);color:rgba(255,255,255,.4);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:8px 20px;font-size:13px;cursor:pointer;z-index:400;transition:all .3s';
    btn.onmouseover = function(){btn.style.background='rgba(255,255,255,.12)';btn.style.color='rgba(255,255,255,.6)'};
    btn.onmouseout = function(){btn.style.background='rgba(255,255,255,.08)';btn.style.color='rgba(255,255,255,.4)'};
    btn.onclick = function(){
      if (detect.phase !== 'playing') return;
      log('problem_skip', {});
      const p = detect.probs[detect.idx];
      if (p) p.skipped = true;
      startProblem(detect.idx + 1);
    };
    document.getElementById('app').appendChild(btn);
  }
  btn.style.display = 'block';
}

function hideSkipButton() {
  var btn = document.getElementById('detect-skip-btn');
  if (btn) btn.style.display = 'none';
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
  hideSkipButton();
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
      patterns: ['⚠️ 报告计算遇到错误，请重试'],
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
  const isExpert = solved >= 7 && solvedTimes.every(function(t) { return t <= 25; }) && totalUndos <= 1;
  const isSolid = solved >= 6 && solvedTimes.every(function(t) { return t <= 60; });

  let rank, emoji;
  if (solved === total && isExpert) { rank = '⚡ 速算高手'; emoji = '⚡'; }
  else if (solved === total && isSolid) { rank = '💪 稳健完成'; emoji = '💪'; }
  else if (solved >= total - 1) { rank = '🌱 基本过关'; emoji = '🌱'; }
  else if (skipped > 0 && solved > 0) { rank = '🔄 中途放弃'; emoji = '🔄'; }
  else { rank = '📚 需要练习'; emoji = '📚'; }

  // 模式识别——简短、一条线
  var patterns = [];

  // 反应速度（用中位数更稳健）
  var firstTimes = solvedItems.map(function(a) { return a.firstActionTime; }).filter(function(t) { return t !== null; });
  firstTimes.sort(function(a, b) { return a - b; });
  var medianFirst = firstTimes.length > 0 ? firstTimes[Math.floor(firstTimes.length / 2)] : null;
  if (medianFirst !== null) {
    if (medianFirst <= 3) patterns.push('⚡ 反应迅速 · 见题即开始探索');
    else if (medianFirst >= 8) patterns.push('🧠 深思熟虑 · 先想清楚再动手');
    else patterns.push('⚖️ 快慢适中 · 边思考边验证');
  }

  // 探索范围
  var explores = analysis.map(function(a) { return a.exploreCount; });
  var avgExp = explores.length > 0 ? explores.reduce(function(s, a) { return s + a; }, 0) / explores.length : 0;
  if (avgExp > 5) patterns.push('🔍 广泛尝试 · 探索多种组合后找到解法');
  else if (avgExp <= 3) patterns.push('🎯 直击目标 · 锁定正确组合快');
  else patterns.push('🔎 适度探索 · 有方向地验证组合');

  // 撤销
  if (totalUndos === 0) patterns.push('✅ 零撤销 · 操作精准果断');
  else if (totalUndos <= 2) patterns.push('👍 偶尔调整 · 发现错误及时纠正');
  else patterns.push('🔄 频繁撤销 · 建议先想清楚再操作');

  // 提示
  if (totalHints === 0 && solved > 0) patterns.push('💡 独立解题 · 没使用提示');
  else if (totalHints > 0) patterns.push('❓ 使用提示 ' + totalHints + '次 · 遇到困难时寻求了帮助');

  // 跳过
  if (skipped > 0) patterns.push('⏭ 跳过 ' + skipped + '题 · 卡住时选择了放弃');

  // 未解出
  if (unsolved > 0) {
    var unsolvedStars = [];
    for (var ui = 0; ui < detect.probs.length; ui++) {
      var pa = analysis[ui];
      if (pa && !pa.solved && !detect.probs[ui].skipped) {
        unsolvedStars.push('★'.repeat(detect.probs[ui].stars));
      }
    }
    patterns.push('❌ 未解出 ' + unsolved + '题（难度：' + (unsolvedStars.join('、') || '?') + '）');
  }

  // 限制最多显示5个
  if (patterns.length > 5) patterns = patterns.slice(0, 5);

  return {
    solved: solved, total: total, skipped: skipped, unsolved: unsolved,
    allTimes: allTimes,
    totalUndos: totalUndos, totalMerges: totalMerges,
    totalExplores: totalExplores, totalHints: totalHints,
    fastCount: fastCount, mediumCount: mediumCount, slowCount: slowCount,
    slowestIdx: slowestIdx, slowestTime: slowestTime,
    patterns: patterns,
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
    patterns: ['⏳ 检测数据不足，请完成检测后再查看'],
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

  // 模式列表（一行一个，简短）
  var patternHtml = (r.patterns || []).map(function(p) {
    return '<div class="pat-item">' + p + '</div>';
  }).join('');

  // 底部统计行
  var statsRow = '';
  statsRow += '<div class="stat-item"><span class="stat-num">' + r.totalMerges + '</span><span class="stat-label">操作</span></div>';
  statsRow += '<div class="stat-item"><span class="stat-num">' + r.totalUndos + '</span><span class="stat-label">撤销</span></div>';
  statsRow += '<div class="stat-item"><span class="stat-num">' + r.totalHints + '</span><span class="stat-label">提示</span></div>';
  statsRow += '<div class="stat-item"><span class="stat-num">' + r.totalExplores + '</span><span class="stat-label">探索</span></div>';

  m.querySelector('.report-body').innerHTML =
    '<div class="report-header"><div class="report-rank">' + r.rank + '</div><div class="report-score">' + r.solved + '/' + r.total + '</div></div>' +
    '<div class="speed-tags">' + speedTags + '</div>' +
    '<div class="report-section"><div class="sec-title">每题用时分布</div><div class="pg-grid">' + gridRows + '</div></div>' +
    '<div class="report-section"><div class="sec-title">行为特征</div><div class="pat-list">' + patternHtml + '</div></div>' +
    '<div class="stats-row">' + statsRow + '</div>' +
    '<div class="report-section" id="ai-analysis-section" style="display:none">' +
      '<div class="sec-title">AI 分析</div>' +
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
  // 构造简化的分析数据
  var problemEvents = splitEventsByProblem(eventLog);
  var data = {
    problems: detect.probs.map(function(p, i) {
      var a = analyzeProblem(problemEvents[i] || []);
      return {
        numbers: p.numbers,
        stars: p.stars,
        solved: a.solved,
        skipped: !!p.skipped,
        time: a.totalTime,
        undos: a.undoCount,
        explores: a.exploreCount,
        firstAction: a.firstActionTime,
        hintUsed: problemEvents[i] && problemEvents[i].some(function(e) { return e.type === 'hint_used'; })
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
