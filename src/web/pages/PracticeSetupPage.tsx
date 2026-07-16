import { BrainCircuit, CircleHelp, ListOrdered, Shuffle } from "lucide-react";
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
  const [settings, setSettings] = useState<PracticeSettings>({ mode: "sequential", subject: "all", shuffleQuestions: false, shuffleOptions: false });
  const chooseMode = (mode: PracticeMode) => setSettings({
    ...settings,
    mode,
    shuffleQuestions: mode === "random" ? true : mode === "sequential" ? false : settings.shuffleQuestions,
    shuffleOptions: mode === "random" ? true : mode === "sequential" ? false : settings.shuffleOptions
  });
  const resumeLabel = activePractice ? `${activePractice.subject.replace("保險", "")}繼續第 ${activePractice.index + 1} 題` : "";
  return <section className="page"><h2>建立練習</h2>{activePractice && <section className="sync-panel"><h3>未完成練習</h3><p>{activePractice.subject}，第 {activePractice.index + 1} / {activePractice.total} 題</p><button onClick={onResume}>{resumeLabel}</button></section>}<div className="subject-selector" aria-label="練習科目">{subjectOptions.map((item) => <button key={item.id} type="button" aria-pressed={settings.subject === item.id} className={settings.subject === item.id ? "subject-button selected" : "subject-button"} onClick={() => setSettings({ ...settings, subject: item.id })}>{item.label}</button>)}</div><div className="mode-grid">{modeOptions.map((item) => <button key={item.id} onClick={() => chooseMode(item.id)} className={settings.mode === item.id ? "mode selected" : "mode"}>{item.icon}<span>{item.label}</span></button>)}</div><Toggle label="隨機考題" checked={settings.shuffleQuestions} onChange={(shuffleQuestions) => setSettings({ ...settings, shuffleQuestions })} /><Toggle label="打亂選項" checked={settings.shuffleOptions} onChange={(shuffleOptions) => setSettings({ ...settings, shuffleOptions })} />{message && <p className="notice">{message}</p>}<button className="primary" onClick={() => onStart(settings)}>開始作答</button></section>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  const state = checked ? "已開啟" : "已關閉";
  return <div className="setting-row"><span>{label}</span><button aria-pressed={checked} aria-label={`${label} ${state}`} className={checked ? "toggle on" : "toggle"} onClick={() => onChange(!checked)}><span /></button></div>;
}
