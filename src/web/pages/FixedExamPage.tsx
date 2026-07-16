import { ClipboardCheck, GraduationCap, Scale } from "lucide-react";

type FixedExamType = "law" | "practice" | "full";

export function FixedExamPage({ onStart }: { onStart: (type: FixedExamType) => Promise<void> }) {
  const start = async (type: FixedExamType) => {
    await onStart(type);
  };

  return <section className="page">
    <h2>正式模考</h2>
    <div className="fixed-exam-list">
      <button aria-label="法規單科模考" onClick={() => void start("law")}><Scale /><span><strong>法規單科模考</strong><small>100 題 · 80 分鐘</small></span><span>›</span></button>
      <button aria-label="實務單科模考" onClick={() => void start("practice")}><ClipboardCheck /><span><strong>實務單科模考</strong><small>50 題 · 60 分鐘</small></span><span>›</span></button>
      <button aria-label="完整測驗" onClick={() => void start("full")}><GraduationCap /><span><strong>完整測驗</strong><small>先法規，再實務</small></span><span>›</span></button>
    </div>
  </section>;
}
