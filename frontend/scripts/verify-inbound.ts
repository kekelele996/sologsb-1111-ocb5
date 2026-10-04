import 'fake-indexeddb/auto';
import { db, SCHEMA_VERSION } from '../src/utils/db';
import { checkAdmission, gapsOfPlacedBoxes } from '../src/utils/inbound';
import type { CoreBox } from '../src/types/core-box';
import type { DrillRun } from '../src/types/drill-run';
import type { StorageLocation } from '../src/types/storage-location';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

// ---------- 1. v2 -> v3 migration ----------
async function testMigration() {
  console.log('v2 -> v3 升级：');

  // 手工建出 v2 schema 并塞旧数据（旧箱无 status / locationId）
  const dbOld = new (await import('dexie')).default('gbdrillcore-db');
  dbOld.version(1).stores({
    holes: 'id, holeNo',
    runs: 'id, runNo, holeId',
    boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
    lithos: 'id, holeId',
    meta: 'key',
  });
  dbOld.version(2).stores({
    holes: 'id, holeNo',
    runs: 'id, runNo, holeId',
    boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
    lithos: 'id, holeId, [holeId+fromDepth]',
    meta: 'key',
  });
  await dbOld.table('boxes').bulkPut([
    { id: 'old-1', boxNo: 'X-1', holeId: 'h1', fromDepth: 0, toDepth: 10, slots: 4, slotLength: 2.5, boxedAt: new Date().toISOString(), shelfPos: 'A 区 1 架', damagedSlots: [], operator: '甲' },
    { id: 'old-2', boxNo: 'X-2', holeId: 'h1', fromDepth: 10, toDepth: 20, slots: 4, slotLength: 2.5, boxedAt: new Date().toISOString(), shelfPos: 'A 区 1 架', damagedSlots: [], operator: '甲' },
    { id: 'old-3', boxNo: 'X-3', holeId: 'h1', fromDepth: 20, toDepth: 30, slots: 4, slotLength: 2.5, boxedAt: new Date().toISOString(), shelfPos: 'B 区 1 架', damagedSlots: [], operator: '乙' },
  ]);
  await dbOld.table('lithos').bulkPut([{ id: 'l1', holeId: 'h1', fromDepth: 0, toDepth: 5 } as never]);
  dbOld.close();

  // 用当前代码重新打开（触发 v3 升级）
  await db.open();
  assert(db.verno === 3, `schema 版本升到 3（实际 ${(db as unknown as { verno: number }).verno}），常量=${SCHEMA_VERSION}`);

  const locs = await db.locations.toArray();
  assert(locs.length === 2, `按两个现有架位编出 2 个默认库位（实际 ${locs.length}）`);
  const a1 = locs.find((l) => l.shelfPos === 'A 区 1 架')!;
  assert(a1.capacity === 20, `A 区 1 架箱数为 2，默认容量 max(20,2)=20（实际 ${a1.capacity}）`);
  assert(a1.fromDepth === 0 && a1.toDepth === 9999, '默认库位管段 0~9999m');

  const boxes = await db.boxes.toArray();
  assert(boxes.every((b) => b.status === 'stored'), '三个旧箱全部回填为已上架');
  const byId = new Map(boxes.map((b) => [b.id, b]));
  assert(byId.get('old-1')!.locationId === a1.id && byId.get('old-2')!.locationId === a1.id, '旧箱归属回填到本架默认库位');

  const orders = await db.inboundOrders.toArray();
  assert(orders.length === 2 && orders.every((o) => o.status === 'stored'), '每个默认库位补一张历史入库单（stored）');
  const a1Order = orders.find((o) => o.locationId === a1.id)!;
  assert(a1Order.items.length === 2, '历史入库单承载该架旧箱明细');
  assert(byId.get('old-1')!.inboundOrderId === a1Order.id, '旧箱入库单 id 回填一致');
  db.close();
}

// ---------- 2. admission ----------
const runs: DrillRun[] = [];
for (let i = 0; i < 40; i += 1) {
  runs.push({ id: `r${i}`, runNo: `H1-${String(i + 1).padStart(2, '0')}`, holeId: 'h1', fromDepth: i * 5, toDepth: (i + 1) * 5 } as DrillRun);
}

const loc: StorageLocation = { id: 'L', code: 'A1-01', shelfPos: 'A', holeId: '', capacity: 3, fromDepth: 0, toDepth: 200, createdAt: '', keeper: '' };
const box = (id: string, from: number, to: number, hole = 'h1'): CoreBox =>
  ({ id, boxNo: id, holeId: hole, fromDepth: from, toDepth: to, slots: 4, slotLength: 2.5, boxedAt: '', shelfPos: '', damagedSlots: [], operator: '', status: 'pending' });
const stored = (b: CoreBox): CoreBox => ({ ...b, status: 'stored', locationId: 'L' });

async function testAdmission() {
  console.log('入库确认规则：');

  let r = checkAdmission(loc, [box('a', 0, 25)], [], runs);
  assert(r.ok && r.gaps.length === 0, '单箱在管段内、库位空：确认通过');

  r = checkAdmission(loc, [box('a', 190, 210)], [], runs);
  assert(!r.ok && !r.queued, '超出库位管段：整批确认失败（不是排队）');

  const existing = [stored(box('s1', 0, 25)), stored(box('s2', 25, 50))];
  r = checkAdmission(loc, [box('b', 50, 75)], existing, runs);
  assert(r.ok && r.gaps.length === 0, '容量未满且深度衔接：通过，无断档');

  r = checkAdmission(loc, [box('b', 75, 100), box('c', 100, 125)], existing, runs);
  assert(!r.ok && r.queued === true, '已上架 2 + 本批 2 > 容量 3：排队等腾位');

  // 已上架箱不能被挤下来：排队判定只读 stored，不包含其他挂起单
  const hanging = [stored(box('s1', 0, 25)), stored(box('s2', 25, 50)), stored(box('s3', 50, 75))];
  r = checkAdmission(loc, [box('b', 75, 100)], hanging, runs);
  assert(r.queued, '库位到顶（3/3）：新箱排队');

  r = checkAdmission(loc, [box('b', 20, 40)], existing, runs);
  assert(!r.ok && !r.queued, '与已上架箱深度重叠：确认失败');

  r = checkAdmission(loc, [box('b', 100, 125)], existing, runs);
  assert(r.ok && r.gaps.length === 1 && r.gaps[0].from === 50 && r.gaps[0].to === 100, '同库位 50~100m 断档被记录（缺哪段+回次）');
  assert(r.gaps[0].runLabel.includes('H1-11'), `断档标注涉及回次（${r.gaps[0].runLabel}）`);

  r = checkAdmission(loc, [box('b', 50, 75, 'h2')], existing, runs);
  assert(!r.ok && !r.queued, '与已上架箱不同孔：确认失败');

  // 断档纯函数
  const gaps = gapsOfPlacedBoxes([stored(box('s1', 0, 25)), stored(box('s2', 100, 125))], runs);
  assert(gaps.length === 1 && gaps[0].from === 25 && gaps[0].to === 100, 'gapsOfPlacedBoxes 输出唯一断档段');

  // FIFO：容量 3、已上架 2，排队在前的 1 箱先占位，后来的单即使只来 1 箱也不能插队
  const earlierQueue = [box('q1', 75, 100)];
  r = checkAdmission(loc, [box('b', 100, 125)], existing, runs, earlierQueue);
  assert(r.queued && /前序申请/.test(r.reason ?? ''), '前序申请排队中：后提交的单不能插队，继续排队');
  r = checkAdmission(loc, [box('q1', 75, 100)], existing, runs, []);
  assert(r.ok, '前序单重试：腾出的空位按提交先后归它');
}

async function main() {
  await testMigration();
  await testAdmission();
  if (failures) {
    console.error(`\n${failures} 条断言失败`);
    process.exit(1);
  }
  console.log('\n全部断言通过');
  process.exit(0);
}
main();
