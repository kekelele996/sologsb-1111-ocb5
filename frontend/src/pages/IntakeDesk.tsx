import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Popconfirm,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { InboxOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import StatBadge from '../components/common/StatBadge';
import { useHoleStore } from '../stores/holeStore';
import { useBoxStore } from '../stores/boxStore';
import { useIntakeStore, IntakeError, type ConfirmSummary } from '../stores/intakeStore';
import { useLocationStore } from '../stores/locationStore';
import { useRoleStore } from '../stores/roleStore';
import { APP_STATUS_COLOR, APP_STATUS_TEXT, type IntakeApplication, type IntakeItem, type IntakeReceipt } from '../types/intake';
import { gapText } from '../utils/warehouse';

const { Title, Paragraph, Text } = Typography;

/** 入库管理：钻机组看申请进度；库房管理员按容量和深度确认上架、重试挂起批、退回 */
export default function IntakeDesk() {
  const { message, modal } = AntApp.useApp();
  const isKeeper = useRoleStore((s) => s.role) === 'keeper';
  const applications = useIntakeStore((s) => s.applications);
  const receipts = useIntakeStore((s) => s.receipts);
  const confirmApplication = useIntakeStore((s) => s.confirmApplication);
  const rejectApplication = useIntakeStore((s) => s.rejectApplication);
  const returnStoredBox = useIntakeStore((s) => s.returnStoredBox);
  const returnReceipt = useIntakeStore((s) => s.returnReceipt);
  const boxes = useBoxStore((s) => s.boxes);
  const locations = useLocationStore((s) => s.locations);
  const holes = useHoleStore((s) => s.holes);

  const [keeper, setKeeper] = useState('马文彬');
  const [drawerApp, setDrawerApp] = useState<IntakeApplication | null>(null);
  const [drawerReceipt, setDrawerReceipt] = useState<IntakeReceipt | null>(null);

  const holeNoOf = (id: string) => holes.find((h) => h.id === id)?.holeNo ?? '未知孔';
  const boxOf = (id: string) => boxes.find((b) => b.id === id);
  const receiptOfApp = (appId: string) => receipts.find((r) => r.applicationId === appId);

  const submittedCount = applications.filter((a) => a.status === 'submitted').length;
  const partialCount = applications.filter((a) => a.status === 'partial').length;
  const waitingBoxes = boxes.filter((b) => b.storageStatus === 'waiting');
  const storedCount = boxes.filter((b) => b.storageStatus === 'stored').length;

  const runConfirm = async (app: IntakeApplication) => {
    if (!keeper.trim()) {
      message.error('请填写库房管理员');
      return;
    }
    try {
      const summary: ConfirmSummary = await confirmApplication(app.id, keeper);
      if (!summary.receipt) {
        message.warning(`确认失败，这批已退回待入库（${summary.failReason ?? '库位不满足'}）；已上架箱保持不动`);
      } else if (summary.waitingCount > 0) {
        message.warning(
          `${summary.retried ? '重试完成' : '确认完成'}：${summary.storedCount} 箱已上架（入库单 ${summary.receipt.receiptNo}），${summary.waitingCount} 箱排队等腾位`,
        );
      } else {
        message.success(`全部 ${summary.storedCount} 箱上架，入库单 ${summary.receipt.receiptNo} 已落成`);
      }
    } catch (error) {
      // 校验类错误（无候选箱等）
      message.error(error instanceof IntakeError ? error.message : '确认失败');
    }
  };

  const askReason = (title: string, onOk: (note: string) => Promise<void> | void) => {
    let note = '';
    modal.confirm({
      title,
      content: <Input.TextArea rows={3} placeholder="退回原因（必填）" onChange={(e) => (note = e.target.value)} />,
      okText: '确认退回',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        if (!note.trim()) {
          message.error('请填写退回原因');
          throw new Error('reason required');
        }
        await onOk(note);
      },
    });
  };

  const handleReject = (app: IntakeApplication) => {
    askReason(`整批退回申请 ${app.appNo}？`, async (note) => {
      await rejectApplication(app.id, note);
      message.success('未上架箱已退回待入库（已上架箱保留）');
    });
  };

  const handleReturnBox = (item: IntakeItem) => {
    askReason(`退回岩芯箱 ${item.boxNo}？退回后该箱回待入库，可由钻机组修改。`, async (note) => {
      await returnStoredBox(item.boxId, keeper, note);
      message.success(`箱 ${item.boxNo} 已退回待入库，库位腾出 ${item.locationCode ?? ''}`);
      const fresh = useIntakeStore.getState().receipts.find((r) => r.id === drawerReceipt?.id);
      if (fresh) setDrawerReceipt(fresh);
    });
  };

  const handleReturnReceipt = (receipt: IntakeReceipt) => {
    askReason(`整单退回 ${receipt.receiptNo}？单上仍上架的箱子全部退回待入库。`, async (note) => {
      await returnReceipt(receipt.id, keeper, note);
      message.success(`入库单 ${receipt.receiptNo} 已整单退回`);
      const fresh = useIntakeStore.getState().receipts.find((r) => r.id === receipt.id);
      if (fresh) setDrawerReceipt(fresh);
    });
  };

  const appColumns: TableColumnsType<IntakeApplication> = [
    { title: '申请单号', dataIndex: 'appNo', width: 170, render: (v: string) => <Text strong>{v}</Text> },
    { title: '钻孔', width: 100, render: (_, row) => holeNoOf(row.holeId) },
    { title: '期望架位', dataIndex: 'shelfPos', width: 100 },
    { title: '申请人', dataIndex: 'applicant', width: 90 },
    { title: '箱数', width: 60, align: 'right', render: (_, row) => row.boxIds.length },
    { title: '提交时间', width: 110, render: (_, row) => dayjs(row.appliedAt).format('MM-DD HH:mm') },
    {
      title: '状态',
      width: 150,
      render: (_, row) => (
        <Tooltip title={row.note}>
          <Tag color={APP_STATUS_COLOR[row.status]}>{APP_STATUS_TEXT[row.status]}</Tag>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      width: 330,
      fixed: 'right',
      render: (_, row) => {
        const receipt = receiptOfApp(row.id);
        return (
          <Space size={2} wrap>
            <Button size="small" type="link" onClick={() => setDrawerApp(row)}>
              箱子明细
            </Button>
            {receipt ? (
              <Button size="small" type="link" onClick={() => setDrawerReceipt(receipt)}>
                入库单
              </Button>
            ) : null}
            {isKeeper && row.status === 'submitted' ? (
              <Button size="small" type="link" onClick={() => runConfirm(row)}>
                确认上架
              </Button>
            ) : null}
            {isKeeper && row.status === 'partial' ? (
              <>
                <Popconfirm
                  title="重试挂起那批？"
                  description="只重新处理排队等腾位的箱子，已上架箱保持不动。"
                  onConfirm={() => runConfirm(row)}
                >
                  <Button size="small" type="link" icon={<ReloadOutlined />}>
                    重试挂起批
                  </Button>
                </Popconfirm>
                <Button size="small" type="link" danger onClick={() => handleReject(row)}>
                  整批退回
                </Button>
              </>
            ) : null}
            {isKeeper && row.status === 'submitted' ? (
              <Button size="small" type="link" danger onClick={() => handleReject(row)}>
                整批退回
              </Button>
            ) : null}
            {row.status === 'failed' ? <Tag color="red">已退回待入库，可重新申请</Tag> : null}
          </Space>
        );
      },
    },
  ];

  const receiptColumns: TableColumnsType<IntakeReceipt> = [
    { title: '入库单号', dataIndex: 'receiptNo', width: 170, render: (v: string) => <Text strong>{v}</Text> },
    { title: '来源申请', dataIndex: 'appNo', width: 170 },
    { title: '库房管理员', dataIndex: 'keeper', width: 100 },
    { title: '确认时间', width: 130, render: (_, row) => dayjs(row.confirmedAt).format('YYYY-MM-DD HH:mm') },
    {
      title: '上架 / 挂起',
      width: 110,
      render: (_, row) => (
        <Space size={4}>
          <Tag color="green">{row.storedCount} 上架</Tag>
          {row.waitingCount ? <Tag color="orange">{row.waitingCount} 挂起</Tag> : null}
        </Space>
      ),
    },
    {
      title: '退回',
      width: 90,
      render: (_, row) => (row.returned ? <Tag color="red">有退回</Tag> : <Tag color="green">在架</Tag>),
    },
    {
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (_, row) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => setDrawerReceipt(row)}>
            查看入库单
          </Button>
          {isKeeper && row.storedCount > 0 ? (
            <Button size="small" type="link" danger icon={<RollbackOutlined />} onClick={() => handleReturnReceipt(row)}>
              整单退回
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const waitingColumns: TableColumnsType<(typeof waitingBoxes)[number]> = [
    { title: '箱号', dataIndex: 'boxNo', width: 140, render: (v: string) => <Text strong>{v}</Text> },
    { title: '钻孔', width: 100, render: (_, row) => holeNoOf(row.holeId) },
    { title: '深度区间(m)', width: 120, render: (_, row) => `${row.fromDepth}~${row.toDepth}` },
    { title: '期望架位', dataIndex: 'shelfPos', width: 100 },
    {
      title: '挂起原因',
      render: (_, row) => <Text type="warning">{row.waitReason ?? '等待库房处理'}</Text>,
    },
    {
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (_, row) => {
        const app = applications.find((a) => a.id === row.applicationId);
        return (
          <Space size={2}>
            {isKeeper && app?.status === 'partial' ? (
              <Popconfirm
                title="重试该申请挂起批？"
                description="只动排队那批，已上架箱不动。"
                onConfirm={() => app && runConfirm(app)}
              >
                <Button size="small" type="link" icon={<ReloadOutlined />}>
                  重试上架
                </Button>
              </Popconfirm>
            ) : null}
            {isKeeper && app ? (
              <Button size="small" type="link" danger onClick={() => handleReject(app)}>
                退回待入库
              </Button>
            ) : null}
          </Space>
        );
      },
    },
  ];

  const appItemColumns = (app: IntakeApplication): TableColumnsType<{ boxId: string }> => {
    // 申请明细：从当前箱子状态 + 最近入库单拼出每行状态
    const receipt = receiptOfApp(app.id);
    const rowOf = (boxId: string) => {
      const box = boxOf(boxId);
      const item = receipt?.items.find((it) => it.boxId === boxId);
      return { box: box ?? null, item: item ?? null };
    };
    return [
      { title: '箱号', width: 140, render: (_, { boxId }) => <Text strong>{boxOf(boxId)?.boxNo ?? boxId}</Text> },
      {
        title: '深度区间(m)',
        width: 120,
        render: (_, { boxId }) => {
          const b = boxOf(boxId);
          return b ? `${b.fromDepth}~${b.toDepth}` : '—';
        },
      },
      {
        title: '结果',
        render: (_, { boxId }) => {
          const { box, item } = rowOf(boxId);
          if (item?.stored)
            return (
              <Space size={4}>
                <Tag color="green">已上架</Tag>
                <Text type="secondary">
                  库位 {item.locationCode} · 第 {item.seq} 位
                </Text>
              </Space>
            );
          if (box?.storageStatus === 'applied') return <Tag color="blue">待确认</Tag>;
          if (box?.storageStatus === 'waiting')
            return (
              <Tooltip title={box.waitReason}>
                <Tag color="orange">排队等腾位</Tag>
              </Tooltip>
            );
          if (app.status === 'failed') return <Tag color="red">确认失败·待入库</Tag>;
          return <Tag>{app.status === 'rejected' ? '已退回' : '待入库'}</Tag>;
        },
      },
      {
        title: '断档 / 原因',
        render: (_, { boxId }) => {
          const { box, item } = rowOf(boxId);
          if (item?.stored)
            return item.gaps?.length ? (
              <Tooltip title={gapText(item.gaps)}>
                <Tag color="orange">{item.gaps.length} 段断档（悬停查看缺哪段回次）</Tag>
              </Tooltip>
            ) : (
              <Tag color="green">深度相接</Tag>
            );
          return <Text type="warning">{item?.reason ?? box?.waitReason}</Text>;
        },
      },
    ];
  };

  const receiptItemColumns = (receipt: IntakeReceipt): TableColumnsType<IntakeItem> => [
    { title: '箱号', dataIndex: 'boxNo', width: 130, render: (v: string) => <Text strong>{v}</Text> },
    { title: '深度区间(m)', width: 110, render: (_, row) => `${row.fromDepth}~${row.toDepth}` },
    {
      title: '库位 / 排位',
      width: 150,
      render: (_, row) => (row.stored ? `${row.locationCode} · 第 ${row.seq} 位` : '—'),
    },
    {
      title: '断档',
      width: 260,
      render: (_, row) =>
        row.stored ? (
          row.gaps?.length ? (
            <Tooltip title={gapText(row.gaps)}>
              <Tag color="orange">{gapText(row.gaps)}</Tag>
            </Tooltip>
          ) : (
            <Tag color="green">相接无断档</Tag>
          )
        ) : (
          <Text type="warning">{row.reason}</Text>
        ),
    },
    {
      title: '当前状态',
      width: 110,
      render: (_, row) => {
        const box = boxOf(row.boxId);
        return box?.storageStatus === 'stored' ? <Tag color="green">在架</Tag> : <Tag color="red">已退回</Tag>;
      },
    },
    {
      title: '操作',
      width: 120,
      render: (_, row) =>
        isKeeper && row.stored && boxOf(row.boxId)?.storageStatus === 'stored' ? (
          <Button size="small" type="link" danger onClick={() => handleReturnBox(row)}>
            退回此箱
          </Button>
        ) : (
          '—'
        ),
    },
  ];

  const tabs = [
    {
      key: 'apps',
      label: (
        <Badge count={submittedCount + partialCount} size="small" offset={[8, -2]}>
          入库申请
        </Badge>
      ),
      children: (
        <Table
          rowKey="id"
          size="small"
          columns={appColumns}
          dataSource={applications}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 1200 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无入库申请，钻探班组可在岩芯箱页勾选待入库箱提交" /> }}
        />
      ),
    },
    {
      key: 'receipts',
      label: '入库单',
      children: (
        <Table
          rowKey="id"
          size="small"
          columns={receiptColumns}
          dataSource={receipts}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 1050 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无入库单" /> }}
        />
      ),
    },
    {
      key: 'waiting',
      label: (
        <Badge count={waitingBoxes.length} size="small" offset={[8, -2]}>
          排队等腾位
        </Badge>
      ),
      children: (
        <Table
          rowKey="id"
          size="small"
          columns={waitingColumns}
          dataSource={waitingBoxes}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 900 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有排队等腾位的箱子" /> }}
        />
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        <Space>
          <InboxOutlined />
          入库管理
        </Space>
      </Title>
      <Paragraph type="secondary">
        钻探班组装箱后提交入库申请；库房管理员按库位容量与管到深度确认上架并落成入库单。同一库位按深度连着排，断档写明缺哪段回次；库位到顶时新箱排队等腾位，
        <Text strong>已上架箱不会被挤下</Text>。确认失败整批退回待入库，重试只动挂起那批。
      </Paragraph>

      {!isKeeper ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message="当前为钻探班组视角：可查看申请与入库单进度；确认上架、重试、退回由库房管理员操作（右上角切换岗位）。"
        />
      ) : (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space>
            <span style={{ color: '#6b7a86' }}>库房管理员</span>
            <Input value={keeper} onChange={(e) => setKeeper(e.target.value)} style={{ width: 160 }} placeholder="签名" maxLength={16} />
            <Text type="secondary">确认上架与退回将记录该签名</Text>
          </Space>
        </Card>
      )}

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="待确认申请" value={submittedCount} unit="单" status={submittedCount ? 'warning' : 'success'} />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="部分挂起申请" value={partialCount} unit="单" status={partialCount ? 'warning' : 'success'} />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="排队等腾位箱" value={waitingBoxes.length} unit="箱" status={waitingBoxes.length ? 'error' : 'success'} />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="在架岩芯箱" value={storedCount} unit="箱" status="success" hint={`分布于 ${locations.filter((l) => boxes.some((b) => b.locationId === l.id && b.storageStatus === 'stored')).length} 个库位`} />
        </Col>
      </Row>

      <Card size="small">
        <Tabs items={tabs} />
      </Card>

      {/* 申请明细抽屉 */}
      <Drawer open={Boolean(drawerApp)} onClose={() => setDrawerApp(null)} width={760} title={drawerApp ? `入库申请 · ${drawerApp.appNo}` : ''}>
        {drawerApp ? (
          <>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="钻孔">{holeNoOf(drawerApp.holeId)}</Descriptions.Item>
              <Descriptions.Item label="期望架位">{drawerApp.shelfPos}</Descriptions.Item>
              <Descriptions.Item label="申请人">{drawerApp.applicant}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{dayjs(drawerApp.appliedAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
              <Descriptions.Item label="状态" span={2}>
                <Tag color={APP_STATUS_COLOR[drawerApp.status]}>{APP_STATUS_TEXT[drawerApp.status]}</Tag>
                {drawerApp.note ? <Text type="secondary">{drawerApp.note}</Text> : null}
              </Descriptions.Item>
            </Descriptions>
            <Table rowKey="boxId" size="small" columns={appItemColumns(drawerApp)} dataSource={drawerApp.boxIds.map((id) => ({ boxId: id } as IntakeItem))} pagination={false} />
            {isKeeper && (drawerApp.status === 'submitted' || drawerApp.status === 'partial') ? (
              <Space style={{ marginTop: 16 }}>
                <Button type="primary" onClick={() => runConfirm(drawerApp)} icon={drawerApp.status === 'partial' ? <ReloadOutlined /> : undefined}>
                  {drawerApp.status === 'partial' ? '重试挂起批（已上架不动）' : '按容量与深度确认上架'}
                </Button>
                <Button danger onClick={() => handleReject(drawerApp)}>
                  整批退回待入库
                </Button>
              </Space>
            ) : null}
          </>
        ) : null}
      </Drawer>

      {/* 入库单抽屉 */}
      <Drawer open={Boolean(drawerReceipt)} onClose={() => setDrawerReceipt(null)} width={820} title={drawerReceipt ? `入库单 · ${drawerReceipt.receiptNo}` : ''}>
        {drawerReceipt ? (
          <>
            <Card size="small" style={{ marginBottom: 12 }}>
              <Row gutter={16}>
                <Col span={6}>
                  <Statistic title="已上架" value={drawerReceipt.storedCount} valueStyle={{ color: '#237804' }} />
                </Col>
                <Col span={6}>
                  <Statistic title="挂起/退回" value={drawerReceipt.waitingCount} valueStyle={{ color: drawerReceipt.waitingCount ? '#d48806' : undefined }} />
                </Col>
                <Col span={12}>
                  <Descriptions size="small" column={1}>
                    <Descriptions.Item label="库房管理员">{drawerReceipt.keeper}</Descriptions.Item>
                    <Descriptions.Item label="确认时间">{dayjs(drawerReceipt.confirmedAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
                    {drawerReceipt.retried ? <Descriptions.Item label="重试"><Tag color="blue">已对挂起批执行过重试</Tag></Descriptions.Item> : null}
                    {drawerReceipt.returned ? (
                      <Descriptions.Item label="退回">
                        <Timeline
                          items={[
                            { color: 'red', children: `整单/部分退回于 ${dayjs(drawerReceipt.returnedAt).format('MM-DD HH:mm')}：${drawerReceipt.returnNote}` },
                          ]}
                        />
                      </Descriptions.Item>
                    ) : null}
                  </Descriptions>
                </Col>
              </Row>
            </Card>
            <Table rowKey="boxId" size="small" columns={receiptItemColumns(drawerReceipt)} dataSource={drawerReceipt.items} pagination={false} scroll={{ x: 880 }} />
            {isKeeper && drawerReceipt.storedCount > 0 ? (
              <Button style={{ marginTop: 16 }} danger icon={<RollbackOutlined />} onClick={() => handleReturnReceipt(drawerReceipt)}>
                整单退回（在架箱全部回待入库）
              </Button>
            ) : null}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
