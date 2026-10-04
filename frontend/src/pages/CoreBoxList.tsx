import { useMemo, useState, type Key } from 'react';
import { Alert, App as AntApp, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Col, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { Link } from 'react-router-dom';
import BoxGrid from '../components/common/BoxGrid';
import DepthRangeInput from '../components/common/DepthRangeInput';
import EmptyPanel from '../components/common/EmptyPanel';
import { useHoleStore } from '../stores/holeStore';
import { useRunStore } from '../stores/runStore';
import { useBoxStore, BoxLockedError } from '../stores/boxStore';
import { useLocationStore } from '../stores/locationStore';
import { useIntakeStore, IntakeError } from '../stores/intakeStore';
import { useRoleStore } from '../stores/roleStore';
import { SHELF_POSITIONS, type CoreBox, type BoxContinuity } from '../types/core-box';
import { STATUS_COLOR, STATUS_TEXT } from '../types/intake';
import { boxCapacityOk, checkBoxContinuity, validateRange } from '../utils/recovery';

const { Title, Paragraph, Text } = Typography;

interface BoxFormValues {
  boxNo: string;
  holeId: string;
  fromDepth: number;
  toDepth: number;
  slots: number;
  slotLength: number;
  boxedAt: Dayjs;
  shelfPos: string;
  operator: string;
  damagedText?: string;
  remark?: string;
}

function parseSlots(text: string | undefined): number[] {
  if (!text) return [];
  return Array.from(
    new Set(
      text
        .split(/[,，\s]+/)
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0),
    ),
  ).sort((a, b) => a - b);
}

/** 岩芯箱编目与格位分配：校验深度连续性；钻机组装箱后提交入库申请 */
export default function CoreBoxList() {
  const { message, modal } = AntApp.useApp();
  const role = useRoleStore((s) => s.role);
  const isCrew = role === 'crew';
  const holes = useHoleStore((s) => s.holes);
  const currentHoleId = useHoleStore((s) => s.currentHoleId);
  const setCurrentHole = useHoleStore((s) => s.setCurrentHole);
  const runs = useRunStore((s) => s.runs);
  const boxes = useBoxStore((s) => s.boxes);
  const addBox = useBoxStore((s) => s.addBox);
  const updateBox = useBoxStore((s) => s.updateBox);
  const removeBox = useBoxStore((s) => s.removeBox);
  const toggleDamagedSlot = useBoxStore((s) => s.toggleDamagedSlot);
  const locations = useLocationStore((s) => s.locations);
  const submitApplication = useIntakeStore((s) => s.submitApplication);

  const [form] = Form.useForm<BoxFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CoreBox | null>(null);
  const [selectedBoxId, setSelectedBoxId] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  /** 深度区间以本地 state 为唯一数据源（Form.useWatch 在弹窗挂载前可能读不到值） */
  const [range, setRange] = useState<{ from: number; to: number }>({ from: 0, to: 0 });

  const holeOptions = holes.map((hole) => ({ label: `${hole.holeNo} · ${hole.rigNo}`, value: hole.id }));
  const activeHoleId = currentHoleId || holes[0]?.id || '';
  const holeBoxes = useMemo(() => boxes.filter((b) => b.holeId === activeHoleId), [boxes, activeHoleId]);
  const selectedBox = useMemo(
    () => holeBoxes.find((b) => b.id === selectedBoxId) ?? holeBoxes[0],
    [holeBoxes, selectedBoxId],
  );
  const locationCodeOf = (box: CoreBox) => locations.find((l) => l.id === box.locationId)?.code;

  const continuityOf = (box: CoreBox): BoxContinuity => checkBoxContinuity(box, runs);

  const pendingCount = holeBoxes.filter((b) => (b.storageStatus ?? 'pending') === 'pending').length;
  const waitingCount = boxes.filter((b) => b.storageStatus === 'waiting').length;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    const lastBox = holeBoxes.reduce<CoreBox | undefined>((acc, box) => (!acc || box.toDepth > acc.toDepth ? box : acc), undefined);
    const from = lastBox ? lastBox.toDepth : 0;
    const to = Number((from + 25).toFixed(2));
    setRange({ from, to });
    form.setFieldsValue({
      boxNo: `X-${holes.find((h) => h.id === activeHoleId)?.holeNo.replace(/^ZK-/, '') ?? '0000'}-${String(holeBoxes.length + 1).padStart(2, '0')}`,
      holeId: activeHoleId,
      fromDepth: from,
      toDepth: to,
      slots: 10,
      slotLength: 2.5,
      boxedAt: dayjs(),
      shelfPos: SHELF_POSITIONS[0],
      operator: '高振华',
      damagedText: '',
    } as unknown as BoxFormValues);
    setOpen(true);
  };

  const openEdit = (record: CoreBox) => {
    if ((record.storageStatus ?? 'pending') !== 'pending') {
      message.warning(`箱子 ${record.boxNo} 已在入库流程中，钻探班组不能修改；如需下架请由库房管理员在入库管理中退回`);
      return;
    }
    setEditing(record);
    setRange({ from: record.fromDepth, to: record.toDepth });
    form.setFieldsValue({
      boxNo: record.boxNo,
      holeId: record.holeId,
      fromDepth: record.fromDepth,
      toDepth: record.toDepth,
      slots: record.slots,
      slotLength: record.slotLength,
      boxedAt: dayjs(record.boxedAt),
      shelfPos: record.shelfPos,
      operator: record.operator,
      damagedText: record.damagedSlots.join(','),
      remark: record.remark,
    } as unknown as BoxFormValues);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const rangeError = validateRange(range.from, range.to);
    if (rangeError) {
      message.error(rangeError);
      return;
    }
    const payload = {
      boxNo: values.boxNo,
      holeId: values.holeId,
      fromDepth: range.from,
      toDepth: range.to,
      slots: Number(values.slots) || 0,
      slotLength: Number(values.slotLength) || 0,
      boxedAt: values.boxedAt.toISOString(),
      shelfPos: values.shelfPos,
      operator: values.operator,
      damagedSlots: parseSlots(values.damagedText).filter((slot) => slot <= (Number(values.slots) || 0)),
      remark: values.remark,
    };
    const draft: CoreBox = { id: editing?.id ?? 'draft', ...payload, storageStatus: 'pending' };
    if (!boxCapacityOk(draft)) {
      message.error('格数 × 每格长度小于区间长度，格位容量不足');
      return;
    }
    const continuity = checkBoxContinuity(draft, runs);
    try {
      if (editing) {
        await updateBox(editing.id, payload);
        message.success(`已更新箱 ${payload.boxNo}`);
      } else {
        const created = await addBox(payload);
        setSelectedBoxId(created.id);
        message.success(`已装箱 ${payload.boxNo}（待入库）`);
      }
    } catch (error) {
      message.error(error instanceof BoxLockedError ? error.message : '保存失败');
      return;
    }
    if (!continuity.covered) {
      message.warning(continuity.message);
    }
    setOpen(false);
  };

  const handleRemove = async (record: CoreBox) => {
    try {
      await removeBox(record.id);
      message.success('已删除');
    } catch (error) {
      message.error(error instanceof BoxLockedError ? error.message : '删除失败');
    }
  };

  const handleToggleDamaged = async (slot: number) => {
    if (!selectedBox) return;
    if (!isCrew) {
      message.info('破损格标记由钻探班组维护');
      return;
    }
    try {
      await toggleDamagedSlot(selectedBox.id, slot);
    } catch (error) {
      message.warning(error instanceof BoxLockedError ? error.message : '操作失败');
    }
  };

  const openApply = () => {
    const chosen = holeBoxes.filter((b) => selectedRowKeys.includes(b.id));
    if (!chosen.length) return;
    const defaultApplicant = chosen[0]?.operator || '';
    let applicant = defaultApplicant;
    modal.confirm({
      title: `提交入库申请（${chosen.length} 箱）`,
      content: (
        <div style={{ marginTop: 8 }}>
          <Paragraph type="secondary" style={{ marginBottom: 8 }}>
            申请架位「{chosen[0].shelfPos}」，提交后箱子锁定，等待库房管理员按容量和深度确认上架。
          </Paragraph>
          <Input
            defaultValue={defaultApplicant}
            placeholder="申请人（钻探班组）"
            onChange={(e) => {
              applicant = e.target.value;
            }}
          />
        </div>
      ),
      okText: '提交申请',
      cancelText: '取消',
      onOk: async () => {
        try {
          const app = await submitApplication(chosen.map((b) => b.id), applicant);
          message.success(`申请单 ${app.appNo} 已提交，等待库房确认`);
          setSelectedRowKeys([]);
        } catch (error) {
          message.error(error instanceof IntakeError ? error.message : '提交失败');
          throw error;
        }
      },
    });
  };

  const columns: TableColumnsType<CoreBox> = [
    { title: '箱号', dataIndex: 'boxNo', width: 130, render: (v: string) => <Text strong>{v}</Text> },
    { title: '深度区间(m)', width: 120, render: (_, row) => `${row.fromDepth}~${row.toDepth}` },
    { title: '格数', dataIndex: 'slots', width: 60, align: 'right' },
    { title: '每格长度(m)', dataIndex: 'slotLength', width: 100, align: 'right' },
    { title: '期望架位', dataIndex: 'shelfPos', width: 100 },
    {
      title: '入库状态 / 库位',
      width: 150,
      render: (_, row) => {
        const status = row.storageStatus ?? 'pending';
        const code = locationCodeOf(row);
        return (
          <Space size={4} direction="vertical" style={{ lineHeight: 1.2 }}>
            <Tooltip title={row.waitReason}>
              <Tag color={STATUS_COLOR[status]} style={{ marginInlineEnd: 0 }}>
                {STATUS_TEXT[status]}
              </Tag>
            </Tooltip>
            {code ? <Text type="secondary" style={{ fontSize: 12 }}>库位 {code}</Text> : null}
          </Space>
        );
      },
    },
    { title: '装箱日期', dataIndex: 'boxedAt', width: 100, render: (v: string) => dayjs(v).format('YYYY-MM-DD') },
    { title: '装箱人', dataIndex: 'operator', width: 90 },
    {
      title: '破损格',
      width: 90,
      render: (_, row) => (row.damagedSlots.length ? <Tag color="red">{row.damagedSlots.join(',')}</Tag> : <Tag color="green">无</Tag>),
    },
    {
      title: '深度连续性校验',
      width: 300,
      render: (_, row) => {
        const continuity = continuityOf(row);
        return continuity.covered ? (
          <Text type="success">{continuity.message}</Text>
        ) : (
          <Text type="danger">{continuity.message}</Text>
        );
      },
    },
    {
      title: '操作',
      width: 210,
      fixed: 'right',
      render: (_, record) => {
        const editable = isCrew && (record.storageStatus ?? 'pending') === 'pending';
        return (
          <Space size={2}>
            <Button size="small" type="link" onClick={() => setSelectedBoxId(record.id)}>
              查看格位
            </Button>
            <Button size="small" type="link" disabled={!editable} onClick={() => openEdit(record)}>
              编辑
            </Button>
            {editable ? (
              <Popconfirm title={`确认删除岩芯箱 ${record.boxNo}？`} onConfirm={() => handleRemove(record)}>
                <Button size="small" type="link" danger>
                  删除
                </Button>
              </Popconfirm>
            ) : (
              <Tooltip title={isCrew ? '已在入库流程中，需库房管理员退回后才能删除' : '库房管理员请到入库管理退回'}>
                <Button size="small" type="link" danger disabled>
                  删除
                </Button>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  const formHoleId = Form.useWatch('holeId', form) ?? activeHoleId;

  const rowSelection: TableProps<CoreBox>['rowSelection'] = {
    selectedRowKeys,
    onChange: setSelectedRowKeys,
    getCheckboxProps: (row) => ({ disabled: (row.storageStatus ?? 'pending') !== 'pending' }),
  };

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        岩芯箱编目与格位分配
      </Title>
      <Paragraph type="secondary">
        钻探班组按深度区间装箱（仅「待入库」箱可改可删），勾选待入库箱提交入库申请；库房管理员在
        <Link to="/intake"> 入库管理 </Link>
        按容量和深度确认上架。断档在格位网格中以虚线标出，破损格可点击切换标记。
      </Paragraph>

      {waitingCount > 0 ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          message={`有 ${waitingCount} 箱排队等腾位：匹配库位容量到顶或管段不符，库房管理员腾位后可在入库管理重试上架（已上架箱不受影响）`}
        />
      ) : null}

      <Space style={{ marginBottom: 12 }} wrap>
        <span style={{ color: '#6b7a86' }}>当前钻孔</span>
        <Select style={{ width: 200 }} value={activeHoleId} onChange={setCurrentHole} options={holeOptions} placeholder="选择钻孔" />
        <Button type="primary" onClick={openCreate} disabled={!activeHoleId || !isCrew} title={isCrew ? '' : '钻探班组负责装箱'}>
          新建岩芯箱
        </Button>
        <Button onClick={openApply} disabled={!isCrew || selectedRowKeys.length === 0}>
          提交入库申请{selectedRowKeys.length ? `（${selectedRowKeys.length} 箱）` : ''}
        </Button>
        {!isCrew ? <Tag color="gold">库房管理员视角：装箱与申请由钻探班组操作</Tag> : <Tag color="blue">本孔待入库 {pendingCount} 箱</Tag>}
      </Space>

      {holeBoxes.length === 0 ? (
        <EmptyPanel description="该孔暂无岩芯箱记录" actionText="新建岩芯箱" onAction={openCreate} />
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card
              size="small"
              title="格位网格（点击切换破损标记）"
              extra={
                <Select
                  style={{ width: 220 }}
                  value={selectedBox?.id}
                  onChange={setSelectedBoxId}
                  options={holeBoxes.map((box) => ({ label: `${box.boxNo}（${box.fromDepth}~${box.toDepth}m）`, value: box.id }))}
                />
              }
            >
              {selectedBox ? (
                <>
                  <BoxGrid box={selectedBox} runs={runs} onToggleDamaged={isCrew ? handleToggleDamaged : undefined} />
                  <Alert
                    style={{ marginTop: 10 }}
                    type={continuityOf(selectedBox).covered ? 'success' : 'warning'}
                    showIcon
                    message={continuityOf(selectedBox).message}
                  />
                </>
              ) : null}
            </Card>
          </Col>
          <Col xs={24}>
            <Card size="small" title="岩芯箱台账（勾选待入库箱可批量提交申请）">
              <Table
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={holeBoxes}
                rowSelection={isCrew ? rowSelection : undefined}
                pagination={{ pageSize: 6 }}
                scroll={{ x: 1560 }}
              />
            </Card>
          </Col>
        </Row>
      )}

      <Modal open={open} title={editing ? `编辑岩芯箱 · ${editing.boxNo}` : '新建岩芯箱'} onCancel={() => setOpen(false)} onOk={submit} okText="保存" cancelText="取消" width={720}>
        <Form form={form} layout="vertical">
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="boxNo" label="箱号" rules={[{ required: true, message: '请输入箱号' }]}>
              <Input style={{ width: 180 }} maxLength={24} placeholder="如：X-2401-02" />
            </Form.Item>
            <Form.Item name="holeId" label="钻孔" rules={[{ required: true, message: '请选择钻孔' }]}>
              <Select style={{ width: 200 }} options={holeOptions} />
            </Form.Item>
            <Form.Item name="shelfPos" label="期望库架位" rules={[{ required: true, message: '请选择库架位' }]}>
              <Select style={{ width: 150 }} options={SHELF_POSITIONS.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
          </Space>

          <Form.Item label="深度区间" required>
            <DepthRangeInput
              fromDepth={range.from}
              toDepth={range.to}
              referenceRuns={runs.filter((run) => run.holeId === formHoleId)}
              maxDepth={holes.find((h) => h.id === formHoleId)?.designDepth}
              onChange={(patch) => {
                setRange((prev) => ({ ...prev, ...patch }));
                form.setFieldsValue(patch as unknown as BoxFormValues);
              }}
            />
          </Form.Item>

          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="slots" label="格数" rules={[{ required: true, message: '请输入格数' }]}>
              <InputNumber min={1} max={30} style={{ width: 140 }} placeholder="格数" />
            </Form.Item>
            <Form.Item name="slotLength" label="每格长度(m)" rules={[{ required: true, message: '请输入每格长度' }]}>
              <InputNumber min={0.5} step={0.5} style={{ width: 160 }} placeholder="每格长度" />
            </Form.Item>
            <Form.Item name="boxedAt" label="装箱日期" rules={[{ required: true, message: '请选择装箱日期' }]}>
              <DatePicker style={{ width: 170 }} />
            </Form.Item>
            <Form.Item name="operator" label="装箱人" rules={[{ required: true, message: '请输入装箱人' }]}>
              <Input style={{ width: 140 }} maxLength={16} placeholder="装箱人" />
            </Form.Item>
          </Space>

          <Form.Item name="damagedText" label="破损格序号（逗号分隔，留空表示无破损）">
            <Input placeholder="如：4,7" maxLength={40} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={60} placeholder="岩芯缺失情况等" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
