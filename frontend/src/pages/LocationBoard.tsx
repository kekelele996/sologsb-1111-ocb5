import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { AppstoreOutlined, PlusOutlined } from '@ant-design/icons';
import StatBadge from '../components/common/StatBadge';
import { SHELF_POSITIONS } from '../types/core-box';
import { useBoxStore } from '../stores/boxStore';
import { useHoleStore } from '../stores/holeStore';
import { useLocationStore, type LocationInput } from '../stores/locationStore';
import { useRunStore } from '../stores/runStore';
import { useRoleStore } from '../stores/roleStore';
import type { StorageLocation } from '../types/storage-location';
import { buildLocationLayout, gapText } from '../utils/warehouse';
import { validateRange } from '../utils/recovery';

const { Title, Paragraph, Text } = Typography;

/** 库位管理：库房管理员按架位编库位，写明容量（装几箱）与管段（管到哪段深度） */
export default function LocationBoard() {
  const { message } = AntApp.useApp();
  const isKeeper = useRoleStore((s) => s.role) === 'keeper';
  const locations = useLocationStore((s) => s.locations);
  const { addLocation, updateLocation, removeLocation, suggestCode } = useLocationStore();
  const boxes = useBoxStore((s) => s.boxes);
  const runs = useRunStore((s) => s.runs);
  const holes = useHoleStore((s) => s.holes);

  const [form] = Form.useForm<LocationInput>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StorageLocation | null>(null);
  const [shelfFilter, setShelfFilter] = useState<string>('全部');

  const holeNoOf = (id: string) => holes.find((h) => h.id === id)?.holeNo ?? '未知孔';
  const layouts = useMemo(
    () =>
      locations
        .filter((loc) => shelfFilter === '全部' || loc.shelfPos === shelfFilter)
        .map((loc) => buildLocationLayout(loc, boxes, runs))
        .sort((a, b) => a.location.code.localeCompare(b.location.code)),
    [locations, boxes, runs, shelfFilter],
  );

  const totalCapacity = locations.reduce((sum, loc) => sum + loc.capacity, 0);
  const totalUsed = layouts.reduce((sum, layout) => sum + layout.used, 0);
  const fullCount = layouts.filter((l) => l.full).length;
  const gapCount = layouts.reduce((sum, l) => sum + l.gaps.length, 0);

  const openCreate = (shelfPos?: string) => {
    setEditing(null);
    form.resetFields();
    const shelf = shelfPos ?? (shelfFilter !== '全部' ? shelfFilter : SHELF_POSITIONS[0]);
    form.setFieldsValue({
      shelfPos: shelf,
      holeId: holes[0]?.id,
      fromDepth: 0,
      toDepth: holes[0]?.designDepth ?? 100,
      capacity: 8,
      remark: '',
    });
    setOpen(true);
  };

  const openEdit = (loc: StorageLocation) => {
    setEditing(loc);
    form.setFieldsValue({
      shelfPos: loc.shelfPos,
      holeId: loc.holeId,
      fromDepth: loc.fromDepth,
      toDepth: loc.toDepth,
      capacity: loc.capacity,
      remark: loc.remark,
    });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const rangeError = validateRange(Number(values.fromDepth), Number(values.toDepth));
    if (rangeError) {
      message.error(rangeError);
      return;
    }
    if (Number(values.capacity) < 1) {
      message.error('库位容量至少为 1 箱');
      return;
    }
    // 编辑时容量不能小于已上架箱数，且管段不能把已上架箱切出去
    if (editing) {
      const layout = buildLocationLayout(editing, boxes, runs);
      if (Number(values.capacity) < layout.used) {
        message.error(`该库位已上架 ${layout.used} 箱，容量不能小于已上架箱数`);
        return;
      }
      const overflow = layout.storedBoxes.find(
        (b) => b.fromDepth < Number(values.fromDepth) - 0.0001 || b.toDepth > Number(values.toDepth) + 0.0001,
      );
      if (overflow) {
        message.error(`已上架箱 ${overflow.boxNo}（${overflow.fromDepth}~${overflow.toDepth}m）不在新管段内，不能收窄管段`);
        return;
      }
    }
    const payload: LocationInput = {
      shelfPos: values.shelfPos,
      holeId: values.holeId,
      fromDepth: Number(values.fromDepth) || 0,
      toDepth: Number(values.toDepth) || 0,
      capacity: Number(values.capacity) || 0,
      remark: values.remark,
    };
    if (editing) {
      await updateLocation(editing.id, payload);
      message.success(`库位 ${editing.code} 已更新`);
    } else {
      const created = await addLocation(payload);
      message.success(`已编出库位 ${created.code}`);
    }
    setOpen(false);
  };

  const handleRemove = async (loc: StorageLocation) => {
    const used = boxes.filter((b) => b.storageStatus === 'stored' && b.locationId === loc.id).length;
    if (used > 0) {
      message.error(`库位 ${loc.code} 已有 ${used} 箱上架，请先退回箱子再删除`);
      return;
    }
    await removeLocation(loc.id);
    message.success(`库位 ${loc.code} 已删除`);
  };

  const columns: TableColumnsType<(typeof layouts)[number]> = [
    {
      title: '库位编号',
      width: 100,
      render: (_, row) => <Text strong>{row.location.code}</Text>,
    },
    { title: '库架位', width: 100, dataIndex: ['location', 'shelfPos'] },
    { title: '钻孔', width: 100, render: (_, row) => holeNoOf(row.location.holeId) },
    {
      title: '管到哪段(m)',
      width: 130,
      render: (_, row) => `${row.location.fromDepth}~${row.location.toDepth}`,
    },
    {
      title: '装几箱（占用）',
      width: 170,
      render: (_, row) => (
        <Space size={6}>
          <Progress
            percent={Math.round((row.used / row.location.capacity) * 100)}
            size="small"
            style={{ width: 90 }}
            status={row.full ? 'exception' : 'normal'}
          />
          <Text type={row.full ? 'danger' : undefined}>
            {row.used}/{row.location.capacity}
          </Text>
          {row.full ? <Tag color="red">到顶</Tag> : <Tag color="green">余 {row.free}</Tag>}
        </Space>
      ),
    },
    {
      title: '连着排的箱子（按深度）',
      render: (_, row) =>
        row.storedBoxes.length ? (
          <Space size={4} wrap>
            {row.storedBoxes.map((b) => (
              <Tooltip key={b.boxId} title={`第 ${b.seq} 位 · ${b.fromDepth}~${b.toDepth}m`}>
                <Tag color="blue">{b.seq}.{b.boxNo}</Tag>
              </Tooltip>
            ))}
          </Space>
        ) : (
          <Text type="secondary">空库位</Text>
        ),
    },
    {
      title: '断档（缺哪段回次）',
      width: 260,
      render: (_, row) =>
        row.gaps.length ? (
          <Tooltip title={<div style={{ whiteSpace: 'pre-line' }}>{gapText(row.gaps).replace(/；/g, '；\n')}</div>}>
            <Tag color="orange" style={{ whiteSpace: 'normal' }}>
              {row.gaps.length} 段断档
            </Tag>
          </Tooltip>
        ) : (
          <Tag color="green">相接无断档</Tag>
        ),
    },
    {
      title: '操作',
      width: 130,
      fixed: 'right',
      render: (_, row) =>
        isKeeper ? (
          <Space size={2}>
            <Button size="small" type="link" onClick={() => openEdit(row.location)}>
              编辑
            </Button>
            <Popconfirm title={`删除库位 ${row.location.code}？`} onConfirm={() => handleRemove(row.location)}>
              <Button size="small" type="link" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Text type="secondary">仅查看</Text>
        ),
    },
  ];

  const holesByShelf = (shelfPos: string) => {
    const ids = new Set(locations.filter((l) => l.shelfPos === shelfPos).map((l) => l.holeId));
    return holes.filter((h) => !ids.has(h.id));
  };

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        <Space>
          <AppstoreOutlined />
          库位管理
        </Space>
      </Title>
      <Paragraph type="secondary">
        岩芯箱堆在库架旁时架位只有一行字；本页由库房管理员按架位编出库位，写明每个库位「装几箱」（容量）和「管到哪段」（钻孔 +
        深度段）。同一库位的箱子按深度连着排，断档处列出缺失回次；库位容量到顶后新箱排队等腾位，已上架箱不会被挤下。
      </Paragraph>

      {!isKeeper ? (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="当前为钻探班组视角，库位仅供查看；编库位请在右上角切换为库房管理员。" />
      ) : null}

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="库位数" value={locations.length} unit="个" status="default" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="已上架 / 总容量" value={`${totalUsed}/${totalCapacity}`} status="success" hint="箱 / 箱" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="容量到顶库位" value={fullCount} unit="个" status={fullCount ? 'warning' : 'success'} />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="深度断档段数" value={gapCount} unit="段" status={gapCount ? 'warning' : 'success'} />
        </Col>
      </Row>

      <Space style={{ marginBottom: 12 }} wrap>
        <span style={{ color: '#6b7a86' }}>架位筛选</span>
        <Select
          style={{ width: 160 }}
          value={shelfFilter}
          onChange={setShelfFilter}
          options={['全部', ...SHELF_POSITIONS].map((v) => ({ label: v, value: v }))}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!isKeeper}
          onClick={() => openCreate(shelfFilter !== '全部' ? shelfFilter : undefined)}
        >
          编出库位
        </Button>
        {isKeeper && shelfFilter !== '全部' && holesByShelf(shelfFilter).length > 0 ? (
          <Text type="secondary">
            该架位还可收纳：{holesByShelf(shelfFilter).map((h) => h.holeNo).join('、')}
          </Text>
        ) : null}
      </Space>

      <Card size="small">
        {layouts.length ? (
          <Table rowKey={(row) => row.location.id} size="small" columns={columns} dataSource={layouts} pagination={false} scroll={{ x: 1280 }} />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              isKeeper ? (
                <span>
                  架位「{shelfFilter}」还没有库位，点「编出库位」写明容量与管段。旧架位数据升级时会自动编出默认库位。
                </span>
              ) : (
                <span>暂无库位</span>
              )
            }
          >
            {isKeeper ? (
              <Button type="primary" onClick={() => openCreate(shelfFilter !== '全部' ? shelfFilter : undefined)}>
                编出库位
              </Button>
            ) : null}
          </Empty>
        )}
      </Card>

      <Modal
        open={open}
        title={
          editing
            ? `编辑库位 · ${editing.code}`
            : `编出库位（${suggestCode(
                form.getFieldValue('shelfPos') ?? (shelfFilter !== '全部' ? shelfFilter : SHELF_POSITIONS[0]),
              )}）`
        }
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="shelfPos" label="所属库架位" rules={[{ required: true, message: '请选择库架位' }]}>
            <Select options={SHELF_POSITIONS.map((v) => ({ label: v, value: v }))} />
          </Form.Item>
          <Form.Item name="holeId" label="收纳钻孔（一孔一位）" rules={[{ required: true, message: '请选择钻孔' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={holes.map((h) => ({ label: `${h.holeNo} · ${h.rigNo}`, value: h.id }))}
            />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="fromDepth" label="管段起深度(m)" rules={[{ required: true, message: '请填起深度' }]}>
              <InputNumber min={0} step={5} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="toDepth" label="管段止深度(m)" rules={[{ required: true, message: '请填止深度' }]}>
              <InputNumber min={0} step={5} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="capacity" label="容量（装几箱）" rules={[{ required: true, message: '请填容量' }]}>
              <InputNumber min={1} max={200} style={{ width: 150 }} />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={80} placeholder="如：主矿化段专用、到顶后需腾位" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
