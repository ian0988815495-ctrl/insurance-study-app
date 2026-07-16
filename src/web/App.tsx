import { useEffect, useState } from "react";
import { ArchiveRestore, BookOpenCheck, BrainCircuit, GraduationCap, LockKeyhole, Upload } from "lucide-react";
import { api, clearPhonePractice, isOfflinePwa, lockOfflineApi, restorePhoneProgress, savePhonePractice, unlockOfflineApi } from "./api.ts";
import { loadActivePractice } from "./active-practice.ts";
import { getPhoneSyncSession, isPhoneSyncConfigured, signInPhoneSync, signOutPhoneSync, signUpPhoneSync } from "./phone-sync.ts";
import type { Dashboard, PracticeQuestion, Review, StudyPlan } from "./types.ts";
import { EmptyState } from "./components/EmptyState.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { PracticeSetupPage, type PracticeSettings } from "./pages/PracticeSetupPage.tsx";
import { PracticeSessionPage } from "./pages/PracticeSessionPage.tsx";
import { ExamSessionPage } from "./pages/ExamSessionPage.tsx";
import { FixedExamPage } from "./pages/FixedExamPage.tsx";
import "./style.css";

const rememberedPasswordKey = "private-question-bank-offline-password";

export default function App() {
  if (!isOfflinePwa) return <QuestionBankApp />;
  return <OfflineUnlockGate />;
}

function OfflineUnlockGate() {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const unlock = async (candidate: string, persist: boolean) => {
    setMessage("");
    try {
      await unlockOfflineApi(candidate);
      if (persist) localStorage.setItem(rememberedPasswordKey, candidate);
      else localStorage.removeItem(rememberedPasswordKey);
      setUnlocked(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "題庫無法解鎖。");
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem(rememberedPasswordKey);
    if (!saved) { setLoading(false); return; }
    void unlock(saved, true).finally(() => setLoading(false));
  }, []);

  if (unlocked) return <QuestionBankApp />;
  return <main className="unlock-shell"><section className="unlock-panel"><LockKeyhole aria-hidden="true" /><span className="eyebrow">私人題庫</span><h1>輸入解鎖密碼</h1><p>題庫資料已加密，密碼正確後才會在這台裝置載入。</p><label>解鎖密碼<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={loading} /></label><label className="remember-choice"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />記住這台裝置</label>{message && <p className="notice">{message}</p>}<button className="primary" disabled={loading || !password} onClick={() => void unlock(password, remember)}>{loading ? "正在載入題庫" : "解鎖題庫"}</button><button className="link-button" onClick={() => { localStorage.removeItem(rememberedPasswordKey); lockOfflineApi(); setPassword(""); setMessage("已清除這台裝置的記憶密碼。"); }}>清除記憶密碼</button></section></main>;
}

function QuestionBankApp() {
  const [page, setPage] = useState<"home" | "practice" | "exam" | "backup">("home");
  const [dashboard, setDashboard] = useState<Dashboard>({ total: 0, wrong: 0, commonWrong: 0, mastered: 0 });
  const [studyPlan, setStudyPlan] = useState<StudyPlan | null>(null);
  const [savingStudyPlan, setSavingStudyPlan] = useState(false);
  const [practiceLaunch, setPracticeLaunch] = useState<PracticeSettings | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const refresh = () => { void api<Dashboard>("/dashboard").then((value) => { setDashboard(value); setServiceError(null); }).catch((error) => setServiceError(error instanceof Error ? error.message : "無法讀取本機題庫服務。")); void api<StudyPlan>("/study-plan").then(setStudyPlan).catch(() => undefined); };
  useEffect(refresh, []);
  useEffect(() => { if (isOfflinePwa) void restorePhoneProgress().then((restored) => { if (restored) refresh(); }).catch(() => undefined); }, []);
  const saveStudyPlan = async (examDate: string) => { setSavingStudyPlan(true); try { setStudyPlan(await api<StudyPlan>("/study-plan/settings", { method: "PUT", body: JSON.stringify({ examDate }) })); } finally { setSavingStudyPlan(false); } };
  const startStudyPlan = () => { setPracticeLaunch({ mode: "study-plan", subject: "all", shuffleQuestions: false, shuffleOptions: false }); setPage("practice"); };

  return <main className="app-shell">
    <header className="topbar"><div><span className="eyebrow">私人題庫</span><h1>人身保險</h1></div><BookOpenCheck aria-hidden="true" /></header>
    {page === "home" && <HomePage dashboard={dashboard} plan={studyPlan} savingPlan={savingStudyPlan} onSaveDate={saveStudyPlan} onStartStudyPlan={startStudyPlan} onNavigate={setPage} serviceError={serviceError} />}
    {page === "practice" && <Practice initialSettings={practiceLaunch} onInitialStarted={() => setPracticeLaunch(null)} onDone={refresh} onReturnHome={() => { setPracticeLaunch(null); setPage("home"); }} />}
    {page === "exam" && <ExamPage />}
    {page === "backup" && <BackupPage />}
    <nav className="bottom-nav" aria-label="主要功能">
      <NavButton active={page === "home"} onClick={() => setPage("home")} icon={<BookOpenCheck />} label="首頁" />
      <NavButton active={page === "practice"} onClick={() => setPage("practice")} icon={<BrainCircuit />} label="練習" />
      <NavButton active={page === "exam"} onClick={() => setPage("exam")} icon={<GraduationCap />} label="模考" />
      <NavButton active={page === "backup"} onClick={() => setPage("backup")} icon={<ArchiveRestore />} label="備份" />
    </nav>
  </main>;
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button className={active ? "nav-button active" : "nav-button"} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function Practice({ initialSettings, onInitialStarted, onDone, onReturnHome }: { initialSettings: PracticeSettings | null; onInitialStarted: () => void; onDone: () => void; onReturnHome: () => void }) {
  const [questions, setQuestions] = useState<PracticeQuestion[] | null>(null); const [sessionId, setSessionId] = useState(""); const [message, setMessage] = useState(""); const [empty, setEmpty] = useState(false);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);
  const [activeProgress, setActiveProgress] = useState(() => loadActivePractice());
  const start = async (settings: PracticeSettings) => { try { const session = await api<{ id: string; questionCount: number }>("/practice-sessions", { method: "POST", body: JSON.stringify(settings) }); if (!session.questionCount) { setEmpty(true); setMessage(""); return; } const data = await api<{ questions: PracticeQuestion[] }>(`/practice-sessions/${session.id}/questions`); const progress = { sessionId: session.id, questions: data.questions, index: 0 }; savePhonePractice(progress); setActiveProgress(progress); setSessionId(session.id); setQuestions(data.questions); setMessage(""); } catch (error) { setMessage(error instanceof Error ? error.message : "無法建立練習。"); } };
  useEffect(() => { if (!initialSettings || hasAutoStarted) return; setHasAutoStarted(true); onInitialStarted(); void start(initialSettings); }, [hasAutoStarted, initialSettings, onInitialStarted]);
  if (questions) return <PracticeSessionPage sessionId={sessionId} questions={questions} initialProgress={activeProgress ?? undefined} onProgressChange={(progress) => { savePhonePractice(progress); setActiveProgress(progress); }} recordAttempt={(questionId, activeSessionId, selectedOptionId) => api("/attempts", { method: "POST", body: JSON.stringify({ questionId, sessionId: activeSessionId, eventType: "answer", selectedOptionId }) })} loadReview={async (questionId) => { await api("/attempts", { method: "POST", body: JSON.stringify({ questionId, sessionId, eventType: "view_answer" }) }); return api<Review>(`/questions/${questionId}/review`); }} onMastered={(questionId) => api(`/questions/${questionId}/mastered`, { method: "PATCH", body: JSON.stringify({ mastered: true }) })} onExit={() => { clearPhonePractice(); setActiveProgress(null); setQuestions(null); onDone(); }} />;
  if (empty) return <div className="page"><EmptyState onReturnHome={onReturnHome} /></div>;
  return <PracticeSetupPage onStart={start} onResume={activeProgress ? () => { setSessionId(activeProgress.sessionId); setQuestions(activeProgress.questions); } : undefined} activePractice={activeProgress ? { subject: activeProgress.questions[activeProgress.index]?.subject ?? "練習", index: activeProgress.index, total: activeProgress.questions.length } : undefined} message={message} />;
}

type ActiveExam = { id: string; endsAt: string; questions: PracticeQuestion[]; seriesId?: string; stage?: "law" | "practice" };

function ExamPage() {
  const [exam, setExam] = useState<ActiveExam>(); const [seriesResult, setSeriesResult] = useState<{ lawScore: number; practiceScore: number; totalScore: number; passed: boolean }>();
  const start = async (type: "law" | "practice" | "full") => {
    const result = await api<{ id?: string; endsAt?: string; questions?: PracticeQuestion[]; seriesId?: string; stage?: "law"; exam?: ActiveExam }>("/exams/fixed", { method: "POST", body: JSON.stringify({ type }) });
    setSeriesResult(undefined);
    setExam(type === "full" ? { ...result.exam!, seriesId: result.seriesId, stage: "law" } : { id: result.id!, endsAt: result.endsAt!, questions: result.questions! });
  };
  const leaveExam = async () => {
    if (!exam?.seriesId) return setExam(undefined);
    if (exam.stage === "law") {
      const result = await api<{ stage: "practice"; exam: ActiveExam }>(`/exam-series/${exam.seriesId}/next`, { method: "POST" });
      return setExam({ ...result.exam, seriesId: exam.seriesId, stage: result.stage });
    }
    const result = await api<{ lawScore: number; practiceScore: number; totalScore: number; passed: boolean }>(`/exam-series/${exam.seriesId}/result`);
    setExam(undefined); setSeriesResult(result);
  };
  if (exam) return <ExamSessionPage exam={exam} onSubmit={(examId, answers) => api(`/exams/${examId}/submit`, { method: "POST", body: JSON.stringify({ answers }) })} onExit={() => void leaveExam()} resultActionLabel={exam.seriesId ? exam.stage === "law" ? "開始實務模考" : "查看完整結果" : "返回模考"} />;
  if (seriesResult) return <section className="page result-page"><h2>{seriesResult.passed ? "完整測驗通過" : "完整測驗未通過"}</h2><strong className="result-score">{seriesResult.totalScore.toFixed(0)} / 200</strong><div className="subject-result"><span>保險法規</span><span>{seriesResult.lawScore.toFixed(0)} 分</span></div><div className="subject-result"><span>保險實務</span><span>{seriesResult.practiceScore.toFixed(0)} 分</span></div><button className="primary" onClick={() => setSeriesResult(undefined)}>返回模考</button></section>;
  return <FixedExamPage onStart={start} />;
}

function BackupPage() {
  const [backup, setBackup] = useState<unknown>(); const [message, setMessage] = useState("");
  const exportBackup = async () => {
    try {
      const payload = await api<unknown>("/backups/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "question-bank-backup.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("已建立備份檔案。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法建立備份。");
    }
  };
  const chooseFile = (file?: File) => { if (!file) return; const reader = new FileReader(); reader.onload = async () => { try { const parsed = JSON.parse(String(reader.result)); const result = await api<{ questionCount: number; attemptCount: number }>("/backups/preview", { method: "POST", body: JSON.stringify(parsed) }); setBackup(parsed); setMessage(`備份預覽：${result.questionCount} 題、${result.attemptCount} 筆作答紀錄。`); } catch (error) { setBackup(undefined); setMessage(error instanceof Error ? error.message : "備份檔無法讀取。"); } }; reader.readAsText(file); };
  const restore = async () => { if (!backup) return; try { const result = await api<{ safetyBackup: string | null }>("/backups/restore", { method: "POST", body: JSON.stringify({ backup, confirmed: true }) }); setMessage(result.safetyBackup ? `還原完成，已建立還原前備份：${result.safetyBackup}` : "還原完成。"); } catch (error) { setMessage(error instanceof Error ? error.message : "還原失敗。"); } };
  return <section className="page"><h2>備份與還原</h2><PhoneSyncPanel /><button className="primary" onClick={() => void exportBackup()}><ArchiveRestore />匯出完整 JSON</button><label className="file-input"><Upload />選擇備份 JSON<input type="file" accept={("application/json")} onChange={(event) => chooseFile(event.target.files?.[0])} /></label>{Boolean(backup) && <button className="danger" onClick={restore}>確認還原資料</button>}{message && <p className="notice">{message}</p>}</section>;
}

function PhoneSyncPanel() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [connected, setConnected] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => { if (isPhoneSyncConfigured) void getPhoneSyncSession().then((session) => setConnected(Boolean(session))).catch(() => undefined); }, []);
  if (!isPhoneSyncConfigured) return null;
  const signIn = async (create: boolean) => { try { const session = create ? await signUpPhoneSync(email, password) : await signInPhoneSync(email, password); setConnected(Boolean(session)); setMessage(session ? "手機同步已啟用。" : "確認信已寄出，請在此手機開啟信件完成驗證。"); } catch (error) { setMessage(error instanceof Error ? error.message : "無法啟用手機同步。"); } };
  return <section className="sync-panel"><h3>手機進度同步</h3>{connected ? <><p>此手機會自動保存刷題進度，電腦不需要開著。</p><button onClick={() => void signOutPhoneSync().then(() => setConnected(false))}>登出同步帳號</button></> : <><label>電子信箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>同步密碼<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><div className="inline-actions"><button onClick={() => void signIn(false)} disabled={!email || password.length < 6}>登入</button><button className="primary" onClick={() => void signIn(true)} disabled={!email || password.length < 6}>建立同步帳號</button></div></>}{message && <p className="notice">{message}</p>}</section>;
}
