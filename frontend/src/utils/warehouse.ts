import type { CoreBox } from '../types/core-box';
import type { DrillRun } from '../types/drill-run';
import type { IntakeItem } from '../types/intake';
import type { LocationGap, LocationLayout, StorageLocation } from '../types/storage-location';

/** 库位编号前缀：取架位中的区字母 + 架号数字，如「A 区 1 架」→ A1 */
export function shelfPrefix(shelfPos: string): string {
  const zone = shelfPos.match(/([A-Za-z])\s*区/)?.[1]?.toUpperCase() ?? 'K';
  const rack = shelfPos.match(/(\d+)\s*架/)?.[1] ?? '1';
  return `${zone}${rack}`;
}

/** 按现有库位生成下一个库位编号，如 A1-03 */
export function nextLocationCode(shelfPos: string, locations: StorageLocation[]): string {
  const prefix = shelfPrefix(shelfPos);
  const maxSeq = locations
    .filter((loc) => loc.shelfPos === shelfPos)
    .reduce((max, loc) => {
      const m = loc.code.match(/^[A-Za-z]+\d+-(\d+)$/);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
  return `${prefix}-${String(maxSeq + 1).padStart(2, '0')}`;
}

/** 箱子深度区间是否被库位管段完整覆盖 */
export function boxCoveredByLocation(box: Pick<CoreBox, 'fromDepth' | 'toDepth' | 'holeId'>, loc: StorageLocation): boolean {
  return box.holeId === loc.holeId && box.fromDepth + 0.0001 >= loc.fromDepth && box.toDepth <= loc.toDepth + 0.0001;
}

/**
 * 同一库位的箱子按深度连着排（断档处不断开，但记录缺哪段回次）。
 * 排架位置号按深度次序给出；库房腾退后新箱按深度补进相应位置。
 */
export function buildLocationLayout(location: StorageLocation, boxes: CoreBox[], runs: DrillRun[]): LocationLayout {
  const stored = boxes
    .filter((b) => b.storageStatus === 'stored' && b.locationId === location.id)
    .sort((a, b) => a.fromDepth - b.fromDepth || a.toDepth - b.toDepth);

  const storedBoxes = stored.map((box, index) => ({
    boxId: box.id,
    boxNo: box.boxNo,
    fromDepth: box.fromDepth,
    toDepth: box.toDepth,
    seq: index + 1,
  }));

  const used = stored.length;
  const free = Math.max(0, location.capacity - used);
  const gaps = gapsBetweenBoxes(stored, location, runs);

  return { location, storedBoxes, used, free, full: used >= location.capacity, gaps };
}

/** 找出断档深度段内相关（缺失）的回次号 */
function runNosInGap(gapFrom: number, gapTo: number, runs: DrillRun[], holeId: string): string[] {
  const eps = 0.0001;
  const inside = runs.filter(
    (run) => run.holeId === holeId && run.toDepth > gapFrom + eps && run.fromDepth < gapTo - eps,
  );
  if (inside.length) return inside.map((r) => r.runNo);
  // 完全无回次覆盖：给出紧邻断档段前后的回次，便于核对
  const before = runs.filter((r) => r.holeId === holeId && r.toDepth <= gapFrom + eps).sort((a, b) => b.toDepth - a.toDepth)[0];
  const after = runs.filter((r) => r.holeId === holeId && r.fromDepth >= gapTo - eps).sort((a, b) => a.fromDepth - b.fromDepth)[0];
  return [before, after].filter((r): r is DrillRun => Boolean(r)).map((r) => r.runNo);
}

/** 库位内箱与箱之间（含库位首段、库位尾段）的深度断档 */
export function gapsBetweenBoxes(
  orderedBoxes: CoreBox[],
  location: StorageLocation,
  runs: DrillRun[],
): LocationGap[] {
  const gaps: LocationGap[] = [];
  const eps = 0.0001;
  const push = (from: number, to: number, afterBoxNo: string | undefined, beforeBoxNo: string | undefined) => {
    if (to - from <= eps) return;
    gaps.push({
      afterBoxNo,
      beforeBoxNo,
      from: Number(from.toFixed(2)),
      to: Number(to.toFixed(2)),
      runNos: runNosInGap(from, to, runs, location.holeId),
    });
  };

  // 已装箱覆盖到的深度段（箱箱相接则合并；断档处在并集之间留出缺口）
  const covered = [...orderedBoxes]
    .map((b) => ({ from: Math.max(location.fromDepth, b.fromDepth), to: Math.min(location.toDepth, b.toDepth), box: b }))
    .filter((r) => r.to > r.from)
    .sort((a, b) => a.from - b.from)
    .reduce<Array<{ from: number; to: number; lastBox?: CoreBox }>>((acc, seg) => {
      const last = acc[acc.length - 1];
      if (last && seg.from <= last.to + eps) {
        last.to = Math.max(last.to, seg.to);
        last.lastBox = seg.box;
      } else {
        acc.push({ from: seg.from, to: seg.to, lastBox: seg.box });
      }
      return acc;
    }, []);

  // 库位首段
  const first = covered[0];
  if (!first) {
    push(location.fromDepth, location.toDepth, undefined, undefined);
    return gaps;
  }
  if (first.from > location.fromDepth + eps) {
    push(location.fromDepth, first.from, undefined, orderedBoxes.find((b) => b.fromDepth >= first.from - eps)?.boxNo);
  }
  // 覆盖段之间：箱与箱之间的断档
  for (let i = 1; i < covered.length; i += 1) {
    push(covered[i - 1].to, covered[i].from, covered[i - 1].lastBox?.boxNo, orderedBoxes.find((b) => b.fromDepth >= covered[i].from - eps)?.boxNo);
  }
  // 库位尾段
  const lastSeg = covered[covered.length - 1];
  if (lastSeg.to < location.toDepth - eps) {
    push(lastSeg.to, location.toDepth, lastSeg.lastBox?.boxNo, undefined);
  }
  return gaps;
}

/** 断档提示文案 */
export function gapText(gaps: LocationGap[]): string {
  if (!gaps.length) return '箱箱深度相接，无断档';
  return gaps
    .map((g) => {
      const seg = `${g.from}~${g.to}m`;
      const where = g.afterBoxNo ? `${g.afterBoxNo} 与 ${g.beforeBoxNo ?? '库位尾'} 之间` : `库位首至 ${g.beforeBoxNo ?? '库位尾'}`;
      const runText = g.runNos.length ? `（缺回次：${g.runNos.join('、') || '无记录'}）` : '（该段无回次记录）';
      return `${where} 缺 ${seg}${runText}`;
    })
    .join('；');
}

export interface AllocationResult {
  item: IntakeItem;
  /** 是否落架成功 */
  stored: boolean;
  /** 挂起/失败原因（成功时为空） */
  reason?: string;
  /** 落架库位（成功时） */
  location?: StorageLocation;
  /** 放入后库位的深度断档（位置号由调用方统一编号后写入） */
  gaps?: LocationGap[];
}

/**
 * 按库位内最终在架箱的深度次序统一编写位置号与断档。
 * 库房退回（腾位）后补架时，已在架箱保持原位置号，新箱按深度补进空号——绝不挤动已上架箱。
 *
 * @param orderedStoredBoxes 库位内最终在架箱（已按深度排序）
 * @param fixedSeqByBox 已在入库单上的箱位置号（重试时据此保持不动）
 */
export function assignLayout(
  location: StorageLocation,
  orderedStoredBoxes: CoreBox[],
  fixedSeqByBox: Map<string, number>,
  runs: DrillRun[],
): Map<string, { seq: number; gaps: LocationGap[] }> {
  const gaps = gapsBetweenBoxes(orderedStoredBoxes, location, runs);
  const result = new Map<string, { seq: number; gaps: LocationGap[] }>();

  // 期望深度位置：从 1 开始；已固定箱占据其单据位置，新箱按深度次序领取最小的未占用位置号
  const occupied = new Set<number>([...fixedSeqByBox.values()]);
  orderedStoredBoxes.forEach((box) => {
    const fixed = fixedSeqByBox.get(box.id);
    if (typeof fixed === 'number') {
      result.set(box.id, { seq: fixed, gaps });
      occupied.add(fixed);
      return;
    }
    let seq = 1;
    while (occupied.has(seq)) seq += 1;
    occupied.add(seq);
    result.set(box.id, { seq, gaps });
  });
  return result;
}

/**
 * 为一箱挑选库位并尝试落架。
 * 规则：库架位一致 + 同孔 + 箱深度落在库位管段内 + 容量未满。
 * 多个库位满足时优先排到深度最贴合（管段最短、剩余容量最少）的库位。
 * 不挤下任何已上架箱子：本函数基于传入的占用快照计数，调用方须在批内同步更新占用。
 */
export function allocateBox(
  box: CoreBox,
  locations: StorageLocation[],
  occupancy: Map<string, number>,
  runs: DrillRun[],
  storedBoxes: CoreBox[],
): AllocationResult {
  const base: IntakeItem = {
    boxId: box.id,
    boxNo: box.boxNo,
    holeId: box.holeId,
    fromDepth: box.fromDepth,
    toDepth: box.toDepth,
    stored: false,
  };

  const sameShelf = locations.filter((loc) => loc.shelfPos === box.shelfPos);
  if (!sameShelf.length) {
    return { item: base, stored: false, reason: `架位「${box.shelfPos}」尚未编出任何库位，请库房管理员先编库位` };
  }

  const matchHoleSegment = sameShelf.filter((loc) => boxCoveredByLocation(box, loc));
  if (!matchHoleSegment.length) {
    const sameHole = sameShelf.filter((loc) => loc.holeId === box.holeId);
    const reason = sameHole.length
      ? `深度 ${box.fromDepth}~${box.toDepth}m 超出该架位本孔库位管段（${sameHole
          .map((l) => `${l.code} ${l.fromDepth}~${l.toDepth}m`)
          .join('、')}）`
      : `架位「${box.shelfPos}」没有收纳该钻孔的库位`;
    return { item: base, stored: false, reason };
  }

  const withRoom = matchHoleSegment.filter((loc) => (occupancy.get(loc.id) ?? 0) < loc.capacity);
  if (!withRoom.length) {
    const codes = matchHoleSegment.map((l) => l.code).join('、');
    return { item: base, stored: false, reason: `匹配库位 ${codes} 容量到顶，排队等腾位` };
  }

  // 最贴合：剩余容量最少（尽量塞满）、管段最短优先
  const target = [...withRoom].sort((a, b) => {
    const freeA = a.capacity - (occupancy.get(a.id) ?? 0);
    const freeB = b.capacity - (occupancy.get(b.id) ?? 0);
    if (freeA !== freeB) return freeA - freeB;
    return a.toDepth - a.fromDepth - (b.toDepth - b.fromDepth);
  })[0];

  const storedHere = storedBoxes
    .filter((b) => b.locationId === target.id)
    .sort((a, b) => a.fromDepth - b.fromDepth || a.toDepth - b.toDepth);
  // 排位位置号与断档由调用方在整批落架完成后按库位统一编号（见 intakeStore.assignLayout），
  // 此处只决定箱落到哪个库位，保证批内乱序提交也能得到正确的深度连排位置。
  const withThisSorted = [...storedHere, box].sort((a, b) => a.fromDepth - b.fromDepth || a.toDepth - b.toDepth);
  const gaps = gapsBetweenBoxes(withThisSorted, target, runs);

  return {
    item: { ...base, stored: true, locationId: target.id, locationCode: target.code, gaps },
    stored: true,
    location: target,
    gaps,
  };
}
