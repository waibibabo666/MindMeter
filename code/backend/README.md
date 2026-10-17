# Backend（API 与业务服务）

负责账号、测评会话、作答数据、报告、订阅与运营后台的 API 与业务编排。

## 职责边界

- 对外提供版本化 REST API（`/api/v1`），负责鉴权、限流、幂等与审计。
- 管理测评会话状态机，保证断点续答与提交不丢失。
- 调用 `core_engine` 完成计分与报告生成，不在此重复实现计分逻辑。
- 执行数据生命周期：同意记录、导出、删除、保留期与备份。

## 计划技术栈

【待定：语言/框架/数据库/部署方式；建议在 `docs/software.md` 架构评审后确定】

## 目录约定（待实现）

```text
backend/
├─ src/
│  ├─ api/          # 路由与控制器
│  ├─ domain/       # 领域模型与业务规则
│  ├─ services/     # 用例编排
│  ├─ repositories/ # 数据访问
│  └─ integrations/ # 邮件、支付、对象存储等
├─ migrations/
└─ tests/
```

## 本地开发

【待定：环境变量、启动命令、数据库迁移、测试命令】

## 相关文档

- [功能需求规范](../../docs/requirements/functional_spec.md)
- [非功能需求规范](../../docs/requirements/nonfunctional_spec.md)
- [软件设计](../../docs/software.md)
