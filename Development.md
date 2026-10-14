# 开发说明

## 环境与目录

- Node.js >= 22.12.0，npm workspaces；在项目根目录安装和执行以下命令。
- `apps/api`：Fastify API 和 Prisma 模型。
- `apps/web`：React、Ant Design 和 Vite 管理界面。
- SQLite 数据库由 `DATABASE_URL` 指定；相对 `file:` 路径相对于 `apps/api/prisma/schema.prisma` 所在目录。

## 配置与初始化

```powershell
npm ci
Copy-Item .env.example .env
```

编辑 `.env`，设置随机 `JWT_SECRET`（生产环境至少 32 字符）和初始 `ADMIN_USERNAME`、`ADMIN_PASSWORD`（生产环境密码至少 12 字符）。首次启动自动创建管理员，已有管理员时不覆盖账户。不得提交 `.env` 或数据库文件。

```powershell
npm run prisma:push -w @allpush/api
npm run prisma:generate -w @allpush/api
```

平台私网和自定义代理默认被禁止；仅受信任内网部署按需设置 `ALLOW_PRIVATE_NETWORK=true`。其他配置见根目录 `.env.example` 和 [用户说明](README.md#环境变量)。

## 本地运行

先运行一次 `npm run build` 生成 API 文档与前端静态资源，然后分别在两个终端运行：

```powershell
npm run dev
```

```powershell
npm run dev:web
```

API 默认位于 `http://localhost:3000`；前端开发服务器位于 `http://localhost:5173`，会代理 `/api` 请求到 3000。API 的 `dev` 命令直接运行 TypeScript，修改后需重新启动 API 进程。前端由 Vite 自动热更新。

## 构建与验证

```powershell
npm run build
```

构建先从 `apps/api/README.md` 生成前端 API 文档，再生成 Prisma Client、编译 API 并复制投递工作线程，最后检查前端 TypeScript 并构建 Vite 静态资源。生成的 HTML、`dist`、`*.tsbuildinfo` 不提交。

`package.json` 已预留 `npm test` 命令，匹配 `apps/api/test/*.test.ts`；当前仓库未保留自动化测试文件，需添加测试后再使用该命令。本次功能曾使用临时隔离 SQLite 数据库验证旧配置绑定补齐、多服务增删改、跨用户权限、按服务投递、删除服务保留共享配置、删除用户后的数据清理及凭证失效；测试文件未纳入仓库。后续编写集成测试时应使用独立数据库，不读取或改写 `.env` 指定的业务数据库，也不向真实推送平台发送通知。

前端没有独立的自动化测试命令。界面验证包括：新增/编辑平台配置时可多选服务且正确回显；各服务统计包含共享配置；删除服务后其他绑定可用；管理员删除按钮需要确认、请求中禁用且不能删除自己，删除后刷新访问日志。还需验证启用“减少动态效果”时下拉列表和确认框仍位于可视区域，窄屏下无页面横向溢出。

构建后可运行 `npm start` 验证生产静态页面与 API。Docker 和 Linux systemd 部署方式见 [用户说明](README.md)。

## 升级已有数据库

1. 停止旧进程，备份 `DATABASE_URL` 指向的 SQLite 文件；如启用 WAL，同时处理 `-wal` / `-shm` 文件。
2. 更新代码、运行 `npm ci`，保留现有 `.env`。
3. 运行 `npm run prisma:push -w @allpush/api`。本次模型只新增 `ChannelConfigService` 表及索引，保留旧的 `ChannelConfig.serviceId`；不需要清空或重建已有平台配置。
4. 运行 `npm run build`，再启动服务。`createServer` 会调用 `ensureChannelServiceBindings`，以 `INSERT OR IGNORE ... SELECT` 为旧配置补齐首服务关联，可重复执行。

Docker 入口脚本已在启动前执行 Prisma 表结构同步。新旧服务进程不应同时操作升级后的配置；回滚前恢复备份，避免旧程序遗漏新增的多服务绑定。

## 关联与删除约定

- `ChannelConfigService` 保存平台配置与服务的多对多关系，联合主键防止重复绑定。`ChannelConfig.serviceId` 保留为首服务兼容字段，必须也是有效绑定之一。
- 创建/更新配置在事务内校验全部服务所有权及各绑定服务中的平台配置名称唯一性。`serviceIds` 整体替换绑定，旧版 `serviceId` 请求替换为单服务绑定。
- 删除首服务时，先将兼容字段指向一个剩余服务，再删除服务；否则旧外键的级联删除会误删共享配置。最后一个服务被删除时沿用级联删除。
- 推送以 API Key 的 `serviceName` 筛选关联，使用命中服务的 ID、超时和启用状态，不能使用配置的兼容首服务代替实际投递服务。
- 管理员删除其他用户时，访问日志清理、系统设置更新者解除和用户删除处于同一事务。其余所属数据通过外键级联删除；管理员本次删除操作的访问日志保留。

## 排错

- 提示 `ChannelConfigService` 表不存在：确认对实际 `DATABASE_URL` 执行了 `prisma:push`，并重新生成 Client、构建和重启。
- Prisma 类型缺少 `bindings` / `channelConfigService`：运行 `npm run prisma:generate -w @allpush/api`。
- 首次启动提示管理员配置缺失：填写 `.env` 中的初始账号和密码；生产环境还需满足密钥和密码长度限制。
- 多绑定保存返回 `404`：检查每个 ID 是否属于当前用户且服务仍存在；`409` 表示某个绑定服务已有同平台同名配置。
- 推送返回没有可用配置：检查密钥绑定服务、服务启用状态、平台配置的绑定列表及启用状态；平台认证信息应填写在 `configPayload`。
- 平台投递超时或网络失败：查投递日志，检查平台凭据、网络与服务超时；超时后的第三方送达结果可能未知，重试前先确认收件情况。
