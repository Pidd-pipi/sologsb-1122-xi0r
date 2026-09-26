# sologsb-1122 隧道掌子面地质编录台（gbtunnelface）

面向隧道施工地质人员的掌子面编录工作台：逐循环编录围岩级别、岩性、节理产状与涌水情况，绘制岩性素描并用数字表示结构面，实时按 BQ 指标判定围岩级别并给出支护建议。纯前端单页应用，数据全部保存在浏览器本地。

## Docker 一键启动（推荐）

```bash
cp .env.example .env
docker compose up -d --build
```

访问地址：**http://localhost:21822**

停止服务：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| UI | Element Plus 2 |
| 构建 | Vite 5 |
| 状态管理 | Pinia |
| 路由 | Vue Router 4（history 模式） |
| 本地存储 | IndexedDB（Dexie 4）+ localStorage（素描线段），含结构版本号与升级迁移 |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # vue-tsc 类型检查 + vite 构建
```

> 生产环境由 nginx 托管 `dist`，`nginx.conf` 已启用 `try_files $uri $uri/ /index.html;` 与 gzip。

## 目录结构

```
sologsb-1122/
├── docker-compose.yml
├── .env.example
├── .env
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── main.ts
        ├── App.vue
        ├── router/index.ts
        ├── types/{face,joint,grade,water,support}.ts
        ├── stores/{face,joint,grade,support}Store.ts
        ├── components/common/{SketchCanvas,JointPolarPlot,GradeTag,FaceCard,SupportOrderDrawer}.vue
        ├── hooks/{useFaceFilter,useGradeCalc}.ts
        ├── pages/{FaceList,FaceDetail,JointEntry,WaterView,GradeJudge}.vue
        └── utils/{db,geoMath,id}.ts
```

## 页面与路由

| 路由 | 页面 | 消费模型 |
| --- | --- | --- |
| `/faces` | 掌子面台账：里程区间/岩性/围岩级别/开挖方式筛选 + 级别分布条 + 待处理支护单角标 | TunnelFace、RockMassGrade、SupportOrder |
| `/faces/:id` | 掌子面详情：基本信息 + 岩性素描图 + 节理组列表 + 与上循环级别比对 + 支护单跟踪（待施工/需复核/历史分区） | TunnelFace、JointSet、RockMassGrade、SupportOrder |
| `/faces/:id/joints` | 节理产状录入：极点图/玫瑰图、同组产状合并、异常倾角提示 | JointSet |
| `/faces/:id/water` | 涌水记录与沿里程趋势折线，标记突变点与建议措施 | WaterInflow |
| `/grade/:faceId` | 围岩级别判定：逐项输入 RQD/Jv/Kv/出水状态，实时算级别与支护建议，可人工修正并保存；保存即开具/更新支护单 | RockMassGrade、SupportOrder、TunnelFace |

`/` 重定向到 `/faces`，未匹配路由同样兜底到 `/faces`。

## 支护单流转

保存围岩级别判定时，按**最终级别**（含人工修正）在同一事务内落判定记录与支护单：

1. 该掌子面没有待施工单（首次判定，或上一张已完成/已作废）：开具一张新的**待施工**支护单；级别相对上一张有效单的变化（变好/变差 N 级）标注在单上。
2. 已有待施工单且级别相同：只刷新该单的建议措施与判定引用，**同一掌子面始终最多一张待施工单**。
3. 已有待施工单但级别变化：旧单转**需要复核**（关联新单），另开一张待施工单并标明级别变化；**已完成记录永不被覆盖**。
4. 施工完成后在单据抽屉中回填实际措施、完成日期、施工班组，单据转**已完成**并进入历史，仍可随时查看。
5. 复核单需与班组核对：已按旧单施工则补登为已完成；确认未施工则**作废留痕**，按新单执行。

## 数据存储说明

- 数据库名 `gbtunnelface`，当前结构版本 **v3**（`localStorage['gbtunnelface:db-version']` 记录）。
- 五张表：`faces`（掌子面）、`joints`（节理组）、`grades`（围岩级别判定）、`waters`（涌水记录）、`supports`（支护施工单）。
- v1 → v2 迁移：为老掌子面补 `attitude`、`mileageRange`，为级别记录补 `correctedBq`、`manualAdjusted`，为涌水补 `chainage`，并新增索引。
- v2 → v3 迁移：新增 `supports` 表；按每个掌子面的历史判定补录支护单（最新判定对应待施工单，更早判定补已完成历史单，标注「由历史判定记录补录」）。
- 岩性素描的结构面线段单独存 `localStorage['gbtunnelface:sketch:<faceId>']`，刷新后仍在。
- 容器无状态、不挂载命名卷；清空站点数据即回到初始示范数据。
- 首次打开灌入 2 个示范掌子面、4 组节理、3 条级别判定、3 张支护单（含已完成/待施工两种状态与级别变差标注）与 3 条涌水记录。

## 功能要点

- **围岩级别实时判定**：`BQ = 90 + 3σc + 250Kv`，`[BQ] = BQ − 100(K1 + K2 + K3)`（K1 由出水状态、K2 由洞跨取值），再按 >550/451~550/351~450/251~350/151~250/≤150 映射到 Ⅰ~Ⅵ 级，并给出对应支护建议；支持人工修正级别。
- **支护建议可追踪**：判定保存即生成支护单，待施工/需要复核/已完成/已作废四态流转；同面最多一张待施工单，完成后回填实际措施与日期，重判不覆盖已完成记录，台账卡片与详情页均可一眼分辨待办状态。
- **级别比对**：详情页、判定页与支护单自动与上一循环/上一张有效单比对，输出「变好/变差 N 级」结论。
- **素描交互**：`<SketchCanvas>` 在图上单击即按当前岩层产状布置结构面线段，带岩性填充纹样、比例尺、图例与撤销/清空，线段本地持久化。
- **节理统计**：`<JointPolarPlot>` 等面积投影极点图 + 走向玫瑰图，按组着色；按倾向 30° 聚类支持同组产状合并。
- **异常提示**：倾角超出 0~90° 直接拦截；涌水量较上一点翻倍或趋势突增标记为突变点并给出措施。
