# 矿区钻孔岩芯编目台（gbdrillcore）

面向地质勘查钻探班组与地质编录员：登记钻孔台帐、回次进尺与采取率、岩芯箱箱位，并按深度区间编录岩性描述与样品；另由库房管理员按库架编出**库位**（写明每库位装几箱、管到哪段深度），钻机组装箱后提交入库申请、库房按容量与深度确认上架并落成入库单。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21811>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| 构建 | Vite 6（`npm run build` 含 `tsc --noEmit` 类型检查） |
| UI | Ant Design 5 + @ant-design/icons |
| 路由 | React Router 6（7 条业务路由 + 404） |
| 状态 | Zustand（holeStore / runStore / boxStore / lithoStore / locationStore / intakeStore / roleStore） |
| 存储 | IndexedDB（Dexie，库名 `gbdrillcore-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21811
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # drill-hole / drill-run / core-box / litho-log
│       ├── stores/            # holeStore / runStore / boxStore / lithoStore
│       ├── components/common/ # DepthRangeInput / RecoveryBadge / BoxGrid / LithoColumn / StatBadge / FilterBar / EmptyPanel
│       ├── hooks/             # useHoleFilter / useDepthCalc
│       ├── pages/             # HoleBoard / HoleList / RunLog / CoreBoxList / IntakeDesk / LocationBoard / LithoEditor
│       ├── router/index.tsx   # 路由表
│       └── utils/             # recovery.ts / db.ts / export.ts（+ seed.ts / id.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 工作台 | 钻孔进度、设计达成率、未达设计待补勘清单、采取率异常清单（<75% 标红） |
| `/holes` | 钻孔台帐 | 建孔、坐标与孔口标高、设计/终孔深度、测斜数据、回次深度覆盖与岩芯箱数回显 |
| `/runs` | 回次记录 | 起止深度自动算进尺与采取率，低于 75% 立即标红并入异常清单 |
| `/boxes` | 岩芯箱编目 | 格位网格按深度填充、破损格标记、装箱深度连续性与格位容量校验；钻机组勾选待入库箱提交入库申请 |
| `/intake` | 入库管理 | 库房按容量与深度确认上架并落成入库单；排队等腾位、挂起批重试、整批/单箱/整单退回 |
| `/locations` | 库位管理 | 库房按架位编库位（容量 + 钻孔管段），按深度连排、断档缺哪段回次、占用与到顶一览 |
| `/lithology` | 岩性编录 | 按深度区间编录岩性/蚀变/矿化/RQD/样品，区间重叠报冲突并高亮，SVG 岩性柱状图 |

## 库位与入库规则

- **编库位**：库房管理员在「库位管理」按现有架位编出库位（编号如 `A1-01`），写明容量（装几箱）与管段（收纳哪个钻孔、管到哪段深度）。
- **申请入库**：钻机组装箱后箱子为「待入库」，可改可删；勾选待入库箱提交申请后锁定（同孔一单），等待库房确认。
- **确认上架**：库房管理员按「架位一致 + 同孔 + 箱深度落在管段内 + 容量未满」确认；成功即落成入库单（单号、库位、排架位置、断档）。同一库位的箱子按深度连着排，断档写明缺哪段回次。
- **到顶排队**：匹配库位容量到顶（或管段不符）时箱子进入「排队等腾位」，**已上架箱不会被挤下**；库房退回腾出位置后可「重试」，重试只动挂起那批。
- **确认失败**：一批中一箱都没上架时整批退回待入库（申请留痕为失败，可重新申请）；部分成功则部分上架、部分挂起。
- **退回权限**：未入库箱钻机组可改可删；已提交/挂起/已上架的箱子只能由库房管理员在入库管理退回（单箱或整单），退回后回待入库。
- 右上角可在「钻探班组 / 库房管理员」两岗之间切换，操作按钮按岗位显隐（本地记忆，纯前端无鉴权）。

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbdrillcore-db`），表：`holes`、`runs`、`boxes`、`lithos`、`locations`、`applications`、`receipts`、`meta`。
- `db.version(1)` 建表声明索引；`db.version(2)` 为岩性表增加复合索引并回填历史 RQD；`db.version(3)` 增加库位/申请/入库单三表。**旧数据的架位没有容量，v3 升级会按现有架位（架位 + 钻孔）编出默认库位、按现有箱数给出默认容量、管段延到孔深，并把历史箱回填为已上架（附迁移入库单）。** 升级前可用顶栏「导出备份」导出全量 JSON。
- 首次打开且表为空时写入一批示例编目数据（`src/utils/seed.ts`，5 个钻孔 + 回次 + 岩芯箱（含待入库/排队等腾位示例）+ 库位 + 入库单 + 岩性区间）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
