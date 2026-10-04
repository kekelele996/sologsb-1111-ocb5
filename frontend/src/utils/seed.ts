import { db } from './db';
import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { CoreBox } from '../types/core-box';
import type { LithoLog } from '../types/litho-log';
import type { StorageLocation } from '../types/storage-location';
import type { IntakeApplication, IntakeReceipt } from '../types/intake';
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

export const SEED_BOXES: CoreBox[] = [
  { id: 'box-001', boxNo: 'X-2402-01', holeId: 'hole-002', fromDepth: 0, toDepth: 25, slots: 10, slotLength: 2.5, boxedAt: daysAgo(40), shelfPos: 'A 区 1 架', damagedSlots: [], operator: '高振华' },
  { id: 'box-002', boxNo: 'X-2402-02', holeId: 'hole-002', fromDepth: 25, toDepth: 50, slots: 10, slotLength: 2.5, boxedAt: daysAgo(39), shelfPos: 'A 区 1 架', damagedSlots: [4], operator: '高振华', remark: '第 4 格岩芯破碎' },
  { id: 'box-003', boxNo: 'X-2402-03', holeId: 'hole-002', fromDepth: 50, toDepth: 75, slots: 10, slotLength: 2.5, boxedAt: daysAgo(38), shelfPos: 'A 区 2 架', damagedSlots: [], operator: '周明' },
  { id: 'box-004', boxNo: 'X-2403-01', holeId: 'hole-003', fromDepth: 0, toDepth: 30, slots: 12, slotLength: 2.5, boxedAt: daysAgo(52), shelfPos: 'B 区 1 架', damagedSlots: [], operator: '周明' },
  { id: 'box-005', boxNo: 'X-2403-02', holeId: 'hole-003', fromDepth: 30, toDepth: 60, slots: 12, slotLength: 2.5, boxedAt: daysAgo(51), shelfPos: 'B 区 1 架', damagedSlots: [7, 8], operator: '周明', remark: '断层破碎带，两格岩芯缺失' },
  { id: 'box-006', boxNo: 'X-2404-01', holeId: 'hole-004', fromDepth: 0, toDepth: 28, slots: 12, slotLength: 2.5, boxedAt: daysAgo(30), shelfPos: 'B 区 2 架', damagedSlots: [], operator: '赵晓峰' },
  { id: 'box-007', boxNo: 'X-2401-01', holeId: 'hole-001', fromDepth: 0, toDepth: 26, slots: 11, slotLength: 2.5, boxedAt: daysAgo(22), shelfPos: 'C 区 1 架', damagedSlots: [], operator: '高振华' },
  // 库位管理示例：待入库、排队等腾位、深度断档
  { id: 'box-008', boxNo: 'X-2401-02', holeId: 'hole-001', fromDepth: 26, toDepth: 52, slots: 11, slotLength: 2.5, boxedAt: daysAgo(10), shelfPos: 'C 区 1 架', damagedSlots: [], operator: '高振华', remark: '待提交入库申请' },
  { id: 'box-009', boxNo: 'X-2402-04', holeId: 'hole-002', fromDepth: 75, toDepth: 100, slots: 10, slotLength: 2.5, boxedAt: daysAgo(8), shelfPos: 'A 区 2 架', damagedSlots: [], operator: '高振华' },
  { id: 'box-010', boxNo: 'X-2404-02', holeId: 'hole-004', fromDepth: 28, toDepth: 56, slots: 12, slotLength: 2.5, boxedAt: daysAgo(7), shelfPos: 'B 区 2 架', damagedSlots: [], operator: '赵晓峰' },
  { id: 'box-011', boxNo: 'X-2403-03', holeId: 'hole-003', fromDepth: 60, toDepth: 90, slots: 12, slotLength: 2.5, boxedAt: daysAgo(3), shelfPos: 'B 区 1 架', damagedSlots: [], operator: '周明' },
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

/** 库位：按现有架位 + 钻孔编出，注明容量与管段 */
export const SEED_LOCATIONS: StorageLocation[] = [
  { id: 'loc-seed-a1-01', code: 'A1-01', shelfPos: 'A 区 1 架', holeId: 'hole-002', fromDepth: 0, toDepth: 120, capacity: 2, remark: '容量到顶，退回一箱后排队箱可重试上架' },
  { id: 'loc-seed-a2-01', code: 'A2-01', shelfPos: 'A 区 2 架', holeId: 'hole-002', fromDepth: 50, toDepth: 250, capacity: 6 },
  { id: 'loc-seed-b1-01', code: 'B1-01', shelfPos: 'B 区 1 架', holeId: 'hole-003', fromDepth: 0, toDepth: 180, capacity: 8 },
  { id: 'loc-seed-b2-01', code: 'B2-01', shelfPos: 'B 区 2 架', holeId: 'hole-004', fromDepth: 0, toDepth: 80, capacity: 1 },
  { id: 'loc-seed-c1-01', code: 'C1-01', shelfPos: 'C 区 1 架', holeId: 'hole-001', fromDepth: 0, toDepth: 160, capacity: 8 },
];

/**
 * 为已上架的历史箱补齐入库单/申请，并给出三单示例：
 * - rec-seed-a1：A1-01 已装满 2 箱
 * - rec-seed-b2：B2-01 容量 1，box-006 已上架、box-010 排队等腾位（部分上架）
 * - app-seed-b1：box-011 已提交待确认（且 60~90m 与库位内既有箱之间存在深度断档）
 */
export function buildSeedWarehouse(): {
  applications: IntakeApplication[];
  receipts: IntakeReceipt[];
  boxPatches: Record<string, Partial<CoreBox>>;
} {
  const boxPatches: Record<string, Partial<CoreBox>> = {};
  const applications: IntakeApplication[] = [];
  const receipts: IntakeReceipt[] = [];

  const markStored = (boxIds: string[], appId: string, receiptId: string, locId: string) => {
    boxIds.forEach((id) => {
      boxPatches[id] = { storageStatus: 'stored', applicationId: appId, receiptId, locationId: locId };
    });
  };

  // A1-01：hole-002 两箱装满
  applications.push({
    id: 'app-seed-a1', appNo: 'SQ-OLD-A101', holeId: 'hole-002', shelfPos: 'A 区 1 架',
    applicant: '高振华', appliedAt: daysAgo(38), boxIds: ['box-001', 'box-002'], status: 'confirmed',
  });
  receipts.push({
    id: 'rec-seed-a1', receiptNo: 'RK-OLD-A101', applicationId: 'app-seed-a1', appNo: 'SQ-OLD-A101',
    confirmedAt: daysAgo(38), keeper: '马文彬',
    items: [
      { boxId: 'box-001', boxNo: 'X-2402-01', holeId: 'hole-002', fromDepth: 0, toDepth: 25, locationId: 'loc-seed-a1-01', locationCode: 'A1-01', seq: 1, stored: true },
      { boxId: 'box-002', boxNo: 'X-2402-02', holeId: 'hole-002', fromDepth: 25, toDepth: 50, locationId: 'loc-seed-a1-01', locationCode: 'A1-01', seq: 2, stored: true },
    ],
    storedCount: 2, waitingCount: 0,
  });
  markStored(['box-001', 'box-002'], 'app-seed-a1', 'rec-seed-a1', 'loc-seed-a1-01');

  // A2-01：hole-002 box-003 已上架
  applications.push({
    id: 'app-seed-a2', appNo: 'SQ-OLD-A201', holeId: 'hole-002', shelfPos: 'A 区 2 架',
    applicant: '周明', appliedAt: daysAgo(37), boxIds: ['box-003'], status: 'confirmed',
  });
  receipts.push({
    id: 'rec-seed-a2', receiptNo: 'RK-OLD-A201', applicationId: 'app-seed-a2', appNo: 'SQ-OLD-A201',
    confirmedAt: daysAgo(37), keeper: '马文彬',
    items: [
      { boxId: 'box-003', boxNo: 'X-2402-03', holeId: 'hole-002', fromDepth: 50, toDepth: 75, locationId: 'loc-seed-a2-01', locationCode: 'A2-01', seq: 1, stored: true },
    ],
    storedCount: 1, waitingCount: 0,
  });
  markStored(['box-003'], 'app-seed-a2', 'rec-seed-a2', 'loc-seed-a2-01');

  // B1-01：hole-003 两箱已上架（60m 之后到库位尾留作断档展示）
  applications.push({
    id: 'app-seed-b1-old', appNo: 'SQ-OLD-B101', holeId: 'hole-003', shelfPos: 'B 区 1 架',
    applicant: '周明', appliedAt: daysAgo(50), boxIds: ['box-004', 'box-005'], status: 'confirmed',
  });
  receipts.push({
    id: 'rec-seed-b1-old', receiptNo: 'RK-OLD-B101', applicationId: 'app-seed-b1-old', appNo: 'SQ-OLD-B101',
    confirmedAt: daysAgo(50), keeper: '马文彬',
    items: [
      { boxId: 'box-004', boxNo: 'X-2403-01', holeId: 'hole-003', fromDepth: 0, toDepth: 30, locationId: 'loc-seed-b1-01', locationCode: 'B1-01', seq: 1, stored: true },
      { boxId: 'box-005', boxNo: 'X-2403-02', holeId: 'hole-003', fromDepth: 30, toDepth: 60, locationId: 'loc-seed-b1-01', locationCode: 'B1-01', seq: 2, stored: true },
    ],
    storedCount: 2, waitingCount: 0,
  });
  markStored(['box-004', 'box-005'], 'app-seed-b1-old', 'rec-seed-b1-old', 'loc-seed-b1-01');

  // C1-01：hole-001 box-007 已上架
  applications.push({
    id: 'app-seed-c1', appNo: 'SQ-OLD-C101', holeId: 'hole-001', shelfPos: 'C 区 1 架',
    applicant: '高振华', appliedAt: daysAgo(21), boxIds: ['box-007'], status: 'confirmed',
  });
  receipts.push({
    id: 'rec-seed-c1', receiptNo: 'RK-OLD-C101', applicationId: 'app-seed-c1', appNo: 'SQ-OLD-C101',
    confirmedAt: daysAgo(21), keeper: '马文彬',
    items: [
      { boxId: 'box-007', boxNo: 'X-2401-01', holeId: 'hole-001', fromDepth: 0, toDepth: 26, locationId: 'loc-seed-c1-01', locationCode: 'C1-01', seq: 1, stored: true },
    ],
    storedCount: 1, waitingCount: 0,
  });
  markStored(['box-007'], 'app-seed-c1', 'rec-seed-c1', 'loc-seed-c1-01');

  // B2-01 容量 1：box-006 上架，box-010 排队等腾位（部分上架，可在退回 box-006 后重试）
  applications.push({
    id: 'app-seed-b2', appNo: 'SQ-2400-B201', holeId: 'hole-004', shelfPos: 'B 区 2 架',
    applicant: '赵晓峰', appliedAt: daysAgo(6), boxIds: ['box-006', 'box-010'], status: 'partial', note: '库位容量到顶，一箱挂起',
  });
  receipts.push({
    id: 'rec-seed-b2', receiptNo: 'RK-2400-B201', applicationId: 'app-seed-b2', appNo: 'SQ-2400-B201',
    confirmedAt: daysAgo(6), keeper: '马文彬',
    items: [
      { boxId: 'box-006', boxNo: 'X-2404-01', holeId: 'hole-004', fromDepth: 0, toDepth: 28, locationId: 'loc-seed-b2-01', locationCode: 'B2-01', seq: 1, stored: true },
      { boxId: 'box-010', boxNo: 'X-2404-02', holeId: 'hole-004', fromDepth: 28, toDepth: 56, stored: false, reason: '匹配库位 B2-01 容量到顶，排队等腾位' },
    ],
    storedCount: 1, waitingCount: 1,
  });
  markStored(['box-006'], 'app-seed-b2', 'rec-seed-b2', 'loc-seed-b2-01');
  boxPatches['box-010'] = { storageStatus: 'waiting', applicationId: 'app-seed-b2', waitReason: '匹配库位 B2-01 容量到顶，排队等腾位' };

  // box-011 已提交申请、待确认（B1-01 内 60~90m 与 box-005 相接，入架后 90m 至库位尾为断档）
  applications.push({
    id: 'app-seed-b1-new', appNo: 'SQ-2400-B102', holeId: 'hole-003', shelfPos: 'B 区 1 架',
    applicant: '周明', appliedAt: daysAgo(2), boxIds: ['box-011'], status: 'submitted',
  });
  boxPatches['box-011'] = { storageStatus: 'applied', applicationId: 'app-seed-b1-new' };

  // box-008 / box-009 待入库（钻机组可改可删、可提交申请）
  boxPatches['box-008'] = { storageStatus: 'pending' };
  boxPatches['box-009'] = { storageStatus: 'pending' };

  return { applications, receipts, boxPatches };
}

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

  const { applications, receipts, boxPatches } = buildSeedWarehouse();
  const boxes = SEED_BOXES.map((box) => ({ ...box, ...(boxPatches[box.id] ?? {}) }));

  await db.transaction('rw', [db.holes, db.runs, db.boxes, db.lithos, db.locations, db.applications, db.receipts, db.meta], async () => {
    if (holeCount === 0) await db.holes.bulkPut(SEED_HOLES);
    if (runCount === 0) await db.runs.bulkPut(SEED_RUNS);
    if (boxCount === 0) {
      await db.boxes.bulkPut(boxes);
      await db.locations.bulkPut(SEED_LOCATIONS);
      await db.applications.bulkPut(applications);
      await db.receipts.bulkPut(receipts);
    }
    if (lithoCount === 0) await db.lithos.bulkPut(SEED_LITHOS);
    await db.meta.put({ key: 'seeded', value: new Date().toISOString() });
  });
}
