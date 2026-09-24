import { useState } from 'react';
import { Button, Card, Empty, Form, Input, InputNumber, Modal, Popconfirm, Switch, Tag, message } from 'antd';
import { api, getApiErrorMessage } from '../api';
import { Icon } from '../components/Icon';
import type { PushService, ChannelConfig, ResourceProps } from '../types';

export default function ServicesPage({
  services,
  configs,
  reload,
  headers
}: ResourceProps & { services: PushService[]; configs: ChannelConfig[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PushService | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  function edit(service: PushService | null) {
    setEditing(service);
    form.resetFields();
    form.setFieldsValue(service || { timeoutMs: 10000, isEnabled: true });
    setOpen(true);
  }
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>我的推送服务</h2>
          <p className="muted">将不同用途的渠道归入独立服务，通过密钥调用。</p>
        </div>
        <Button type="primary" onClick={() => edit(null)}>
          ＋ 新建服务
        </Button>
      </div>
      {services.length ? (
        <div className="service-grid">
          {services.map((service) => (
            <Card key={service.id} className="service-card">
              <div className="service-card-top">
                <span className="service-icon">
                  <Icon name="send" size={24} />
                </span>
                <Tag color={service.isEnabled ? 'green' : 'default'}>
                  {service.isEnabled ? '已启用' : '已停用'}
                </Tag>
              </div>
              <h3>{service.name}</h3>
              <p className="muted">
                {configs.filter((c) => c.serviceId === service.id).length} 个平台配置 · 超时{' '}
                {(service.timeoutMs || 10000) / 1000} 秒
              </p>
              <div className="service-card-bottom">
                <Button onClick={() => edit(service)}>管理服务</Button>
                <Popconfirm
                  title="删除此服务？"
                  description="关联配置和投递记录将删除，绑定密钥将被撤销。"
                  onConfirm={async () => {
                    try {
                      await api.delete(`/v1/push-services/${service.id}`, { headers });
                      await reload();
                      message.success('服务已删除');
                    } catch (e) {
                      message.error(getApiErrorMessage(e));
                    }
                  }}
                >
                  <Button danger type="text">
                    删除
                  </Button>
                </Popconfirm>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <Empty description="还没有推送服务，创建后即可添加平台配置。">
            <Button type="primary" onClick={() => edit(null)}>
              创建第一个服务
            </Button>
          </Empty>
        </Card>
      )}
      <Modal
        open={open}
        title={editing ? '管理推送服务' : '新建推送服务'}
        onCancel={() => !saving && setOpen(false)}
        confirmLoading={saving}
        onOk={async () => {
          try {
            const values = await form.validateFields();
            setSaving(true);
            if (editing) await api.patch(`/v1/push-services/${editing.id}`, values, { headers });
            else await api.post('/v1/push-services', values, { headers });
            setOpen(false);
            await reload();
            message.success('服务已保存');
          } catch (e) {
            if (!(e as { errorFields?: unknown }).errorFields) message.error(getApiErrorMessage(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="服务名称" rules={[{ required: true, whitespace: true, max: 120 }]}>
            <Input placeholder="例如：系统告警" />
          </Form.Item>
          <Form.Item
            name="timeoutMs"
            label="投递超时（毫秒）"
            extra="超时后终止投递，请确认收件结果后再重试。"
          >
            <InputNumber min={1} max={60000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="isEnabled" label="启用服务" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
