import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Modal, Skeleton, Spin, Typography, message } from 'antd';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, getApiErrorMessage } from './api';
import { Icon } from './components/Icon';
import AuthPage, { type Credentials } from './pages/AuthPage';
import type { User, PushService, ChannelConfig, ApiKeyRow, TemplatePlatform } from './types';

const ServicesPage = lazy(() => import('./pages/ServicesPage'));
const ConfigPage = lazy(() => import('./pages/ConfigPage'));
const KeysPage = lazy(() => import('./pages/KeysPage'));
const LogsPage = lazy(() => import('./pages/LogsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const DocsPage = lazy(() => import('./pages/DocsPage'));
const navigation = [
  {
    path: '/panel',
    label: '推送服务',
    icon: 'grid',
    description: '把消息交给一个接口，把连接留给 All Push。'
  },
  {
    path: '/panel/configs',
    label: '平台配置',
    icon: 'channels',
    description: '连接消息渠道，管理每个平台的投递配置。'
  },
  {
    path: '/panel/keys',
    label: 'API 密钥',
    icon: 'key',
    description: '为应用分配独立访问凭证，让调用范围清晰可控。'
  },
  {
    path: '/panel/logs',
    label: '投递日志',
    icon: 'logs',
    description: '查看每一次请求的状态，定位投递问题。'
  },
  {
    path: '/api-docs',
    label: '接入文档',
    icon: 'book',
    description: '从第一个请求开始，将推送能力接入你的应用。'
  },
  { path: '/admin', label: '系统管理', icon: 'admin', description: '管理账户、日志保留策略和系统访问记录。' }
];

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setToken] = useState(() => sessionStorage.getItem('token') || '');
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(!!token);
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [services, setServices] = useState<PushService[]>([]);
  const [configs, setConfigs] = useState<ChannelConfig[]>([]);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [templates, setTemplates] = useState<TemplatePlatform[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [retention, setRetention] = useState(30);
  const [preview, setPreview] = useState('');
  const [authVersion, setAuthVersion] = useState(0);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const requestVersion = useRef(0);
  const logout = useCallback(() => {
    requestVersion.current++;
    sessionStorage.removeItem('token');
    setToken('');
    setUser(null);
    setPreview('');
    setServices([]);
    setConfigs([]);
    setKeys([]);
    setTemplates([]);
    setUsers([]);
    setChecking(false);
    setAuthError('');
    navigate('/', { replace: true });
  }, [navigate]);

  useEffect(() => {
    const id = api.interceptors.response.use(
      (res) => res,
      (error) => {
        if (
          error.response?.status === 401 &&
          error.config?.headers?.Authorization === headers.Authorization &&
          token
        )
          logout();
        return Promise.reject(error);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, [headers, token, logout]);

  useEffect(() => {
    if (!token) {
      setChecking(false);
      return;
    }
    const controller = new AbortController();
    setChecking(true);
    setAuthError('');
    api
      .get('/v1/auth/me', { headers, signal: controller.signal })
      .then((res) => setUser(res.data.user))
      .catch((error) => {
        if (!controller.signal.aborted && error.response?.status !== 401)
          setAuthError(getApiErrorMessage(error, '无法连接服务器'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [headers, token, authVersion]);

  const isAdminPage = location.pathname === '/admin';
  const reload = useCallback(async () => {
    if (!token || !user) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError('');
    try {
      if (isAdminPage && user.role === 'ADMIN') {
        const [settings, accounts] = await Promise.all([
          api.get('/v1/admin/settings', { headers }),
          api.get('/v1/admin/users', { headers })
        ]);
        if (version === requestVersion.current) {
          setRetention(settings.data.logRetentionDays);
          setUsers(accounts.data.items);
        }
      } else {
        const [s, c, k, t] = await Promise.all([
          api.get('/v1/push-services', { headers }),
          api.get('/v1/channel-configs', { headers }),
          api.get('/v1/api-keys', { headers }),
          api.get('/v1/templates/platforms', { headers })
        ]);
        if (version === requestVersion.current) {
          setServices(s.data.items);
          setConfigs(c.data.items);
          setKeys(k.data.items);
          setTemplates(t.data.items);
        }
      }
    } catch (error) {
      if (version === requestVersion.current) setLoadError(getApiErrorMessage(error));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [headers, token, user, isAdminPage]);
  useEffect(() => {
    void reload();
    return () => {
      requestVersion.current++;
    };
  }, [reload]);

  async function login(values: Credentials) {
    try {
      const res = await api.post('/v1/auth/login', values);
      sessionStorage.setItem('token', res.data.accessToken);
      setChecking(true);
      setToken(res.data.accessToken);
      navigate('/panel', { replace: true });
    } catch (error) {
      message.error(getApiErrorMessage(error, '登录失败'));
      throw error;
    }
  }
  async function register(values: Credentials) {
    try {
      await api.post('/v1/auth/register', values);
      message.success('注册成功，请登录');
    } catch (error) {
      message.error(getApiErrorMessage(error, '注册失败'));
      throw error;
    }
  }
  if (checking)
    return (
      <main className="loading-screen" aria-label="正在验证登录状态">
        <Spin size="large" />
        <p>正在连接你的工作区…</p>
      </main>
    );
  if (authError)
    return (
      <main className="loading-screen">
        <Alert
          type="error"
          message={authError}
          action={<Button onClick={() => setAuthVersion((v) => v + 1)}>重试</Button>}
        />
        <Button onClick={logout}>返回登录</Button>
      </main>
    );
  if (!token || !user) return <AuthPage onLogin={login} onRegister={register} />;
  const current = navigation.find((item) => item.path === location.pathname) || navigation[0];
  const common = { headers, reload };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <NavLink to="/panel" className="brand">
          <span className="brand-mark">
            <Icon name="send" />
          </span>
          <span>
            ALL PUSH<small>消息连接工作台</small>
          </span>
        </NavLink>
        <div className="nav-caption">工作空间</div>
        <nav aria-label="主导航">
          {navigation
            .filter((item) => item.path !== '/admin' || user.role === 'ADMIN')
            .map((item) => (
              <NavLink
                end
                key={item.path}
                to={item.path}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-note">
          <span className="eyebrow">BUILD ONCE, PUSH ANYWHERE</span>
          <p>一处连接。多端抵达。</p>
          <NavLink to="/api-docs">
            查看接入指南 <Icon name="arrow" size={16} />
          </NavLink>
        </div>
        <div className="account">
          <span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.username}</strong>
            <small>{user.role === 'ADMIN' ? '管理员' : '个人工作区'}</small>
          </div>
          <Button type="text" onClick={logout}>
            退出
          </Button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            工作空间 <span className="breadcrumb-divider">/</span> <strong>{current.label}</strong>
          </span>
          <span className="topbar-brand">ALL PUSH API</span>
        </header>
        <main id="main-content" className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">{isAdminPage ? 'ADMINISTRATION' : 'PUSH WORKSPACE'}</span>
              <h1>{current.label}</h1>
              <p>{current.description}</p>
            </div>
            {!['/api-docs', '/panel/logs'].includes(location.pathname) && (
              <Button loading={loading} onClick={() => void reload()}>
                刷新数据
              </Button>
            )}
          </div>
          {loadError && (
            <Alert
              className="page-alert"
              type="error"
              showIcon
              message="数据加载失败"
              description={loadError}
              action={<Button onClick={() => void reload()}>重试</Button>}
            />
          )}
          {location.pathname === '/panel' && (
            <div className="metrics-grid">
              {[
                { label: '推送服务', value: services.length, sub: '独立管理的消息入口', icon: 'grid' },
                {
                  label: '启用渠道',
                  value: configs.filter((c) => c.isEnabled).length,
                  sub: `共 ${configs.length} 个平台配置`,
                  icon: 'channels'
                },
                {
                  label: '有效密钥',
                  value: keys.filter((k) => !k.expiresAt || Date.parse(k.expiresAt) > Date.now()).length,
                  sub: '应用调用访问凭证',
                  icon: 'key'
                }
              ].map((metric) => (
                <div className="metric" key={metric.label}>
                  <div>
                    <span>{metric.label}</span>
                    <strong>{loading ? '—' : metric.value}</strong>
                    <small>{metric.sub}</small>
                  </div>
                  <span className="metric-icon">
                    <Icon name={metric.icon} size={22} />
                  </span>
                </div>
              ))}
            </div>
          )}
          <Suspense fallback={<Skeleton active paragraph={{ rows: 6 }} />}>
            <div className="page-content">
              <Routes>
                <Route
                  path="/panel"
                  element={<ServicesPage services={services} configs={configs} {...common} />}
                />
                <Route
                  path="/panel/configs"
                  element={
                    <ConfigPage services={services} configs={configs} templates={templates} {...common} />
                  }
                />
                <Route
                  path="/panel/keys"
                  element={<KeysPage services={services} keys={keys} onPreview={setPreview} {...common} />}
                />
                <Route path="/panel/logs" element={<LogsPage headers={headers} />} />
                <Route path="/api-docs" element={<DocsPage />} />
                <Route
                  path="/admin"
                  element={
                    user.role === 'ADMIN' ? (
                      <AdminPage retention={retention} users={users} currentUserId={user.id} {...common} />
                    ) : (
                      <Navigate to="/panel" replace />
                    )
                  }
                />
                <Route path="*" element={<Navigate to="/panel" replace />} />
              </Routes>
            </div>
          </Suspense>
          <footer className="workspace-footer">
            All Push API<span>统一推送 · 简单连接</span>
          </footer>
        </main>
      </div>
      <Modal
        open={!!preview}
        onCancel={() => setPreview('')}
        title="密钥已创建"
        footer={
          <Button type="primary" onClick={() => setPreview('')}>
            已保存，关闭
          </Button>
        }
      >
        <Alert type="warning" showIcon message="完整密钥仅展示一次，请立即复制并妥善保存。" />
        <Typography.Paragraph className="key-preview" copyable={{ text: preview }}>
          {preview}
        </Typography.Paragraph>
      </Modal>
    </div>
  );
}
