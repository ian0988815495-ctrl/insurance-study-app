import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PracticeQuestion, Review } from "../types.ts";
import type { ActivePractice } from "../active-practice.ts";

type Props = {
  sessionId: string;
  questions: PracticeQuestion[];
  recordAttempt: (questionId: string, sessionId: string, optionId: string) => Promise<void>;
  loadReview: (questionId: string) => Promise<Review>;
  onExit: () => void;
  onBack?: () => void;
  onMastered: (questionId: string) => Promise<void>;
  initialProgress?: ActivePractice;
  onProgressChange?: (progress: ActivePractice) => void;
};

export function PracticeSessionPage({ sessionId, questions, recordAttempt, loadReview, onExit, onBack, onMastered, initialProgress, onProgressChange = () => undefined }: Props) {
  const [index, setIndex] = useState(initialProgress?.index ?? 0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>(initialProgress?.selectedAnswers ?? legacySelectedAnswers(initialProgress, questions));
  const [revealedQuestions, setRevealedQuestions] = useState<string[]>(initialProgress?.revealedQuestions ?? legacyRevealedQuestions(initialProgress, questions));
  const [recordedAnswers, setRecordedAnswers] = useState<Record<string, string>>(initialProgress?.recordedAnswers ?? {});
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [message, setMessage] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const reviewLoading = useRef(new Set<string>());
  const [startedAt] = useState(initialProgress?.startedAt ?? new Date().toISOString());
  const question = questions[index];
  const selected = selectedAnswers[question.id];
  const review = reviews[question.id];
  const revealed = revealedQuestions.includes(question.id);

  useEffect(() => {
    onProgressChange({
      sessionId,
      questions,
      index,
      selectedAnswers,
      revealedQuestions,
      recordedAnswers,
      sessionStatus: "active",
      startedAt,
      updatedAt: new Date().toISOString()
    });
  }, [index, selectedAnswers, revealedQuestions, recordedAnswers, sessionId, questions, startedAt, onProgressChange]);

  useEffect(() => {
    if (revealed && !review) void loadReviewForQuestion(question.id);
  }, [question.id, revealed, review]);

  const loadReviewForQuestion = async (questionId: string) => {
    if (reviews[questionId] || reviewLoading.current.has(questionId)) return;
    reviewLoading.current.add(questionId);
    try {
      const loaded = await loadReview(questionId);
      setReviews((current) => ({ ...current, [questionId]: loaded }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法取得 AI 詳解。");
    } finally {
      reviewLoading.current.delete(questionId);
    }
  };

  const commitAnswer = async (questionId: string, optionId?: string) => {
    if (!optionId || recordedAnswers[questionId] === optionId) return true;
    try {
      await recordAttempt(questionId, sessionId, optionId);
      setRecordedAnswers((current) => ({ ...current, [questionId]: optionId }));
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法儲存作答。");
      return false;
    }
  };

  const selectAnswer = (optionId: string) => {
    if (revealed) return;
    setSelectedAnswers((current) => ({ ...current, [question.id]: optionId }));
  };

  const viewAnswer = async () => {
    if (revealed) return;
    setRevealedQuestions((current) => current.includes(question.id) ? current : [...current, question.id]);
    const saved = await commitAnswer(question.id, selected);
    if (saved) await loadReviewForQuestion(question.id);
  };

  const next = async () => {
    if (!(await commitAnswer(question.id, selected))) return;
    if (index + 1 >= questions.length) return onExit();
    setIndex((current) => current + 1);
    setMessage("");
  };

  const previous = () => {
    if (index === 0) return;
    setIndex((current) => current - 1);
    setMessage("");
  };

  return <section className="page question-page">
    <div className="question-toolbar"><button className="back-button" onClick={onBack} aria-label="返回練習選擇"><ArrowLeft aria-hidden="true" />返回練習選擇</button><button className="link-button" onClick={() => setConfirmEnd(true)}>結束測驗</button></div>
    <div className="progress-label"><span>第 {index + 1} 題，共 {questions.length} 題</span><span>{question.subject} · {question.chapter}</span></div>
    <div className="progress"><span style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div>
    <div className="question-heading"><span className="step-kicker">現在專心這一題</span><h2>{question.questionText}</h2></div>
    <div className="options" data-testid="practice-options">{question.options.map((option) => <button key={option.id} className={optionClass(option.id, selected, review)} onClick={() => selectAnswer(option.id)} disabled={revealed} aria-pressed={option.id === selected}><span className="radio" />{option.sourceLabel && <span className="option-label">{option.sourceLabel}</span>}<span>{option.text}</span></button>)}</div>
    {!revealed && <button className="primary answer-button" onClick={() => void viewAnswer()}>公布答案</button>}
    {revealed && <section className="answer-panel"><section className="explanation-block ai-explanation"><h3>AI 詳解</h3>{review?.aiExplanation.content ? <p>{review.aiExplanation.content}</p> : <p>AI 詳解尚未產生。</p>}{review?.aiOptionAnalysis?.length ? <div>{question.options.map((option) => review.aiOptionAnalysis?.find((analysis) => analysis.optionId === option.id)).filter((analysis): analysis is NonNullable<typeof analysis> => Boolean(analysis)).map((analysis) => <p className="analysis-row" data-testid="ai-option-analysis" key={analysis.optionId}>{analysis.content}</p>)}</div> : null}</section><div className="inline-actions"><button onClick={() => void onMastered(question.id)}>標記已掌握</button></div></section>}
    <div className="inline-actions navigation-actions"><button className="secondary" onClick={previous} disabled={index === 0}><ArrowLeft aria-hidden="true" />上一題</button><button className="primary" onClick={() => void next()}>{index + 1 === questions.length ? "完成練習" : "下一題"}</button></div>
    {message && <p className="notice">{message}</p>}
    {confirmEnd && <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="end-practice-title"><div className="confirm-dialog-panel"><h2 id="end-practice-title">確定要結束目前測驗嗎？</h2><p>目前的測驗進度將會結束，下次進入時會重新開始新的測驗。</p><div className="inline-actions"><button className="secondary" onClick={() => setConfirmEnd(false)}>取消</button><button className="danger" onClick={onExit}>確認結束</button></div></div></section>}
  </section>;
}

function optionClass(optionId: string, selected?: string, review?: Review) {
  if (!review) return optionId === selected ? "option selected" : "option";
  if (optionId === review.correctOptionId) return "option correct";
  return optionId === selected ? "option incorrect" : "option";
}

function legacySelectedAnswers(progress: ActivePractice | undefined, questions: PracticeQuestion[]) {
  if (!progress?.selectedOptionId || !questions[progress.index]) return {};
  return { [questions[progress.index].id]: progress.selectedOptionId };
}

function legacyRevealedQuestions(progress: ActivePractice | undefined, questions: PracticeQuestion[]) {
  if (!progress?.viewedAnswer || !questions[progress.index]) return [];
  return [questions[progress.index].id];
}
