import { createRoot } from "react-dom/client";
import App from "./App.tsx";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("找不到前端掛載節點。");
createRoot(rootElement).render(<App />);

if (import.meta.env.VITE_OFFLINE_PWA === "true" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/service-worker.js");
  });
}
