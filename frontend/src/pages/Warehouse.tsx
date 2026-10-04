import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudUploadOutlined,
  InboxOutlined,
  RetweetOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useHoleStore } from '../stores/holeStore';
import { useRunStore } from '../stores/runStore';
import { useBoxStore } from '../stores/boxStore';
import { useLocationStore, type LocationInput } from '../stores/locationStore';
import { useInboundStore } from '../stores/inboundStore';
import { SHELF_POSITIONS, BOX_STATUS_TEXT, type BoxStatus, type CoreBox } from '../types/core-box';
import type { StorageLocation } from '../types/storage-location';
import { INBOUND_STATUS_TEXT, type InboundOrder, type InboundOrderStatus } from '../types/inbound-order';
import { checkAdmission, freeCapacityOf, gapsOfPlacedBoxes, storedCountOf, validateLocation } from '../utils/inbound';

const { Title, Paragraph, Text } = Typography;

type Role = 'keeper' | 'crew';

const ORDER_STATUS_COLOR: Record<InboundOrderStatus, string> = {
  submitted: 'processing',
  stored: 'success',
  failed: 'error',
};

const BOX_STATUS_COLOR: Record<BoxStatus, string> = {
  pending: 'default',
  submitted: 'processing',
  stored: 'success',
};

export default function Warehouse() {
  const { message, modal } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const runs = useRunStore((s) => s.runs);
  const boxes = useBoxStore((s) => s.boxes);
  const locations = useLocationStore((s) => s.locations);
  const addLocation = useLocationStore((s) => s.addLocation);
  const updateLocation = useLocationStore((s) => s.updateLocation);
  const removeLocation = useLocationStore((s) => s.removeLocation);
  const orders = useInboundStore((s) => s.orders);
  const submitApplication = useInboundStore((s) => s.submitApplication);
  const withdrawApplication = useInboundStore((s) => s.withdrawApplication);
  const confirmOrder = useInboundStore((s) => s.confirmOrder);
  const rejectOrder = useInboundStore((s) => s.rejectOrder);
  const returnBox = useInboundStore((s) => s.returnBox);

  const [role, setRole] = useState<Role>('keeper');
  const [keeperName, setKeeperName] = useState('马国仓');
  const [applicantName, setApplicantName] = useState('高振华');
  const [activeTab, setActiveTab] = useState('locations');

  const holeNo = (id: string) => holes.find((hole) => hole.id === id)?.holeNo ?? id;
  const locById = (id: string) => locations.find((loc) => loc.id === id);

  const pendingBoxes = useMemo(() => boxes.filter((box) => (box.status ?? 'pending') === 'pending'), [boxes]);
  const submittedBoxes = useMemo(() => boxes.filter((box) => box.status === 'submitted'), [boxes]);

  const orderState = (order: InboundOrder): 'queued' | InboundOrderStatus => {
    if (order.status !== 'submitted') return order.status;
    const location = locById(order.locationId);
    if (!location) return 'submitted';
    const batchIds = new Set(order.items.map((item) => item.boxId));
    const queuedAhead = orders
      .filter((o) => o.id !== order.id && o.status === 'submitted' && o.locationId === order.locationId && o.submittedAt < order.submittedAt)
      .flatMap((o) => o.items.map((item) => boxes.find((box) => box.id === item.boxId)))
      .filter((box): box is CoreBox => box !== undefined && box.status === 'submitted' && !batchIds.has(box.id));
    const batch = order.items
      .map((item) => boxes.find((box) => box.id === item.boxId))
      .filter((box): box is CoreBox => Boolean(box));
    return checkAdmission(location, batch, boxes, runs, queuedAhead).queued ? 'queued' : 'submitted';
  };

  // ---------------- 库位管理 ----------------
  const [locForm] = Form.useForm<LocationInput>();
  const [locModalOpen, setLocModalOpen] = useState(false);
  const [editingLoc, setEditingLoc] = useState<StorageLocation | null>(null);

  const openCreateLoc = () => {
    setEditingLoc(null);
    locForm.resetFields();
    locForm.setFieldsValue({
      shelfPos: SHELF_POSITIONS[0],
      holeId: '',
      capacity: 12,
      fromDepth: 0,
      toDepth: 200,
      keeper: keeperName,
    });
    setLocModalOpen(true);
  };

  const openEditLoc = (record: StorageLocation) => {
    setEditingLoc(record);
    locForm.setFieldsValue({
      code: record.code,
      shelfPos: record.shelfPos,
      holeId: record.holeId,
      capacity: record.capacity,
      fromDepth: record.fromDepth,
      toDepth: record.toDepth,
      keeper: record.keeper,
      remark: record.remark,
    });
    setLocModalOpen(true);
  };

  const saveLoc = async () => {
    const values = await locForm.validateFields();
    const error = validateLocation(values);
    if (error) {
      message.error(error);
      return;
    }
    const duplicated = locations.find(
      (loc) => loc.code === values.code.trim() && loc.id !== editingLoc?.id,
    );
    if (duplicated) {
      message.error(`库位编号 ${values.code} 已存在`);
      return;
    }
    // 容量不能缩到已上架箱数以下（已上架的不能挤下来）
    if (editingLoc) {
      const occupied = boxes.filter((box) => box.status === 'stored' && box.locationId === editingLoc.id).length;
      if (values.capacity < occupied) {
        message.error(`该库位已上架 ${occupied} 箱，容量不能小于已上架数`);
        return;
      }
    }
    if (editingLoc) {
      await updateLocation(editingLoc.id, { ...values, code: values.code.trim() });
      message.success(`已更新库位 ${values.code}`);
    } else {
      await addLocation({ ...values, code: values.code.trim() });
      message.success(`已编出库位 ${values.code.trim()}`);
    }
    setLocModalOpen(false);
  };

  const handleRemoveLoc = async (record: StorageLocation) => {
    const used = boxes.some((box) => box.locationId === record.id && box.status === 'stored');
    const hanging = orders.some((order) => order.locationId === record.id && order.status === 'submitted');
    if (used || hanging) {
      message.error('该库位还有已上架箱或待确认申请，不能删除');
      return;
    }
    await removeLocation(record.id);
    message.success('已删除空库位');
  };

  const locationColumns: TableColumnsType<StorageLocation> = [
    { title: '库位编号', dataIndex: 'code', width: 130, render: (v: string) => <Text strong>{v}</Text> },
    { title: '库架位', dataIndex: 'shelfPos', width: 110 },
    {
      title: '限定钻孔',
      dataIndex: 'holeId',
      width: 130,
      render: (v: string) => (v ? holeNo(v) : <Text type="secondary">不限</Text>),
    },
    {
      title: '容量（箱）',
      width: 120,
      render: (_, row) => {
        const occupied = storedCountOf(row.id, boxes);
        const full = occupied >= row.capacity;
        return (
          <Tooltip title={full ? '容量到顶，新箱排队等腾位' : `剩余 ${row.capacity - occupied} 箱空位`}>
            <Badge
              status={full ? 'error' : occupied > 0 ? 'warning' : 'success'}
              text={`${occupied} / ${row.capacity}`}
            />
          </Tooltip>
        );
      },
    },
    {
      title: '管段深度(m)',
      width: 150,
      render: (_, row) => `${row.fromDepth} ~ ${row.toDepth}`,
    },
    {
      title: '在架箱深度排布 / 断档',
      render: (_, row) => {
        const placed = boxes.filter((box) => box.status === 'stored' && box.locationId === row.id);
        if (!placed.length) return <Text type="secondary">空库位</Text>;
        const sorted = [...placed].sort((a, b) => a.fromDepth - b.fromDepth);
        const gaps = gapsOfPlacedBoxes(sorted, runs);
        return (
          <Space direction="vertical" size={2}>
            <Space size={4} wrap>
              {sorted.map((box) => (
                <Tag key={box.id} style={{ marginInlineEnd: 0 }}>
                  {box.boxNo} {box.fromDepth}~{box.toDepth}
                </Tag>
              ))}
            </Space>
            {gaps.length ? (
              <Space size={4} wrap>
                {gaps.map((gap, idx) => (
                  <Tag key={idx} color="warning">
                    断档 {gap.from}~{gap.to}m · {gap.runLabel}
                  </Tag>
                ))}
              </Space>
            ) : (
              <Text type="success">同库位按深度连着排，无断档</Text>
            )}
          </Space>
        );
      },
    },
    { title: '建位人', dataIndex: 'keeper', width: 100 },
    {
      title: '操作',
      width: 130,
      fixed: 'right',
      render: (_, record) =>
        role === 'keeper' ? (
          <Space size={2}>
            <Button size="small" type="link" onClick={() => openEditLoc(record)}>
              编辑
            </Button>
            <Popconfirm title={`删除库位 ${record.code}？`} onConfirm={() => handleRemoveLoc(record)}>
              <Button size="small" type="link" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Text type="secondary">库房管理员维护</Text>
        ),
    },
  ];

  // ---------------- 班组申请 ----------------
  const [selectedBoxIds, setSelectedBoxIds] = useState<string[]>([]);
  const [targetLocationId, setTargetLocationId] = useState<string>('');

  const eligibleLocations = useMemo(() => {
    const holesOfSelection = new Set(
      selectedBoxIds
        .map((id) => boxes.find((box) => box.id === id))
        .filter((box): box is CoreBox => Boolean(box))
        .map((box) => box.holeId),
    );
    return locations.filter((loc) => !loc.holeId || holesOfSelection.size === 0 || holesOfSelection.has(loc.holeId));
  }, [locations, selectedBoxIds, boxes]);

  const selectedTarget = targetLocationId ? locById(targetLocationId) : undefined;
  const selectionPreview = useMemo(() => {
    if (!selectedTarget) return undefined;
    const batchIds = new Set(selectedBoxIds);
    // 已挂起申请占先：新申请排在更早的待确认申请之后
    const reservedByOrders = orders
      .filter((o) => o.status === 'submitted' && o.locationId === selectedTarget.id)
      .flatMap((o) => o.items.map((item) => boxes.find((box) => box.id === item.boxId)))
      .filter((box): box is CoreBox => box !== undefined && box.status === 'submitted' && !batchIds.has(box.id));
    const batch = selectedBoxIds
      .map((id) => boxes.find((box) => box.id === id))
      .filter((box): box is CoreBox => Boolean(box));
    return checkAdmission(selectedTarget, batch, boxes, runs, reservedByOrders);
  }, [selectedTarget, selectedBoxIds, boxes, runs, orders]);

  const handleSubmitApplication = async () => {
    if (!targetLocationId) {
      message.error('请选择申请上架的库位');
      return;
    }
    try {
      const order = await submitApplication(targetLocationId, selectedBoxIds, applicantName);
      // 用提交前的判定结果提示排队（提交成功后本批箱已转 submitted）
      const queued = selectionPreview?.queued ?? false;
      setSelectedBoxIds([]);
      setTargetLocationId('');
      if (queued) {
        message.warning(`申请已提交（单号 ${order.orderNo}）。库位容量不足或前序申请未处理，本批排队等腾位`);
      } else {
        message.success(`申请已提交（单号 ${order.orderNo}），等待库房管理员确认上架`);
      }
      setActiveTab('orders');
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const crewColumns: TableColumnsType<CoreBox> = [
    { title: '箱号', dataIndex: 'boxNo', width: 130, render: (v: string) => <Text strong>{v}</Text> },
    { title: '钻孔', dataIndex: 'holeId', width: 110, render: (v: string) => holeNo(v) },
    { title: '深度区间(m)', width: 130, render: (_, row) => `${row.fromDepth}~${row.toDepth}` },
    { title: '装箱日期', dataIndex: 'boxedAt', width: 110, render: (v: string) => dayjs(v).format('YYYY-MM-DD') },
    { title: '装箱人', dataIndex: 'operator', width: 90 },
  ];

  const handleWithdraw = async (order: InboundOrder) => {
    try {
      await withdrawApplication(order.id);
      message.success(`已撤回申请 ${order.orderNo}，箱子回到待入库`);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  // ---------------- 管理员确认 ----------------
  const handleConfirm = async (order: InboundOrder) => {
    try {
      const result = await confirmOrder(order.id, keeperName);
      if (result.outcome === 'stored') {
        message.success(`入库单 ${order.orderNo} 已落成，箱子按深度上架`);
      } else if (result.outcome === 'queued') {
        modal.warning({
          title: `库位已满，${order.orderNo} 排队等腾位`,
          content: result.reason,
          okText: '知道了',
        });
      } else {
        modal.error({
          title: `确认失败，这批退回待入库`,
          content: (
            <Space direction="vertical">
              <Text>入库单：{order.orderNo}</Text>
              <Text type="danger">{result.reason}</Text>
              <Text type="secondary">已上架的箱子保持不动；修正后在该单上「重试」即可，重试只动挂起这批。</Text>
            </Space>
          ),
          okText: '知道了',
        });
      }
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const handleReturnBox = async (box: CoreBox) => {
    try {
      await returnBox(box.id, keeperName);
      message.success(`箱 ${box.boxNo} 已退回待入库，库位空出`);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const handleReject = (order: InboundOrder) => {
    let reason = '';
    modal.confirm({
      title: `退回申请 ${order.orderNo}`,
      content: (
        <Input.TextArea
          rows={3}
          autoFocus
          placeholder="填写退回原因，整批箱子退回待入库，钻探班组可修改后重新申请"
          onChange={(e) => {
            reason = e.target.value;
          }}
        />
      ),
      okText: '确认退回',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        if (!reason.trim()) {
          message.error('请填写退回原因');
          throw new Error('empty reason');
        }
        await rejectOrder(order.id, keeperName, reason);
        message.success(`申请 ${order.orderNo} 已退回，箱子回到待入库`);
      },
    });
  };

  const orderColumns: TableColumnsType<InboundOrder> = [
    { title: '入库单号', dataIndex: 'orderNo', width: 190, render: (v: string) => <Text strong>{v}</Text> },
    {
      title: '库位',
      width: 170,
      render: (_, row) => {
        const loc = locById(row.locationId);
        return loc ? `${loc.code}（${loc.shelfPos}）` : <Tag color="error">库位已删除</Tag>;
      },
    },
    {
      title: '本批箱子',
      render: (_, row) => (
        <Space size={4} wrap>
          {row.items.map((item) => {
            const live = boxes.find((box) => box.id === item.boxId);
            return (
              <Tooltip key={item.boxId} title={live ? `${holeNo(item.holeId)} · ${BOX_STATUS_TEXT[live.status ?? 'pending']}` : '箱子已删除'}>
                <Tag color={live ? BOX_STATUS_COLOR[live.status ?? 'pending'] : 'error'}>
                  {item.boxNo}（{item.fromDepth}~{item.toDepth}m）
                </Tag>
              </Tooltip>
            );
          })}
        </Space>
      ),
    },
    {
      title: '状态',
      width: 120,
      render: (_, row) => {
        const state = orderState(row);
        if (state === 'queued') return <Tag icon={<ClockCircleOutlined />} color="warning">排队等腾位</Tag>;
        return <Tag color={ORDER_STATUS_COLOR[row.status]}>{INBOUND_STATUS_TEXT[row.status]}</Tag>;
      },
    },
    {
      title: '断档/失败原因',
      width: 260,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          {row.failReason ? <Text type="danger">{row.failReason}</Text> : null}
          {row.gaps?.length
            ? row.gaps.map((gap, idx) => (
                <Tag key={idx} color="warning">
                  断档 {gap.from}~{gap.to}m · {gap.runLabel}
                </Tag>
              ))
            : null}
          {!row.failReason && !row.gaps?.length ? <Text type="secondary">—</Text> : null}
        </Space>
      ),
    },
    { title: '申请人', dataIndex: 'applicant', width: 90 },
    { title: '管理员', dataIndex: 'keeper', width: 90, render: (v?: string) => v ?? <Text type="secondary">—</Text> },
    {
      title: '提交/确认时间',
      width: 160,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>报 {dayjs(row.submittedAt).format('MM-DD HH:mm')}</Text>
          {row.confirmedAt ? <Text style={{ fontSize: 12 }}>{`定 ${dayjs(row.confirmedAt).format('MM-DD HH:mm')}`}</Text> : null}
        </Space>
      ),
    },
    {
      title: '操作',
      width: 240,
      fixed: 'right',
      render: (_, row) => {
        const state = orderState(row);
        if (role === 'crew') {
          return row.status === 'submitted' ? (
            <Popconfirm title={`撤回申请 ${row.orderNo}？整批回到待入库`} onConfirm={() => handleWithdraw(row)}>
              <Button size="small" type="link">撤回申请</Button>
            </Popconfirm>
          ) : (
            <Text type="secondary">—</Text>
          );
        }
        if (row.status === 'submitted') {
          return (
            <Space size={2}>
              <Button
                size="small"
                type="link"
                icon={state === 'queued' ? <RetweetOutlined /> : <CheckCircleOutlined />}
                onClick={() => handleConfirm(row)}
              >
                {state === 'queued' ? '重试上架（排队中）' : '确认上架'}
              </Button>
              <Button size="small" type="link" danger icon={<UndoOutlined />} onClick={() => handleReject(row)}>
                整批退回
              </Button>
            </Space>
          );
        }
        if (row.status === 'failed') {
          return (
            <Button size="small" type="link" icon={<RetweetOutlined />} onClick={() => handleConfirm(row)}>
              重试（只动挂起这批）
            </Button>
          );
        }
        return <Text type="secondary">已落成入库单</Text>;
      },
    },
  ];

  // 已上架箱表（管理员可退回）
  const storedColumns: TableColumnsType<CoreBox> = [
    { title: '箱号', dataIndex: 'boxNo', width: 130, render: (v: string) => <Text strong>{v}</Text> },
    { title: '钻孔', dataIndex: 'holeId', width: 100, render: (v: string) => holeNo(v) },
    { title: '深度区间(m)', width: 120, render: (_, row) => `${row.fromDepth}~${row.toDepth}` },
    {
      title: '库位',
      width: 180,
      render: (_, row) => {
        const loc = row.locationId ? locById(row.locationId) : undefined;
        return loc ? `${loc.code}（${loc.shelfPos}）` : '—';
      },
    },
    { title: '入库单号', width: 180, render: (_, row) => orders.find((o) => o.id === row.inboundOrderId)?.orderNo ?? '—' },
    {
      title: '操作',
      width: 120,
      render: (_, record) =>
        role === 'keeper' ? (
          <Popconfirm
            title={`退回箱 ${record.boxNo}？`}
            description="箱子回到待入库并空出该库位，由钻探班组重新申请"
            onConfirm={() => handleReturnBox(record)}
          >
            <Button size="small" type="link" danger icon={<UndoOutlined />}>
              退回
            </Button>
          </Popconfirm>
        ) : (
          <Text type="secondary">库房管理员可退回</Text>
        ),
    },
  ];

  const stats = {
    pending: pendingBoxes.length,
    submitted: submittedBoxes.length,
    stored: boxes.filter((box) => box.status === 'stored').length,
    queued: orders.filter((order) => orderState(order) === 'queued').length,
    failed: orders.filter((order) => order.status === 'failed').length,
  };

  const locOptions = eligibleLocations.map((loc) => {
    const free = freeCapacityOf(loc, boxes);
    return {
      value: loc.id,
      label: `${loc.code} · ${loc.shelfPos} · 管 ${loc.fromDepth}~${loc.toDepth}m · 余 ${free}/${loc.capacity} 箱`,
    };
  });

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        库房管理 · 岩芯箱入库
      </Title>
      <Paragraph type="secondary">
        库房管理员按架位编出库位（写明每位装几箱、管到哪段深度）；钻探班组装箱后提交入库申请，管理员按容量和深度确认上架并落成入库单。
        同库位箱子按深度连着排、断档写清缺哪段回次；容量到顶新箱排队等腾位，已上架箱不被挤下。
      </Paragraph>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space size={24} wrap>
          <Radio.Group
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            optionType="button"
            buttonStyle="solid"
            options={[
              { label: '库房管理员', value: 'keeper' },
              { label: '钻探班组', value: 'crew' },
            ]}
          />
          {role === 'keeper' ? (
            <Space>
              <Text type="secondary">当前管理员</Text>
              <Input style={{ width: 120 }} value={keeperName} onChange={(e) => setKeeperName(e.target.value)} />
            </Space>
          ) : (
            <Space>
              <Text type="secondary">班组申请人</Text>
              <Input style={{ width: 120 }} value={applicantName} onChange={(e) => setApplicantName(e.target.value)} />
            </Space>
          )}
          <Space size={16}>
            <Badge count={stats.pending} color="#8c8c8c" title="待入库箱" />
            <Text type="secondary" style={{ marginLeft: -8 }}>待入库箱</Text>
            <Badge count={stats.submitted} color="#1677ff" />
            <Text type="secondary" style={{ marginLeft: -8 }}>待确认</Text>
            <Badge count={stats.queued} color="#faad14" />
            <Text type="secondary" style={{ marginLeft: -8 }}>排队</Text>
            <Badge count={stats.stored} color="#52c41a" />
            <Text type="secondary" style={{ marginLeft: -8 }}>已上架</Text>
            <Badge count={stats.failed} color="#ff4d4f" />
            <Text type="secondary" style={{ marginLeft: -8 }}>失败退回</Text>
          </Space>
        </Space>
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'locations',
            label: (
              <span>
                <InboxOutlined /> 库位编制
              </span>
            ),
            children: (
              <Row gutter={[16, 16]}>
                {role === 'keeper' ? (
                  <Col xs={24}>
                    <Alert
                      type="info"
                      showIcon
                      message="旧架位只有一行字，升级时已按现有架位编出默认库位并回填箱子归属；请按实际库房把默认库位的容量（箱）与管段深度改成真实值。"
                    />
                  </Col>
                ) : null}
                <Col xs={24}>
                  <Card
                    size="small"
                    title="库位台账"
                    extra={
                      role === 'keeper' ? (
                        <Button type="primary" onClick={openCreateLoc}>
                          新编库位
                        </Button>
                      ) : undefined
                    }
                  >
                    {locations.length ? (
                      <Table
                        rowKey="id"
                        size="small"
                        columns={locationColumns}
                        dataSource={locations}
                        pagination={false}
                        scroll={{ x: 1200 }}
                      />
                    ) : (
                      <Empty description="还没有库位，请库房管理员先按架位编出库位" />
                    )}
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'apply',
            label: (
              <span>
                <CloudUploadOutlined /> 入库申请
              </span>
            ),
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24}>
                  <Card size="small" title="待入库箱（钻探班组勾选后提交申请；未入库箱可在岩芯箱页改删）">
                    {pendingBoxes.length ? (
                      <>
                        <Table
                          rowKey="id"
                          size="small"
                          columns={crewColumns}
                          dataSource={pendingBoxes}
                          pagination={{ pageSize: 5 }}
                          rowSelection={{
                            selectedRowKeys: selectedBoxIds,
                            onChange: (keys) => setSelectedBoxIds(keys.map(String)),
                            getCheckboxProps: () => ({ disabled: role !== 'crew' }),
                          }}
                          scroll={{ x: 700 }}
                        />
                        <Card size="small" type="inner" style={{ marginTop: 12 }}>
                          <Space wrap align="end">
                            <Form layout="vertical" style={{ marginBottom: 0 }}>
                              <Form.Item label="申请上架库位" style={{ marginBottom: 0 }}>
                                <Select
                                  showSearch
                                  placeholder="按容量和管段选择库位"
                                  style={{ width: 460 }}
                                  value={targetLocationId || undefined}
                                  onChange={setTargetLocationId}
                                  options={locOptions}
                                  notFoundContent="没有匹配钻孔的库位"
                                />
                              </Form.Item>
                            </Form>
                            <Tooltip title={role !== 'crew' ? '切换到钻探班组身份提交' : ''}>
                              <Button
                                type="primary"
                                icon={<CloudUploadOutlined />}
                                disabled={role !== 'crew' || selectedBoxIds.length === 0}
                                onClick={handleSubmitApplication}
                              >
                                提交入库申请（{selectedBoxIds.length} 箱）
                              </Button>
                            </Tooltip>
                          </Space>
                          {selectionPreview ? (
                            <Alert
                              style={{ marginTop: 10 }}
                              type={selectionPreview.ok ? 'success' : selectionPreview.queued ? 'warning' : 'error'}
                              showIcon
                              message={
                                selectionPreview.ok
                                  ? `容量与深度校验通过，可上架；同库位排布${
                                      selectionPreview.gaps.length
                                        ? `有 ${selectionPreview.gaps.length} 处断档（确认时写入入库单）`
                                        : '无断档'
                                    }`
                                  : selectionPreview.reason
                              }
                              description={
                                selectionPreview.gaps.length ? (
                                  <Space size={4} wrap>
                                    {selectionPreview.gaps.map((gap, idx) => (
                                      <Tag key={idx} color="warning">
                                        {gap.from}~{gap.to}m · {gap.runLabel}
                                      </Tag>
                                    ))}
                                  </Space>
                                ) : null
                              }
                            />
                          ) : null}
                        </Card>
                      </>
                    ) : (
                      <Empty description="没有待入库箱；在岩芯箱页新建装箱后即可申请" />
                    )}
                  </Card>
                </Col>
                <Col xs={24}>
                  <Card size="small" title="本班组已报待上架（未确认前可撤回）">
                    {submittedBoxes.length ? (
                      <Timeline
                        items={orders
                          .filter((order) => order.status === 'submitted')
                          .flatMap((order) =>
                            order.items
                              .filter((item) => boxes.some((box) => box.id === item.boxId && box.status === 'submitted'))
                              .map((item) => {
                                const state = orderState(order);
                                return {
                                  color: state === 'queued' ? 'orange' : 'blue',
                                  children: (
                                    <Space size={8} wrap>
                                      <Text strong>{item.boxNo}</Text>
                                      <Text type="secondary">
                                        {holeNo(item.holeId)} · {item.fromDepth}~{item.toDepth}m
                                      </Text>
                                      <Tag>{order.orderNo}</Tag>
                                      {state === 'queued' ? <Tag color="warning">库位满，排队等腾位</Tag> : <Tag color="processing">待管理员确认</Tag>}
                                    </Space>
                                  ),
                                };
                              }),
                          )}
                      />
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已报待上架箱" />
                    )}
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'orders',
            label: (
              <span>
                <CheckCircleOutlined /> 入库单确认
              </span>
            ),
            children: (
              <Card size="small" title="入库申请单 / 入库单">
                {orders.length ? (
                  <Table
                    rowKey="id"
                    size="small"
                    columns={orderColumns}
                    dataSource={orders}
                    pagination={{ pageSize: 8 }}
                    scroll={{ x: 1600 }}
                  />
                ) : (
                  <Empty description="还没有入库申请" />
                )}
              </Card>
            ),
          },
          {
            key: 'stored',
            label: (
              <span>
                <UndoOutlined /> 已上架（{stats.stored}）
              </span>
            ),
            children: (
              <Card size="small" title="已上架箱：上了入库单的箱子由库房管理员退回，退回后空出位置供排队箱重试">
                {stats.stored ? (
                  <Table
                    rowKey="id"
                    size="small"
                    columns={storedColumns}
                    dataSource={boxes.filter((box) => box.status === 'stored')}
                    pagination={{ pageSize: 8 }}
                    scroll={{ x: 900 }}
                  />
                ) : (
                  <Empty description="暂无已上架箱" />
                )}
              </Card>
            ),
          },
        ]}
      />

      <Modal
        open={locModalOpen}
        title={editingLoc ? `编辑库位 · ${editingLoc.code}` : '新编库位'}
        onCancel={() => setLocModalOpen(false)}
        onOk={saveLoc}
        okText="保存"
        cancelText="取消"
      >
        <Form form={locForm} layout="vertical">
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="code" label="库位编号" rules={[{ required: true, message: '请输入库位编号' }]}>
              <Input style={{ width: 160 }} placeholder="如：A1-01" maxLength={24} />
            </Form.Item>
            <Form.Item name="shelfPos" label="所属库架位" rules={[{ required: true, message: '请选择架位' }]}>
              <Select style={{ width: 150 }} options={SHELF_POSITIONS.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
            <Form.Item name="holeId" label="限定钻孔">
              <Select
                allowClear
                style={{ width: 180 }}
                placeholder="不限钻孔可留空"
                options={holes.map((hole) => ({ label: hole.holeNo, value: hole.id }))}
              />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="capacity" label="容量（箱）" rules={[{ required: true, message: '请输入容量' }]}>
              <InputNumber min={1} max={9999} precision={0} style={{ width: 150 }} placeholder="能装几箱" />
            </Form.Item>
            <Form.Item name="fromDepth" label="管段起深(m)" rules={[{ required: true, message: '请输入起始深度' }]}>
              <InputNumber min={0} step={10} style={{ width: 150 }} placeholder="从几米" />
            </Form.Item>
            <Form.Item name="toDepth" label="管段止深(m)" rules={[{ required: true, message: '请输入终止深度' }]}>
              <InputNumber min={0} step={10} style={{ width: 150 }} placeholder="到几米" />
            </Form.Item>
          </Space>
          <Form.Item name="keeper" label="管理员" rules={[{ required: true, message: '请输入管理员姓名' }]}>
            <Input style={{ width: 160 }} maxLength={16} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={60} placeholder="如：靠立柱侧、限整孔同放" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
