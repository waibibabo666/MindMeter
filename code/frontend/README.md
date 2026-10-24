# Frontend

负责首页、档位选择、知情同意、8 个任务、报告、历史、设置和 4 款补充练习。

## 页面

| 页面 | 作用 |
| --- | --- |
| 首页 | 8 项能力、三档时长、开始按钮、历史/设置入口 |
| 档位页 | 快测 2 项 / 标准 4 项 / 深度 8 项 |
| 同意页 | 18+、非诊断、数据只存本地；不收集人口学信息 |
| 任务页 | 说明 → 1–2 次练习 → 正式试次；进度与计时 |
| 报告页 | 八维雷达图、维度分、2–3 条建议、局限；**不显示总分** |
| 历史页 | 本地记录、共同维度复测对比、清除数据 |
| 设置页 | BYOK（endpoint/model/key）、AI 开关、ASR 说明、数据清除 |
| 练习页 | 心算、舒尔特、翻牌、快速分类（不计分） |

## 计划目录

```text
frontend/
├─ index.html
├─ src/
│  ├─ main.js          # 入口与页面切换
│  ├─ pages/           # 首页、档位、同意、报告、历史、设置
│  ├─ tasks/           # vc, vf, nc, ps, ir, sv, am, ni
│  ├─ ai/              # byok.js, validate.js, templates.js
│  ├─ practice/        # math, schulte, flip, sort
│  ├─ storage.js       # localStorage 读写
│  └─ styles/
└─ README.md
```

## 约定

- 页面不写计分公式，统一调用 `core_engine`；
- 每完成一个任务写一次 draft，刷新后从当前任务说明页重开；
- 手机端 360px 起可用，按钮不小于 44×44px；
- 不收集姓名、手机号、年龄、学历、学校、公司等身份/人口学信息；
- 不接第三方广告/统计；
- AI 默认关闭；BYOK Key 只存本机；
- 言语流畅性只使用 Web Speech API（Chrome/Edge），不做键盘替代。

## 启动

原型：直接打开 `../../docs/software/prototype/index.html`。
正式实现：技术方案确定后补充；原生静态文件可直接用浏览器打开。
