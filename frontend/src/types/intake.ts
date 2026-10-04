import type { LocationGap } from './storage-location';

/**
 * 岩芯箱入库状态：
 * - pending 待入库（钻机组装箱后，尚未提交申请；可改可删）
 * - applied 已提交申请，待库房确认
 * - waiting 挂起排队：库位到顶或管段不符，等腾位（已上架的不受影响）
 * - stored 已上架，落成入库单（只能由库房管理员退回）
 */
export type BoxStorageStatus = 'pending' | 'applied' | 'waiting' | 'stored';

/** 入库申请单状态 */
export type IntakeStatus = 'submitted' | 'confirmed' | 'partial' | 'failed' | 'rejected';

/** 入库单条目（一箱一行，确认时落架结果） */
export interface IntakeItem {
  boxId: string;
  boxNo: string;
  holeId: string;
  fromDepth: number;
  toDepth: number;
  /** 上架库位（挂起/退回时为空） */
  locationId?: string;
  locationCode?: string;
  /** 同库位内的排架序号 */
  seq?: number;
  /** 排队/退回原因 */
  reason?: string;
  /** 上架是否成功 */
  stored: boolean;
  /** 深度断档（缺哪段回次） */
  gaps?: LocationGap[];
}

/** 入库申请（钻机组装箱后提交） */
export interface IntakeApplication {
  id: string;
  /** 申请单号 */
  appNo: string;
  /** 申请钻孔 */
  holeId: string;
  /** 期望库架位 */
  shelfPos: string;
  /** 申请人（钻探班组） */
  applicant: string;
  /** 提交时间 ISO */
  appliedAt: string;
  /** 涉及箱子（提交时快照顺序） */
  boxIds: string[];
  status: IntakeStatus;
  note?: string;
}

/** 入库单（库房管理员按容量和深度确认后落成） */
export interface IntakeReceipt {
  id: string;
  /** 入库单号 */
  receiptNo: string;
  /** 来源申请 */
  applicationId: string;
  appNo: string;
  /** 确认时间 ISO（重试后更新） */
  confirmedAt: string;
  /** 库房管理员 */
  keeper: string;
  /** 本次落架明细 */
  items: IntakeItem[];
  /** 成功箱数 */
  storedCount: number;
  /** 挂起箱数 */
  waitingCount: number;
  /** 是否最近一次由挂起重试生成 */
  retried?: boolean;
  /** 是否有退回（整单退回或部分退回） */
  returned?: boolean;
  /** 退回时间 ISO */
  returnedAt?: string;
  /** 退回备注 */
  returnNote?: string;
}

export const STATUS_TEXT: Record<BoxStorageStatus, string> = {
  pending: '待入库',
  applied: '待确认',
  waiting: '排队等腾位',
  stored: '已上架',
};

export const STATUS_COLOR: Record<BoxStorageStatus, string> = {
  pending: 'default',
  applied: 'blue',
  waiting: 'orange',
  stored: 'green',
};

export const APP_STATUS_TEXT: Record<IntakeStatus, string> = {
  submitted: '待确认',
  confirmed: '全部上架',
  partial: '部分上架·部分挂起',
  failed: '确认失败·待入库',
  rejected: '已退回',
};

export const APP_STATUS_COLOR: Record<IntakeStatus, string> = {
  submitted: 'blue',
  confirmed: 'green',
  partial: 'orange',
  failed: 'red',
  rejected: 'default',
};
