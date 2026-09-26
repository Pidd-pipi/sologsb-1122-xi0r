<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useFaceStore } from '../stores/faceStore';
import { useGradeStore } from '../stores/gradeStore';
import { useJointStore } from '../stores/jointStore';
import { useSupportStore } from '../stores/supportStore';
import { useGradeCalc } from '../hooks/useGradeCalc';
import SketchCanvas from '../components/common/SketchCanvas.vue';
import GradeTag from '../components/common/GradeTag.vue';
import SupportOrderDrawer from '../components/common/SupportOrderDrawer.vue';
import { attitudeText, formatChainage } from '../utils/geoMath';
import { GRADE_SUPPORT } from '../types/grade';
import { SUPPORT_STATUS_LABEL, type SupportOrder } from '../types/support';

const route = useRoute();
const router = useRouter();
const faceStore = useFaceStore();
const jointStore = useJointStore();
const gradeStore = useGradeStore();
const supportStore = useSupportStore();

const faceId = computed(() => String(route.params.id ?? ''));
const face = computed(() => faceStore.byId(faceId.value));
const joints = computed(() => jointStore.byFace(faceId.value));
const grades = computed(() => gradeStore.byFace(faceId.value));
const latest = computed(() => grades.value[0]);
const previousGrade = computed(() => grades.value[1]);

const pendingOrders = computed(() => supportStore.pendingByFace(faceId.value));
const reviewOrders = computed(() => supportStore.reviewByFace(faceId.value));
const historyOrders = computed(() => supportStore.historyByFace(faceId.value));

const drawerVisible = ref(false);
const activeOrder = ref<SupportOrder | null>(null);

function openOrder(order: SupportOrder): void {
  activeOrder.value = order;
  drawerVisible.value = true;
}

/** 抽屉中处理（完成/作废）后，从最新内存状态回填当前单据 */
function onOrderHandled(): void {
  if (activeOrder.value) {
    activeOrder.value = supportStore.orders.find((it) => it.id === activeOrder.value?.id) ?? activeOrder.value;
  }
}

function formatDate(value?: number): string {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '—';
}

const { result, patch } = useGradeCalc(() => joints.value);
const segmentCount = ref(0);

/** SketchCanvas 变更回调（用命名函数避免模板内联箭头参数丢类型） */
function onSketchChange(segs: { id: string }[]): void {
  segmentCount.value = segs.length;
}

/** 与上循环级别比对结论 */
const gradeCompare = computed(() => {
  if (!latest.value) return '本掌子面尚无级别判定记录';
  if (!previousGrade.value) return `本掌子面首次判定为 ${latest.value.grade} 级围岩`;
  const order = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ'];
  const delta = order.indexOf(latest.value.grade) - order.indexOf(previousGrade.value.grade);
  if (delta === 0) return `与上一循环一致（${latest.value.grade} 级）`;
  return delta > 0
    ? `较上一循环变差 ${delta} 级：${previousGrade.value.grade} → ${latest.value.grade}`
    : `较上一循环变好 ${-delta} 级：${previousGrade.value.grade} → ${latest.value.grade}`;
});

onMounted(async () => {
  await faceStore.load();
  await jointStore.load();
  await gradeStore.load();
  await supportStore.load();
  if (face.value) {
    patch({ rockStrength: face.value.rockStrength, spanWidth: Number(face.value.faceSize.split('×')[0]) || 12 });
  }
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>掌子面详情 · {{ face?.faceNo ?? '未找到' }}</h2>
      <GradeTag v-if="latest" :grade="latest.grade" />
      <el-tag v-else type="info">未判定级别</el-tag>
      <el-tag type="info" effect="plain">节理 {{ joints.length }} 组</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="router.push(`/faces/${faceId}/joints`)">节理录入</el-button>
      <el-button @click="router.push(`/faces/${faceId}/water`)">涌水记录</el-button>
      <el-button @click="router.push(`/grade/${faceId}`)">围岩级别判定</el-button>
      <el-button @click="router.push('/faces')">返回台账</el-button>
    </div>

    <el-alert v-if="!face" type="warning" :closable="false" show-icon title="未找到该掌子面（可能已被删除）" />

    <div v-if="face" class="grid">
      <div class="left">
        <el-card shadow="never">
          <template #header><strong>基本信息</strong></template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="掌子面编号">{{ face.faceNo }}</el-descriptions-item>
            <el-descriptions-item label="里程桩号">{{ formatChainage(face.chainage) }}</el-descriptions-item>
            <el-descriptions-item label="编录里程区间">
              {{ formatChainage(face.mileageRange[0]) }} ~ {{ formatChainage(face.mileageRange[1]) }}
            </el-descriptions-item>
            <el-descriptions-item label="开挖方式">{{ face.excavationMethod }}</el-descriptions-item>
            <el-descriptions-item label="开挖断面尺寸">{{ face.faceSize }} m</el-descriptions-item>
            <el-descriptions-item label="岩性 / 风化">{{ face.lithology }} / {{ face.weathering }}</el-descriptions-item>
            <el-descriptions-item label="饱和抗压强度">{{ face.rockStrength }} MPa</el-descriptions-item>
            <el-descriptions-item label="岩层产状">
              走向 {{ face.attitude.strike }}° · {{ attitudeText(face.attitude.dipDirection, face.attitude.dipAngle) }}
            </el-descriptions-item>
            <el-descriptions-item label="地质员">{{ face.geologist }}</el-descriptions-item>
            <el-descriptions-item label="编录时间">
              {{ new Date(face.recordedAt).toLocaleString('zh-CN') }}
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card shadow="never">
          <template #header><strong>级别与支护</strong></template>
          <div v-if="latest" class="grade-box">
            <GradeTag :grade="latest.grade" />
            <span class="muted">[BQ] = {{ latest.correctedBq }}（BQ {{ latest.bqValue }}，修正 {{ latest.correction }}）</span>
            <p class="support">{{ latest.supportSuggestion || GRADE_SUPPORT[latest.grade] }}</p>
            <p class="muted">{{ gradeCompare }}</p>
          </div>
          <div v-else>
            <p class="muted">尚未判定级别，按当前参数实时试算：</p>
            <GradeTag :grade="result.grade" />
            <p class="support">{{ result.support }}</p>
          </div>
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>支护单跟踪</strong>
              <el-tag size="small" type="warning">待施工 {{ pendingOrders.length }}</el-tag>
              <el-tag size="small" type="danger">需复核 {{ reviewOrders.length }}</el-tag>
              <el-tag size="small" type="success">已完成 {{ historyOrders.filter((o) => o.status === 'done').length }}</el-tag>
              <el-tag size="small" type="info" effect="plain">已作废 {{ historyOrders.filter((o) => o.status === 'voided').length }}</el-tag>
            </div>
          </template>

          <!-- 需要复核 -->
          <div v-for="order in reviewOrders" :key="order.id" class="order review-box" @click="openOrder(order)">
            <div class="order-line">
              <el-tag type="danger" size="small">需要复核</el-tag>
              <strong>#{{ order.seq }}</strong>
              <GradeTag :grade="order.grade" />
              <span class="muted">{{ order.gradeChangeNote }}</span>
            </div>
            <p class="order-measures">{{ order.suggestedMeasures }}</p>
            <div class="order-line">
              <span class="muted">开单 {{ new Date(order.issuedAt).toLocaleString('zh-CN') }}</span>
              <el-button link type="primary" size="small">去复核处理</el-button>
            </div>
          </div>

          <!-- 待施工（同面最多一张） -->
          <div
            v-for="order in pendingOrders"
            :key="order.id"
            class="order pending-box"
            @click="openOrder(order)"
          >
            <div class="order-line">
              <el-tag type="warning" size="small">待施工</el-tag>
              <strong>#{{ order.seq }}</strong>
              <GradeTag :grade="order.grade" />
              <el-tag
                v-if="order.gradeChange === 'worse'"
                type="danger"
                size="small"
                effect="plain"
              >
                {{ order.gradeChangeNote }}
              </el-tag>
              <el-tag v-else-if="order.gradeChange === 'better'" type="success" size="small" effect="plain">
                {{ order.gradeChangeNote }}
              </el-tag>
              <el-tag v-else-if="order.gradeChange === 'first'" type="primary" size="small" effect="plain">
                首张支护单
              </el-tag>
            </div>
            <p class="order-measures">{{ order.suggestedMeasures }}</p>
            <div class="order-line">
              <span class="muted">开单 {{ new Date(order.issuedAt).toLocaleString('zh-CN') }}</span>
              <el-button link type="primary" size="small">登记完成</el-button>
            </div>
          </div>

          <el-alert
            v-if="pendingOrders.length === 0 && reviewOrders.length === 0 && historyOrders.length === 0"
            type="info"
            :closable="false"
            title="尚无支护单：保存围岩级别判定后自动生成待施工支护单"
            style="margin-bottom: 8px"
          />
          <el-alert
            v-else-if="pendingOrders.length === 0 && reviewOrders.length === 0"
            type="success"
            :closable="false"
            title="当前无待施工支护单"
            style="margin-bottom: 8px"
          />

          <!-- 历史单：已完成 / 已作废 -->
          <el-table
            v-if="historyOrders.length > 0"
            :data="historyOrders"
            size="small"
            border
            class="history-table"
            @row-click="openOrder"
          >
            <el-table-column label="单号" width="64">
              <template #default="{ row }">#{{ row.seq }}</template>
            </el-table-column>
            <el-table-column label="状态" width="86">
              <template #default="{ row }">
                <el-tag size="small" :type="row.status === 'done' ? 'success' : 'info'">
                  {{ SUPPORT_STATUS_LABEL[row.status as 'done' | 'voided'] }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="级别" width="78">
              <template #default="{ row }"><GradeTag :grade="row.grade" /></template>
            </el-table-column>
            <el-table-column prop="crew" label="施工班组" width="96" />
            <el-table-column label="完成日期" width="104">
              <template #default="{ row }">{{ formatDate(row.completedAt) }}</template>
            </el-table-column>
            <el-table-column label="级别变化 / 备注" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ row.reviewNote || row.gradeChangeNote }}</template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card shadow="never">
          <template #header><strong>节理组列表（{{ joints.length }} 组）</strong></template>
          <el-table :data="joints" size="small" border>
            <el-table-column label="组号" width="70">
              <template #default="{ row }">J{{ row.setNo }}</template>
            </el-table-column>
            <el-table-column label="产状" width="140">
              <template #default="{ row }">{{ attitudeText(row.dipDirection, row.dipAngle) }}</template>
            </el-table-column>
            <el-table-column prop="spacing" label="间距 cm" width="90" />
            <el-table-column prop="persistence" label="延伸 m" width="90" />
            <el-table-column prop="aperture" label="张开 mm" width="90" />
            <el-table-column prop="fillMaterial" label="充填" width="90" />
            <el-table-column prop="waterWet" label="渗水" width="90" />
            <el-table-column prop="jointCount" label="条数" width="80" />
          </el-table>
          <el-empty v-if="joints.length === 0" description="暂无节理组记录" :image-size="60" />
        </el-card>
      </div>

      <el-card shadow="never">
        <template #header>
          <div class="card-head">
            <strong>岩性素描图</strong>
            <span class="muted">已布置 {{ segmentCount }} 条结构面线段（自动保存在浏览器本地）</span>
          </div>
        </template>
        <SketchCanvas
          :face-id="face.id"
          :lithology="face.lithology"
          :attitude="face.attitude"
          @change="onSketchChange"
        />
      </el-card>
    </div>

    <SupportOrderDrawer
      v-model="drawerVisible"
      :order="activeOrder"
      :review-context="activeOrder?.status === 'review'"
      @handled="onOrderHandled"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.grid {
  display: grid;
  grid-template-columns: 620px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.left {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.support {
  margin: 8px 0;
  color: #2f3a46;
}
.grade-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.order {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.order:hover {
  border-color: #c0c4cc;
}
.pending-box {
  border-left: 4px solid #e6a23c;
  background: #fdf8f0;
}
.review-box {
  border-left: 4px solid #f56c6c;
  background: #fef4f4;
}
.order-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.order-measures {
  margin: 6px 0;
  font-size: 13px;
  color: #2f3a46;
  line-height: 1.6;
}
.history-table {
  cursor: pointer;
}
</style>
