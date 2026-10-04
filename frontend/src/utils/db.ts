import Dexie, { type Table } from 'dexie';
import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { CoreBox } from '../types/core-box';
import type { LithoLog } from '../types/litho-log';
import type { StorageLocation } from '../types/storage-location';
import type { InboundItem, InboundOrder } from '../types/inbound-order';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbdrillcore-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class DrillCoreDB extends Dexie {
  holes!: Table<DrillHole, string>;
  runs!: Table<DrillRun, string>;
  boxes!: Table<CoreBox, string>;
  lithos!: Table<LithoLog, string>;
  locations!: Table<StorageLocation, string>;
  inboundOrders!: Table<InboundOrder, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      holes: 'id, holeNo, rigNo, shift, startDate',
      runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
      boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
      lithos: 'id, holeId, fromDepth, toDepth, lithology',
      meta: 'key',
    });

    // v2：岩性表增加 (holeId+fromDepth) 复合索引，按深度区间查询更快；并回填历史 rqd 缺省值。
    // 升级前请在顶栏「导出备份」导出 JSON。
    this.version(2)
      .stores({
        holes: 'id, holeNo, rigNo, shift, startDate',
        runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
        boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
        lithos: 'id, holeId, fromDepth, toDepth, [holeId+fromDepth], lithology',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('lithos')
          .toCollection()
          .modify((row: LithoLog) => {
            if (typeof row.rqd !== 'number') {
              row.rqd = 0;
            }
          });
      });

    // v3：库位与入库流程。新增 locations / inboundOrders 两张表；
    // 箱子增加 status / locationId / inboundOrderId，索引补 status。
    // 旧架位没有容量：按现有架位各编一个默认库位（容量取该架箱数，至少 20），
    // 管段取 0~9999m，旧箱回填为「已上架」并归属到对应默认库位；无架位的箱退回待入库。
    this.version(3)
      .stores({
        holes: 'id, holeNo, rigNo, shift, startDate',
        runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
        boxes: 'id, boxNo, holeId, shelfPos, boxedAt, status, locationId, inboundOrderId',
        lithos: 'id, holeId, fromDepth, toDepth, [holeId+fromDepth], lithology',
        locations: 'id, code, shelfPos, holeId',
        inboundOrders: 'id, orderNo, locationId, status, submittedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const boxesTable = tx.table<CoreBox, string>('boxes');
        const locationsTable = tx.table<StorageLocation, string>('locations');
        const ordersTable = tx.table<InboundOrder, string>('inboundOrders');
        const boxes = await boxesTable.toArray();
        const nowIso = new Date().toISOString();

        // 按旧架位分组统计箱数，每个架位编一个默认库位
        const shelfCount = new Map<string, number>();
        boxes.forEach((box) => {
          if (box.shelfPos) shelfCount.set(box.shelfPos, (shelfCount.get(box.shelfPos) ?? 0) + 1);
        });

        const locations: StorageLocation[] = [];
        const locationOfShelf = new Map<string, StorageLocation>();
        shelfCount.forEach((count, shelfPos) => {
          const shelfCode = shelfPos.replace(/\s*区\s*/g, '').replace(/\s*架\s*/g, '').replace(/\s+/g, '');
          const location: StorageLocation = {
            id: `loc-legacy-${shelfCode}`,
            code: `${shelfCode}-默认`,
            shelfPos,
            holeId: '',
            capacity: Math.max(20, count),
            fromDepth: 0,
            toDepth: 9999,
            createdAt: nowIso,
            keeper: '系统升级',
            remark: '旧架位升级自动生成的默认库位，可按实际容量与管段调整',
          };
          locations.push(location);
          locationOfShelf.set(shelfPos, location);
        });
        if (locations.length) await locationsTable.bulkPut(locations);

        // 每个默认库位补一张历史入库单，承载旧箱归属
        const itemsByShelf = new Map<string, InboundItem[]>();
        boxes.forEach((box) => {
          if (box.shelfPos && locationOfShelf.has(box.shelfPos)) {
            const list = itemsByShelf.get(box.shelfPos) ?? [];
            list.push({ boxId: box.id, boxNo: box.boxNo, holeId: box.holeId, fromDepth: box.fromDepth, toDepth: box.toDepth });
            itemsByShelf.set(box.shelfPos, list);
          }
        });
        const legacyOrders: InboundOrder[] = [];
        locationOfShelf.forEach((location, shelfPos) => {
          const items = itemsByShelf.get(shelfPos) ?? [];
          if (!items.length) return;
          legacyOrders.push({
            id: `inbound-legacy-${location.id}`,
            orderNo: `RK-LEGACY-${location.code}`,
            locationId: location.id,
            applicant: '历史数据',
            keeper: '系统升级',
            submittedAt: nowIso,
            confirmedAt: nowIso,
            status: 'stored',
            items,
            gaps: [],
          });
        });
        if (legacyOrders.length) await ordersTable.bulkPut(legacyOrders);
        const orderIdOfShelf = new Map<string, string>();
        legacyOrders.forEach((order) => {
          const location = locations.find((loc) => loc.id === order.locationId);
          if (location) orderIdOfShelf.set(location.shelfPos, order.id);
        });

        // 回填箱子归属
        await boxesTable.toCollection().modify((box: CoreBox) => {
          const location = box.shelfPos ? locationOfShelf.get(box.shelfPos) : undefined;
          if (location) {
            box.status = 'stored';
            box.locationId = location.id;
            box.inboundOrderId = orderIdOfShelf.get(box.shelfPos);
          } else {
            box.status = 'pending';
            box.shelfPos = box.shelfPos ?? '';
            box.locationId = '';
            box.inboundOrderId = '';
          }
        });
      });
  }
}

export const db = new DrillCoreDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
