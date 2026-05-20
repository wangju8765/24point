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
  // 计算概要统计数据
  const allSolved = problems.every(p => p.solved);
  const solvedItems = problems.filter(p => p.solved && p.time);
  const avgTime = solvedItems.length > 0 ? Math.round(solvedItems.reduce((s, p) => s + p.time, 0) / solvedItems.length) : 0;
  const totalUndos = problems.reduce((s, p) => s + (p.undos || 0), 0);
  const totalHints = problems.filter(p => p.hintUsed).length;

  // 每道题摘要
  const summaries = problems.map((p, idx) => {
    const solved = !!p.solved;
    const skipped = !!p.skipped;
    const time = p.time || (skipped ? '跳' : '—');
    const hint = p.hintUsed ? ' H' : '';
    return `题${idx+1}: [${p.numbers.join(',')}] ${'★'.repeat(p.stars)} | ${skipped ? '跳' : (solved ? '✓' : '✗')} | ${time}秒 | 撤${p.undos||0}${hint}`;
  }).join('\n');

  const header = allSolved
    ? `全对${problems.length}题，平均${avgTime}秒/题，撤销${totalUndos}次，提示${totalHints}次`
    : `完成${solvedItems.length}/${problems.length}题，撤销${totalUndos}次，提示${totalHints}次`;

  const toneGuide = allSolved && avgTime < 15 && totalUndos === 0
    ? '此人水平很高。分析要肯定其优势，建议挑战更高难度或限时模式。不要说"不足""需要练"。'
    : '客观分析优势与待提升方向，建议要具体可执行。';

  return `你是一位教练。以下是某人在24点检测中的表现数据。

${header}

${summaries}

## 分析要求
${toneGuide}

请输出以下内容：

【总体】30字以内，把数据翻译成结论（如："9秒/题且零失误，说明基础运算非常熟练"），不要只复述数字

【基础运算】20字内评估加减乘除的熟练程度（看用时和撤销）

【数字组合】20字内评估对数字搭配的敏感度（看探索数量和首次操作时间）

【策略运用】20字内评估遇到困难时的应对方式，只有能看出时再说，看不出就说"数据不足以判断"

【建议】20字内，只写一句真人能做到的具体行动（如"练分数模式""计时挑战"，但不要说"预设框架""多路径推演"这种空话）

规则：
- 别复述数字，要解释数字的意义
- 每句10-20字，不要说空话
- 不确定的能力就别提，宁缺毋滥
- 建议必须是日常能做的事`;
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
