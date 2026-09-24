import { useState } from 'react';
import { Button, Form, Input, Segmented } from 'antd';
import { Icon } from '../components/Icon';

export type Credentials = { username: string; password: string };
export default function AuthPage({
  onLogin,
  onRegister
}: {
  onLogin: (v: Credentials) => Promise<void>;
  onRegister: (v: Credentials) => Promise<void>;
}) {
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="send" />
          </span>
          ALL PUSH<span className="brand-caption">统一推送平台</span>
        </div>
        <div className="auth-copy">
          <span className="eyebrow">ONE API. EVERY CHANNEL.</span>
          <h1>
            让消息，
            <br />
            抵达每一个渠道。
          </h1>
          <p>
            集中管理推送服务、连接平台与访问密钥。
            <br />
            从配置到投递，每一步都清晰可见。
          </p>
          <div className="flow-diagram">
            <span>你的应用</span>
            <Icon name="arrow" />
            <strong>All Push API</strong>
            <Icon name="arrow" />
            <span>消息渠道</span>
          </div>
        </div>
        <span className="auth-footer">统一接口 · 独立密钥 · 投递追踪</span>
      </section>
      <section className="auth-form">
        <div className="auth-form-inner">
          <span className="eyebrow">WORKSPACE ACCESS</span>
          <h2>{mode === 'login' ? '欢迎回来' : '创建你的账户'}</h2>
          <p className="muted">
            {mode === 'login' ? '登录控制台，管理你的消息连接。' : '一个账户，管理所有推送渠道。'}
          </p>
          <Segmented
            block
            value={mode}
            options={[
              { label: '登录', value: 'login' },
              { label: '注册', value: 'register' }
            ]}
            onChange={setMode}
            disabled={busy}
          />
          <Form
            key={mode}
            layout="vertical"
            requiredMark={false}
            onFinish={async (values: Credentials) => {
              setBusy(true);
              try {
                if (mode === 'login') await onLogin(values);
                else {
                  await onRegister(values);
                  setMode('login');
                }
              } catch {
                /* Parent reports the error. */
              } finally {
                setBusy(false);
              }
            }}
          >
            <Form.Item
              name="username"
              label="用户名"
              rules={[
                { required: true, whitespace: true, message: '请输入用户名' },
                { min: mode === 'register' ? 3 : 1, max: 64, message: '用户名长度为 3–64 个字符' }
              ]}
            >
              <Input autoComplete="username" placeholder="输入用户名" size="large" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[
                { required: true, message: '请输入密码' },
                { min: mode === 'register' ? 8 : 1, message: '密码至少 8 个字符' }
              ]}
              extra={mode === 'register' ? '至少 8 个字符，最多 72 字节。' : undefined}
            >
              <Input.Password
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="输入密码"
                size="large"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={busy}>
              {mode === 'login' ? '进入控制台' : '创建账户'}
            </Button>
          </Form>
          <div className="auth-footnote">All Push API · 消息连接，从这里开始</div>
        </div>
      </section>
    </main>
  );
}
