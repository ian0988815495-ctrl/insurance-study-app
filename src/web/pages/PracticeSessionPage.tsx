import { useEffect, useState } from "react";
import type { PracticeQuestion, Review } from "../types.ts";
import type { ActivePractice } from "../active-practice.ts";

type Props = {
  sessionId: string;
  questions: PracticeQuestion[];
  recordAttempt: (questionId: string, sessionId: string, optionId: string) => Promise<void>;
  loadReview: (questionId: string) => Promise<Review>;
  onExit: () => void;
  onMastered: (questionId: string) => Promise<void>;
  initialProgress?: ActivePractice;
  onProgressChange?: (progress: ActivePractice) => void;
};

export function PracticeSessionPage({ sessionId, questions, recordAttempt, loadReview, onExit, onMastered, initialProgress, onProgressChange = () => undefined }: Props) {
  const [index, setIndex] = useState(initialProgress?.index ?? 0); const [selected, setSelected] = useState<string | undefined>(initialProgress?.selectedOptionId); const [review, setReview] = useState<Review>(); const [message, setMessage] = useState("");
  const question = questions[index];
  useEffect(() => { if (initialProgress?.viewedAnswer) void viewAnswer(); }, []);
  useEffect(() => { onProgressChange({ sessionId, questions, index, selectedOptionId: selected, viewedAnswer: Boolean(review) }); }, [index, selected, review, sessionId, questions, onProgressChange]);
  const answer = async (optionId: string) => { if (selected) return; setSelected(optionId); try { await recordAttempt(question.id, sessionId, optionId); } catch (error) { setMessage(error instanceof Error ? error.message : "無法儲存作答。"); } };
  const viewAnswer = async () => { try { setReview(await loadReview(question.id)); } catch (error) { setMessage(error instanceof Error ? error.message : "無法取得解析。"); } };
  const next = () => { if (index + 1 >= questions.length) return onExit(); setIndex(index + 1); setSelected(undefined); setReview(undefined); setMessage(""); };
  const resultLabel = selected ? (selected === review?.correctOptionId ? "答對" : "答錯") : "看過答案／待複習";
  const sourceExplanation = formatSourceExplanation(review?.rawExplanation ?? "");
  return <section className="page question-page"><div className="progress-label"><span>{index + 1} / {questions.length}</span><span>{question.subject} · {question.chapter}</span></div><div className="progress"><span style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div><h2>{question.questionText}</h2><div className="options">{question.options.map((option) => <button key={option.id} className={optionClass(option.id, selected, review)} onClick={() => void answer(option.id)} disabled={Boolean(selected)}><span className="radio" />{option.sourceLabel && <span className="option-label">{option.sourceLabel}</span>}<span>{option.text}</span></button>)}</div>{!review && <button className="primary" onClick={() => void viewAnswer()}>查看答案</button>}{review && <section className="answer-panel"><strong>{resultLabel}</strong><section className="explanation-block source-explanation"><h3>解析</h3><p>{sourceExplanation}</p></section><div className="inline-actions"><button onClick={() => void onMastered(question.id)}>標記已掌握</button><button className="primary" onClick={next}>{index + 1 === questions.length ? "完成練習" : "下一題"}</button></div></section>}{message && <p className="notice">{message}</p>}</section>;
}

function optionClass(optionId: string, selected?: string, review?: Review) { if (!review) return optionId === selected ? "option selected" : "option"; if (optionId === review.correctOptionId) return "option correct"; return optionId === selected ? "option incorrect" : "option"; }

function formatSourceExplanation(rawExplanation: string) {
  const content = rawExplanation.trim().replace(/^訊息列(?:成功|錯誤)\s*/u, "").trim();
  if (!content || /^正確。?$/u.test(content)) return "此題來源未提供詳細解析。";
  return content;
}
