import { useEffect, useState } from 'react';
import { Alert, Button, Card, Modal, Table, Tag, Typography } from 'antd';
import { api, getApiErrorMessage } from '../api';
import type { Headers, PushLog } from '../types';

export function StatusTag({ status }: { status: string }) {
  const value = {
    SUCCESS: ['green', '成功'],
    PARTIAL_FAILED: ['orange', '部分失败'],
    FAILED: ['red', '失败']
  }[status];
  return <Tag color={value?.[0]}>{value?.[1] || '未知'}</Tag>;
}
export default function LogsPage({ headers }: { headers: Headers }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: PushLog[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [detail, setDetail] = useState<unknown>();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api
      .get('/v1/logs/push-requests', { headers, params: { page, pageSize: 20 }, signal: controller.signal })
      .then((res) => setData(res.data))
      .catch((e) => {
        if (!controller.signal.aborted) setError(getApiErrorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [headers, page, version]);
  return (
    <Card
      title="投递记录"
      extra={
        <Button onClick={() => setVersion((v) => v + 1)} loading={loading}>
          刷新日志
        </Button>
      }
    >
      {error && <Alert type="error" message={error} showIcon />}
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data.items}
        scroll={{ x: 720 }}
        pagination={{
          current: page,
          pageSize: 20,
          total: data.total,
          showSizeChanger: false,
          onChange: setPage
        }}
        columns={[
          {
            title: '请求 ID',
            dataIndex: 'requestId',
            render: (v) => <Typography.Text code>{v}</Typography.Text>
          },
          { title: '结果', dataIndex: 'status', render: (v) => <StatusTag status={v} /> },
          {
            title: '时间',
            dataIndex: 'createdAt',
            render: (v) => new Date(v).toLocaleString('zh-CN', { hour12: false })
          },
          {
            title: '详情',
            render: (_, row) => (
              <Button
                onClick={async () => {
                  try {
                    setDetail((await api.get(`/v1/logs/push-requests/${row.id}`, { headers })).data);
                  } catch (e) {
                    setError(getApiErrorMessage(e));
                  }
                }}
              >
                查看
              </Button>
            )
          }
        ]}
      />
      <Modal
        open={detail !== undefined}
        onCancel={() => setDetail(undefined)}
        title="请求与投递详情"
        footer={null}
        width={800}
      >
        <pre className="json-preview">{JSON.stringify(detail, null, 2)}</pre>
      </Modal>
    </Card>
  );
}
