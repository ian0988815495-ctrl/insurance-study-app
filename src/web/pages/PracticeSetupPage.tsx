import { ArrowLeft, ArrowRight, BrainCircuit, CircleHelp, ListOrdered, Shuffle } from "lucide-react";
import { useState } from "react";
import type { PracticeMode } from "../types.ts";

type PracticeSubject = "all" | "law" | "practice";

export type PracticeSettings = { mode: PracticeMode; subject: PracticeSubject; shuffleQuestions: boolean; shuffleOptions: boolean };
export type PracticeResume = { subject: string; index: number; total: number };

const modeOptions: { id: PracticeMode; label: string; icon: React.ReactNode }[] = [
  { id: "sequential", label: "順序練習", icon: <ListOrdered /> },
  { id: "random", label: "隨機練習", icon: <Shuffle /> },
  { id: "wrong", label: "錯題練習", icon: <CircleHelp /> },
  { id: "common-wrong", label: "常錯題", icon: <BrainCircuit /> }
];

const subjectOptions: { id: PracticeSubject; label: string }[] = [
  { id: "all", label: "全部科目" },
  { id: "law", label: "法規" },
  { id: "practice", label: "實務" }
];

export function PracticeSetupPage({ onStart, onResume, activePractice, message }: { onStart: (settings: PracticeSettings) => void; onResume?: () => void; activePractice?: PracticeResume; message: string }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [settings, setSettings] = useState<PracticeSettings>({ mode: "sequential", subject: "all", shuffleQuestions: false, shuffleOptions: false });
  const chooseMode = (mode: PracticeMode) => setSettings({
    ...settings,
    mode,
    shuffleQuestions: mode === "random" ? true : mode === "sequential" ? false : settings.shuffleQuestions,
    shuffleOptions: mode === "random" ? true : mode === "sequential" ? false : settings.shuffleOptions
  });
  const resumeLabel = activePractice ? `${activePractice.subject.replace("保險", "")}繼續第 ${activePractice.index + 1} 題` : "";
  return <section className="page practice-setup-page">
    <div className="page-heading"><span className="eyebrow">一步一步設定</span><h2>建立練習</h2><p>先選科目，再選方式，最後確認選項。</p></div>
    {activePractice && <section className="resume-panel" aria-label="未完成練習"><div><span className="eyebrow">上次還沒完成</span><h3>{activePractice.subject}</h3><p>目前進度：第 {activePractice.index + 1} / {activePractice.total} 題</p></div><button className="resume-button" onClick={onResume}>{resumeLabel}<ArrowRight aria-hidden="true" /></button></section>}
    <ol className="flow-stepper" aria-label="練習設定進度">
      {([ [1, "選科目"], [2, "選方式"], [3, "確認"] ] as const).map(([number, label]) => <li key={number} className={step === number ? "current" : step > number ? "complete" : ""} aria-current={step === number ? "step" : undefined}><span>{number}</span>{label}</li>)}
    </ol>
    {step === 1 && <section className="setup-step" aria-labelledby="subject-step-title"><span className="step-kicker">第 1 步</span><h3 id="subject-step-title">今天想讀哪一科？</h3><div className="subject-selector" aria-label="練習科目">{subjectOptions.map((item) => <button key={item.id} type="button" aria-label={item.label} aria-pressed={settings.subject === item.id} className={settings.subject === item.id ? "subject-button selected" : "subject-button"} onClick={() => setSettings({ ...settings, subject: item.id })}>{item.label}<span>{item.id === "all" ? "完整複習" : item.id === "law" ? "法規觀念" : "實務題型"}</span></button>)}</div><button className="primary" onClick={() => setStep(2)}>下一步：選擇方式<ArrowRight aria-hidden="true" /></button></section>}
    {step === 2 && <section className="setup-step" aria-labelledby="mode-step-title"><span className="step-kicker">第 2 步</span><h3 id="mode-step-title">想用哪種方式練習？</h3><div className="mode-grid">{modeOptions.map((item) => <button key={item.id} aria-label={item.label} onClick={() => chooseMode(item.id)} className={settings.mode === item.id ? "mode selected" : "mode"}>{item.icon}<span>{item.label}</span>{item.id === "sequential" && <small>照題庫順序</small>}{item.id === "random" && <small>換個方式挑戰</small>}{item.id === "wrong" && <small>集中修正弱點</small>}{item.id === "common-wrong" && <small>反覆加強常錯</small>}</button>)}</div><div className="step-actions"><button className="secondary" onClick={() => setStep(1)}><ArrowLeft aria-hidden="true" />上一步</button><button className="primary" onClick={() => setStep(3)}>下一步：確認設定<ArrowRight aria-hidden="true" /></button></div></section>}
    {step === 3 && <section className="setup-step" aria-labelledby="options-step-title"><span className="step-kicker">第 3 步</span><h3 id="options-step-title">確認這次的練習</h3><div className="selection-summary"><div><span>科目</span><strong>{subjectOptions.find((item) => item.id === settings.subject)?.label}</strong></div><div><span>方式</span><strong>{modeOptions.find((item) => item.id === settings.mode)?.label}</strong></div></div><div className="setting-list"><Toggle label="隨機考題" checked={settings.shuffleQuestions} onChange={(shuffleQuestions) => setSettings({ ...settings, shuffleQuestions })} /><Toggle label="打亂選項" checked={settings.shuffleOptions} onChange={(shuffleOptions) => setSettings({ ...settings, shuffleOptions })} /></div>{message && <p className="notice">{message}</p>}<div className="step-actions"><button className="secondary" onClick={() => setStep(2)}><ArrowLeft aria-hidden="true" />上一步</button><button className="primary" onClick={() => onStart(settings)}>開始作答<ArrowRight aria-hidden="true" /></button></div></section>}
  </section>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  const state = checked ? "已開啟" : "已關閉";
  return <div className="setting-row"><span>{label}</span><button aria-pressed={checked} aria-label={`${label} ${state}`} className={checked ? "toggle on" : "toggle"} onClick={() => onChange(!checked)}><span /></button></div>;
}
