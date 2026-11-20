/**
 * 说明页：把散落在各页的说明集中到一处。
 *
 * 目标：页面整洁（报告/首页只留一句话 + 链到本页），
 * 同时把「测什么、怎么测、分数怎么来、依据是什么、边界在哪」讲清楚。
 */
import { el, button } from '../ui.js';
import { DIMS, LIMITS, TASK_META, STANDARD_ORDER } from '../data.js';
import { SCORING_VERSION } from '../scoring/index.js';

const MEASURED = new Set(STANDARD_ORDER);

const DIM_MEANING = {
  vc: '词汇与语义知识：近义词、反义词、句子理解',
  vf: '言语流畅性：限定时间内说出符合类别的词',
  nc: '数字运算：算术与时序计算',
  ps: '加工速度：在限定时间内快速比对符号',
  ir: '归纳推理：从样例中提取规则',
  sv: '空间视觉化：在头脑中旋转、比对图形',
  am: '联想记忆：词对编码与再认',
  ni: '自然探索：自然常识与分类关系',
};

const PARADIGM = {
  vc: '词汇知识测验（crystallized knowledge）范式：以近义词与语境选词测量词汇掌握，受短期状态影响较小。',
  ps: '视觉搜索／符号匹配范式：在限定时间内比对符号组，反映加工速度与视觉搜索效率。',
  sv: '心理旋转范式（Shepard & Metzler, 1971）：判断图形旋转后的形态，反映空间表征操作。',
  am: '词对再认 + 信号检测论：用命中与虚报计算辨别力 d′，并做对数线性校正（Stanislaw & Todorov, 1999）。',
};

function section(title, children) {
  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title', text: title }),
    ...children,
  ]);
}

function dimTable() {
  const rows = DIMS.map((dim) => {
    const measured = MEASURED.has(dim.id);
    return el('tr', { class: measured ? '' : 'untested' }, [
      el('th', { scope: 'row', text: dim.name }),
      el('td', { class: 'muted', text: DIM_MEANING[dim.id] || '—' }),
      el('td', { text: measured ? '已测' : '未测' }),
    ]);
  });
  return el('table', { class: 'report-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: '维度' }),
        el('th', { scope: 'col', text: '测什么' }),
        el('th', { scope: 'col', text: '标准档' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

function taskList() {
  return el(
    'ul',
    { class: 'plain-list' },
    STANDARD_ORDER.map((id) => {
      const meta = TASK_META[id];
      const name = DIMS.find((dim) => dim.id === id).name;
      const paradigm = PARADIGM[id] ? ` ${PARADIGM[id]}` : '';
      return el('li', { text: `${name}：${meta.desc}${paradigm}` });
    }),
  );
}

export function renderAbout(root, ctx) {
  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'about-title' }, [
      el('p', { class: 'kicker', text: '关于' }),
      el('h1', { id: 'about-title', class: 'page-title', text: '说明' }),
      el('p', {
        class: 'lead',
        text: '这一页集中说明 MindMeter 测什么、怎么测、分数怎么来、依据是什么、哪些事情它做不到。',
      }),

      section('这是什么', [
        el('p', {
          class: 'muted',
          text: 'MindMeter 是一个课程演示性质的认知自评工具：用几个短任务观察八类认知表现，按维度给参考分，并用对话解释结果。',
        }),
        el('p', {
          class: 'muted',
          text: '它不是医疗器械，不提供诊断、治疗或医疗建议；不设总分、没有常模、不做百分位，也不与任何人比较。',
        }),
      ]),

      section('关于这个项目', [
        el('p', {
          class: 'muted',
          text: '这是课程作业演示版，不是商业产品，也不对外提供服务：代码、数据与模型额度都由课程团队自行准备。',
        }),
        el('ul', { class: 'plain-list' }, [
          el('li', {
            text: '用途：课程交付与人工可用性测试，收集的是反馈，不是用于研究或诊断的用户数据。',
          }),
          el('li', {
            text: '不收费、无广告、不做用户画像商业化；账号只用于把你的数据和你自己绑定。',
          }),
          el('li', {
            text: '注册不收集邮箱、姓名或手机号，因此无法自助找回密码；忘记密码需要联系课程团队重置。',
          }),
          el('li', {
            text: '题目、阈值与文案都还在迭代中：已知的题库深度限制见「局限与版本」，实测反馈会持续修正。',
          }),
          el('li', {
            text: '如果你在使用中发现分数或结论明显不对，请通过课程团队反馈，我们会保留用例复现。',
          }),
        ]),
      ]),

      section('测哪些维度', [
        dimTable(),
        el('p', {
          class: 'tiny',
          text: '三档测的是同样的 8 个维度，差别只在题量与限时：题量越多，分数旁边的 ± 区间越窄。未测维度显示「未测」，不按 0 分计算，也不参与任何平均、排名或趋势。',
        }),
      ]),

      section('怎么测', [
        taskList(),
        el('p', {
          class: 'tiny',
          text: '任务只采集原始指标（正确数、反应时、命中与虚报），分数由服务端按固定公式折算，不由模型生成。',
        }),
      ]),

      section('分数怎么来的', [
        el('p', {
          class: 'muted',
          text: `每个已测维度按 ${SCORING_VERSION} 折算为 0–100 的参考分；分数越高表示本次任务表现越好，仅此而已。`,
        }),
        el('ul', { class: 'plain-list' }, [
          el('li', {
            text: '联想记忆用信号检测论的辨别力 d′，并对 0/1 极端值做 +0.5 校正，避免全对或全错时数值失真。',
          }),
          el('li', { text: '未测维度留空，不参与任何平均、排名或趋势计算。' }),
          el('li', {
            text: '题目按固定顺序呈现；趋势只比较两次都测过的共同维度，同一份卷子间隔不足 7 天复测会有练习效应，报告页会把这种间隔标出来。',
          }),
        ]),
      ]),

      section('科学依据与来源', [
        el('ul', { class: 'plain-list' }, [
          el('li', {
            text: '维度框架参考 Cattell–Horn–Carroll（CHC）能力分类，从中选取可短时测查的 8 个维度。',
          }),
          el('li', {
            text: '联想记忆的计分采用信号检测论（d′），校正方式与 Stanislaw & Todorov (1999) 一致。',
          }),
          el('li', {
            text: '空间任务采用心理旋转范式（Shepard & Metzler, 1971）；知觉速度采用符号匹配的视觉搜索范式。',
          }),
          el('li', {
            text: '解释与建议引用的知识库共 30 条，全部经人工核对并记录来源；未核对的条目不进入检索索引。',
          }),
        ]),
      ]),

      section('与临床量表的关系', [
        el('p', {
          class: 'muted',
          text: '本产品没有采用蒙特利尔认知评估（MoCA）、简易精神状态检查（MMSE）等临床量表，也不提供任何临床筛查结论。',
        }),
        el('ul', { class: 'plain-list' }, [
          el('li', { text: '临床量表有明确的版权与授权要求，且需要由受训人员在标准条件下施测。' }),
          el('li', { text: '临床量表面向筛查与诊断用途；本产品只做自评参考，两者不能混用。' }),
          el('li', {
            text: '如果你对自己的认知状态有持续担忧，应咨询医生或学校心理中心，而不是依据本报告判断。',
          }),
        ]),
      ]),

      section('AI 的边界', [
        el('ul', { class: 'plain-list' }, [
          el('li', { text: 'AI 只解释结果、复述知识库、给练习建议，不参与出题与计分。' }),
          el('li', {
            text: '回答必须带知识块引用；出现 facts 之外的数字、或把某个维度的分数写到别的维度上，整条会被拦截并回退模板。',
          }),
          el('li', {
            text: '回答不做等级评价（不说"中等/较好/较弱"），只描述本次任务条件与原始数字。',
          }),
          el('li', {
            text: '出现危机表述时不调用模型，直接给出心理援助热线；医疗类问题固定拒答。',
          }),
          el('li', { text: '未配置模型、超时、限流、鉴权失败时一律回退模板，页面不会空白。' }),
        ]),
      ]),

      section('数据与隐私', [
        el('ul', { class: 'plain-list' }, [
          el('li', {
            text: '测评、对话与记忆保存在站点的 PostgreSQL 数据库，并按账号隔离；只有你登录的浏览器能看到。',
          }),
          el('li', {
            text: '模型 Key 只存在于服务端环境变量，不进入前端存储、数据库、日志或导出文件。',
          }),
          el('li', { text: '导出的 JSON 可用于备份与迁移；清除数据后不可恢复，建议先导出。' }),
          el('li', {
            text: '数据只属于当前账号，可随时在「记忆」或设置里清除；面向 18 岁以上用户，非临床诊断，也不能替代专业评估。',
          }),
          el('li', {
            text: '对话只保留本账号最近 20 条；提问会发送给站点配置的模型服务，不要把手机号、身份证号等敏感信息发进来。',
          }),
          el('li', {
            text: '记忆分三类：画像需要你确认后 AI 才会引用；摘要每次测评最多一条，只记录最低项与建议数量，不写能力评价；建议记录用来打勾完成。删除后 AI 都不会再引用。',
          }),
          el('li', {
            text: '「清除本账号数据」保留账号本身；注销账号会立即级联删除全部数据，站点不设二次确认期。修改密码只会让其他设备退出登录。',
          }),
          el('li', {
            text: '年龄与学历只用于同龄段参考与有效性判断，不参与计分；睡眠与疲劳属于临场状态，每次都重新问，只影响这一次的解读，不写进账号档案。',
          }),
          el('li', {
            text: '游戏中心的成绩只记在本设备，用于自由练习，不计入测评报告，也不改变任何维度分数。',
          }),
        ]),
      ]),

      section('局限与版本', [
        el(
          'ul',
          { class: 'plain-list' },
          LIMITS.map((text) => el('li', { text })),
        ),
        el('p', {
          class: 'tiny',
          text: '更新：2026-11 · 计分口径 scoring-v3.2 · 说明页与各页的免责文案同源，避免表述不一致。',
        }),
      ]),

      el('div', { class: 'row' }, [
        button('去做测评', () => ctx.go('/tier'), { variant: 'primary' }),
        button('返回首页', () => ctx.go('/'), { variant: 'ghost' }),
      ]),
    ]),
  );
}
