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

  // 4. 解析或直接存储JSON结果
  var structured = null;
  try {
    // LLM输出可能包含markdown代码块包裹
    var jsonStr = analysis;
    var m = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) jsonStr = m[1];
    var parsed = JSON.parse(jsonStr);
    if (parsed.scores && parsed.interpretations) structured = parsed;
  } catch(e) { /* not JSON, store as plain text */ }

  const result = {
    requestId,
    analysis: structured || analysis,
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
  const eventLog = data.eventLog || [];

  // 按题拆分事件链
  const problemChains = [];
  let currentChain = [];
  eventLog.forEach(e => {
    if (e.type === 'problem_start') {
      if (currentChain.length > 0) problemChains.push(currentChain);
      currentChain = [e];
    } else {
      currentChain.push(e);
    }
  });
  if (currentChain.length > 0) problemChains.push(currentChain);

  // 为每道题生成详细的决策链文本
  const chainTexts = problemChains.map((chain, idx) => {
    const p = problems[idx] || {};
    const nums = (p.numbers || []).join(',');
    const stars = '★'.repeat(p.stars || 1);
    const status = p.skipped ? '跳过' : (p.solved ? '✓解出' : '✗未解');

    // 还原操作序列
    const actions = chain.map(e => {
      switch (e.type) {
        case 'problem_start': return null;
        case 'bubble_show': return `  查看[${e.a}❌${e.b}]`;
        case 'bubble_dismiss': return `  放弃[${e.a}❌${e.b}]（停留${Math.round((e.dwellMs || 0)/1000)}秒）`;
        case 'merge': return `  →合并 ${e.a}${e.op}${e.b}`;
        case 'undo': return `  ↩撤销`;
        case 'hint_used': return `  ❓使用提示`;
        case 'problem_solved': return null;
        case 'detect_end': return null;
        case 'problem_skip': return null;
        default: return null;
      }
    }).filter(a => a !== null);

    const actionText = actions.length > 0 ? actions.join('\n') : '  无操作';

    // 统计用时
    const startEvent = chain.find(e => e.type === 'problem_start');
    const endEvent = chain.find(e => e.type === 'problem_solved');
    const skipEvent = chain.find(e => e.type === 'problem_skip');
    const totalTime = endEvent && startEvent ? `用时${Math.round((endEvent.ts - startEvent.ts)/1000)}秒` :
                       skipEvent && startEvent ? `坚持${Math.round((skipEvent.ts - startEvent.ts)/1000)}秒后放弃` :
                       '用时?秒';

    return `【题${idx+1}】[${nums}] ${stars} ${status} ${totalTime}\n${actionText}`;
  }).join('\n\n');

  // 统计概览
  const solvedCount = problems.filter(p => p.solved).length;
  const skippedCount = problems.filter(p => p.skipped).length;
  const totalHint = eventLog.filter(e => e.type === 'hint_used').length;
  const totalUndo = eventLog.filter(e => e.type === 'undo').length;
  const totalDismiss = eventLog.filter(e => e.type === 'bubble_dismiss').length;

  const header = `全${problems.length}题，解出${solvedCount}题，跳过${skippedCount}题，撤销${totalUndo}次，提示${totalHint}次，放弃查看${totalDismiss}次`;

  return `以下是某人在24点检测中的完整决策数据：

${header}

${chainTexts}

## 要求
请基于完整的决策链数据，分析5项基础能力，输出严格JSON：

{
  "summary": "一句话总结，30字内",
  "scores": {
    "数字敏感度": 0-100,
    "自动化程度": 0-100,
    "运算精度": 0-100,
    "工作记忆": 0-100,
    "策略运用": 0-100
  },
  "interpretations": {
    "数字敏感度": "一句话解释，这项能力是什么、当前水平如何",
    "自动化程度": "一句话解释",
    "运算精度": "一句话解释",
    "工作记忆": "一句话解释",
    "策略运用": "一句话解释"
  },
  "advice": "一句真人能做到的建议，不要说空话"
}

评分参考：
- 数字敏感度：看探索了哪些组合、首次操作速度
- 自动化程度：看每次操作的停留时间、简单题是否瞬间出结果
- 运算精度：看撤销次数、解出率
- 工作记忆：看长静默后是否正确完成、中间步骤是否需要外部辅助
- 策略运用：看遇到难题时是否换方向、探索是否有序

规则：
- JSON必须合法，不要加额外文字
- 不确定的能力打中等分（50-60），解释写"数据有限"
- 得分很高（>85）时解释用肯定语气
- 得分较低时解释指出方向但不否"不足"
- 所有解释用人话，别用术语
- 建议必须真人能做到，如"限时挑战""分数模式""专项练习"等`;
}

async function callDashScope(prompt) {
  const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

  const body = {
    model: 'qwen-plus',
    messages: [
      { role: 'system', content: '你是一位24点游戏能力分析员。根据决策链数据做客观分析，语言简洁中肯，适应被分析者的实际水平。对高水平者建议肯定其优势，不要提"不足"或"训练"。' },
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
