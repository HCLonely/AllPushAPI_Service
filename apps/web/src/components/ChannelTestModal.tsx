import { useRef, useState } from 'react';
import { Alert, Form, Input, Modal, Select } from 'antd';
import { api, getApiErrorMessage } from '../api';
import type { ChannelConfig, Headers, PushService } from '../types';

type TestResult = {
  requestId: string;
  status: 'SUCCESS' | 'FAILED';
  message: string;
  responseCode: number | null;
  latencyMs: number;
};

export function ChannelTestModal({ config, services, headers, onClose }: {
  config: ChannelConfig;
  services: PushService[];
  headers: Headers;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const boundServices = services.filter((service) => config.serviceIds.includes(service.id));
  const serviceId = Form.useWatch('serviceId', form);
  const selectedService = boundServices.find((service) => service.id === serviceId);
  const canSend = config.isEnabled && !!selectedService?.isEnabled;

  const sendTest = async () => {
    if (inFlight.current || !canSend) return;
    inFlight.current = true;
    try {
      const values = await form.validateFields();
      setSending(true);
      setResult(null);
      setError('');
      const response = await api.post<TestResult>(`/v1/channel-configs/${config.id}/test`, values, {
        headers,
        // 服务允许最多 60 秒投递，等待时间应覆盖工作线程超时及日志保存。
        timeout: (selectedService?.timeoutMs ?? 10000) + 10000
      });
      setResult(response.data);
    } catch (failure) {
      if (!(failure as { errorFields?: unknown }).errorFields) {
        setError(`${getApiErrorMessage(failure, '发送测试失败')}。如请求超时或连接中断，请先查看投递记录和收件结果，再决定是否重试。`);
      }
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  return (
    <Modal
      open
      title={`发送测试 · ${config.configName}`}
      okText={sending ? '正在发送' : result ? '再次发送测试' : '发送测试'}
      cancelText="关闭"
      confirmLoading={sending}
      okButtonProps={{ disabled: !canSend }}
      cancelButtonProps={{ disabled: sending }}
      closable={!sending}
      maskClosable={!sending}
      keyboard={!sending}
      onCancel={() => !sending && onClose()}
      onOk={sendTest}
    >
      <p>将使用已保存的 {config.platform} 配置向真实收件人发送一条消息，结果会保存到投递记录。</p>
      <Form
        form={form}
        layout="vertical"
        disabled={sending}
        onValuesChange={() => { setResult(null); setError(''); }}
        initialValues={{
          serviceId: boundServices.find((service) => service.isEnabled)?.id,
          title: '平台配置发送测试',
          message: '这是一条来自 All Push API 的测试消息。'
        }}
      >
        <Form.Item label="推送服务" name="serviceId" rules={[{ required: true, message: '请选择推送服务' }]}>
          <Select options={boundServices.map((service) => ({
            value: service.id,
            label: `${service.name}${service.isEnabled ? '' : '（已停用）'}`,
            disabled: !service.isEnabled
          }))} />
        </Form.Item>
        <Form.Item label="标题" name="title" rules={[{ max: 200, message: '标题最多 200 字符' }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item label="正文" name="message" rules={[
          { required: true, whitespace: true, message: '请输入测试正文' },
          { max: 10000, message: '正文最多 10000 字符' }
        ]}>
          <Input.TextArea rows={4} maxLength={10000} />
        </Form.Item>
      </Form>
      {error && <Alert type="error" showIcon message="发送测试未完成" description={error} />}
      {result && <Alert
        type={result.status === 'SUCCESS' ? 'success' : 'error'}
        showIcon
        message={result.status === 'SUCCESS' ? '测试消息已发送' : '测试发送失败'}
        description={<div style={{ overflowWrap: 'anywhere' }} role="status">
          <div>{result.message}</div>
          <div>响应码：{result.responseCode ?? '无'} · 耗时：{result.latencyMs} ms</div>
          <div>请求 ID：{result.requestId}</div>
        </div>}
      />}
    </Modal>
  );
}
