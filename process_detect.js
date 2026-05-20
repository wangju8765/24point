#!/usr/bin/env node
/**
 * 检测数据分析脚本
 * 用法：node process_detect.js
 *
 * 从 Supabase 读取 _detect_waiting 记录，
 * 调用 DashScope LLM 分析事件链数据，
 * 将分析结果写回 Supabase（_detect_result）。
 */

const SUPABASE_URL = 'https://pkxmsfyzcphzvuangrzs.supabase.co';

// 从 ~/.zshrc 读 key
const fs = require('fs');
const path = require('path');
const homeDir = process.env.HOME || process.env.USERPROFILE;
const zshrc = fs.readFileSync(path.join(homeDir, '.zshrc'), 'utf8');
const skMatch = zshrc.match(/SUPABASE_SERVICE_KEY="([^"]+)"/);
const SUPABASE_KEY = skMatch ? skMatch[1] : process.env.SUPABASE_SERVICE_KEY;

const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY || (() => {
  const m = zshrc.match(/DASHSCOPE_API_KEY="([^"]+)"/);
  return m ? m[1] : null;
})();

if (!SUPABASE_KEY) { console.error('Missing SUPABASE_SERVICE_KEY'); process.exit(1); }
if (!DASHSCOPE_KEY) { console.error('Missing DASHSCOPE_API_KEY'); process.exit(1); }

const AUTH = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY };

async function main() {
  console.log('🔍 Checking for pending detect data...');

  // 1. 读取待处理记录
  const records = await supabaseGet('/rest/v1/feedback', 'select=id,name,text,time&name=eq._detect_waiting&order=time.asc&limit=1');
  if (!records || records.length === 0) {
    console.log('📭 No pending data found.');
    return;
  }

  const record = records[0];
  const requestId = record.time;
  let data;
  try { data = JSON.parse(record.text); } catch(e) {
    console.error('Parse error:', e.message);
    await supabaseDel('/rest/v1/feedback?id=eq.' + record.id);
    return;
  }

  console.log(`📊 Analyzing detection data (id: ${requestId})...`);

  // 2. 构造 LLM prompt
  const prompt = buildPrompt(data);
  console.log('Prompt length:', prompt.length, 'chars');

  // 3. 调用 DashScope LLM
  const analysis = await callDashScope(prompt);

  // 4. 写入结果
  const result = {
    requestId,
    analysis,
    suggestions: extractSuggestions(analysis),
    processedAt: Date.now()
  };

  await supabasePost('/rest/v1/feedback', {
    name: '_detect_result',
    text: JSON.stringify(result),
    time: requestId
  });

  // 5. 删除已处理的记录
  await supabaseDel('/rest/v1/feedback?id=eq.' + record.id);

  console.log('✅ Analysis complete!');
  console.log('---');
  console.log(analysis);
}

async function supabaseGet(endpoint, query) {
  const res = await fetch(SUPABASE_URL + endpoint + '?' + query, { headers: AUTH });
  return res.json();
}

async function supabasePost(endpoint, body) {
  await fetch(SUPABASE_URL + endpoint, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(body)
  });
}

async function supabaseDel(endpoint) {
  await fetch(SUPABASE_URL + endpoint, {
    method: 'DELETE',
    headers: { ...AUTH, 'Prefer': 'return=minimal' }
  });
}

function buildPrompt(data) {
  const problems = data.problems || [];
  const events = data.events || [];

  // 生成每道题的摘要（使用 already-computed summary in p）
  const summaries = problems.map((p, idx) => {
    const solved = !!p.solved;
    const skipped = !!p.skipped;
    const time = p.time || '?';
    const undos = p.undos || 0;
    const explores = p.explores || 0;
    const firstAction = p.firstAction || '?';
    const hintUsed = !!p.hintUsed;
    const stars = '★'.repeat(p.stars || 1);
    const status = skipped ? '跳过' : (solved ? '解出' : '未解出');
    const hintMark = hintUsed ? ' [用了提示]' : '';
    return `题${idx+1}: [${p.numbers.join(',')}] ${stars} | ${status} | 用时${time}秒 | 撤销${undos}次 | 首次操作${firstAction}秒${hintMark}`;
  }).join('\n');

  // 判断整体水平
  const allSolved = problems.every(p => p.solved);
  const allTimes = problems.filter(p => p.solved && p.time).map(p => p.time);
  const allFast = allTimes.length > 0 && allTimes.every(t => t <= 30);
  const allVeryFast = allTimes.length > 0 && allTimes.every(t => t <= 10);
  const noUndos = problems.every(p => p.undos === 0);
  const hasSkips = problems.some(p => !p.solved);

  const isExpert = allSolved && allVeryFast && noUndos;
  const isAdvanced = allSolved && allFast && !isExpert;
  const isStruggling = !allSolved || hasSkips;

  let toneInstruction;
  if (isExpert) {
    toneInstruction = '全部8题快速解出且零失误，属于高水平表现。分析重点：确认优势、给出更高阶挑战建议。最后给出简明建议时，应以"挑战更高难度"为主，不要说"需要加强"或"不足"。';
  } else if (isAdvanced) {
    toneInstruction = '整体表现良好，大部分题解出。分析重点：肯定优势同时指出可以提升的方向。建议部分要具体可执行。';
  } else {
    toneInstruction = '表现有提升空间。分析重点：客观描述当前水平，给出清晰具体的练习方向。语气要鼓励，建议要可操作。';
  }

  return `你是一位专业的24点游戏分析员。以下是一次8题能力检测的数据：

## 原始数据
${summaries}

## 分析要求
${toneInstruction}

请用中文输出以下内容，每段30字以内，总共120字以内：

1. 一句话总结总体表现（解出情况+速度概况）
2. 一句话概括优势特点
3. 一句话（如果是高手：说挑战方向；如果是新手：说待提升方向）
4. 一句话建议

注意：
- 用中性称呼，不要说"孩子"
- 语言简洁有力，每句话单独成行
- 对高水平者不要用"需要提升""不足""练"等词`;
}

async function callDashScope(prompt) {
  const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

  const body = {
    model: 'qwen-plus',
    messages: [
      { role: 'system', content: '你是一位24点游戏能力分析员。根据检测数据做客观分析，语言简洁中肯，适应被分析者的实际水平。' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 800
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + DASHSCOPE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const json = await res.json();
  if (json.choices && json.choices[0]) {
    return json.choices[0].message.content;
  }
  throw new Error('LLM response error: ' + JSON.stringify(json));
}

function extractSuggestions(text) {
  const suggestions = [];
  const lines = text.split('\n');
  let inSuggestions = false;
  for (const line of lines) {
    if (line.includes('建议') || line.includes('练习')) inSuggestions = true;
    if (inSuggestions && line.match(/^\d+[\.\、]/)) suggestions.push(line.replace(/^\d+[\.\、]\s*/, ''));
    if (inSuggestions && line.match(/^[-–—·]/) && suggestions.length > 0) {
      suggestions.push(line.replace(/^[-–—·]\s*/, ''));
    }
  }
  if (suggestions.length === 0) {
    // fallback: 把整个分析按句号拆分，取最后2-3句
    const sentences = text.split(/[。\n]/).filter(s => s.trim().length > 5);
    for (let i = Math.max(0, sentences.length - 3); i < sentences.length; i++) {
      suggestions.push(sentences[i].trim());
    }
  }
  return suggestions.slice(0, 4);
}

// 启动轮询模式（每5秒检查一次）
async function pollLoop() {
  console.log('🔄 Detect Analysis Service started');
  console.log('   Polling every 5 seconds...');
  while (true) {
    try {
      await main();
    } catch(e) {
      console.error('Error:', e.message);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}

// 如果直接运行，启动轮询
if (require.main === module) {
  const isPoll = process.argv.includes('--poll');
  if (isPoll) {
    pollLoop().catch(console.error);
  } else {
    main().then(() => {
      console.log('Done (use --poll for continuous mode)');
    }).catch(e => {
      console.error('Fatal:', e.message);
      process.exit(1);
    });
  }
}
