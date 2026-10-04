# 矿区钻孔岩芯编目台（gbdrillcore）

面向地质勘查钻探班组与地质编录员：登记钻孔台帐、回次进尺与采取率、岩芯箱箱位，并按深度区间编录岩性描述与样品。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

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
| 路由 | React Router 6（6 条业务路由 + 404） |
| 状态 | Zustand（holeStore / runStore / boxStore / lithoStore / locationStore / inboundStore） |
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
│       ├── types/             # drill-hole / drill-run / core-box / litho-log / storage-location / inbound-order
│       ├── stores/            # holeStore / runStore / boxStore / lithoStore / locationStore / inboundStore
│       ├── components/common/ # DepthRangeInput / RecoveryBadge / BoxGrid / LithoColumn / StatBadge / FilterBar / EmptyPanel
│       ├── hooks/             # useHoleFilter / useDepthCalc
│       ├── pages/             # HoleBoard / HoleList / RunLog / CoreBoxList / Warehouse / LithoEditor
│       ├── router/index.tsx   # 路由表
│       └── utils/             # recovery.ts / inbound.ts / db.ts / export.ts（+ seed.ts / id.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 工作台 | 钻孔进度、设计达成率、未达设计待补勘清单、采取率异常清单（<75% 标红） |
| `/holes` | 钻孔台帐 | 建孔、坐标与孔口标高、设计/终孔深度、测斜数据、回次深度覆盖与岩芯箱数回显 |
| `/runs` | 回次记录 | 起止深度自动算进尺与采取率，低于 75% 立即标红并入异常清单 |
| `/boxes` | 岩芯箱编目 | 格位网格按深度填充、破损格标记、装箱深度连续性与格位容量校验；待入库箱可改删，已报/已上架箱锁定 |
| `/warehouse` | 库房管理 | 库位编制（容量+管段）、入库申请、按容量与深度确认上架落成入库单、排队/失败退回/重试、管理员退回 |
| `/lithology` | 岩性编录 | 按深度区间编录岩性/蚀变/矿化/RQD/样品，区间重叠报冲突并高亮，SVG 岩性柱状图 |

## 入库流程规则（库位 → 入库单）

- **库位编制（库房管理员）**：旧架位只有一行字，由管理员在其下编出库位，写明每个库位「能装几箱」（容量）与「管到哪段」（深度区间），可限定钻孔。
- **提交入库申请（钻探班组）**：装箱后箱子为「待入库」，班组在库房管理勾选并指定库位提交；未入库箱可改可删。
- **确认上架（库房管理员）**：按容量与深度校验——深度须落在库位管段内、同库位同孔、与在架箱不重叠；通过后落成入库单，箱子变「已上架」。
- **断档标注**：同一库位的箱子按深度连着排，相邻箱不衔接就写明缺哪段（深度段及对应回次），随入库单记录，不拦截上架。
- **容量到顶排队**：库位容量一到顶，新箱挂「待确认」单排队等腾位，已上架箱不会被挤下来；腾出位置后管理员「重试」即可。
- **确认失败**：深度/孔别/重叠校验不过，这批退回「待入库」并记录失败原因，已上架箱保持不动；重试只动挂起那批。
- **退回权限**：上了入库单（已报待上架/已上架）的箱子，钻探班组不能改删；待确认单由管理员整批退回，已上架箱由管理员逐箱退回。

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbdrillcore-db`），表：`holes`、`runs`、`boxes`、`lithos`、`locations`、`inboundOrders`、`meta`。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为岩性表增加 `[holeId+fromDepth]` 复合索引并回填历史 RQD；`db.version(3).upgrade(...)` 增加库位/入库单两表，旧架位按现有架位编出默认库位（容量取该架箱数且不少于 20、管段 0~9999m），旧箱回填为「已上架」并挂到对应默认库位与历史入库单。升级前可用顶栏「导出备份」导出全量 JSON。
- 首次打开且表为空时写入一批示例编目数据（`src/utils/seed.ts`，5 个钻孔 + 回次 + 岩芯箱 + 库位 + 入库单 + 岩性区间，含排队单与失败退回单）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
