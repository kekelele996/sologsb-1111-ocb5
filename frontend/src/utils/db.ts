import Dexie, { type Table } from 'dexie';
import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { CoreBox } from '../types/core-box';
import type { LithoLog } from '../types/litho-log';
import type { StorageLocation } from '../types/storage-location';
import type { IntakeApplication, IntakeItem, IntakeReceipt } from '../types/intake';

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
  applications!: Table<IntakeApplication, string>;
  receipts!: Table<IntakeReceipt, string>;
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

    // v3：库位管理。新增 locations / applications / receipts 三表，
    // 旧数据的架位没有容量：按现有架位（架位 + 钻孔）编出默认库位，并回填箱子归属。
    this.version(3)
      .stores({
        holes: 'id, holeNo, rigNo, shift, startDate',
        runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
        boxes: 'id, boxNo, holeId, shelfPos, boxedAt, storageStatus, locationId, applicationId',
        lithos: 'id, holeId, fromDepth, toDepth, [holeId+fromDepth], lithology',
        locations: 'id, code, shelfPos, holeId',
        applications: 'id, appNo, holeId, status, appliedAt',
        receipts: 'id, receiptNo, applicationId, confirmedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const [boxes, holes, runs] = await Promise.all([
          tx.table<CoreBox, string>('boxes').toArray(),
          tx.table<DrillHole, string>('holes').toArray(),
          tx.table<DrillRun, string>('runs').toArray(),
        ]);

        // 按「架位 + 钻孔」把历史箱子归组，每组编一个默认库位
        const groups = new Map<string, CoreBox[]>();
        boxes.forEach((box) => {
          const shelf = box.shelfPos || 'A 区 1 架';
          const key = `${shelf}||${box.holeId}`;
          const list = groups.get(key) ?? [];
          list.push(box);
          groups.set(key, list);
        });

        const locations: StorageLocation[] = [];
        const receipts: IntakeReceipt[] = [];
        const applications: IntakeApplication[] = [];
        // 同一架位的库位序号
        const seqByShelf = new Map<string, number>();

        groups.forEach((groupBoxes, key) => {
          const [shelfPos, holeId] = key.split('||');
          const sorted = [...groupBoxes].sort((a, b) => a.fromDepth - b.fromDepth);
          const shelfSeq = (seqByShelf.get(shelfPos) ?? 0) + 1;
          seqByShelf.set(shelfPos, shelfSeq);

          const zone = shelfPos.match(/([A-Za-z])\s*区/)?.[1]?.toUpperCase() ?? 'A';
          const rack = shelfPos.match(/(\d+)\s*架/)?.[1] ?? '1';
          const locationId = `loc-mig-${zone}${rack}-${shelfSeq}`;
          const code = `${zone}${rack}-${String(shelfSeq).padStart(2, '0')}`;
          const fromDepth = Math.min(...sorted.map((b) => b.fromDepth));
          // 管段尽量延到孔深，新箱可继续上架；取不到孔深时以现有最深箱为准
          const hole = holes.find((h) => h.id === holeId);
          const maxBoxTo = Math.max(...sorted.map((b) => b.toDepth));
          const toDepth = hole ? Math.max(hole.designDepth || 0, hole.finalDepth || 0, maxBoxTo) : maxBoxTo;
          // 默认容量：现有箱数再加余量（至少 8 箱），容量取整
          const capacity = Math.max(8, sorted.length + 4);

          locations.push({
            id: locationId,
            code,
            shelfPos,
            holeId,
            fromDepth: Number(fromDepth.toFixed(2)),
            toDepth: Number(toDepth.toFixed(2)),
            capacity,
            remark: '升级旧架位时自动编出的默认库位',
          });

          const items: IntakeItem[] = sorted.map((box, index) => ({
            boxId: box.id,
            boxNo: box.boxNo,
            holeId: box.holeId,
            fromDepth: box.fromDepth,
            toDepth: box.toDepth,
            locationId,
            locationCode: code,
            seq: index + 1,
            stored: true,
          }));

          const appId = `app-mig-${zone}${rack}-${shelfSeq}`;
          const appNo = `SQ-OLD-${zone}${rack}${shelfSeq}`;
          applications.push({
            id: appId,
            appNo,
            holeId,
            shelfPos,
            applicant: '系统迁移',
            appliedAt: new Date().toISOString(),
            boxIds: sorted.map((b) => b.id),
            status: 'confirmed',
            note: '旧架位数据升级自动生成',
          });
          receipts.push({
            id: `rec-mig-${zone}${rack}-${shelfSeq}`,
            receiptNo: `RK-OLD-${zone}${rack}${shelfSeq}`,
            applicationId: appId,
            appNo,
            confirmedAt: new Date().toISOString(),
            keeper: '系统迁移',
            items,
            storedCount: items.length,
            waitingCount: 0,
          });

          // 回填箱子归属
          sorted.forEach((box, index) => {
            box.storageStatus = 'stored';
            box.locationId = locationId;
            box.applicationId = appId;
            box.receiptId = `rec-mig-${zone}${rack}-${shelfSeq}`;
            void index;
          });
        });

        // 不属于任何架位组（无 shelfPos 且兜底失败）的箱子视作待入库
        boxes.forEach((box) => {
          if (!box.storageStatus) box.storageStatus = 'pending';
        });

        if (locations.length) {
          await tx.table('locations').bulkPut(locations);
          await tx.table('applications').bulkPut(applications);
          await tx.table('receipts').bulkPut(receipts);
          await tx.table('boxes').bulkPut(boxes);
        }
        void runs;
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
