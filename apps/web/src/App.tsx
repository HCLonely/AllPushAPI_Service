import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Button, Card, Form, Input, Layout, List, Modal, Pagination, Select, Space, Statistic, Switch, Table, Tabs, Tag, message } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
const api = axios.create({ baseURL: apiBaseUrl });

type User = { id: string; username: string; role: 'ADMIN' | 'USER'; status: string };
type PushService = { id: string; name: string; isEnabled: boolean };
type ChannelConfig = { id: string; serviceId: string; platform: string; configName: string; tags?: string; priority: number; isEnabled: boolean; configPayload?: Record<string, unknown> };
type ApiKeyRow = { id: string; name: string; serviceName?: string; keyPrefix: string; status: string; expiresAt?: string };
type TemplatePlatform = { platform: string; key: string; fieldCount: number };
type TemplateField = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  defaultValue?: unknown;
  description?: string;
  inputType?: string;
  repeat?: boolean;
  children?: TemplateField[];
};
const toPayloadBySchema = (fields: TemplateField[], value: any): any => {
  const source = value && typeof value === 'object' ? value : {};
  const output: any = {};
  for (const field of fields) {
    const current = source[field.key];
    if (current === undefined || current === null || current === '') continue;
    if (field.type === 'object') {
      output[field.key] = toPayloadBySchema(field.children || [], current);
      continue;
    }
    if (field.type === 'boolean') {
      output[field.key] = Boolean(current);
      continue;
    }
    if (field.type === 'array') {
      if (Array.isArray(current)) {
        output[field.key] = current;
      } else if (typeof current === 'string') {
        const raw = current.trim();
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          output[field.key] = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          output[field.key] = raw.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
        }
      }
      continue;
    }
    if (field.inputType === 'number') {
      const n = Number(current);
      output[field.key] = Number.isNaN(n) ? current : n;
      continue;
    }
    output[field.key] = current;
  }
  return output;
};

const setDefaultBySchema = (fields: TemplateField[]) => {
  const output: any = {};
  for (const field of fields) {
    if (field.type === 'object' && field.children?.length) {
      output[field.key] = setDefaultBySchema(field.children);
      continue;
    }
    if (field.defaultValue !== undefined) {
      output[field.key] = field.defaultValue;
    }
  }
  return output;
};

const getApiErrorMessage = (error: unknown, fallback = '请求失败') => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as any;
    if (typeof data?.message === 'string' && data.message.trim()) return data.message;
    if (Array.isArray(data?.issues) && data.issues.length) {
      const firstIssue = data.issues[0];
      if (typeof firstIssue?.message === 'string' && firstIssue.message.trim()) return firstIssue.message;
    }
    if (typeof error.message === 'string' && error.message.trim()) return error.message;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
};

const dashboardStyles = {
  shell: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #f7f9ff 0%, #eef3fb 100%)',
    padding: '24px 16px'
  },
  container: {
    width: '100%',
    maxWidth: 1280,
    margin: '0 auto'
  },
  headerCard: {
    borderRadius: 14,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
  },
  contentCard: {
    borderRadius: 14,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)'
  },
  authCard: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 14,
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.1)'
  }
} as const;

const sectionCardStyle = {
  borderRadius: 12,
  boxShadow: '0 4px 16px rgba(15, 23, 42, 0.06)',
  borderTop: '3px solid #1677ff'
} as const;

const summaryCardStyle = {
  width: 180,
  borderRadius: 12,
  boxShadow: '0 4px 14px rgba(15, 23, 42, 0.05)'
} as const;

export function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [token, setToken] = useState(sessionStorage.getItem('token') || '');
  const [user, setUser] = useState<User | null>(null);
  const [services, setServices] = useState<PushService[]>([]);
  const [configs, setConfigs] = useState<ChannelConfig[]>([]);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [pushLogs, setPushLogs] = useState<any[]>([]);
  const [retention, setRetention] = useState(30);
  const [users, setUsers] = useState<any[]>([]);
  const [apiKeyPreview, setApiKeyPreview] = useState('');
  const [templates, setTemplates] = useState<TemplatePlatform[]>([]);

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const refreshMe = async () => {
    if (!token) return null;
    const res = await api.get('/v1/auth/me', { headers: authHeaders });
    setUser(res.data.user);
    return res.data.user as User | null;
  };

  const loadAll = async (currentUser?: User | null) => {
    if (!token) return;
    const [s, c, k, p, t] = await Promise.all([
      api.get('/v1/push-services', { headers: authHeaders }),
      api.get('/v1/channel-configs', { headers: authHeaders }),
      api.get('/v1/api-keys', { headers: authHeaders }),
      api.get('/v1/logs/push-requests', { headers: authHeaders }),
      api.get('/v1/templates/platforms', { headers: authHeaders })
    ]);
    setServices(s.data.items || []);
    setConfigs(c.data.items || []);
    setKeys(k.data.items || []);
    setPushLogs(p.data.items || []);
    setTemplates(t.data.items || []);

    const effectiveUser = currentUser ?? user;
    if (effectiveUser?.role === 'ADMIN') {
      const [settingRes, usersRes] = await Promise.all([
        api.get('/v1/admin/settings', { headers: authHeaders }),
        api.get('/v1/admin/users', { headers: authHeaders })
      ]);
      setRetention(settingRes.data.logRetentionDays || 30);
      setUsers(usersRes.data.items || []);
    }
  };

  useEffect(() => {
    refreshMe().catch((error) => {
      setToken('');
      setUser(null);
      sessionStorage.removeItem('token');
      message.error(getApiErrorMessage(error, '登录状态已失效，请重新登录'));
    });
  }, []);

  useEffect(() => {
    refreshMe().then((currentUser) => loadAll(currentUser)).catch((error) => {
      message.error(getApiErrorMessage(error, '加载数据失败'));
    });
  }, [token]);

  const login = async (values: any) => {
    try {
      const res = await api.post('/v1/auth/login', values);
      setToken(res.data.accessToken);
      sessionStorage.setItem('token', res.data.accessToken);
      setUser(res.data.user);
      message.success('登录成功');
      navigate(res.data.user.role === 'ADMIN' ? '/admin' : '/panel', { replace: true });
    } catch (error) {
      message.error(getApiErrorMessage(error, '登录失败'));
    }
  };

  const register = async (values: any) => {
    try {
      await api.post('/v1/auth/register', values);
      message.success('注册成功，请登录');
    } catch (error) {
      message.error(getApiErrorMessage(error, '注册失败'));
    }
  };

  const logout = () => {
    setToken('');
    setUser(null);
    sessionStorage.removeItem('token');
    navigate('/', { replace: true });
  };

  if (!token || !user) {
    return <AuthPage onLogin={login} onRegister={register} />;
  }

  const currentPanelTitle = location.pathname.startsWith('/admin') ? '管理员面板' : '用户面板';

  return (
    <Layout style={dashboardStyles.shell}>
      <Space direction="vertical" size={16} style={dashboardStyles.container}>
        <Card style={{ ...dashboardStyles.headerCard, border: 'none' }}>
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Space style={{ justifyContent: 'space-between', width: '100%' }} align="start" wrap>
              <Space direction="vertical" size={2}>
                <h2 style={{ margin: 0 }}>All Push {currentPanelTitle}</h2>
                <span style={{ color: '#475569' }}>控制台</span>
              </Space>
              <Space wrap>
                <Tag>{user.username}</Tag>
                <Tag color={user.role === 'ADMIN' ? 'red' : 'blue'}>{user.role}</Tag>
                <Button onClick={() => loadAll(user).catch((error) => message.error(getApiErrorMessage(error, '刷新失败')))}>刷新</Button>
                <Button onClick={() => navigate('/panel')}>用户面板</Button>
                {user.role === 'ADMIN' && <Button onClick={() => navigate('/admin')}>管理员面板</Button>}
                <Button onClick={() => navigate('/api-docs')}>API 文档</Button>
                <Button danger onClick={logout}>退出</Button>
              </Space>
            </Space>
            <Space wrap size={12}>
              <Card size="small" style={summaryCardStyle}><Statistic title="推送服务" value={services.length} /></Card>
              <Card size="small" style={summaryCardStyle}><Statistic title="平台配置" value={configs.length} /></Card>
              <Card size="small" style={summaryCardStyle}><Statistic title="API Keys" value={keys.length} /></Card>
              <Card size="small" style={summaryCardStyle}><Statistic title="请求日志" value={pushLogs.length} /></Card>
              {user.role === 'ADMIN' && <Card size="small" style={summaryCardStyle}><Statistic title="用户数" value={users.length} /></Card>}
            </Space>
          </Space>
        </Card>

        <Card style={{ ...dashboardStyles.contentCard, border: 'none' }}>
          <Routes>
            <Route
              path="/panel"
              element={
                <UserPanel
                  services={services}
                  configs={configs}
                  templates={templates}
                  keys={keys}
                  pushLogs={pushLogs}
                  reload={loadAll}
                  headers={authHeaders}
                  onPreview={setApiKeyPreview}
                />
              }
            />
            <Route
              path="/admin"
              element={
                user.role === 'ADMIN' ? (
                  <AdminPanel
                    retention={retention}
                    users={users}
                    reload={loadAll}
                    headers={authHeaders}
                  />
                ) : (
                  <Navigate to="/panel" replace />
                )
              }
            />
            <Route
              path="/api-docs"
              element={<ApiDocsPage />}
            />
            <Route path="*" element={<Navigate to={user.role === 'ADMIN' ? '/admin' : '/panel'} replace />} />
          </Routes>
        </Card>
      </Space>

      <div style={{ textAlign: 'center', color: '#64748b', paddingTop: 14, paddingBottom: 4 }}>
        © {new Date().getFullYear()} All Push. All rights reserved.
      </div>

      <Modal open={!!apiKeyPreview} onCancel={() => setApiKeyPreview('')} footer={null} title="新建 API Key（仅显示一次）">
        <Input.TextArea value={apiKeyPreview} rows={3} readOnly />
      </Modal>
    </Layout>
  );
}

function AuthPage({ onLogin, onRegister }: any) {
  return (
    <Layout style={{ ...dashboardStyles.shell, alignItems: 'center', justifyContent: 'center' }}>
      <Space direction="vertical" size={14} align="center" style={{ width: '100%' }}>
        <Card title="All Push 账户入口" style={dashboardStyles.authCard}>
          <Tabs
            items={[
              {
                key: 'login',
                label: '登录',
                children: (
                  <Form onFinish={onLogin} layout="vertical">
                    <Form.Item name="username" label="用户名" rules={[{ required: true }]}><Input size="large" /></Form.Item>
                    <Form.Item name="password" label="密码" rules={[{ required: true }]}><Input.Password size="large" /></Form.Item>
                    <Button type="primary" htmlType="submit" size="large" block>登录</Button>
                  </Form>
                )
              },
              {
                key: 'register',
                label: '注册',
                children: (
                  <Form onFinish={onRegister} layout="vertical">
                    <Form.Item name="username" label="用户名" rules={[{ required: true }, { min: 3 }]}><Input size="large" /></Form.Item>
                    <Form.Item name="password" label="密码" rules={[{ required: true }, { min: 6 }]}><Input.Password size="large" /></Form.Item>
                    <Button type="primary" htmlType="submit" size="large" block>注册</Button>
                  </Form>
                )
              }
            ]}
          />
        </Card>
        <div style={{ textAlign: 'center', color: '#64748b' }}>© {new Date().getFullYear()} All Push. All rights reserved.</div>
      </Space>
    </Layout>
  );
}

function UserPanel({ services, configs, templates, keys, pushLogs, reload, headers, onPreview }: any) {
  return (
    <Tabs
      type="card"
      items={[
        { key: 'services', label: '推送服务', children: <ServiceTab services={services} reload={reload} headers={headers} /> },
        { key: 'configs', label: '平台配置', children: <ConfigTab services={services} configs={configs} templates={templates} reload={reload} headers={headers} /> },
        { key: 'keys', label: 'API Keys', children: <KeyTab services={services} keys={keys} reload={reload} headers={headers} onPreview={onPreview} /> },
        { key: 'logs', label: '日志', children: <LogTab pushLogs={pushLogs} /> }
      ]}
    />
  );
}

function AdminPanel({ retention, users, reload, headers }: any) {
  return <AdminTab retention={retention} users={users} reload={reload} headers={headers} />;
}

function ServiceTab({ services, reload, headers }: any) {
  const [open, setOpen] = useState(false);
  const [editingService, setEditingService] = useState<PushService | null>(null);
  const [form] = Form.useForm();

  const openCreate = () => {
    setEditingService(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (item: PushService) => {
    setEditingService(item);
    form.setFieldsValue({ name: item.name });
    setOpen(true);
  };

  const closeModal = () => {
    setOpen(false);
    setEditingService(null);
    form.resetFields();
  };
  return (
    <Card style={sectionCardStyle} extra={<Button onClick={openCreate}>新增服务</Button>}>
      <List dataSource={services} renderItem={(item: PushService) => (
        <List.Item actions={[
          <Button onClick={() => openEdit(item)}>编辑</Button>,
          <Button danger onClick={async () => {
            try {
              await api.delete(`/v1/push-services/${item.id}`, { headers });
              await reload();
              message.success('删除成功');
            } catch (error) {
              message.error(getApiErrorMessage(error, '删除服务失败'));
            }
          }}>删除</Button>
        ]}>
          <List.Item.Meta title={item.name} description={item.isEnabled ? '启用' : '禁用'} />
        </List.Item>
      )} />
      <Modal
        open={open}
        title={editingService ? '编辑服务' : '新增服务'}
        onCancel={closeModal}
        onOk={async () => {
          try {
            const v = await form.validateFields();
            if (editingService) {
              await api.patch(`/v1/push-services/${editingService.id}`, v, { headers });
              message.success('更新成功');
            } else {
              await api.post('/v1/push-services', v, { headers });
              message.success('创建成功');
            }
            closeModal();
            await reload();
          } catch (error) {
            message.error(getApiErrorMessage(error, editingService ? '更新服务失败' : '创建服务失败'));
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true }]} tooltip="服务名称，仅用于当前面板识别该推送服务"><Input /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

function renderTemplateFields(fields: TemplateField[], prefix: (string | number)[] = []) {
  return fields.map((field) => {
    const name = [...prefix, field.key];
    if (field.type === 'object') {
      return (
        <Card key={name.join('.')} size="small" title={field.label} style={{ marginBottom: 12 }}>
          {renderTemplateFields(field.children || [], name)}
        </Card>
      );
    }

    if (field.type === 'boolean') {
      return (
        <Form.Item key={name.join('.')} label={field.label} name={name} valuePropName="checked" tooltip={field.description}>
          <Switch />
        </Form.Item>
      );
    }

    if (field.type === 'array') {
      return (
        <Form.Item key={name.join('.')} label={field.label} name={name} tooltip={field.description}>
          <Input.TextArea rows={4} placeholder='JSON数组，或用逗号/换行分隔' />
        </Form.Item>
      );
    }

    return (
      <Form.Item key={name.join('.')} label={field.label} name={name} rules={field.required ? [{ required: true }] : undefined} tooltip={field.description}>
        <Input type={field.inputType === 'number' ? 'number' : undefined} />
      </Form.Item>
    );
  });
}

function ConfigTab({ services, configs, templates, reload, headers }: any) {
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [schema, setSchema] = useState<TemplateField[]>([]);
  const [editingConfig, setEditingConfig] = useState<ChannelConfig | null>(null);
  const [form] = Form.useForm();
  const selectedPlatform = Form.useWatch('platform', form);

  const openCreate = () => {
    setEditingConfig(null);
    setAdvanced(false);
    setSchema([]);
    form.resetFields();
    form.setFieldValue('priority', 100);
    setOpen(true);
  };

  const openEdit = (item: ChannelConfig) => {
    setEditingConfig(item);
    setAdvanced(false);
    setSchema([]);
    const payload = item.configPayload || {};
    form.setFieldsValue({
      serviceId: item.serviceId,
      platform: item.platform,
      configName: item.configName,
      tags: item.tags,
      priority: item.priority,
      configPayload: payload,
      configPayloadText: JSON.stringify(payload, null, 2)
    });
    setOpen(true);
  };

  const closeModal = () => {
    setOpen(false);
    setAdvanced(false);
    setSchema([]);
    setEditingConfig(null);
    form.resetFields();
  };

  useEffect(() => {
    if (!open || !selectedPlatform || advanced) {
      setSchema([]);
      return;
    }
    api.get(`/v1/templates/platforms/${encodeURIComponent(selectedPlatform)}/schema`, { headers }).then((res) => {
      const nextSchema = res.data.schema || [];
      setSchema(nextSchema);
      const currentPayload = form.getFieldValue('configPayload');
      form.setFieldValue('configPayload', currentPayload || setDefaultBySchema(nextSchema));
    }).catch((error) => {
      setSchema([]);
      message.error(getApiErrorMessage(error, '加载平台模板失败'));
    });
  }, [open, selectedPlatform, advanced]);

  return (
    <Card style={sectionCardStyle} extra={<Button onClick={openCreate}>新增配置</Button>}>
      <List dataSource={configs} renderItem={(item: ChannelConfig) => (
        <List.Item actions={[
          <Button onClick={async () => {
            try {
              await api.patch(`/v1/channel-configs/${item.id}`, { isEnabled: !item.isEnabled }, { headers });
              await reload();
              message.success(item.isEnabled ? '已禁用' : '已启用');
            } catch (error) {
              message.error(getApiErrorMessage(error, '更新配置状态失败'));
            }
          }}>{item.isEnabled ? '禁用' : '启用'}</Button>,
          <Button onClick={() => openEdit(item)}>编辑</Button>,
          <Button danger onClick={async () => {
            try {
              await api.delete(`/v1/channel-configs/${item.id}`, { headers });
              await reload();
              message.success('删除成功');
            } catch (error) {
              message.error(getApiErrorMessage(error, '删除配置失败'));
            }
          }}>删除</Button>
        ]}>
          <List.Item.Meta title={`${item.platform} / ${item.configName}`} description={`status=${item.isEnabled ? 'enabled' : 'disabled'} service=${item.serviceId} tags=${item.tags || '-'} priority=${item.priority}`} />
        </List.Item>
      )} />
      <Modal open={open} width={780} title={editingConfig ? '编辑配置' : '新增配置'} onCancel={closeModal} onOk={async () => {
        try {
          const v = await form.validateFields();
          let payload = v.configPayload;

          if (advanced) {
            try {
              payload = JSON.parse(v.configPayloadText || '{}');
            } catch {
              message.error('配置JSON格式不正确');
              return;
            }
          } else {
            if (!schema.length) {
              message.error('当前平台模板不可用，请切换到高级 JSON 模式');
              return;
            }
            payload = toPayloadBySchema(schema, v.configPayload || {});
          }

          const requestBody = {
            serviceId: v.serviceId,
            platform: v.platform,
            configName: v.configName,
            tags: v.tags,
            priority: Number(v.priority || 100),
            configPayload: payload
          };

          if (editingConfig) {
            await api.patch(`/v1/channel-configs/${editingConfig.id}`, requestBody, { headers });
            message.success('更新成功');
          } else {
            await api.post('/v1/channel-configs', requestBody, { headers });
            message.success('创建成功');
          }

          closeModal();
          await reload();
        } catch (error) {
          message.error(getApiErrorMessage(error, editingConfig ? '更新配置失败' : '创建配置失败'));
        }
      }}>
        <Form form={form} layout="vertical" initialValues={{ priority: 100 }}>
          <Form.Item label="服务" name="serviceId" rules={[{ required: true }]} tooltip="选择该平台配置归属的推送服务">
            <Select options={services.map((s: any) => ({ value: s.id, label: s.name }))} />
          </Form.Item>

          <Form.Item label="平台" name="platform" rules={[{ required: true }]} tooltip="选择平台模板后会自动展示对应配置字段">
            <Select
              showSearch
              options={templates.map((t: TemplatePlatform) => ({ value: t.platform, label: t.platform }))}
              placeholder="选择平台模板"
              allowClear
            />
          </Form.Item>

          <Form.Item label="配置名" name="configName" rules={[{ required: true }]} tooltip="用于区分同一平台下的多个配置"><Input /></Form.Item>
          <Form.Item label="标签(逗号分隔)" name="tags" tooltip="仅用于配置管理分类"><Input /></Form.Item>
          <Form.Item label="优先级" name="priority" tooltip="数值越小越靠前，用于展示和发送顺序"><Input type="number" /></Form.Item>

          <Form.Item label="高级 JSON 模式" valuePropName="checked" tooltip="开启后可直接填写完整 JSON，不使用模板表单">
            <Switch checked={advanced} onChange={(checked) => {
              setAdvanced(checked);
              if (checked) {
                const currentPayload = form.getFieldValue('configPayload') || {};
                form.setFieldValue('configPayloadText', JSON.stringify(currentPayload, null, 2));
              }
            }} />
          </Form.Item>

          {advanced ? (
            <Form.Item label="配置JSON" name="configPayloadText" rules={[{ required: true }]} tooltip="请输入合法 JSON 对象，字段应与目标平台要求一致">
              <Input.TextArea rows={8} placeholder='{"key":"value"}' />
            </Form.Item>
          ) : (
            <>
              {schema.length ? renderTemplateFields(schema, ['configPayload']) : <Tag color="orange">当前平台暂无模板，切换为高级 JSON 模式可手工配置</Tag>}
            </>
          )}
        </Form>
      </Modal>
    </Card>
  );
}

function KeyTab({ services, keys, reload, headers, onPreview }: any) {
  const [form] = Form.useForm();
  const [hiddenKeyIds, setHiddenKeyIds] = useState<string[]>([]);
  return (
    <Card style={sectionCardStyle}>
      <Form form={form} layout="inline" onFinish={async (v) => {
        try {
          const res = await api.post('/v1/api-keys', v, { headers });
          onPreview(res.data.apiKey);
          form.resetFields();
          await reload();
          message.success('创建成功');
        } catch (error) {
          message.error(getApiErrorMessage(error, '创建 API Key 失败'));
        }
      }}>
        <Form.Item name="name" rules={[{ required: true }]} tooltip="用于标识 API Key 用途"><Input placeholder="Key 名称" /></Form.Item>
        <Form.Item name="serviceName" rules={[{ required: true }]} tooltip="该 Key 仅可用于此推送服务名下的配置">
          <Select style={{ minWidth: 220 }} placeholder="绑定服务名" options={services.map((s: PushService) => ({ value: s.name, label: s.name }))} />
        </Form.Item>
        <Button type="primary" htmlType="submit">新增 Key</Button>
      </Form>
      <List style={{ marginTop: 16 }} dataSource={keys.filter((item: ApiKeyRow) => item.status === 'ACTIVE' && !hiddenKeyIds.includes(item.id))} renderItem={(item: ApiKeyRow) => (
        <List.Item actions={[<Button danger onClick={async () => {
          try {
            await api.patch(`/v1/api-keys/${item.id}/revoke`, {}, { headers });
            setHiddenKeyIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
            await reload();
            message.success('删除成功');
          } catch (error) {
            message.error(getApiErrorMessage(error, '删除 API Key 失败'));
          }
        }}>删除</Button>]}>
          <List.Item.Meta title={`${item.name} (${item.keyPrefix}...)`} description={`${item.status}${item.serviceName ? ` / service=${item.serviceName}` : ''}${item.expiresAt ? ` / expires=${item.expiresAt}` : ''}`} />
        </List.Item>
      )} />
    </Card>
  );
}

function LogTab({ pushLogs }: any) {
  const getStatusTag = (status: unknown) => {
    const raw = String(status || '').toLowerCase();
    if (raw.includes('success') || raw.includes('ok') || raw.includes('成功')) {
      return <Tag color="green">成功</Tag>;
    }
    if (raw.includes('partial')) {
      return <Tag color="#8c8c8c">未知</Tag>;
    }
    if (raw.includes('fail') || raw.includes('error') || raw.includes('失败')) {
      return <Tag color="red">失败</Tag>;
    }
    return <Tag color="#8c8c8c">未知</Tag>;
  };

  return (
    <Card style={sectionCardStyle} title="推送请求日志">
      <Table
        rowKey={(record: any, index?: number) => record.requestId || `${record.createdAt || 'unknown'}-${index || 0}`}
        dataSource={pushLogs}
        pagination={false}
        columns={[
          {
            title: '请求ID',
            dataIndex: 'requestId',
            key: 'requestId',
            render: (value: string) => value || '-'
          },
          {
            title: '结果',
            dataIndex: 'status',
            key: 'status',
            width: 120,
            render: (value: unknown) => getStatusTag(value)
          },
          {
            title: '时间',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 220,
            render: (value: string) => value || '-'
          }
        ]}
      />
    </Card>
  );
}

function ApiDocsPage() {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [toc, setToc] = useState<{ id: string; text: string; level: number }[]>([]);
  const [activeId, setActiveId] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api-docs.generated.html')
      .then((res) => { if (!res.ok) throw new Error('not found'); return res.text(); })
      .then((text) => {
        const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
        setHtml(text.replace(/http:\/\/localhost:3000/g, origin));
        const headings: { id: string; text: string; level: number }[] = [];
        const re = /<h([1-3])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/gi;
        let m;
        while ((m = re.exec(text)) !== null) {
          headings.push({ level: Number(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, '') });
        }
        setToc(headings);
        setLoading(false);
      })
      .catch(() => { setLoading(false); message.error('加载API文档失败'); });
  }, []);

  useEffect(() => {
    if (!contentRef.current || toc.length === 0) return;
    const els = contentRef.current.querySelectorAll('h1[id], h2[id], h3[id]');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [html, toc]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
    }
  };

  if (loading) {
    return (
      <Card style={sectionCardStyle} loading>
        <div style={{ minHeight: 400 }} />
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      <Card style={{ ...sectionCardStyle, flex: 1, minWidth: 0 }}>
        <style>{`
          .docs-content { color: #1e293b; line-height: 1.75; }
          .docs-content h1 { font-size: 1.75rem; margin: 0 0 16px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; color: #0f172a; }
          .docs-content h2 { font-size: 1.35rem; margin: 28px 0 12px; color: #1e293b; }
          .docs-content h3 { font-size: 1.12rem; margin: 22px 0 8px; color: #334155; }
          .docs-content h4 { font-size: 1rem; margin: 16px 0 6px; color: #475569; }
          .docs-content p { margin: 0 0 12px; }
          .docs-content ul { margin: 0 0 12px; padding-left: 20px; }
          .docs-content ul li { margin-bottom: 4px; }
          .docs-content code { background: #f1f5f9; color: #d9465e; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; font-family: 'SF Mono', 'Fira Code', monospace; }
          .docs-content pre { background: #1e293b; color: #e2e8f0; padding: 16px 20px; border-radius: 10px; overflow-x: auto; margin: 0 0 16px; }
          .docs-content pre code { background: none; color: inherit; padding: 0; border-radius: 0; font-size: 0.88em; }
          .docs-content table { width: 100%; border-collapse: collapse; margin: 0 0 16px; font-size: 0.92em; }
          .docs-content table th, .docs-content table td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
          .docs-content table th { background: #f8fafc; font-weight: 600; color: #334155; }
          .docs-content table tr:nth-child(even) td { background: #fafbfc; }
          .docs-content hr { border: none; border-top: 1px solid #e2e8f0; margin: 28px 0; }
          .docs-content a { color: #1677ff; }
          .docs-content strong { color: #0f172a; }
          .docs-toc { display: block; }
          @media (max-width: 1100px) { .docs-toc { display: none; } }
        `}</style>
        <div ref={contentRef} dangerouslySetInnerHTML={{ __html: html }} />
      </Card>

      {toc.length > 0 && (
        <nav className="docs-toc" style={{
          position: 'sticky',
          top: 24,
          width: 220,
          flexShrink: 0,
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 4px 16px rgba(15, 23, 42, 0.06)',
          padding: '16px 0'
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', padding: '0 16px 10px', borderBottom: '1px solid #e2e8f0', marginBottom: 6 }}>
            目录
          </div>
          {toc.map((item) => (
            <a
              key={item.id}
              onClick={(e) => { e.preventDefault(); scrollTo(item.id); }}
              href={`#${item.id}`}
              style={{
                display: 'block',
                padding: `${item.level === 2 ? 5 : item.level === 3 ? 3 : 6}px 16px`,
                paddingLeft: 16 + (item.level - 1) * 14,
                fontSize: item.level === 1 ? 13 : item.level === 2 ? 12 : 11,
                fontWeight: item.level === 1 ? 600 : 400,
                color: activeId === item.id ? '#1677ff' : item.level === 1 ? '#334155' : '#64748b',
                background: activeId === item.id ? '#eef4ff' : 'transparent',
                borderRight: activeId === item.id ? '3px solid #1677ff' : '3px solid transparent',
                textDecoration: 'none',
                lineHeight: 1.5,
                cursor: 'pointer',
                transition: 'all 0.15s',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={item.text}
            >
              {item.text}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

function AdminTab({ retention, users, reload, headers }: any) {
  const [days, setDays] = useState(retention);
  const [form] = Form.useForm();
  const [accessLogs, setAccessLogs] = useState<any[]>([]);
  const [accessPage, setAccessPage] = useState(1);
  const [accessPageSize, setAccessPageSize] = useState(20);
  const [accessTotal, setAccessTotal] = useState(0);
  const [accessLoading, setAccessLoading] = useState(false);

  useEffect(() => setDays(retention), [retention]);

  useEffect(() => {
    const fetchAccessLogs = async () => {
      setAccessLoading(true);
      try {
        const res = await api.get('/v1/admin/logs/access', {
          headers,
          params: { page: accessPage, pageSize: accessPageSize }
        });
        setAccessLogs(res.data.items || []);
        setAccessTotal(Number(res.data.total || 0));
      } catch (error) {
        message.error(getApiErrorMessage(error, '加载访问日志失败'));
      } finally {
        setAccessLoading(false);
      }
    };

    fetchAccessLogs();
  }, [headers, accessPage, accessPageSize]);

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Card style={sectionCardStyle} title="日志保留天数" extra={<Button type="primary" onClick={async () => {
        try {
          await api.patch('/v1/admin/settings', { logRetentionDays: Number(days) }, { headers });
          message.success('已更新');
          await reload();
        } catch (error) {
          message.error(getApiErrorMessage(error, '更新日志保留失败'));
        }
      }}>保存</Button>}>
        <Input value={days} onChange={(e) => setDays(Number(e.target.value || 30))} />
      </Card>
      <Card style={sectionCardStyle} title="用户管理">
        <Form form={form} layout="inline" onFinish={async (v) => {
          try {
            await api.post('/v1/admin/users', v, { headers });
            form.resetFields();
            await reload();
            message.success('创建成功');
          } catch (error) {
            message.error(getApiErrorMessage(error, '新增用户失败'));
          }
        }}>
          <Form.Item name="username" rules={[{ required: true }]}><Input placeholder="用户名" /></Form.Item>
          <Form.Item name="password" rules={[{ required: true }]}><Input.Password placeholder="密码" /></Form.Item>
          <Form.Item name="role" initialValue="USER"><Input placeholder="USER 或 ADMIN" /></Form.Item>
          <Button htmlType="submit">新增用户</Button>
        </Form>
        <Table
          style={{ marginTop: 16 }}
          rowKey="id"
          dataSource={users}
          pagination={false}
          columns={[
            { title: '用户名', dataIndex: 'username', key: 'username' },
            { title: '用户组', dataIndex: 'role', key: 'role', width: 120 },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 120,
              render: (status: string) => (
                <Tag color={status === 'ACTIVE' ? 'green' : 'red'}>{status}</Tag>
              )
            },
            {
              title: '操作',
              key: 'actions',
              width: 180,
              render: (_: unknown, u: any) => (
                <Space>
                  <Button size="small" onClick={async () => {
                    try {
                      await api.patch(`/v1/admin/users/${u.id}/status`, { status: 'ACTIVE' }, { headers });
                      await reload();
                      message.success('已启用');
                    } catch (error) {
                      message.error(getApiErrorMessage(error, '启用用户失败'));
                    }
                  }}>启用</Button>
                  <Button size="small" danger onClick={async () => {
                    try {
                      await api.patch(`/v1/admin/users/${u.id}/status`, { status: 'DISABLED' }, { headers });
                      await reload();
                      message.success('已禁用');
                    } catch (error) {
                      message.error(getApiErrorMessage(error, '禁用用户失败'));
                    }
                  }}>禁用</Button>
                </Space>
              )
            }
          ]}
        />
      </Card>
      <Card style={sectionCardStyle} title="访问日志（管理员）" loading={accessLoading}>
        <List dataSource={accessLogs} renderItem={(item: any) => <List.Item>{item.method} {item.path} / {item.statusCode} / {item.user?.username || '-'} / {item.createdAt}</List.Item>} />
        <Pagination
          style={{ marginTop: 16 }}
          current={accessPage}
          pageSize={accessPageSize}
          total={accessTotal}
          showSizeChanger
          pageSizeOptions={[20, 50, 100]}
          onChange={(page, pageSize) => {
            setAccessPage(page);
            setAccessPageSize(pageSize);
          }}
        />
      </Card>
    </Space>
  );
}
