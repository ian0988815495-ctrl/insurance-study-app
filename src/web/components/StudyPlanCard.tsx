import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import type { StudyPlan } from "../types.ts";

type StudyPlanCardProps = {
  plan: StudyPlan | null;
  saving: boolean;
  onSaveDate: (examDate: string) => Promise<void>;
  onStart: () => void;
};

export function StudyPlanCard({ plan, saving, onSaveDate, onStart }: StudyPlanCardProps) {
  const [examDate, setExamDate] = useState(plan?.examDate ?? "");
  useEffect(() => setExamDate(plan?.examDate ?? ""), [plan?.examDate]);

  const canStart = Boolean(plan?.examDate && plan.questionIds.length > 0);
  return <section className="study-plan" aria-label="今日讀書計畫">
    <div className="study-plan-header"><span className="eyebrow">今日讀書計畫</span><h2>{plan?.daysRemaining === null ? "設定考試日期" : `距離考試 ${plan?.daysRemaining ?? "-"} 天`}</h2></div>
    <div className="study-plan-date"><label htmlFor="exam-date">考試日期</label><input id="exam-date" aria-label="考試日期" type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} /><button type="button" aria-label="儲存考試日期" className="study-plan-save" disabled={saving || !examDate} onClick={() => void onSaveDate(examDate)}><Check /></button></div>
    <div className="study-plan-tasks"><Task label="到期複習" value={plan?.counts.due ?? 0} /><Task label="錯題加強" value={plan?.counts.wrong ?? 0} /><Task label="新題練習" value={plan?.counts.new ?? 0} /></div>
    <button type="button" className="primary" disabled={!canStart} onClick={onStart}>開始今日計畫</button>
    <section className="study-plan-advice" aria-label="今日建議"><div className="cat-coach" aria-hidden="true"><div className="cat-mascot"><span className="cat-ear cat-ear-left" /><span className="cat-ear cat-ear-right" /><span className="cat-eye cat-eye-left" /><span className="cat-eye cat-eye-right" /><span className="cat-nose" /></div><span className="cat-name">小保貓</span></div><div className="cat-speech"><strong>今日建議</strong><p>{plan?.advice.content ? `喵～${plan.advice.content}` : "喵～今天先完成一小段，累積起來就會很厲害。"}</p></div></section>
    <p className="study-plan-message">{plan?.message ?? "正在讀取今日安排。"}</p>
  </section>;
}

function Task({ label, value }: { label: string; value: number }) {
  return <div><strong>{value}</strong><span>{label} {value} 題</span></div>;
}
