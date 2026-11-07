/**
 * 复杂度检查配置：在常规 lint 之外单独跑，先作为报告，不阻塞 CI。
 *
 * 指标：
 *   - 圈复杂度 complexity：分支数，10 警告、15 考虑重构
 *   - 嵌套深度 max-depth：4
 *   - 函数语句数 max-statements：30
 *   - 参数个数 max-params：4
 *   - 文件行数 max-lines：300
 *   - 函数行数 max-lines-per-function：80
 *
 * 运行：npm run complexity
 */
import base from './eslint.config.mjs';

export default [
  ...base,
  {
    files: ['scripts/**/*.js', 'code/frontend/src/**/*.js'],
    rules: {
      complexity: ['warn', 10],
      'max-depth': ['warn', 4],
      'max-statements': ['warn', 30],
      'max-params': ['warn', 4],
      'max-lines': ['warn', 300],
      'max-lines-per-function': ['warn', 80],
    },
  },
];
