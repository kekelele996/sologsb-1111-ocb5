/** 库位（库架位下的具体存放段，库房管理员编出） */
export interface StorageLocation {
  id: string;
  /** 库位编号，如 A1-01 */
  code: string;
  /** 所属库架位（与岩芯箱 shelfPos 对应） */
  shelfPos: string;
  /** 该库位收纳的钻孔（一孔一位） */
  holeId: string;
  /** 管到的起始深度（m） */
  fromDepth: number;
  /** 管到的终止深度（m） */
  toDepth: number;
  /** 容量（最多装几箱） */
  capacity: number;
  /** 备注 */
  remark?: string;
}

/** 库位中一箱的断档说明（深度连续排时记录缺哪段回次） */
export interface LocationGap {
  /** 前一箱的箱号（首箱断档时为空） */
  afterBoxNo?: string;
  /** 后一箱的箱号 */
  beforeBoxNo?: string;
  /** 断档起始深度（m） */
  from: number;
  /** 断档终止深度（m） */
  to: number;
  /** 断档段涉及/缺失的回次号（无回次覆盖时列出可能相关回次） */
  runNos: string[];
}

/** 库位排架派生信息 */
export interface LocationLayout {
  location: StorageLocation;
  /** 已上架箱子（按深度连着排） */
  storedBoxes: Array<{ boxId: string; boxNo: string; fromDepth: number; toDepth: number; seq: number }>;
  /** 已用箱数 */
  used: number;
  /** 剩余容量 */
  free: number;
  /** 是否到顶 */
  full: boolean;
  /** 深度断档（缺哪段回次） */
  gaps: LocationGap[];
}
