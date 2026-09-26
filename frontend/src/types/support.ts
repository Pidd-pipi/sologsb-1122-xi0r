import type { RockGrade } from './grade';

/** 支护单状态：待施工 / 已完成 / 需要复核 */
export type SupportOrderStatus = 'pending' | 'done' | 'review';

export const SUPPORT_STATUS_TEXT: Record<SupportOrderStatus, string> = {
  pending: '待施工',
  done: '已完成',
  review: '需要复核',
};

/** 状态对应的标签颜色（用于 <el-tag>） */
export const SUPPORT_STATUS_TAG: Record<SupportOrderStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  done: 'success',
  review: 'danger',
};

/** 支护单：由围岩级别判定生成的可追踪支护任务 */
export interface SupportOrder {
  id: string;
  faceId: string;
  /** 来源判定记录 id */
  gradeId: string;
  /** 判定的最终级别 */
  grade: RockGrade;
  /** 按级别生成的建议支护措施 */
  supportSuggestion: string;
  status: SupportOrderStatus;
  /** 级别变化说明，如 "Ⅲ → Ⅳ" */
  gradeChange?: string;
  /** 实际施工措施（施工完成后填写） */
  actualMeasure?: string;
  /** 完成日期 */
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}
