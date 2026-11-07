// ESLint 扁平配置（ESLint 9+）
// 规则目标：抓真实问题，同时保留复杂度与重复的可观测指标。
const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    files: ['code/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        performance: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        alert: 'readonly',
        confirm: 'readonly'
      }
    },
    rules: {
      // 复杂度与规模：对应任务里的「圈复杂度」指标
      complexity: ['warn', 10],
      'max-depth': ['warn', 4],
      'max-lines-per-function': ['warn', 80],
      'max-params': ['warn', 5],

      // 常见缺陷
      eqeqeq: ['error', 'smart'],
      'no-var': 'warn',
      'prefer-const': 'warn',
      'no-unused-vars': ['warn', { args: 'after-used' }],
      'no-undef': 'error',
      'no-implicit-globals': 'off'
    }
  },
  {
    files: ['code/core_engine/test/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly' }
    }
  },
  {
    ignores: ['node_modules/**', '**/*.min.js', 'code/frontend/vendor/**']
  }
];
