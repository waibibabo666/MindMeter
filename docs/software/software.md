# MindMeter 软件设计

## 一、文档信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | MM-DES-002 |
| 版本 | v1.0 |
| 状态 | 完成（技术栈 W2 确认） |
| 文档负责人 | song |
| 评审人 | waibibabo666、xlr268、1213lz |
| 最后更新 | 2026-10-19 |
| 关联文档 | [功能需求规范](../requirements/functional_spec.md)、[算法设计](../algorithm/algorithm.md) |

## 二、目标与约束

6 周内做一个**纯前端、本地存储、静态部署**的 Web 应用：

- 不建账号、不接数据库、不做后端接口；
- 4 个游戏和报告都在浏览器里完成；
- 计分逻辑独立成模块，方便测试和复用；
- 静态托管即可上线，成本接近零。

## 三、架构

```text
浏览器
├─ 页面与游戏（frontend）
├─ 计分模块（core_engine，纯函数）
└─ localStorage（测评记录）
        │
        ▼
静态托管（GitHub Pages / Vercel / Netlify，HTTPS）
```

`code/backend` 本期不启用，只保留目录；后续若要做账号或跨设备同步再启用，本期不写接口。

## 四、模块划分

| 模块 | 职责 | 不做什么 |
| --- | --- | --- |
| `frontend` | 首页、同意页、4 个游戏、报告页、历史页、数据清除 | 不实现计分公式 |
| `core_engine` | 指标计算、0–100 映射、综合分、配置版本 | 不操作 DOM、不发请求 |
| `backend` | 本期空目录，预留未来同步/账号 | 本期不实现 |
| `tests` | 计分单测、流程集成测试 | 不使用真实用户数据 |

## 五、目录结构

```text
code/
├─ frontend/
│  ├─ index.html
│  ├─ src/
│  │  ├─ main.js          # 入口与路由
│  │  ├─ pages/           # 首页、同意、报告、历史
│  │  ├─ games/           # 4 个游戏
│  │  ├─ components/      # 进度条、雷达图、卡片
│  │  └─ styles/
│  └─ README.md
├─ core_engine/
│  ├─ src/
│  │  ├─ scoring.js       # 计分公式
│  │  └─ config.js        # 阈值与版本
│  ├─ test/
│  │  └─ scoring.test.js
│  └─ README.md
└─ backend/
   └─ README.md           # 本期不启用
```

如团队选择 Vite + React，可把 `frontend/src/pages` 换成路由页面，`core_engine` 保持为独立纯函数模块；W2 定稿后更新本文档。

## 六、数据流

```text
游戏作答
  → 每个游戏输出原始指标
  → core_engine.scoreSession(results)
  → { 四维分数, 综合分, 版本 }
  → 报告页渲染
  → localStorage 追加一条 session
  → 历史页读取并对比
```

报告只依赖计分结果和静态文案，不依赖网络。

## 七、本地存储

- key：`mindmeter.sessions.v1`
- 结构见[功能需求规范](../requirements/functional_spec.md)第八节；
- 每局结束写入一次，避免刷新丢结果；
- 写入失败（隐私模式/空间不足）要提示用户；
- 只存测评数据，不存姓名、手机号等身份信息。

## 八、部署

| 项目 | 方案 |
| --- | --- |
| 托管 | GitHub Pages、Vercel 或 Netlify，优先免费额度 |
| 协议 | HTTPS |
| 构建 | 纯静态文件直接部署；如用 Vite，构建后部署 `dist/` |
| 回滚 | 保留每周演示版本 tag |
| 演示兜底 | 本地打开 `index.html` + 录屏视频 |

## 九、关键取舍

- **不做后端**：省掉账号、数据库、接口联调和部署成本；代价是换设备不同步、清浏览器会丢数据，已在隐私提示中说明。
- **不做框架锁定**：先保证 4 个游戏和计分跑通，再决定是否引入 React。
- **计分独立**：即使页面重写，`core_engine` 的公式和测试仍可复用。
- **本地优先**：比赛/课程演示不依赖网络，降低现场故障风险。
