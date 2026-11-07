/**
 * L-05 Agent 主流程（本地状态机，不依赖服务端）。
 *
 * 状态：input → classify → (retrieve) → generate → validate → output
 *
 * 规则（与 L-05 验收对齐）：
 *   - 危机 / 越界 / 无关 / 澄清：不调模型，直接给固定话术；
 *   - 只有 explain 才检索知识块并调用模型；
 *   - 检索为空：明说"不知道"，不硬答（P-06 契约 §8.1 兜底）；
 *   - 模型不可用或输出不合格 → 一律回退模板，页面不空白；
 *   - 输出必须过 validate：禁用词 0、数字可溯源、有引用。
 */

import { INTENT, classify, fixedReply } from './classify.js';
import { retrieve as defaultRetrieve } from './retrieve.js';
import { describeIssues, validateText } from './validate.js';
import { callLlm, isConfigured } from '../llm/client.js';
import { templateExplanation } from '../llm/degrade.js';

const MAX_HISTORY = 6;

const NO_KNOWLEDGE_REPLY =
  '本地知识库里没有能直接回答这个问题的内容，我不猜。' +
  '你可以换个问法（比如「联想记忆怎么练」），或查看报告里的原始指标。';

const SYSTEM_PROMPT = [
  '你是 MindMeter 的解读助手。',
  '只解释给定的本次原始指标，不推断能力高低，不下诊断，不与人群比较。',
  '不要出现“总分”“百分位”“正常/异常”“治疗”等词。',
  '提到数字时只能用给定指标里的数字。',
  '如果提供了知识块，回答末尾另起一行写「引用：知识块编号 · 标题」。',
  '不超过 200 字。',
].join('');

function templateResult(intent, text, citations, code) {
  return { intent, text, citations, source: 'template', code };
}

/** 把 facts 里的数字摊平成白名单，供校验器比对。 */
export function collectNumbers(facts = {}) {
  const out = [];
  const walk = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(facts);
  return out;
}

function factsToLines(facts = {}) {
  return Object.entries(facts)
    .filter(([, value]) => value && typeof value === 'object')
    .map(([id, metrics]) => `${id}: ${JSON.stringify(metrics)}`)
    .join('\n');
}

function kbToLines(chunks = []) {
  if (chunks.length === 0) return '（无）';
  return chunks.map((chunk) => `${chunk.id} · ${chunk.title}：${chunk.text}`).join('\n');
}

/** 组装 messages；导出便于单测直接断言 prompt 内容。 */
export function buildMessages({ question, facts, chunks = [], history = [] }) {
  const recent = history.slice(-MAX_HISTORY).map((item) => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: String(item.content || ''),
  }));

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `本次原始指标：\n${factsToLines(facts) || '（无）'}`,
        `可引用知识块：\n${kbToLines(chunks)}`,
        `用户问题：${question}`,
      ].join('\n\n'),
    },
    ...recent,
  ];
}

/** 调模型；任何异常收敛成 code，不在这里做降级决策。 */
async function tryLlm({ settings, question, facts, chunks, history, callFn }) {
  try {
    const result = await callFn({
      settings,
      messages: buildMessages({ question, facts, chunks, history }),
    });
    return { text: String(result?.text || '').trim(), code: 'ok' };
  } catch (error) {
    return { text: '', code: error?.code || 'unknown' };
  }
}

/** 依赖解析单独放，避免主流程堆 || 默认值抬高复杂度。 */
function resolveDeps(deps = {}) {
  return {
    classifyFn: deps.classify || classify,
    retrieveFn: deps.retrieve || defaultRetrieve,
    callFn: deps.call || callLlm,
    templateFn: deps.template || templateExplanation,
  };
}

/** explain 意图的完整链路：检索 → 生成 → 校验，任一环节失败都回退模板。 */
async function runExplain({ question, facts, history, settings, deps }) {
  const { retrieveFn, callFn, templateFn } = deps;
  const intent = INTENT.EXPLAIN;

  const chunks = await retrieveFn({ query: question });
  if (chunks.length === 0) {
    return templateResult(intent, NO_KNOWLEDGE_REPLY, [], 'no_knowledge');
  }
  const citations = chunks.map((chunk) => chunk.id);

  if (!isConfigured(settings) || !settings.enabled) {
    return templateResult(intent, templateFn(facts), citations, 'not_configured');
  }

  const generated = await tryLlm({ settings, question, facts, chunks, history, callFn });
  if (generated.code !== 'ok') {
    return templateResult(intent, templateFn(facts), citations, generated.code);
  }

  const check = validateText({
    text: generated.text,
    allowedNumbers: collectNumbers(facts),
    requireCitation: true,
  });
  if (!check.ok) {
    return templateResult(
      intent,
      templateFn(facts),
      citations,
      `invalid:${describeIssues(check.issues)}`,
    );
  }

  return { intent, text: generated.text, citations, source: 'llm', code: 'ok' };
}

/**
 * 跑一轮问答。
 * @param {object} options
 * @param {string} options.question
 * @param {object} [options.facts] 本次指标（来自 L-02 计分）
 * @param {Array} [options.history] 最近若干条消息
 * @param {object} [options.settings] BYOK 配置（storage.readSettings）
 * @param {object} [options.deps] 注入点，便于测试
 * @returns {Promise<{intent:string, text:string, citations:string[], source:string, code:string}>}
 */
export async function answer(options = {}) {
  const { question, facts = {}, history = [], settings = null } = options;
  const deps = resolveDeps(options.deps);

  const { intent } = deps.classifyFn(question);
  if (intent !== INTENT.EXPLAIN) {
    return templateResult(intent, fixedReply(intent), [], `intent:${intent}`);
  }
  return runExplain({ question, facts, history, settings, deps });
}
