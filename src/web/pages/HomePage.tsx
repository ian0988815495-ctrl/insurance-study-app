import { BrainCircuit, GraduationCap } from "lucide-react";
import { StudyPlanCard } from "../components/StudyPlanCard.tsx";
import type { Dashboard, StudyPlan } from "../types.ts";

export function HomePage({ dashboard, plan, savingPlan, onSaveDate, onStartStudyPlan, onNavigate, serviceError }: { dashboard: Dashboard; plan: StudyPlan | null; savingPlan: boolean; onSaveDate: (examDate: string) => Promise<void>; onStartStudyPlan: () => void; onNavigate: (page: "practice" | "exam") => void; serviceError?: string | null }) {
  return <section className="page home-page">{serviceError && <p className="notice" role="alert">{serviceError} 請確認本機題庫服務已啟動後重新整理。</p>}<div className="stats-grid"><Stat label="題庫總數" value={dashboard.total} /><Stat label="錯題" value={dashboard.wrong} /><Stat label="常錯題" value={dashboard.commonWrong} /><Stat label="已掌握" value={dashboard.mastered} /></div><StudyPlanCard plan={plan} saving={savingPlan} onSaveDate={onSaveDate} onStart={onStartStudyPlan} /><section className="action-list" aria-label="開始功能"><button onClick={() => onNavigate("practice")}><BrainCircuit />開始練習<span>›</span></button><button onClick={() => onNavigate("exam")}><GraduationCap />正式模考<span>›</span></button></section></section>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div>; }
