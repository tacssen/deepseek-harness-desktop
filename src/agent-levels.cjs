/**
 * Desktop-level Agent profiles.
 *
 * DeepSeek currently advertises only `high` and `max` reasoning efforts. The
 * five UI levels therefore combine the provider's real effort parameter with
 * a Desktop execution policy (parallel tool budget, turn-step budget and
 * verification guidance). Low/Medium are intentionally documented as
 * Desktop policies mapped to the provider's supported `high` effort rather
 * than pretending that DeepSeek exposes native low/medium reasoning.
 */
const AGENT_LEVELS = Object.freeze({
  low: Object.freeze({
    id: 'low', label: '低', description: '快速响应；少量工具循环和基础读取。', reasoningEffort: 'high', maxParallelToolCalls: 2, maxSteps: 8, verify: false, repair: false,
  }),
  medium: Object.freeze({
    id: 'medium', label: '中', description: '日常开发；正常规划、工具预算和基础验证。', reasoningEffort: 'high', maxParallelToolCalls: 4, maxSteps: 16, verify: true, repair: false,
  }),
  high: Object.freeze({
    id: 'high', label: '高', description: '复杂任务；完整规划、测试和失败诊断。', reasoningEffort: 'high', maxParallelToolCalls: 6, maxSteps: 28, verify: true, repair: true,
  }),
  'extra-high': Object.freeze({
    id: 'extra-high', label: '极高', description: '大型工程；更高预算、复查和代码审阅。', reasoningEffort: 'max', maxParallelToolCalls: 8, maxSteps: 48, verify: true, repair: true,
  }),
  max: Object.freeze({
    id: 'max', label: '最高', description: 'Goal 长任务；最大 Desktop 预算、自动修复和回归检查。', reasoningEffort: 'max', maxParallelToolCalls: 10, maxSteps: 80, verify: true, repair: true,
  }),
});

const DEFAULT_AGENT_LEVEL = 'medium';

function normalizeAgentLevel(value) {
  const id = String(value || DEFAULT_AGENT_LEVEL);
  return Object.prototype.hasOwnProperty.call(AGENT_LEVELS, id) ? id : DEFAULT_AGENT_LEVEL;
}

function getAgentLevel(value) { return AGENT_LEVELS[normalizeAgentLevel(value)]; }

function listAgentLevels() { return Object.values(AGENT_LEVELS).map((entry) => ({ ...entry })); }

module.exports = { AGENT_LEVELS, DEFAULT_AGENT_LEVEL, normalizeAgentLevel, getAgentLevel, listAgentLevels };
