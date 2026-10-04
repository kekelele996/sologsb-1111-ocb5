/** 岩芯箱入库状态：待入库（钻探班组可改可删）/ 已报待上架 / 已上架（入库单） */
export type BoxStatus = 'pending' | 'submitted' | 'stored';

/** 岩芯箱 */
export interface CoreBox {
  id: string;
  /** 箱号 */
  boxNo: string;
  /** 所属钻孔 */
  holeId: string;
  /** 起始深度（m） */
  fromDepth: number;
  /** 终止深度（m） */
  toDepth: number;
  /** 格数 */
  slots: number;
  /** 每格长度（m） */
  slotLength: number;
  /** 装箱日期 ISO */
  boxedAt: string;
  /** 库架位（上架后随库位带出；待入库箱可为空串） */
  shelfPos: string;
  /** 破损格（格序号，从 1 开始） */
  damagedSlots: number[];
  /** 装箱人 */
  operator: string;
  /** 备注 */
  remark?: string;
  /** 入库状态，旧数据升级后回填为 stored */
  status?: BoxStatus;
  /** 所在库位 id（已上架） */
  locationId?: string;
  /** 最近一次入库申请单 id（提交后挂单，失败退回后保留以便追溯） */
  inboundOrderId?: string;
}

/** 岩芯箱与回次的连续性校验结果 */
export interface BoxContinuity {
  box: CoreBox;
  /** 区间是否被回次完整覆盖 */
  covered: boolean;
  /** 断档区间（未被回次覆盖的深度段） */
  gaps: Array<{ from: number; to: number }>;
  /** 提示文案 */
  message: string;
}

export const SHELF_POSITIONS: string[] = ['A 区 1 架', 'A 区 2 架', 'B 区 1 架', 'B 区 2 架', 'C 区 1 架'];

export const BOX_STATUS_TEXT: Record<BoxStatus, string> = {
  pending: '待入库',
  submitted: '已报待上架',
  stored: '已上架',
};
