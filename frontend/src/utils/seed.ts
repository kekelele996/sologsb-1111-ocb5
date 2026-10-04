import { db } from './db';
import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { CoreBox } from '../types/core-box';
import type { LithoLog } from '../types/litho-log';
import type { StorageLocation } from '../types/storage-location';
import type { InboundOrder } from '../types/inbound-order';
import { footageOf, recoveryOf } from './recovery';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

export const SEED_HOLES: DrillHole[] = [
  {
    id: 'hole-001',
    holeNo: 'ZK-2401',
    coordX: 512340.5,
    coordY: 3210880.2,
    collarElevation: 1246.5,
    designDepth: 300,
    finalDepth: 0,
    startDate: daysAgo(26),
    rigNo: 'XY-1',
    shift: '甲班',
    surveyData: [
      { id: 'sv-001-1', depth: 50, dip: 88.5, azimuth: 132 },
      { id: 'sv-001-2', depth: 100, dip: 87.2, azimuth: 133.5 },
      { id: 'sv-001-3', depth: 150, dip: 86.4, azimuth: 134 },
    ],
    remark: '设计见矿层位 120~160m',
  },
  {
    id: 'hole-002',
    holeNo: 'ZK-2402',
    coordX: 512420.1,
    coordY: 3210940.8,
    collarElevation: 1251.2,
    designDepth: 250,
    finalDepth: 250,
    startDate: daysAgo(48),
    endDate: daysAgo(12),
    rigNo: 'XY-2',
    shift: '甲班',
    surveyData: [
      { id: 'sv-002-1', depth: 80, dip: 89.1, azimuth: 128 },
      { id: 'sv-002-2', depth: 180, dip: 87.8, azimuth: 129.4 },
    ],
    remark: '已终孔并完成编录',
  },
  {
    id: 'hole-003',
    holeNo: 'ZK-2403',
    coordX: 512505.9,
    coordY: 3210810.4,
    collarElevation: 1238.8,
    designDepth: 400,
    finalDepth: 320,
    startDate: daysAgo(60),
    endDate: daysAgo(5),
    rigNo: 'XY-4',
    shift: '乙班',
    surveyData: [
      { id: 'sv-003-1', depth: 100, dip: 86.9, azimuth: 141 },
      { id: 'sv-003-2', depth: 200, dip: 85.1, azimuth: 142.6 },
      { id: 'sv-003-3', depth: 300, dip: 83.4, azimuth: 143.8 },
    ],
    remark: '孔内坍塌提前终孔，未达设计孔深',
  },
  {
    id: 'hole-004',
    holeNo: 'ZK-2404',
    coordX: 512288.3,
    coordY: 3211020.6,
    collarElevation: 1260.4,
    designDepth: 180,
    finalDepth: 180,
    startDate: daysAgo(34),
    endDate: daysAgo(18),
    rigNo: 'HGY-300',
    shift: '丙班',
    surveyData: [{ id: 'sv-004-1', depth: 90, dip: 89.4, azimuth: 120 }],
  },
  {
    id: 'hole-005',
    holeNo: 'ZK-2405',
    coordX: 512610.7,
    coordY: 3210765.1,
    collarElevation: 1233.6,
    designDepth: 220,
    finalDepth: 0,
    startDate: daysAgo(9),
    rigNo: 'XY-1',
    shift: '乙班',
    surveyData: [{ id: 'sv-005-1', depth: 40, dip: 88.2, azimuth: 137 }],
    remark: '在钻，已完成首段编录',
  },
];

/** 按孔生成回次：5m 一回次，采取率在 62%~98% 之间波动（含低采取率异常回次） */
function buildRuns(): DrillRun[] {
  const plan: Array<{ holeId: string; runNoPrefix: string; reached: number; base: number; anomalyRuns: number[] }> = [
    { holeId: 'hole-001', runNoPrefix: '2401', reached: 155, base: 91, anomalyRuns: [17] },
    { holeId: 'hole-002', runNoPrefix: '2402', reached: 250, base: 93, anomalyRuns: [12, 33] },
    { holeId: 'hole-003', runNoPrefix: '2403', reached: 320, base: 88, anomalyRuns: [8, 22, 41] },
    { holeId: 'hole-004', runNoPrefix: '2404', reached: 180, base: 95, anomalyRuns: [] },
    { holeId: 'hole-005', runNoPrefix: '2405', reached: 45, base: 90, anomalyRuns: [6] },
  ];

  const runs: DrillRun[] = [];
  plan.forEach((item) => {
    const total = Math.floor(item.reached / 5);
    for (let i = 0; i < total; i += 1) {
      const fromDepth = Number((i * 5).toFixed(2));
      const toDepth = Number(Math.min((i + 1) * 5, item.reached).toFixed(2));
      const footage = footageOf(fromDepth, toDepth);
      const recovering = item.anomalyRuns.includes(i + 1) ? 58 + ((i * 7) % 14) : item.base + ((i * 5) % 8) - 3;
      const recovery = Math.min(99, Math.max(45, recovering));
      const coreLength = Number(((footage * recovery) / 100).toFixed(2));
      runs.push({
        id: `run-${item.runNoPrefix}-${String(i + 1).padStart(3, '0')}`,
        runNo: `${item.runNoPrefix}-${String(i + 1).padStart(2, '0')}`,
        holeId: item.holeId,
        fromDepth,
        toDepth,
        footage,
        coreLength,
        recovery: recoveryOf(coreLength, footage),
        waterLevel: Number((12 + ((i * 3) % 25)).toFixed(1)),
        shift: (['甲班', '乙班', '丙班'] as const)[i % 3],
        drilledAt: daysAgo(30 - Math.min(28, i)),
        recorder: i % 2 === 0 ? '高振华' : '周明',
        remark: recovery < 75 ? '岩芯破碎，采取率偏低' : undefined,
      });
    }
  });
  return runs;
}

export const SEED_RUNS: DrillRun[] = buildRuns();

/** 示例岩芯箱：含已上架（挂库位）、待入库、已报待上架（排队 / 确认失败退回）几种状态 */
export const SEED_BOXES: CoreBox[] = [
  // A 区 1 架（loc-a1：0~150m，容量 2）—— 已满
  { id: 'box-001', boxNo: 'X-2402-01', holeId: 'hole-002', fromDepth: 0, toDepth: 25, slots: 10, slotLength: 2.5, boxedAt: daysAgo(40), shelfPos: 'A 区 1 架', damagedSlots: [], operator: '高振华', status: 'stored', locationId: 'loc-a1', inboundOrderId: 'inbound-001' },
  { id: 'box-002', boxNo: 'X-2402-02', holeId: 'hole-002', fromDepth: 25, toDepth: 50, slots: 10, slotLength: 2.5, boxedAt: daysAgo(39), shelfPos: 'A 区 1 架', damagedSlots: [4], operator: '高振华', remark: '第 4 格岩芯破碎', status: 'stored', locationId: 'loc-a1', inboundOrderId: 'inbound-001' },
  // A 区 2 架（loc-a2：0~200m，容量 4）—— 与下箱之间留一段 75~100m 断档
  { id: 'box-003', boxNo: 'X-2402-03', holeId: 'hole-002', fromDepth: 50, toDepth: 75, slots: 10, slotLength: 2.5, boxedAt: daysAgo(38), shelfPos: 'A 区 2 架', damagedSlots: [], operator: '周明', status: 'stored', locationId: 'loc-a2', inboundOrderId: 'inbound-002' },
  { id: 'box-008', boxNo: 'X-2402-05', holeId: 'hole-002', fromDepth: 100, toDepth: 125, slots: 10, slotLength: 2.5, boxedAt: daysAgo(35), shelfPos: 'A 区 2 架', damagedSlots: [], operator: '周明', status: 'stored', locationId: 'loc-a2', inboundOrderId: 'inbound-002' },
  // B 区 1 架（loc-b1：0~400m，容量 4）
  { id: 'box-004', boxNo: 'X-2403-01', holeId: 'hole-003', fromDepth: 0, toDepth: 30, slots: 12, slotLength: 2.5, boxedAt: daysAgo(52), shelfPos: 'B 区 1 架', damagedSlots: [], operator: '周明', status: 'stored', locationId: 'loc-b1', inboundOrderId: 'inbound-003' },
  { id: 'box-005', boxNo: 'X-2403-02', holeId: 'hole-003', fromDepth: 30, toDepth: 60, slots: 12, slotLength: 2.5, boxedAt: daysAgo(51), shelfPos: 'B 区 1 架', damagedSlots: [7, 8], operator: '周明', remark: '断层破碎带，两格岩芯缺失', status: 'stored', locationId: 'loc-b1', inboundOrderId: 'inbound-003' },
  // B 区 2 架（loc-b2：0~200m，容量 2）
  { id: 'box-006', boxNo: 'X-2404-01', holeId: 'hole-004', fromDepth: 0, toDepth: 28, slots: 12, slotLength: 2.5, boxedAt: daysAgo(30), shelfPos: 'B 区 2 架', damagedSlots: [], operator: '赵晓峰', status: 'stored', locationId: 'loc-b2', inboundOrderId: 'inbound-004' },
  // C 区 1 架（loc-c1：0~200m，容量 3）
  { id: 'box-007', boxNo: 'X-2401-01', holeId: 'hole-001', fromDepth: 0, toDepth: 26, slots: 11, slotLength: 2.5, boxedAt: daysAgo(22), shelfPos: 'C 区 1 架', damagedSlots: [], operator: '高振华', status: 'stored', locationId: 'loc-c1', inboundOrderId: 'inbound-005' },

  // 待入库箱：钻探班组可改可删
  { id: 'box-101', boxNo: 'X-2402-06', holeId: 'hole-002', fromDepth: 125, toDepth: 150, slots: 10, slotLength: 2.5, boxedAt: daysAgo(8), shelfPos: '', damagedSlots: [], operator: '高振华', status: 'pending', locationId: '', inboundOrderId: '' },
  { id: 'box-102', boxNo: 'X-2405-01', holeId: 'hole-005', fromDepth: 0, toDepth: 25, slots: 10, slotLength: 2.5, boxedAt: daysAgo(4), shelfPos: '', damagedSlots: [], operator: '周明', status: 'pending', locationId: '', inboundOrderId: '' },
  { id: 'box-103', boxNo: 'X-2401-02', holeId: 'hole-001', fromDepth: 26, toDepth: 52, slots: 11, slotLength: 2.5, boxedAt: daysAgo(2), shelfPos: '', damagedSlots: [], operator: '高振华', status: 'pending', locationId: '', inboundOrderId: '' },

  // 已报待上架：loc-a1 已满，这箱排队等腾位（重试仍提示排队，退回箱-001/002 后可再试）
  { id: 'box-104', boxNo: 'X-2402-07', holeId: 'hole-002', fromDepth: 150, toDepth: 175, slots: 10, slotLength: 2.5, boxedAt: daysAgo(1), shelfPos: '', damagedSlots: [], operator: '高振华', status: 'submitted', locationId: '', inboundOrderId: 'inbound-101' },

  // 确认失败退回待入库：B1-01 目前只管到 60m；管理员加深止深后在该单上重试即可上架
  { id: 'box-105', boxNo: 'X-2403-03', holeId: 'hole-003', fromDepth: 60, toDepth: 90, slots: 12, slotLength: 2.5, boxedAt: daysAgo(1), shelfPos: '', damagedSlots: [], operator: '周明', status: 'pending', locationId: '', inboundOrderId: 'inbound-102' },
];

/** 库位：写明每个位装几箱、管到哪段 */
export const SEED_LOCATIONS: StorageLocation[] = [
  { id: 'loc-a1', code: 'A1-01', shelfPos: 'A 区 1 架', holeId: '', capacity: 2, fromDepth: 0, toDepth: 200, createdAt: daysAgo(60), keeper: '马国仓', remark: '已满，新箱排队等腾位' },
  { id: 'loc-a2', code: 'A2-01', shelfPos: 'A 区 2 架', holeId: '', capacity: 4, fromDepth: 0, toDepth: 200, createdAt: daysAgo(60), keeper: '马国仓' },
  { id: 'loc-b1', code: 'B1-01', shelfPos: 'B 区 1 架', holeId: '', capacity: 4, fromDepth: 0, toDepth: 60, createdAt: daysAgo(60), keeper: '马国仓', remark: '管段暂编到 60m；加深止深后可重试失败单' },
  { id: 'loc-b2', code: 'B2-01', shelfPos: 'B 区 2 架', holeId: '', capacity: 2, fromDepth: 0, toDepth: 200, createdAt: daysAgo(60), keeper: '马国仓' },
  { id: 'loc-c1', code: 'C1-01', shelfPos: 'C 区 1 架', holeId: '', capacity: 3, fromDepth: 0, toDepth: 200, createdAt: daysAgo(60), keeper: '马国仓' },
];

/** 入库申请单 / 入库单：已上架单、排队单、确认失败退回单各一 */
export const SEED_INBOUND_ORDERS: InboundOrder[] = [
  {
    id: 'inbound-001',
    orderNo: 'RK-2401-001',
    locationId: 'loc-a1',
    applicant: '高振华',
    keeper: '马国仓',
    submittedAt: daysAgo(40),
    confirmedAt: daysAgo(40),
    status: 'stored',
    items: [
      { boxId: 'box-001', boxNo: 'X-2402-01', holeId: 'hole-002', fromDepth: 0, toDepth: 25 },
      { boxId: 'box-002', boxNo: 'X-2402-02', holeId: 'hole-002', fromDepth: 25, toDepth: 50 },
    ],
    gaps: [],
  },
  {
    id: 'inbound-002',
    orderNo: 'RK-2401-002',
    locationId: 'loc-a2',
    applicant: '周明',
    keeper: '马国仓',
    submittedAt: daysAgo(38),
    confirmedAt: daysAgo(38),
    status: 'stored',
    items: [
      { boxId: 'box-003', boxNo: 'X-2402-03', holeId: 'hole-002', fromDepth: 50, toDepth: 75 },
      { boxId: 'box-008', boxNo: 'X-2402-05', holeId: 'hole-002', fromDepth: 100, toDepth: 125 },
    ],
    gaps: [{ from: 75, to: 100, runLabel: '缺该段箱，对应回次 2402-16、2402-17、2402-18、2402-19、2402-20' }],
  },
  {
    id: 'inbound-003',
    orderNo: 'RK-2401-003',
    locationId: 'loc-b1',
    applicant: '周明',
    keeper: '马国仓',
    submittedAt: daysAgo(52),
    confirmedAt: daysAgo(52),
    status: 'stored',
    items: [
      { boxId: 'box-004', boxNo: 'X-2403-01', holeId: 'hole-003', fromDepth: 0, toDepth: 30 },
      { boxId: 'box-005', boxNo: 'X-2403-02', holeId: 'hole-003', fromDepth: 30, toDepth: 60 },
    ],
    gaps: [],
  },
  {
    id: 'inbound-004',
    orderNo: 'RK-2401-004',
    locationId: 'loc-b2',
    applicant: '赵晓峰',
    keeper: '马国仓',
    submittedAt: daysAgo(30),
    confirmedAt: daysAgo(30),
    status: 'stored',
    items: [{ boxId: 'box-006', boxNo: 'X-2404-01', holeId: 'hole-004', fromDepth: 0, toDepth: 28 }],
    gaps: [],
  },
  {
    id: 'inbound-005',
    orderNo: 'RK-2401-005',
    locationId: 'loc-c1',
    applicant: '高振华',
    keeper: '马国仓',
    submittedAt: daysAgo(22),
    confirmedAt: daysAgo(22),
    status: 'stored',
    items: [{ boxId: 'box-007', boxNo: 'X-2401-01', holeId: 'hole-001', fromDepth: 0, toDepth: 26 }],
    gaps: [],
  },
  {
    id: 'inbound-101',
    orderNo: 'RK-2402-001',
    locationId: 'loc-a1',
    applicant: '高振华',
    submittedAt: daysAgo(1),
    status: 'submitted',
    items: [{ boxId: 'box-104', boxNo: 'X-2402-07', holeId: 'hole-002', fromDepth: 150, toDepth: 175 }],
    gaps: [],
  },
  {
    id: 'inbound-102',
    orderNo: 'RK-2402-002',
    locationId: 'loc-b1',
    applicant: '周明',
    confirmedAt: daysAgo(1),
    submittedAt: daysAgo(2),
    status: 'failed',
    failReason: '箱 X-2403-03 深度 60~90m 超出库位管段 0~60m，这批退回待入库；管理员把 B1-01 止深加大后可重试',
    items: [{ boxId: 'box-105', boxNo: 'X-2403-03', holeId: 'hole-003', fromDepth: 60, toDepth: 90 }],
    gaps: [],
  },
];


export const SEED_LITHOS: LithoLog[] = [
  { id: 'litho-001', holeId: 'hole-002', fromDepth: 0, toDepth: 8, lithology: '第四系覆盖层', color: '黄褐色', alteration: '无', mineralization: '无', rqd: 0, sampleNo: '', logger: '陈立', remark: '残坡积层' },
  { id: 'litho-002', holeId: 'hole-002', fromDepth: 8, toDepth: 62, lithology: '花岗闪长岩', color: '灰白色', alteration: '绿泥石化', mineralization: '无', rqd: 82, sampleNo: 'YP-2402-01', logger: '陈立' },
  { id: 'litho-003', holeId: 'hole-002', fromDepth: 62, toDepth: 96, lithology: '矽卡岩', color: '暗绿色', alteration: '矽卡岩化', mineralization: '磁铁矿', rqd: 68, sampleNo: 'YP-2402-02', logger: '陈立', remark: '见稀疏浸染状磁铁矿' },
  { id: 'litho-004', holeId: 'hole-002', fromDepth: 96, toDepth: 132, lithology: '大理岩', color: '白色', alteration: '碳酸盐化', mineralization: '黄铜矿', rqd: 74, sampleNo: 'YP-2402-03', logger: '陈立', remark: '见细脉状黄铜矿' },
  { id: 'litho-005', holeId: 'hole-002', fromDepth: 132, toDepth: 168, lithology: '矽卡岩', color: '褐绿色', alteration: '硅化', mineralization: '黄铜矿', rqd: 61, sampleNo: 'YP-2402-04', logger: '陈立', remark: '主矿化段' },
  { id: 'litho-006', holeId: 'hole-002', fromDepth: 168, toDepth: 250, lithology: '花岗闪长岩', color: '浅灰色', alteration: '绿泥石化', mineralization: '黄铁矿', rqd: 88, sampleNo: '', logger: '陈立' },
  { id: 'litho-007', holeId: 'hole-003', fromDepth: 0, toDepth: 12, lithology: '第四系覆盖层', color: '褐黄色', alteration: '无', mineralization: '无', rqd: 0, sampleNo: '', logger: '吴倩' },
  { id: 'litho-008', holeId: 'hole-003', fromDepth: 12, toDepth: 74, lithology: '花岗闪长岩', color: '灰白色', alteration: '绿泥石化', mineralization: '无', rqd: 79, sampleNo: 'YP-2403-01', logger: '吴倩' },
  { id: 'litho-009', holeId: 'hole-003', fromDepth: 74, toDepth: 118, lithology: '断层角砾岩', color: '杂色', alteration: '碳酸盐化', mineralization: '无', rqd: 32, sampleNo: 'YP-2403-02', logger: '吴倩', remark: '破碎带，岩芯采取率低' },
  { id: 'litho-010', holeId: 'hole-003', fromDepth: 118, toDepth: 205, lithology: '矽卡岩', color: '暗绿色', alteration: '矽卡岩化', mineralization: '磁铁矿', rqd: 66, sampleNo: 'YP-2403-03', logger: '吴倩' },
  { id: 'litho-011', holeId: 'hole-003', fromDepth: 205, toDepth: 320, lithology: '大理岩', color: '灰白色', alteration: '硅化', mineralization: '黄铁矿', rqd: 71, sampleNo: 'YP-2403-04', logger: '吴倩' },
  { id: 'litho-012', holeId: 'hole-004', fromDepth: 0, toDepth: 10, lithology: '第四系覆盖层', color: '黄褐色', alteration: '无', mineralization: '无', rqd: 0, sampleNo: '', logger: '赵晓峰' },
  { id: 'litho-013', holeId: 'hole-004', fromDepth: 10, toDepth: 180, lithology: '花岗闪长岩', color: '浅灰白色', alteration: '硅化', mineralization: '磁铁矿', rqd: 86, sampleNo: 'YP-2404-01', logger: '赵晓峰' },
  { id: 'litho-014', holeId: 'hole-001', fromDepth: 0, toDepth: 9, lithology: '第四系覆盖层', color: '黄褐色', alteration: '无', mineralization: '无', rqd: 0, sampleNo: '', logger: '陈立' },
  { id: 'litho-015', holeId: 'hole-001', fromDepth: 9, toDepth: 86, lithology: '花岗闪长岩', color: '灰白色', alteration: '绿泥石化', mineralization: '无', rqd: 84, sampleNo: 'YP-2401-01', logger: '陈立' },
  { id: 'litho-016', holeId: 'hole-001', fromDepth: 86, toDepth: 155, lithology: '矽卡岩', color: '褐绿色', alteration: '矽卡岩化', mineralization: '黄铜矿', rqd: 69, sampleNo: 'YP-2401-02', logger: '陈立', remark: '主矿化段，与设计见矿层位吻合' },
  { id: 'litho-017', holeId: 'hole-005', fromDepth: 0, toDepth: 11, lithology: '第四系覆盖层', color: '褐黄色', alteration: '无', mineralization: '无', rqd: 0, sampleNo: '', logger: '吴倩' },
  { id: 'litho-018', holeId: 'hole-005', fromDepth: 11, toDepth: 45, lithology: '花岗闪长岩', color: '灰白色', alteration: '硅化', mineralization: '无', rqd: 87, sampleNo: 'YP-2405-01', logger: '吴倩' },
];

/** 首次打开（表内无数据）时写入示例数据；已有数据则不动 */
export async function seedIfEmpty(): Promise<void> {
  const flag = await db.meta.get('seeded');
  if (flag) {
    return;
  }
  const [holeCount, runCount, boxCount, lithoCount] = await Promise.all([
    db.holes.count(),
    db.runs.count(),
    db.boxes.count(),
    db.lithos.count(),
  ]);

  await db.transaction('rw', [db.holes, db.runs, db.boxes, db.lithos, db.locations, db.inboundOrders, db.meta], async () => {
    if (holeCount === 0) await db.holes.bulkPut(SEED_HOLES);
    if (runCount === 0) await db.runs.bulkPut(SEED_RUNS);
    if (boxCount === 0) {
      await db.locations.bulkPut(SEED_LOCATIONS);
      await db.inboundOrders.bulkPut(SEED_INBOUND_ORDERS);
      await db.boxes.bulkPut(SEED_BOXES);
    }
    if (lithoCount === 0) await db.lithos.bulkPut(SEED_LITHOS);
    await db.meta.put({ key: 'seeded', value: new Date().toISOString() });
  });
}
