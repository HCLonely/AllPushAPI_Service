# All Push API 平台使用文档

本项目是统一推送平台，包含：

- 后端 API（Fastify + Prisma + SQLite）
- Web 管理面板（React + Ant Design）
- 用户体系（注册/登录/角色）
- API Key 推送调用

## 快速开始

### 0) 安装环境

- [NodeJS >= v20.0.0](https://nodejs.org/zh-cn/download)

### 1) 安装依赖

```bash
npm install
```

### 2) 初始化数据库

```bash
npm run prisma:push -w @allpush/api
```

### 3) 构建

```bash
npm run build
```

### 4) 启动

开发模式：

```bash
npm run dev
```

生产模式（先构建再启动）：

```bash
npm start
```

默认访问：`http://localhost:3000`

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

## Docker 部署

### 使用 docker-compose（推荐）

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
  -e JWT_SECRET=your-secret-key \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=your-password \
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
