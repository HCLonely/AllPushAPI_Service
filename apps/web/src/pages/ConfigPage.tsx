import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Select,
  Switch,
  Tag,
  message
} from 'antd';
import { ActionButton } from '../components/ActionButton';
import { api, getApiErrorMessage } from '../api';
import type { PushService, ChannelConfig, TemplateField, TemplatePlatform, ResourceProps } from '../types';
import { toPayloadBySchema, setDefaultBySchema, toFormValues } from '../template';
const sectionCardStyle = { borderRadius: 12 };
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
        <Form.Item
          key={name.join('.')}
          label={field.label}
          name={name}
          valuePropName="checked"
          tooltip={field.description}
        >
          <Switch />
        </Form.Item>
      );
    }

    if (field.type === 'array') {
      return (
        <Form.Item key={name.join('.')} label={field.label} name={name} tooltip={field.description}>
          <Input.TextArea rows={4} placeholder="JSON数组，或用逗号/换行分隔" />
        </Form.Item>
      );
    }

    return (
      <Form.Item
        key={name.join('.')}
        label={field.label}
        name={name}
        rules={field.required ? [{ required: true }] : undefined}
        tooltip={field.description}
      >
        {/password|secret|token|key/i.test(field.key) ? (
          <Input.Password autoComplete="new-password" />
        ) : (
          <Input type={field.inputType === 'number' ? 'number' : undefined} />
        )}
      </Form.Item>
    );
  });
}

export default function ConfigPage({
  services,
  configs,
  templates,
  reload,
  headers
}: ResourceProps & { services: PushService[]; configs: ChannelConfig[]; templates: TemplatePlatform[] }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
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
    form.resetFields();
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
    const controller = new AbortController();
    setSchemaLoading(true);
    api
      .get(`/v1/templates/platforms/${encodeURIComponent(selectedPlatform)}/schema`, {
        headers,
        signal: controller.signal
      })
      .then((res) => {
        const nextSchema = res.data.schema || [];
        setSchema(nextSchema);
        const currentPayload = form.getFieldValue('configPayload');
        form.setFieldValue(
          'configPayload',
          toFormValues(nextSchema, currentPayload || setDefaultBySchema(nextSchema))
        );
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSchema([]);
        message.error(getApiErrorMessage(error, '加载平台模板失败'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSchemaLoading(false);
      });
    return () => controller.abort();
  }, [open, selectedPlatform, advanced, headers]);

  return (
    <Card
      title="消息渠道"
      style={sectionCardStyle}
      extra={
        <Button type="primary" disabled={!services.length} onClick={openCreate}>
          ＋ 新增配置
        </Button>
      }
    >
      {!services.length && <p className="muted">请先创建推送服务，再添加平台配置。</p>}
      <List
        dataSource={configs}
        renderItem={(item: ChannelConfig) => (
          <List.Item
            actions={[
              <ActionButton
                action={async () => {
                  try {
                    await api.patch(
                      `/v1/channel-configs/${item.id}`,
                      { isEnabled: !item.isEnabled },
                      { headers }
                    );
                    await reload();
                    message.success(item.isEnabled ? '已禁用' : '已启用');
                  } catch (error) {
                    message.error(getApiErrorMessage(error, '更新配置状态失败'));
                  }
                }}
              >
                {item.isEnabled ? '禁用' : '启用'}
              </ActionButton>,
              <Button onClick={() => openEdit(item)}>编辑</Button>,
              <Popconfirm
                title="删除此平台配置？"
                description="相关投递记录也将删除。"
                onConfirm={async () => {
                  try {
                    await api.delete(`/v1/channel-configs/${item.id}`, { headers });
                    await reload();
                    message.success('删除成功');
                  } catch (error) {
                    message.error(getApiErrorMessage(error, '删除配置失败'));
                  }
                }}
              >
                <Button danger>删除</Button>
              </Popconfirm>
            ]}
          >
            <List.Item.Meta
              title={`${item.platform} / ${item.configName}`}
              description={`${item.isEnabled ? '已启用' : '已停用'} · ${services.find((service: PushService) => service.id === item.serviceId)?.name || '未关联服务'} · 优先级 ${item.priority}${item.tags ? ` · ${item.tags}` : ''}`}
            />
          </List.Item>
        )}
      />
      <Modal
        open={open}
        confirmLoading={saving}
        okButtonProps={{ disabled: !advanced && schemaLoading }}
        width={780}
        title={editingConfig ? '编辑配置' : '新增配置'}
        onCancel={() => !saving && closeModal()}
        onOk={async () => {
          try {
            await form.validateFields();
            const v = form.getFieldsValue(true);
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

            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
              message.error('配置必须是 JSON 对象');
              return;
            }
            setSaving(true);
            const requestBody = {
              serviceId: v.serviceId,
              platform: v.platform,
              configName: v.configName,
              tags: v.tags,
              priority: Number(v.priority ?? 100),
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
            if (!(error as { errorFields?: unknown }).errorFields)
              message.error(getApiErrorMessage(error, editingConfig ? '更新配置失败' : '创建配置失败'));
          } finally {
            setSaving(false);
          }
        }}
      >
        <Form form={form} layout="vertical" initialValues={{ priority: 100 }}>
          <Form.Item
            label="服务"
            name="serviceId"
            rules={[{ required: true }]}
            tooltip="选择该平台配置归属的推送服务"
          >
            <Select options={services.map((s: any) => ({ value: s.id, label: s.name }))} />
          </Form.Item>

          <Form.Item
            label="平台"
            name="platform"
            rules={[{ required: true }]}
            tooltip="选择平台模板后会自动展示对应配置字段"
          >
            <Select
              onChange={() => {
                form.setFieldValue('configPayload', undefined);
                form.setFieldValue('configPayloadText', '{}');
                setSchema([]);
              }}
              showSearch
              options={templates.map((t: TemplatePlatform) => ({ value: t.platform, label: t.platform }))}
              placeholder="选择平台模板"
              allowClear
            />
          </Form.Item>

          <Form.Item
            label="配置名"
            name="configName"
            rules={[{ required: true }]}
            tooltip="用于区分同一平台下的多个配置"
          >
            <Input />
          </Form.Item>
          <Form.Item label="标签(逗号分隔)" name="tags" tooltip="仅用于配置管理分类">
            <Input />
          </Form.Item>
          <Form.Item label="优先级" name="priority" tooltip="数值越小越靠前，用于展示和发送顺序">
            <InputNumber style={{ width: '100%' }} precision={0} />
          </Form.Item>

          <Form.Item
            label="高级 JSON 模式"
            valuePropName="checked"
            tooltip="开启后可直接填写完整 JSON，不使用模板表单"
          >
            <Switch
              aria-label="高级 JSON 模式"
              checked={advanced}
              onChange={(checked) => {
                if (checked) {
                  const currentPayload = form.getFieldValue('configPayload') || {};
                  form.setFieldValue(
                    'configPayloadText',
                    JSON.stringify(toPayloadBySchema(schema, currentPayload), null, 2)
                  );
                } else {
                  try {
                    const payload = JSON.parse(form.getFieldValue('configPayloadText') || '{}');
                    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
                    form.setFieldValue('configPayload', payload);
                  } catch {
                    message.error('请先输入合法 JSON 对象');
                    return;
                  }
                }
                setAdvanced(checked);
              }}
            />
          </Form.Item>

          {advanced ? (
            <Form.Item
              label="配置JSON"
              name="configPayloadText"
              rules={[{ required: true }]}
              tooltip="请输入合法 JSON 对象，字段应与目标平台要求一致"
            >
              <Input.TextArea rows={8} placeholder='{"key":"value"}' />
            </Form.Item>
          ) : (
            <>
              {schemaLoading ? (
                <p role="status">正在加载平台字段…</p>
              ) : schema.length ? (
                renderTemplateFields(schema, ['configPayload'])
              ) : (
                <Tag color="orange">当前平台暂无模板，切换为高级 JSON 模式可手工配置</Tag>
              )}
            </>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
