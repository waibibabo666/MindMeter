# Core Engine（计分模块）

纯函数计分模块，不操作 DOM、不发网络请求，供前端调用、供测试直接验证。

## 对外接口

```js
import { scoreSession, SCORING_VERSION } from './src/scoring.js';

const result = scoreSession({
  vc: { correct: 9, total: 15 },
  vf: { validCount: 21 },
  nc: { correct: 14, total: 20 },
  ps: { correct: 42 },
  ir: { correct: 8, total: 15 },
  sv: { correct: 15, total: 20, medianRt: 3200 },
  am: { hits: 9, falseAlarms: 3, targets: 12, foils: 12 },
  ni: { correct: 13, total: 20 }
}, 'deep');
// {
//   scores: { vc:60, vf:55, nc:70, ps:55, ir:53, sv:71, am:45, ni:65 },
//   missing: [],
//   version: 'scoring-v3'
// }
```

## 目录

```text
core_engine/
├─ src/
│  ├─ scoring.js    # 8 个维度，不设总分
│  └─ config.js     # 阈值、版本号
├─ test/
│  └─ scoring.test.js
└─ README.md
```

## 规则

- 公式、阈值、版本以[算法设计](../../docs/algorithm/algorithm.md)为准；
- 同一输入 + 同一配置必须返回同一结果；
- 缺失/未测维度返回 `null`，由前端显示“未测”；
- **不计算总分、均分、智商、百分位**；
- `scoring-v3` 对应 8 维；旧记录保留 `scoring-v1/v2` 的版本号，不用新版本重算；
- 任何公式修改都要升版本并补测试；
- 不使用真实用户数据做测试，测试数据全部合成。
