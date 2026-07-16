import { BrainCircuit, GraduationCap } from "lucide-react";
import { StudyPlanCard } from "../components/StudyPlanCard.tsx";
import type { Dashboard, StudyPlan } from "../types.ts";

export function HomePage({ dashboard, plan, savingPlan, onSaveDate, onStartStudyPlan, onNavigate, serviceError }: { dashboard: Dashboard; plan: StudyPlan | null; savingPlan: boolean; onSaveDate: (examDate: string) => Promise<void>; onStartStudyPlan: () => void; onNavigate: (page: "practice" | "exam") => void; serviceError?: string | null }) {
  return <section className="page home-page">{serviceError && <p className="notice" role="alert">{serviceError} 請確認本機題庫服務已啟動後重新整理。</p>}<section className="home-intro"><div><span className="eyebrow">今天也一起前進</span><h2>準備好讀一小段了嗎？</h2><p>不用一次完成全部，先從今天最重要的題目開始。</p></div><div className="intro-spark" aria-hidden="true">✦</div></section><div className="stats-grid"><Stat label="題庫總數" value={dashboard.total} /><Stat label="錯題" value={dashboard.wrong} /><Stat label="常錯題" value={dashboard.commonWrong} /><Stat label="已掌握" value={dashboard.mastered} /></div><StudyPlanCard plan={plan} saving={savingPlan} onSaveDate={onSaveDate} onStart={onStartStudyPlan} /><section className="action-list" aria-label="開始功能"><button aria-label="開始練習 ›" onClick={() => onNavigate("practice")}><BrainCircuit /><span><strong>開始練習</strong><small>選科目、選方式，慢慢完成</small></span><span className="action-arrow">›</span></button><button aria-label="正式模考 ›" onClick={() => onNavigate("exam")}><GraduationCap /><span><strong>正式模考</strong><small>依照考試規則完整作答</small></span><span className="action-arrow">›</span></button></section></section>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div>; }
