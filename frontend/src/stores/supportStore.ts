import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { RockMassGrade } from '../types/grade';
import type { SupportOrder } from '../types/support';

interface SupportState {
  items: SupportOrder[];
  loaded: boolean;
}

/** 开具结果：原地更新 / 另开新单（旧单转复核）/ 首次开具 */
export type IssueAction = 'updated' | 'reissued' | 'created';

export const useSupportStore = defineStore('support', {
  state: (): SupportState => ({ items: [], loaded: false }),
  getters: {
    byFace: (state) => (faceId: string) =>
      state.items.filter((it) => it.faceId === faceId).sort((a, b) => b.createdAt - a.createdAt),
    pendingByFace: (state) => (faceId: string) =>
      state.items.find((it) => it.faceId === faceId && it.status === 'pending'),
  },
  actions: {
    async load() {
      const rows = await db.supports.toArray();
      this.items = rows.sort((a, b) => b.createdAt - a.createdAt);
      this.loaded = true;
    },
    /**
     * 按保存的判定结果开具支护单：
     * - 已有待施工单且级别一致 → 原地更新建议，同一掌子面仍只留一张待施工单；
     * - 已有待施工单但级别变化 → 旧单转「需要复核」，另开新待施工单并标明级别变化；
     * - 没有待施工单 → 另开新单，级别变化对照最近一张已完成/需复核单；
     * - 已完成单一律不改动。
     */
    async issueFromGrade(grade: RockMassGrade): Promise<{ order: SupportOrder; action: IssueAction }> {
      const now = Date.now();
      const pending = this.items.find((it) => it.faceId === grade.faceId && it.status === 'pending');

      if (pending && pending.grade === grade.grade) {
        const patch = { gradeId: grade.id, supportSuggestion: grade.supportSuggestion, updatedAt: now };
        await db.supports.update(pending.id, patch);
        this.items = this.items.map((it) => (it.id === pending.id ? { ...it, ...patch } : it));
        return { order: { ...pending, ...patch }, action: 'updated' };
      }

      let gradeChange: string | undefined;
      if (pending) {
        gradeChange = `${pending.grade} → ${grade.grade}`;
        const reviewPatch = { status: 'review' as const, updatedAt: now };
        await db.supports.update(pending.id, reviewPatch);
        this.items = this.items.map((it) => (it.id === pending.id ? { ...it, ...reviewPatch } : it));
      } else {
        const last = this.items
          .filter((it) => it.faceId === grade.faceId && it.status !== 'pending')
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (last && last.grade !== grade.grade) gradeChange = `${last.grade} → ${grade.grade}`;
      }

      const order: SupportOrder = {
        id: newId('support'),
        faceId: grade.faceId,
        gradeId: grade.id,
        grade: grade.grade,
        supportSuggestion: grade.supportSuggestion,
        status: 'pending',
        ...(gradeChange ? { gradeChange } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await db.supports.put(toPlain(order));
      this.items = [order, ...this.items];
      return { order, action: pending ? 'reissued' : 'created' };
    },
    /** 施工完成：填写实际措施与完成日期，仅待施工单可完成 */
    async complete(id: string, actualMeasure: string, completedAt: number) {
      const target = this.items.find((it) => it.id === id);
      if (!target || target.status !== 'pending') return undefined;
      const patch = { status: 'done' as const, actualMeasure, completedAt, updatedAt: Date.now() };
      await db.supports.update(id, toPlain(patch));
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
      return { ...target, ...patch };
    },
  },
});
