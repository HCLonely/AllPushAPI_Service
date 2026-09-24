import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  List,
  Popconfirm,
  Pagination,
  Select,
  Space,
  Table,
  Tag,
  message
} from 'antd';
import { api, getApiErrorMessage } from '../api';
import { ActionButton } from '../components/ActionButton';
import type { ResourceProps, User } from '../types';
const sectionCardStyle = { borderRadius: 12 };
export default function AdminPage({
  retention,
  users,
  currentUserId,
  reload,
  headers
}: ResourceProps & { retention: number; users: User[]; currentUserId: string }) {
  const [days, setDays] = useState(retention);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [accessLogs, setAccessLogs] = useState<any[]>([]);
  const [accessPage, setAccessPage] = useState(1);
  const [accessPageSize, setAccessPageSize] = useState(20);
  const [accessTotal, setAccessTotal] = useState(0);
  const [accessLoading, setAccessLoading] = useState(false);

  useEffect(() => setDays(retention), [retention]);

  useEffect(() => {
    const controller = new AbortController();
    const fetchAccessLogs = async () => {
      setAccessLoading(true);
      try {
        const res = await api.get('/v1/admin/logs/access', {
          headers,
          signal: controller.signal,
          params: { page: accessPage, pageSize: accessPageSize }
        });
        setAccessLogs(res.data.items || []);
        setAccessTotal(Number(res.data.total || 0));
      } catch (error) {
        if (!controller.signal.aborted) message.error(getApiErrorMessage(error, '加载访问日志失败'));
      } finally {
        if (!controller.signal.aborted) setAccessLoading(false);
      }
    };

    fetchAccessLogs();
    return () => controller.abort();
  }, [headers, accessPage, accessPageSize]);

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Card
        style={sectionCardStyle}
        title="日志保留天数"
        extra={
          <ActionButton
            type="primary"
            action={async () => {
              try {
                await api.patch('/v1/admin/settings', { logRetentionDays: Number(days) }, { headers });
                message.success('已更新');
                await reload();
              } catch (error) {
                message.error(getApiErrorMessage(error, '更新日志保留失败'));
              }
            }}
          >
            保存
          </ActionButton>
        }
      >
        <InputNumber
          aria-label="日志保留天数"
          min={1}
          max={3650}
          precision={0}
          value={days}
          onChange={(value) => setDays(value ?? 30)}
        />
      </Card>
      <Card style={sectionCardStyle} title="用户管理">
        <Form
          form={form}
          layout="inline"
          onFinish={async (v) => {
            setSaving(true);
            try {
              await api.post('/v1/admin/users', v, { headers });
              form.resetFields();
              await reload();
              message.success('创建成功');
            } catch (error) {
              message.error(getApiErrorMessage(error, '新增用户失败'));
            } finally {
              setSaving(false);
            }
          }}
        >
          <Form.Item name="username" label="用户名" rules={[{ required: true }, { min: 3, max: 64 }]}>
            <Input placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }, { min: 8 }]}>
            <Input.Password placeholder="密码" />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="USER">
            <Select
              style={{ minWidth: 130 }}
              options={[
                { value: 'USER', label: '普通用户' },
                { value: 'ADMIN', label: '管理员' }
              ]}
            />
          </Form.Item>
          <Button htmlType="submit" loading={saving}>
            新增用户
          </Button>
        </Form>
        <Table
          style={{ marginTop: 16 }}
          rowKey="id"
          dataSource={users}
          scroll={{ x: 620 }}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '用户名', dataIndex: 'username', key: 'username' },
            { title: '用户组', dataIndex: 'role', key: 'role', width: 120 },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 120,
              render: (status: string) => <Tag color={status === 'ACTIVE' ? 'green' : 'red'}>{status}</Tag>
            },
            {
              title: '操作',
              key: 'actions',
              width: 180,
              render: (_: unknown, u: any) => (
                <Space>
                  <Button
                    size="small"
                    disabled={u.status === 'ACTIVE'}
                    onClick={async () => {
                      try {
                        await api.patch(`/v1/admin/users/${u.id}/status`, { status: 'ACTIVE' }, { headers });
                        await reload();
                        message.success('已启用');
                      } catch (error) {
                        message.error(getApiErrorMessage(error, '启用用户失败'));
                      }
                    }}
                  >
                    启用
                  </Button>
                  <Popconfirm
                    title="禁用此用户？"
                    disabled={u.id === currentUserId || u.status === 'DISABLED'}
                    onConfirm={async () => {
                      try {
                        await api.patch(
                          `/v1/admin/users/${u.id}/status`,
                          { status: 'DISABLED' },
                          { headers }
                        );
                        await reload();
                        message.success('已禁用');
                      } catch (error) {
                        message.error(getApiErrorMessage(error, '禁用用户失败'));
                      }
                    }}
                  >
                    <Button size="small" danger disabled={u.id === currentUserId || u.status === 'DISABLED'}>
                      禁用
                    </Button>
                  </Popconfirm>
                </Space>
              )
            }
          ]}
        />
      </Card>
      <Card style={sectionCardStyle} title="访问日志（管理员）" loading={accessLoading}>
        <List
          dataSource={accessLogs}
          renderItem={(item: any) => (
            <List.Item>
              {item.method} {item.path} / {item.statusCode} / {item.user?.username || '-'} / {item.createdAt}
            </List.Item>
          )}
        />
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
