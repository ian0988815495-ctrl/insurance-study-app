export function EmptyState({ onReturnHome }: { onReturnHome: () => void }) {
  return <section className="empty-state">
    <h2>尚無可練習題目</h2>
    <button className="primary" onClick={onReturnHome}>返回首頁</button>
  </section>;
}
