import type { CoreBox } from '../types/core-box';
import type { DrillRun } from '../types/drill-run';
import type { StorageLocation } from '../types/storage-location';
import type { InboundGap, InboundItem } from '../types/inbound-order';

const EPS = 0.0001;

/** 库位当前已上架箱数（已上架的箱子不能被挤下来） */
export function storedCountOf(locationId: string, boxes: CoreBox[]): number {
  return boxes.filter((box) => box.status === 'stored' && box.locationId === locationId).length;
}

/** 库位剩余容量 */
export function freeCapacityOf(location: StorageLocation, boxes: CoreBox[]): number {
  return Math.max(0, location.capacity - storedCountOf(location.id, boxes));
}

export function itemsOf(boxes: CoreBox[]): InboundItem[] {
  return boxes.map((box) => ({
    boxId: box.id,
    boxNo: box.boxNo,
    holeId: box.holeId,
    fromDepth: box.fromDepth,
    toDepth: box.toDepth,
  }));
}

export interface AdmissionCheck {
  /** 是否可上架 */
  ok: boolean;
  /** 容量是否不足（不足时排队等腾位，不算确认失败） */
  queued: boolean;
  /** 失败/排队原因文案 */
  reason?: string;
  /** 上架后排布发现的深度断档（缺哪段回次） */
  gaps: InboundGap[];
}

/** 箱在同库位内按深度排序，相邻箱之间不衔接即为断档，写清缺哪段、涉及哪些回次 */
export function gapsOfPlacedBoxes(placed: CoreBox[], runs: DrillRun[]): InboundGap[] {
  const sorted = [...placed].sort((a, b) => a.fromDepth - b.fromDepth || a.toDepth - b.toDepth);
  const gaps: InboundGap[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.fromDepth - prev.toDepth > EPS) {
      const from = Number(prev.toDepth.toFixed(2));
      const to = Number(cur.fromDepth.toFixed(2));
      const holeId = cur.holeId || prev.holeId;
      const hitRuns = runs
        .filter((run) => run.holeId === holeId && Math.min(run.toDepth, to) - Math.max(run.fromDepth, from) > EPS)
        .map((run) => run.runNo);
      gaps.push({
        from,
        to,
        runLabel: hitRuns.length ? `缺该段箱，对应回次 ${hitRuns.join('、')}` : '该段无对应回次',
      });
    }
  }
  return gaps;
}

/**
 * 库房管理员按容量和深度确认上架。
 * @param location 目标库位
 * @param batch    本批申请箱（挂起/重试时只传这一批）
 * @param allBoxes 全量箱子（用于读取该库位已上架箱）
 * @param runs     回次（断档标注用）
 * @param queuedAhead 同库位更早提交、仍挂着排队的申请箱（先到先得，不能插队）
 *
 * 规则：
 * - 深度必须落在库位管段内，同库位同钻孔，箱间深度不得重叠，否则整批确认失败退回；
 * - 容量一到顶，新箱排队等腾位（queued），已上架箱不动；排队按提交先后，不能插队；
 * - 断档不拦截，只在结果里写清缺哪段回次。
 */
export function checkAdmission(
  location: StorageLocation,
  batch: CoreBox[],
  allBoxes: CoreBox[],
  runs: DrillRun[],
  queuedAhead: CoreBox[] = [],
): AdmissionCheck {
  if (batch.length === 0) {
    return { ok: false, queued: false, reason: '这批没有可确认的箱子', gaps: [] };
  }

  // 1. 深度：必须在库位管段内
  const outOfRange = batch.find(
    (box) => box.fromDepth < location.fromDepth - EPS || box.toDepth > location.toDepth + EPS,
  );
  if (outOfRange) {
    return {
      ok: false,
      queued: false,
      reason: `箱 ${outOfRange.boxNo} 深度 ${outOfRange.fromDepth}~${outOfRange.toDepth}m 超出库位管段 ${location.fromDepth}~${location.toDepth}m`,
      gaps: [],
    };
  }

  // 2. 同库位同钻孔：库位限定钻孔时必须一致，同批箱子也不能跨孔
  const batchHoleIds = new Set(batch.map((box) => box.holeId));
  if (batchHoleIds.size > 1) {
    return { ok: false, queued: false, reason: `库位 ${location.code} 按深度连着排，这批箱子分属多个钻孔，不能同库位`, gaps: [] };
  }
  if (location.holeId && ![...batchHoleIds].every((id) => id === location.holeId)) {
    return { ok: false, queued: false, reason: `库位 ${location.code} 限定存放单孔箱子，这批钻孔不符`, gaps: [] };
  }
  const holeId = [...batchHoleIds][0];

  const stored = allBoxes.filter((box) => box.status === 'stored' && box.locationId === location.id);
  if (stored.some((box) => box.holeId !== holeId)) {
    return { ok: false, queued: false, reason: `库位 ${location.code} 已有其他钻孔的箱子，同库位必须同孔连着排`, gaps: [] };
  }

  // 3. 深度不得与已上架箱或同批箱重叠
  const all = [...stored, ...batch];
  const sorted = [...all].sort((a, b) => a.fromDepth - b.fromDepth);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].fromDepth + EPS < sorted[i - 1].toDepth) {
      return {
        ok: false,
        queued: false,
        reason: `箱 ${sorted[i].boxNo} 与 ${sorted[i - 1].boxNo} 深度重叠，不能同库位连着排`,
        gaps: [],
      };
    }
  }

  // 4. 容量：已上架 + 排队在前的箱 + 本批不得超容；到顶就排队，已上架的不挤下来
  const reserved = stored.length + queuedAhead.filter((box) => !batch.some((b) => b.id === box.id)).length;
  if (reserved + batch.length > location.capacity) {
    return {
      ok: false,
      queued: true,
      reason:
        queuedAhead.length > 0
          ? `库位 ${location.code} 前序申请还在排队，按提交先后本批继续等腾位`
          : `库位 ${location.code} 容量 ${location.capacity} 箱、已上架 ${stored.length} 箱，本批 ${batch.length} 箱暂放不下，排队等腾位`,
      gaps: [],
    };
  }

  // 5. 断档标注（不拦截）
  const placed = [...stored, ...batch];
  return { ok: true, queued: false, gaps: gapsOfPlacedBoxes(placed, runs) };
}

/** 生成入库单号：RK-YYYYMMDD-序号（序号按当天已有单数 +1） */
export function nextOrderNo(existingNos: string[], now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `RK-${day}-`;
  const seq = existingNos
    .filter((no) => no.startsWith(prefix))
    .map((no) => Number(no.slice(prefix.length)))
    .reduce((max, n) => (Number.isInteger(n) && n > max ? n : max), 0);
  return `${prefix}${String(seq + 1).padStart(3, '0')}`;
}

/** 库位表单校验 */
export function validateLocation(input: { code: string; capacity: number; fromDepth: number; toDepth: number }): string | undefined {
  if (!input.code.trim()) return '请输入库位编号';
  if (!Number.isInteger(input.capacity) || input.capacity < 1) return '容量必须是不小于 1 的整数（箱）';
  if (Number.isNaN(input.fromDepth) || input.fromDepth < 0) return '管段起始深度不能为负';
  if (Number.isNaN(input.toDepth) || input.toDepth <= input.fromDepth) return '管段终止深度必须大于起始深度';
  return undefined;
}
