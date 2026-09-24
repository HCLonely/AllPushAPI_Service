import { useState } from 'react';
import { Button, Card, Form, Input, Popconfirm, Select, Table, Tag, Typography, message } from 'antd';
import { api, getApiErrorMessage } from '../api';
import type { ApiKeyRow, PushService, ResourceProps } from '../types';

export default function KeysPage({
  services,
  keys,
  reload,
  headers,
  onPreview
}: ResourceProps & { services: PushService[]; keys: ApiKeyRow[]; onPreview: (value: string) => void }) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Card title="创建访问密钥" className="form-card">
        <p className="muted">密钥只显示一次，请妥善保存。每个密钥仅可调用绑定的服务。</p>
        <Form
          form={form}
          layout="vertical"
          className="inline-fields"
          onFinish={async (values) => {
            setBusy(true);
            try {
              const res = await api.post('/v1/api-keys', values, { headers });
              onPreview(res.data.apiKey);
              form.resetFields();
              await reload();
            } catch (e) {
              message.error(getApiErrorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item name="name" label="密钥名称" rules={[{ required: true, whitespace: true, max: 120 }]}>
            <Input placeholder="例如：生产环境告警" />
          </Form.Item>
          <Form.Item name="serviceName" label="绑定服务" rules={[{ required: true }]}>
            <Select
              placeholder="选择推送服务"
              options={services.map((s) => ({ value: s.name, label: s.name }))}
            />
          </Form.Item>
          <Form.Item label=" ">
            <Button type="primary" htmlType="submit" loading={busy} disabled={!services.length}>
              创建密钥
            </Button>
          </Form.Item>
        </Form>
        {!services.length && <p>请先在「推送服务」中创建服务。</p>}
      </Card>
      <Card title="有效密钥">
        <Table
          rowKey="id"
          dataSource={keys}
          scroll={{ x: 620 }}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '名称', dataIndex: 'name' },
            {
              title: '密钥前缀',
              dataIndex: 'keyPrefix',
              render: (v: string) => <Typography.Text code>{v}…</Typography.Text>
            },
            { title: '服务', dataIndex: 'serviceName' },
            {
              title: '状态',
              render: (_, row: ApiKeyRow) =>
                row.expiresAt && Date.parse(row.expiresAt) <= Date.now() ? (
                  <Tag color="orange">已过期</Tag>
                ) : (
                  <Tag color="green">有效</Tag>
                )
            },
            {
              title: '操作',
              render: (_, row) => (
                <Popconfirm
                  title="撤销此密钥？"
                  description="使用此密钥的应用将无法继续推送。"
                  onConfirm={async () => {
                    try {
                      await api.patch(`/v1/api-keys/${row.id}/revoke`, {}, { headers });
                      await reload();
                      message.success('密钥已撤销');
                    } catch (e) {
                      message.error(getApiErrorMessage(e));
                    }
                  }}
                >
                  <Button danger type="text">
                    撤销
                  </Button>
                </Popconfirm>
              )
            }
          ]}
        />
      </Card>
    </>
  );
}
