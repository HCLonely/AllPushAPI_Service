# All Push API 详细调用文档

本文档面向接口调用方，覆盖请求参数、返回参数、功能说明与示例。

**[推送API](#8-统一推送接口-push-send)**

## 1. 基础信息

- Base URL：与前端网站 host 一致（文档页面会自动替换为当前访问地址，本地开发默认 `http://localhost:3000`）
- API 前缀：`/api/v1`
- 健康检查：`GET /health`

### 认证方式

1) JWT（后台管理接口）
- Header：`Authorization: Bearer <accessToken>`
- 获取方式：`POST /api/v1/auth/login`

2) API Key（统一推送接口）
- Header：`X-API-Key: apu_xxx`
- 使用场景：`POST /api/v1/push/send`

### 通用错误响应

```json
{
  "message": "错误说明"
}
```

---

## 2. 认证接口（Auth）

### 2.1 用户注册

- **POST** `/api/v1/auth/register`
- 功能：注册普通用户（USER）
- 认证：不需要

请求体：

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---:|---|---|
| username | string | 是 | 最少 3 位 | 用户名 |
| password | string | 是 | 最少 6 位 | 密码 |

成功响应（201）：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 用户 ID |
| username | string | 用户名 |
| role | `USER` | 角色 |
| status | `ACTIVE`/`DISABLED` | 状态 |

### 2.2 登录

- **POST** `/api/v1/auth/login`
- 功能：登录并签发 JWT
- 认证：不需要

请求体：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| username | string | 是 | 用户名 |
| password | string | 是 | 密码 |

成功响应（200）：

| 字段 | 类型 | 说明 |
|---|---|---|
| accessToken | string | JWT（默认 7 天） |
| user.id | string | 用户 ID |
| user.username | string | 用户名 |
| user.role | `USER`/`ADMIN` | 角色 |

失败：`401` 用户名或密码错误。

### 2.3 当前登录用户

- **GET** `/api/v1/auth/me`
- 功能：获取当前 JWT 对应用户
- 认证：JWT

成功响应（200）：

```json
{
  "user": {
    "id": "...",
    "username": "demo",
    "role": "USER",
    "status": "ACTIVE"
  }
}
```

---

## 3. 管理员接口（Admin）

### 3.1 用户列表

- **GET** `/api/v1/admin/users`
- 认证：JWT（ADMIN）

响应字段：
- `items[]`：`id, username, role, status, createdAt, lastLoginAt`

### 3.2 新增用户

- **POST** `/api/v1/admin/users`
- 认证：JWT（ADMIN）

请求体：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| username | string | 是 | 最少 3 位 |
| password | string | 是 | 最少 6 位 |
| role | `USER`/`ADMIN` | 否 | 默认 `USER` |

### 3.3 修改用户状态

- **PATCH** `/api/v1/admin/users/:id/status`
- 认证：JWT（ADMIN）

请求体：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| status | `ACTIVE`/`DISABLED` | 是 | 用户状态 |

---

## 4. API Key 接口

### 4.1 查询 API Key

- **GET** `/api/v1/api-keys`
- 认证：JWT

响应：`items[]` 包含 `id, name, keyPrefix, status, expiresAt, lastUsedAt, createdAt`。

### 4.2 创建 API Key

- **POST** `/api/v1/api-keys`
- 认证：JWT

请求体：

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---:|---|---|
| name | string | 是 | 非空 | Key 名称 |
| expiresAt | string | 否 | ISO datetime | 过期时间 |

成功响应会返回一次明文密钥：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 记录 ID |
| name | string | 名称 |
| apiKey | string | 明文 Key（仅此处可见） |
| keyPrefix | string | 前缀 |
| expiresAt | string/null | 过期时间 |

### 4.3 撤销 API Key

- **PATCH** `/api/v1/api-keys/:id/revoke`
- 认证：JWT

成功后该 Key 不再可用于推送。

---

## 5. 推送服务（Push Services）

### 5.1 列表
- **GET** `/api/v1/push-services`

### 5.2 创建
- **POST** `/api/v1/push-services`

### 5.3 更新
- **PATCH** `/api/v1/push-services/:id`

### 5.4 删除
- **DELETE** `/api/v1/push-services/:id`

以上接口均需 JWT。

请求字段（创建/更新）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| name | string | 创建必填 | 服务名称 |
| baseUrl | string(url) | 创建必填 | 服务地址 |
| authConfig | object | 否 | 鉴权配置 |
| timeoutMs | number | 否 | 1-60000 |
| isEnabled | boolean | 否 | 是否启用 |

---

## 6. 渠道配置（Channel Configs）

### 6.1 列表

- **GET** `/api/v1/channel-configs`
- Query：`serviceId`、`platform`（可选）

### 6.2 创建

- **POST** `/api/v1/channel-configs`

### 6.3 更新

- **PATCH** `/api/v1/channel-configs/:id`

### 6.4 删除

- **DELETE** `/api/v1/channel-configs/:id`

请求字段（创建/更新）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| serviceId | string | 创建必填 | 所属服务 ID |
| platform | string | 创建必填 | 平台名（如 WPush） |
| configName | string | 创建必填 | 配置名称 |
| configPayload | object | 创建必填 | 平台配置载荷 |
| tags | string | 否 | 逗号分隔标签 |
| priority | number(int) | 否 | 优先级（越小越高） |
| isEnabled | boolean | 否 | 是否启用 |

---

## 7. 平台模板（Templates）

### 7.1 平台列表
- **GET** `/api/v1/templates/platforms`
- 响应：`items[]` 包含 `platform,key,fieldCount`

### 7.2 平台 schema
- **GET** `/api/v1/templates/platforms/:platform/schema`
- 响应：`platform,key,schema`

说明：`:platform` 支持名称归一化匹配（大小写、空格、下划线、连字符差异可容忍）。

---

## 8. 统一推送接口（Push Send）

### 8.1 发送推送

- **POST** `/api/v1/push/send`
- 认证：`X-API-Key`
- 限流：按服务端配置生效（默认每分钟 60 次）

请求体：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| title | string | 否 | 标题 |
| message | string | 条件必填 | 与 `content` 至少传一个 |
| content | string | 条件必填 | 与 `message` 至少传一个 |
| type | string | 否 | 消息类型 |
| to | string/string[] | 否 | 接收方 |
| customOptions | any | 否 | 自定义参数 |
| extraOptions | any | 否 | 额外参数 |
| requestId | string | 否 | 业务请求号，不传则服务端生成 |

发送规则：

- 自动向当前 API Key 所属用户下所有“已启用配置 + 已启用服务”发送。

成功响应（兼容字段始终存在）：

| 字段 | 类型 | 说明 |
|---|---|---|
| requestId | string | 请求号 |
| status | `SUCCESS`/`PARTIAL_FAILED`/`FAILED` | 聚合状态 |
| successCount | number | 成功条数 |
| failedCount | number | 失败条数 |
| total | number | 总投递条数 |

失败明细扩展字段（仅 `failedCount > 0` 时返回）：

| 字段 | 类型 | 说明 |
|---|---|---|
| errorSummary | object | 按错误码聚合计数，如 `HTTP_401: 2` |
| failedDetails | array | 失败明细（限长） |
| detailLimit | number | 明细上限（默认 20） |
| detailAvailable | number | 实际失败总条数 |
| detailTruncated | boolean | 是否截断 |
| detailReference.requestId | string | 请求号 |
| detailReference.endpoint | string | 查询详细日志接口地址 |

`failedDetails[]` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| serviceId | string | 服务 ID |
| channelConfigId | string | 配置 ID |
| platform | string | 平台 |
| configName | string | 配置名 |
| responseCode | number/null | 响应码 |
| errorCode | string/null | 提取出的错误码 |
| errorMessage | string | 错误说明（已截断/脱敏） |
| retryable | boolean | 是否可重试（默认 5xx 或未知错误判定为 true） |

调用示例：

```bash
curl -X POST "http://localhost:3000/api/v1/push/send" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: apu_xxx" \
  -d '{
    "title": "测试",
    "message": "Hello"
  }'
```

部分失败响应示例：

```json
{
  "requestId": "req_demo_001",
  "status": "PARTIAL_FAILED",
  "successCount": 1,
  "failedCount": 2,
  "total": 3,
  "errorSummary": {
    "HTTP_401": 1,
    "UNKNOWN": 1
  },
  "failedDetails": [
    {
      "serviceId": "svc_1",
      "channelConfigId": "cfg_1",
      "platform": "WPush",
      "configName": "生产配置",
      "responseCode": 401,
      "errorCode": null,
      "errorMessage": "unauthorized",
      "retryable": false
    }
  ],
  "detailLimit": 20,
  "detailAvailable": 2,
  "detailTruncated": true,
  "detailReference": {
    "requestId": "req_demo_001",
    "endpoint": "/api/v1/logs/push-requests/cuid_xxx"
  }
}
```

常见错误：
- `401`：缺少/无效/过期 API Key
- `403`：用户被禁用
- `400`：请求体不合法（如缺少 `message/content`）或没有可用推送配置

---

## 9. 日志接口（Logs）

### 9.1 推送请求日志列表
- **GET** `/api/v1/logs/push-requests`
- 认证：JWT
- 响应：最近 200 条当前用户推送请求日志

### 9.2 推送请求日志详情
- **GET** `/api/v1/logs/push-requests/:id`
- 认证：JWT
- 响应：PushRequest + deliveries（每条投递明细）

### 9.3 访问日志
- **GET** `/api/v1/logs/access`
- 认证：JWT
- 响应：最近 200 条当前用户访问日志

---

## 10. 系统设置与管理员日志

### 10.1 获取系统设置
- **GET** `/api/v1/admin/settings`
- 认证：JWT（ADMIN）
- 响应：`{ "logRetentionDays": number }`

### 10.2 更新系统设置
- **PATCH** `/api/v1/admin/settings`
- 认证：JWT（ADMIN）

请求体：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| logRetentionDays | number(int) | 是 | 1-3650 |

### 10.3 管理员访问日志
- **GET** `/api/v1/admin/logs/access`
- 认证：JWT（ADMIN）

### 10.4 管理员推送日志
- **GET** `/api/v1/admin/logs/push-requests`
- 认证：JWT（ADMIN）

### 10.5 执行日志清理
- **POST** `/api/v1/admin/logs/cleanup`
- 认证：JWT（ADMIN）
- 说明：按照 `logRetentionDays` 清理历史日志。

---
