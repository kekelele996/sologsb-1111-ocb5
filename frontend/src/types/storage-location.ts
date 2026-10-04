/**
 * 库位：库房管理员在每个库架位下编出的具体货位。
 * 写明每个库位能装几箱（capacity）、管到哪段深度（fromDepth~toDepth）。
 */
export interface StorageLocation {
  id: string;
  /** 库位编号，如 A1-01 */
  code: string;
  /** 所属库架位（一行字的旧架位） */
  shelfPos: string;
  /** 限定钻孔（空串表示不限钻孔） */
  holeId: string;
  /** 容量：最多装几箱 */
  capacity: number;
  /** 管辖起始深度（m） */
  fromDepth: number;
  /** 管辖终止深度（m） */
  toDepth: number;
  /** 建位日期 ISO */
  createdAt: string;
  /** 建位人（库房管理员） */
  keeper: string;
  /** 备注 */
  remark?: string;
}
