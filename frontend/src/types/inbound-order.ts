import type { CoreBox } from './core-box';

/** 入库单状态：待确认（已报待上架）/ 已上架 / 确认失败退回 */
export type InboundOrderStatus = 'submitted' | 'stored' | 'failed';

/** 入库单明细（提交时的箱子快照） */
export interface InboundItem {
  boxId: string;
  boxNo: string;
  holeId: string;
  fromDepth: number;
  toDepth: number;
}

/** 确认上架时发现的同库位深度断档：缺哪段回次 */
export interface InboundGap {
  from: number;
  to: number;
  /** 该段涉及/缺失的回次号（取不到时写「无对应回次」） */
  runLabel: string;
}

/**
 * 入库申请单：钻探班组装箱后提交；
 * 库房管理员按容量和深度确认上架，落成入库单。
 */
export interface InboundOrder {
  id: string;
  /** 入库单号，如 RK-20261004-001 */
  orderNo: string;
  /** 申请上架的库位 */
  locationId: string;
  /** 提交申请的班组/装箱人 */
  applicant: string;
  /** 确认上架的库房管理员 */
  keeper?: string;
  /** 申请提交时间 ISO */
  submittedAt: string;
  /** 确认/失败时间 ISO */
  confirmedAt?: string;
  status: InboundOrderStatus;
  /** 申请明细快照 */
  items: InboundItem[];
  /** 确认失败原因（整批退回待入库时填写） */
  failReason?: string;
  /** 上架时记录的深度断档（缺哪段回次） */
  gaps?: InboundGap[];
}

export const INBOUND_STATUS_TEXT: Record<InboundOrderStatus, string> = {
  submitted: '待确认',
  stored: '已上架',
  failed: '确认失败退回',
};

/** 入库单明细当前是否仍存在（重试时可能被班组删掉） */
export function itemBoxExists(item: InboundItem, boxes: CoreBox[]): boolean {
  return boxes.some((box) => box.id === item.boxId);
}
