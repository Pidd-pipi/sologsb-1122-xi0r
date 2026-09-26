<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import GradeTag from './GradeTag.vue';
import { useSupportStore } from '../../stores/supportStore';
import {
  SUPPORT_STATUS_LABEL,
  type GradeChangeKind,
  type SupportOrder,
  type SupportStatus,
} from '../../types/support';

const props = defineProps<{
  modelValue: boolean;
  order: SupportOrder | null;
  /** 复核单登记完成时提示文案（旧单与当前待施工单级别可能不同） */
  reviewContext?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'handled'): void;
}>();

const supportStore = useSupportStore();

const STATUS_TAG: Record<SupportStatus, 'warning' | 'danger' | 'success' | 'info'> = {
  pending: 'warning',
  review: 'danger',
  done: 'success',
  voided: 'info',
};

const CHANGE_TAG: Record<GradeChangeKind, 'success' | 'danger' | 'info' | 'primary'> = {
  better: 'success',
  worse: 'danger',
  same: 'info',
  first: 'primary',
};

const form = reactive({
  actualMeasures: '',
  crew: '',
  completedAt: Date.now(),
  reviewNote: '',
});
const saving = ref(false);

const editable = computed(() => props.order?.status === 'pending' || props.order?.status === 'review');

watch(
  () => props.order,
  (o) => {
    form.actualMeasures = o?.actualMeasures ?? o?.suggestedMeasures ?? '';
    form.crew = o?.crew ?? '';
    form.completedAt = o?.completedAt ?? Date.now();
    form.reviewNote = o?.reviewNote ?? '';
  },
  { immediate: true },
);

function close(): void {
  emit('update:modelValue', false);
}

function formatTime(value?: number): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function formatDateValue(value?: number): string {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '—';
}

async function submitComplete(): Promise<void> {
  if (!props.order) return;
  if (!form.actualMeasures.trim()) {
    ElMessage.error('请填写实际施工措施');
    return;
  }
  if (!Number.isFinite(form.completedAt)) {
    ElMessage.error('请选择施工完成日期');
    return;
  }
  saving.value = true;
  try {
    await supportStore.complete(props.order.id, {
      actualMeasures: form.actualMeasures.trim(),
      completedAt: Number(form.completedAt),
      crew: form.crew.trim() || undefined,
      reviewNote: form.reviewNote.trim() || undefined,
    });
    ElMessage.success(`支护单 #${props.order.seq} 已登记完成`);
    emit('handled');
    close();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '登记失败');
  } finally {
    saving.value = false;
  }
}

async function confirmVoid(): Promise<void> {
  if (!props.order) return;
  try {
    const { value } = await ElMessageBox.prompt(
      '确认该支护单未实际施工？作废后单据保留在历史中备查，现场按新支护单执行。',
      `复核作废支护单 #${props.order.seq}`,
      {
        confirmButtonText: '确认作废',
        cancelButtonText: '取消',
        type: 'warning',
        inputPlaceholder: '可填写复核说明（选填）',
        inputValue: form.reviewNote,
      },
    );
    await supportStore.voidOrder(props.order.id, value);
    ElMessage.success(`支护单 #${props.order.seq} 已作废`);
    emit('handled');
    close();
  } catch (e) {
    if (e === 'cancel' || (e as { action?: string })?.action === 'cancel') return;
    ElMessage.error(e instanceof Error ? e.message : '作废失败');
  }
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :title="order ? `支护单 #${order.seq}` : '支护单'"
    size="520px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template v-if="order">
      <div class="head">
        <el-tag :type="STATUS_TAG[order.status]">{{ SUPPORT_STATUS_LABEL[order.status] }}</el-tag>
        <GradeTag :grade="order.grade" />
        <el-tag
          v-if="order.gradeChange !== 'same'"
          :type="CHANGE_TAG[order.gradeChange]"
          effect="plain"
          size="small"
        >
          {{ order.gradeChangeNote }}
        </el-tag>
      </div>

      <el-alert
        v-if="order.status === 'review'"
        type="error"
        :closable="false"
        show-icon
        title="该单因重新判定级别已被新待施工单替换"
        description="请先与施工班组核对：旧支护措施是否已经施工？已施工则补登为已完成；未施工则作废，按新单执行。"
        style="margin: 12px 0"
      />

      <el-descriptions :column="1" border size="small" class="box">
        <el-descriptions-item label="支护单编号">#{{ order.seq }}</el-descriptions-item>
        <el-descriptions-item label="建议级别">{{ order.grade }} 级围岩</el-descriptions-item>
        <el-descriptions-item label="级别变化">{{ order.gradeChangeNote }}</el-descriptions-item>
        <el-descriptions-item label="建议支护措施">
          <span class="measures">{{ order.suggestedMeasures }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="开单时间">{{ formatTime(order.issuedAt) }}</el-descriptions-item>
        <el-descriptions-item v-if="order.issuedBy" label="开单地质员">{{ order.issuedBy }}</el-descriptions-item>
        <el-descriptions-item v-if="order.status === 'review'" label="被替换时间">
          {{ formatTime(order.replacedAt) }}
        </el-descriptions-item>
      </el-descriptions>

      <!-- 已完成 / 已作废：只读展示 -->
      <template v-if="order.status === 'done' || order.status === 'voided'">
        <el-divider content-position="left">
          {{ order.status === 'done' ? '施工回填' : '作废记录' }}
        </el-divider>
        <el-descriptions :column="1" border size="small" class="box">
          <template v-if="order.status === 'done'">
            <el-descriptions-item label="实际措施">
              <span class="measures">{{ order.actualMeasures }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="完成日期">{{ formatDateValue(order.completedAt) }}</el-descriptions-item>
            <el-descriptions-item v-if="order.crew" label="施工班组">{{ order.crew }}</el-descriptions-item>
          </template>
          <el-descriptions-item v-if="order.voidedAt" label="作废时间">
            {{ formatTime(order.voidedAt) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="order.reviewNote" label="备注">{{ order.reviewNote }}</el-descriptions-item>
        </el-descriptions>
      </template>

      <!-- 待施工 / 需要复核：登记施工完成 -->
      <template v-else>
        <el-divider content-position="left">登记施工完成</el-divider>
        <el-alert
          v-if="reviewContext"
          type="info"
          :closable="false"
          title="正在为被替换的旧单补登，级别以本单记录为准"
          style="margin-bottom: 10px"
        />
        <el-form label-width="100px">
          <el-form-item label="实际措施" required>
            <el-input
              v-model="form.actualMeasures"
              type="textarea"
              :rows="3"
              placeholder="填写实际施作的锚杆/喷混/钢拱架等措施"
            />
          </el-form-item>
          <el-form-item label="完成日期" required>
            <el-date-picker
              v-model="form.completedAt"
              type="date"
              value-format="x"
              :clearable="false"
              placeholder="选择施工完成日期"
            />
          </el-form-item>
          <el-form-item label="施工班组">
            <el-input v-model="form.crew" placeholder="如 支护一班" style="width: 220px" />
          </el-form-item>
          <el-form-item v-if="order.status === 'review'" label="复核备注">
            <el-input v-model="form.reviewNote" placeholder="如 班组已按旧单施作，予以确认" />
          </el-form-item>
        </el-form>
      </template>
    </template>

    <template #footer v-if="order">
      <div class="footer">
        <el-button @click="close">关闭</el-button>
        <template v-if="editable">
          <el-button v-if="order.status === 'review'" type="info" @click="confirmVoid">
            确认未施工，作废
          </el-button>
          <el-button type="primary" :loading="saving" @click="submitComplete">
            {{ order.status === 'review' ? '已按旧单施工，补登完成' : '登记完成' }}
          </el-button>
        </template>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.box {
  margin-top: 12px;
}
.measures {
  white-space: pre-wrap;
  line-height: 1.7;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
