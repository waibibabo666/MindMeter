# MindMeter 汇报幻灯片（Slidev）

对应《创新工程实践营》项目汇报考核：**产品设计 8 分钟 + 功能演示 2 分钟 + 答辩 5 分钟**。
放在 `docs/slides/` 下，和其余文档一起归档。

## 一、怎么启动（不需要叫我）

**方式 A：双击 `start.cmd`（推荐，离线可用）**

- 前提：本机已装 `@slidev/cli`（`slidev --version` 有输出即可）；装好后全程离线运行，不联网；
- 双击后会打开 http://localhost:3030 ，按 `Ctrl+C` 结束。

**方式 B：命令行**

```powershell
cd docs/slides
slidev slides.md --port 3030 --open
```

**方式 C：没有 Node / 只想放映**

先在有 Node 的机器上生成 PDF（一次即可）：

```powershell
cd docs/slides
powershell -File export-offline.ps1
# 产出：MindMeter-汇报.pdf（双击即可放映）、dist/（静态站）
```

之后只拷 `MindMeter-汇报.pdf` 到任何电脑都能离线放映，不需要 Node 和 Slidev。

演示快捷键：`p` 演讲者模式（备注在每页 `<!-- -->` 里）、`o` 总览、`g` 跳页、`f` 全屏。

## 二、文件

| 文件 / 目录 | 说明 |
| --- | --- |
| `slides.md` | 27 页幻灯片正文（严格按参考文档编号，含演讲备注） |
| `style.css` | 品牌色与版式（封面、流程图、截图占位框） |
| `review.md` | 制作 → 审核 → 评分 loop、23 条审核表、截图清单 |
| `tools/audit.mjs` | 静态审计：结构 / 编号 / 密度 / 截图占位（`node tools/audit.mjs`） |
| `tools/render-check.mjs` | 渲染检查：逐页截图 + 溢出检测（需先起 dev server） |
| `start.cmd` / `start.ps1` | 一键启动开发预览 |
| `export-offline.ps1` | 构建静态站 + 导出 PDF |

## 三、结构（对应考核点）

| 页 | 内容 |
| --- | --- |
| 1–2 | 封面、汇报结构 |
| 3–10 | 产品设计：1.1.1–1.1.6、1.2 / 1.2.1–1.2.3、2 设计原则 |
| 11–12 | 2.1 测评依据（题库来源）、2.2 科学性与局限 |
| 13–31 | 产品实现与质量：3.1–3.7（技术栈、仓库协作、生命周期、架构、Agent 与护栏、ER 图、接口、前端、质量、代码统计） |
| 32 | 第二部分：功能演示脚本（2 分钟） |
| 33–34 | 第三部分：答辩、结尾 |

## 四、验收

```powershell
node docs/slides/tools/audit.mjs        # 期望：100/100
node docs/slides/tools/render-check.mjs --count 34   # 期望：34 页 0 溢出
```

## 五、截图（待作者补充）

`review.md` 第二节列了 3 张必交 + 1 张可选截图；拿到后放进 `docs/slides/images/`，
把对应 `<div class="shot">…</div>` 换成 `<img src="/images/xxx.png" class="shot-img" />`。

## 说明

- 所有数字（提交数、代码行数、pytest 用例数）取自仓库真实数据；
- 引用来源标在页面右下角（MoCA 2005、AERA/APA/NCME 2014、ADR-0002 等）；
- 演讲备注包含每段建议时长，总时长约 8 分钟。
