import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { RockMassGrade, RockMassGradeDraft } from '../types/grade';
import type { SupportCompletionDraft, SupportOrder } from '../types/support';
import { describeGradeChange } from '../types/support';
import { useGradeStore } from './gradeStore';

/** 保存判定结果：updated（同面同级，刷新待施工单）/ new（另开新单） */
export type SaveJudgementOutcome = 'updated' | 'new';

interface SupportState {
  orders: SupportOrder[];
  loaded: boolean;
}

export const useSupportStore = defineStore('support', {
  state: (): SupportState => ({ orders: [], loaded: false }),
  getters: {
    byFace: (state) => (faceId: string) =>
      state.orders.filter((it) => it.faceId === faceId).sort((a, b) => b.seq - a.seq),
    pendingByFace: (state) => (faceId: string) =>
      state.orders
        .filter((it) => it.faceId === faceId && it.status === 'pending')
        .sort((a, b) => b.issuedAt - a.issuedAt),
    reviewByFace: (state) => (faceId: string) =>
      state.orders
        .filter((it) => it.faceId === faceId && it.status === 'review')
        .sort((a, b) => (b.replacedAt ?? 0) - (a.replacedAt ?? 0)),
    historyByFace: (state) => (faceId: string) =>
      state.orders
        .filter((it) => it.faceId === faceId && (it.status === 'done' || it.status === 'voided'))
        .sort((a, b) => b.seq - a.seq),
  },
  actions: {
    async load() {
      const rows = await db.supports.toArray();
      rows.sort((a, b) => b.issuedAt - a.issuedAt);
      this.orders = rows;
      this.loaded = true;
    },
    /**
     * 保存围岩级别判定并同步生成/更新支护单（同一事务，保证一致）。
     *
     * 规则：
     * - 已有待施工单且最终级别相同：刷新该单的建议与判定引用（仍只保留一张待施工单）；
     * - 已有待施工单但级别变化：旧单转「需要复核」并关联新单，另开待施工单，标明级别变化；
     * - 没有待施工单（上一张已完成/作废，或首次判定）：另开新的待施工单，
     *   已完成记录永远不被覆盖。
     */
    async saveJudgement(
      draft: RockMassGradeDraft,
    ): Promise<{ grade: RockMassGrade['grade']; order: SupportOrder; outcome: SaveJudgementOutcome }> {
      const now = Date.now();
      const gradeRecord: RockMassGrade = { ...toPlain(draft), id: newId('grade'), judgedAt: now };

      const outcomeRef: { value: SaveJudgementOutcome } = { value: 'new' };
      let order!: SupportOrder;
      let replacedId: string | undefined;

      await db.transaction('rw', db.grades, db.supports, async () => {
        await db.grades.put(toPlain(gradeRecord));

        const existing = await db.supports
          .where('faceId')
          .equals(draft.faceId)
          .and((it) => it.status === 'pending')
          .first();

        if (existing && existing.grade === draft.grade) {
          order = {
            ...existing,
            suggestedMeasures: draft.supportSuggestion,
            gradeRecordId: gradeRecord.id,
          };
          await db.supports.put(toPlain(order));
          outcomeRef.value = 'updated';
          return;
        }

        // 级别变化的基准：优先取被替换的待施工单，否则取最近一张已完成单
        let baseline = existing;
        if (!baseline) {
          const done = await db.supports
            .where('faceId')
            .equals(draft.faceId)
            .and((it) => it.status === 'done')
            .toArray();
          done.sort((a, b) => b.seq - a.seq);
          baseline = done[0];
        }
        const change = describeGradeChange(draft.grade, baseline?.grade);
        const count = await db.supports.where('faceId').equals(draft.faceId).count();

        order = {
          id: newId('support'),
          faceId: draft.faceId,
          seq: count + 1,
          grade: draft.grade,
          suggestedMeasures: draft.supportSuggestion,
          gradeRecordId: gradeRecord.id,
          status: 'pending',
          gradeChange: change.kind,
          gradeChangeNote: change.note,
          previousGrade: change.previousGrade,
          issuedAt: now,
        };
        await db.supports.put(toPlain(order));

        if (existing) {
          const underReview: SupportOrder = {
            ...existing,
            status: 'review',
            replacedAt: now,
            replacedBy: order.id,
          };
          await db.supports.put(toPlain(underReview));
          replacedId = existing.id;
        }
      });

      // 同步内存状态：追加判定记录，并按事务结果更新支护单
      const gradeStore = useGradeStore();
      gradeStore.items = [gradeRecord, ...gradeStore.items];
      if (outcomeRef.value === 'updated') {
        this.orders = this.orders.map((it) => (it.id === order.id ? order : it));
      } else {
        this.orders = this.orders.map((it) =>
          it.id === replacedId
            ? { ...it, status: 'review' as const, replacedAt: now, replacedBy: order.id }
            : it,
        );
        this.orders = [order, ...this.orders];
      }

      return { grade: draft.grade, order, outcome: outcomeRef.value };
    },
    /** 登记施工完成（待施工单，或确认已按复核单施工的复核单） */
    async complete(id: string, completion: SupportCompletionDraft): Promise<void> {
      const current = this.orders.find((it) => it.id === id);
      if (!current || (current.status !== 'pending' && current.status !== 'review')) {
        throw new Error('该支护单当前状态不可登记完成');
      }
      const plain = toPlain({ ...completion, status: 'done' as const });
      await db.supports.update(id, plain);
      this.orders = this.orders.map((it) => (it.id === id ? { ...it, ...plain } : it));
    },
    /** 复核确认旧单未施工：作废留痕 */
    async voidOrder(id: string, reviewNote?: string): Promise<void> {
      const current = this.orders.find((it) => it.id === id);
      if (!current || current.status !== 'review') throw new Error('仅需要复核的支护单可作废');
      const plain = toPlain({
        status: 'voided' as const,
        voidedAt: Date.now(),
        reviewNote: reviewNote?.trim() || '复核确认未施工，按新单执行',
      });
      await db.supports.update(id, plain);
      this.orders = this.orders.map((it) => (it.id === id ? { ...it, ...plain } : it));
    },
  },
});
