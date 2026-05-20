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

  // 生成每道题的摘要
  const summaries = problems.map((p, idx) => {
    // 找到这道题的事件
    const probEvents = [];
    let inProb = false;
    events.forEach(e => {
      if (e.type === 'problem_start' && e.index === idx) { inProb = true; probEvents.push(e); }
      else if (e.type === 'problem_start' && e.index !== idx) { inProb = false; }
      else if (inProb) probEvents.push(e);
    });

    const solved = probEvents.some(e => e.type === 'problem_solved');
    const merges = probEvents.filter(e => e.type === 'merge');
    const undos = probEvents.filter(e => e.type === 'undo');
    const bubbles = probEvents.filter(e => e.type === 'bubble_show');
    const startEvent = probEvents.find(e => e.type === 'problem_start');
    const endEvent = probEvents.find(e => e.type === 'problem_solved');
    const totalTime = solved && startEvent && endEvent ? ((endEvent.ts - startEvent.ts) / 1000).toFixed(1) : '?';

    // 探索序列
    const pairSeq = bubbles.map(b => `${b.a}❌${b.b}`).join(' → ');

    return `题${idx+1}: [${p.numbers.join(',')}] ★${'★'.repeat(p.stars-1)}
  解出: ${solved ? '是' : '否'} | 用时: ${totalTime}秒 | 合并: ${merges.length}次 | 撤销: ${undos.length}次
  探索序列: ${pairSeq || '(无)'}`;
  }).join('\n\n');

  return `你是一位专业的数学认知分析师。以下是8岁孩子在24点游戏能力检测中的完整数据。

## 游戏规则
24点游戏：用4张牌的数字，通过加减乘除运算使结果等于24。
能力检测包含8道题，难度从★到★★★★。

## 原始数据
${summaries}

## 分析要求
请从以下角度给出分析（输出中文，用自然语言，200字以内）：

1. **总体表现**：看了多少题，解出多少，整体速度如何
2. **优势**：孩子做得好的地方（例如速度快、准确率高、有策略等）
3. **待提升**：需要加强的方面（例如计算易出错、方法单一、缺乏策略等）
4. **练习建议**：针对性地给出2-3条具体建议

注意：
- 要基于真实数据说话，不要说空话
- 用家长能听懂的语言，不要用学术术语
- 语气要鼓励但实事求是，重点指出改进方向`;
}

async function callDashScope(prompt) {
  const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

  const body = {
    model: 'qwen-plus',
    messages: [
      { role: 'system', content: '你是一位专业的数学认知分析师，专门分析儿童计算能力。请基于给出的数据做客观分析，用家长能懂的语言输出。' },
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
