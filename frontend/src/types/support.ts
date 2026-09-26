import type { RockGrade } from './grade';

/**
 * 支护单状态：
 * - pending  待施工（同一掌子面同时最多一张）
 * - review   需要复核（级别重判后被新单替换，需确认旧单是否已施工）
 * - done     已完成（已登记实际措施，后续重判不再改动）
 * - voided   已作废（复核确认旧单未施工，留痕保留）
 */
export type SupportStatus = 'pending' | 'review' | 'done' | 'voided';

export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = {
  pending: '待施工',
  review: '需要复核',
  done: '已完成',
  voided: '已作废',
};

/** 级别变化方向，用于支护单上的变化标记 */
export type GradeChangeKind = 'same' | 'better' | 'worse' | 'first';

/** 支护施工单（由围岩级别判定保存时生成） */
export interface SupportOrder {
  id: string;
  faceId: string;
  /** 掌子面内顺序号，从 1 起 */
  seq: number;
  /** 建议支护级别（保存判定时的最终级别） */
  grade: RockGrade;
  /** 建议支护措施 */
  suggestedMeasures: string;
  /** 触发本单的级别判定记录 */
  gradeRecordId: string;
  status: SupportStatus;
  /** 级别变化说明（相对上一张有效支护单） */
  gradeChangeNote: string;
  /** 变化时上一张支护单的级别 */
  previousGrade?: RockGrade;
  gradeChange: GradeChangeKind;
  /** 开单时间 */
  issuedAt: number;
  /** 开单地质员 */
  issuedBy?: string;
  /** 实际施工措施（完成时填写） */
  actualMeasures?: string;
  /** 实际施工完成日期（毫秒时间戳） */
  completedAt?: number;
  /** 施工班组（完成时填写） */
  crew?: string;
  /** 复核/完成处理备注 */
  reviewNote?: string;
  /** 被新单替换（转入需要复核）的时间 */
  replacedAt?: number;
  /** 替换本单的新支护单 */
  replacedBy?: string;
  /** 作废时间 */
  voidedAt?: number;
}

/** 完成登记所需信息 */
export interface SupportCompletionDraft {
  actualMeasures: string;
  completedAt: number;
  crew?: string;
  reviewNote?: string;
}

/** 级别序号，差值越大越差 */
export function gradeRank(grade: RockGrade): number {
  return (['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ'] as RockGrade[]).indexOf(grade);
}

/**
 * 计算相对上一张支护单的级别变化。
 * @returns kind 变化方向；note 文案，first 时返回空串由调用方补充
 */
export function describeGradeChange(
  grade: RockGrade,
  previous?: RockGrade,
): { kind: GradeChangeKind; note: string; previousGrade?: RockGrade } {
  if (!previous) return { kind: 'first', note: '本掌子面首张支护单', previousGrade: undefined };
  if (previous === grade) {
    return { kind: 'same', note: `级别未变（仍为 ${grade} 级），建议措施不变`, previousGrade: previous };
  }
  const delta = gradeRank(grade) - gradeRank(previous);
  const note =
    delta > 0
      ? `级别变差 ${delta} 级：${previous} 级 → ${grade} 级，请加强支护`
      : `级别变好 ${-delta} 级：${previous} 级 → ${grade} 级，支护相应调整`;
  return { kind: delta > 0 ? 'worse' : 'better', note, previousGrade: previous };
}
