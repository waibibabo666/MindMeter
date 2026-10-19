# Core Engine（计分模块）

纯函数计分模块，不操作 DOM、不发网络请求，供前端调用、供测试直接验证。

## 对外接口

```js
import { scoreSession, SCORING_VERSION } from './src/scoring.js';

const result = scoreSession({
  workingMemory: { maxSpan: 5, accuracy: 0.75 },
  inhibition: { accuracy: 0.88, commissionErrors: 3, meanRt: 420 },
  speed: { medianRt: 310, omissions: 1 },
  memory: { hits: 9, falseAlarms: 2 }
});
// { workingMemory: 62, inhibition: 78, speed: 71, memory: 58, overall: 67, version: 'scoring-v1' }
```

## 目录

```text
core_engine/
├─ src/
│  ├─ scoring.js    # 4 个维度 + 综合分
│  └─ config.js     # 阈值、版本号
├─ test/
│  └─ scoring.test.js
└─ README.md
```

## 规则

- 公式、阈值、版本以[算法设计](../../docs/algorithm/algorithm.md)为准；
- 同一输入 + 同一配置必须返回同一结果；
- 缺失超过 20% 的维度返回 `null`，由前端显示“数据不足”；
- 任何公式修改都要升版本并补测试；
- 不使用真实用户数据做测试，测试数据全部合成。
