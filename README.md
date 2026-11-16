# All Push API 平台使用文档

本项目是统一推送平台，包含：

- 后端 API（Fastify + Prisma + SQLite）
- Web 管理面板（React + Ant Design）
- 用户体系（注册/登录/角色）
- API Key 推送调用
- 同一份平台配置绑定多个推送服务
- 管理员新增、禁用和删除用户

## 快速开始

### 0) 安装环境

- [NodeJS >= v22.12.0](https://nodejs.org/zh-cn/download)

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境并初始化数据库

复制 `.env.example` 为 `.env`，填写随机 `JWT_SECRET`（至少 32 字符）和 `ADMIN_PASSWORD`（生产至少 12 字符）。首次启动不再创建使用默认密码的管理员。

```bash
cp .env.example .env
```

```bash
npm run prisma:push -w @allpush/api
```

### 3) 构建

```bash
npm run build
```

### 4) 启动

完成构建后启动：

```bash
npm start
```

默认访问：`http://localhost:3000`。本地开发、测试与升级步骤参见 [开发说明](Development.md)。

## 平台配置与用户管理

1. 在“推送服务”创建服务，再进入“平台配置”新增配置。
2. “绑定服务”支持多选，填写一次平台凭据即可供多个服务共用。编辑或禁用此配置会同时影响所有绑定服务。
3. 为各服务创建 API 密钥；使用密钥推送时，只向该密钥绑定服务下已启用的平台配置发送，每份配置投递一次。

配置保存后，可点击该行“发送测试”，选择已启用的绑定服务并填写测试标题、正文。测试只发送当前配置，会真实通知收件人；弹窗显示结果、响应码及耗时，并在投递记录中保留日志。测试无需创建 API 密钥，停用的配置或服务需先启用。

删除服务时会撤销该服务的密钥并删除其投递记录；共享平台配置仍绑定其他服务时会保留，最后一个绑定服务删除后才会删除配置。

管理员可在“系统管理 → 用户管理”删除其他用户，确认后会永久删除该用户及其 API 密钥、服务、平台配置、路由规则、推送日志和访问日志，原有登录凭证立即失效。当前登录账户不能删除。

已有部署升级时，先备份数据库，再执行 `npm run prisma:push -w @allpush/api`、`npm run build` 并重启。启动时会自动补齐旧平台配置的服务绑定，具体步骤参见 [开发说明](Development.md#升级已有数据库)。Docker 镜像启动时自动同步表结构。

## API 文档入口

完整 API 调用手册（请求参数、返回参数、功能与参数说明）：

- [apps/api/README.md](apps/api/README.md)

## 推送调用最小示例

```bash
curl -X POST "http://localhost:3000/api/v1/push/send" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: apu_xxx" \
  -d '{
    "title": "测试",
    "message": "Hello"
  }'
```

## 环境变量

文件：`.env`（项目根目录）

- `DATABASE_URL`
- `JWT_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `LOG_RETENTION_DEFAULT_DAYS`
- `PORT`（可选，默认 3000）
- `HOST`（可选，默认 `0.0.0.0`）
- `ALLOW_REGISTRATION`（可选，设为 `false` 关闭公开注册）
- `ALLOW_PRIVATE_NETWORK`（默认 `false`；仅受信任自建部署可设为 `true` 访问内网渠道及代理）
- `LOG_LEVEL`（默认 `info`）

## Docker 部署

### 使用预构建镜像（推荐）

镜像自动跟随 `main` 分支构建，无需本地编译。

```bash
docker pull ghcr.io/hclonely/allpushapi_service:main

docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/data \
  -e JWT_SECRET=replace-with-a-random-secret-at-least-32-chars \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=replace-with-a-strong-password \
  ghcr.io/hclonely/allpushapi_service:main
```

镜像详情页：[ghcr.io/hclonely/allpushapi_service](https://github.com/users/hclonely/packages/container/package/allpushapi_service)

docker-compose 方式：

```yaml
services:
  allpush-api:
    image: ghcr.io/hclonely/allpushapi_service:main
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - JWT_SECRET=replace-with-a-random-secret-at-least-32-chars
      - ADMIN_USERNAME=admin
      - ADMIN_PASSWORD=replace-with-a-strong-password
    restart: unless-stopped
```

### 使用 docker-compose 本地构建

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止
docker-compose down
```

### 使用 Docker 直接构建

```bash
docker build -t all-push-api .
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/data \
  -e JWT_SECRET=replace-with-a-random-secret-at-least-32-chars \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=replace-with-a-strong-password \
  all-push-api
```

### 数据持久化

SQLite 数据库文件存储在 `/data/app.db`，通过 volume 挂载到宿主机 `./data` 目录。

## systemd 服务安装（仅 Linux）

构建完成后，一键安装为系统服务：

```bash
npm run service
```

脚本自动完成：

- 创建 `/etc/systemd/system/allpush-api.service`
- 设置开机自启
- 启动服务

手动管理命令：

```bash
systemctl status allpush-api      # 查看状态
systemctl restart allpush-api     # 重启
systemctl stop allpush-api        # 停止
journalctl -u allpush-api -f      # 查看日志
```

## LICENSE

[Apache License 2.0](https://github.com/HCLonely/AllPushAPI_Service/blob/main/LICENSE)
