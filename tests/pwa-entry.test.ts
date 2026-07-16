import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("離線 iPhone PWA 入口", () => {
  it("提供安裝資訊、Apple 圖示、Service Worker 與離線建置指令", async () => {
    const [html, manifest, serviceWorker, packageJson] = await Promise.all([
      readFile("index.html", "utf8"),
      readFile("public/manifest.webmanifest", "utf8"),
      readFile("public/service-worker.js", "utf8"),
      readFile("package.json", "utf8")
    ]);

    expect(html).toContain('rel="manifest"');
    expect(html).toContain('apple-touch-icon.png');
    expect(manifest).toContain('"display": "standalone"');
    expect(manifest).toContain('apple-touch-icon.png');
    expect(manifest).toContain('"start_url": "."');
    expect(serviceWorker).toContain("offline-seed.encrypted.json");
    expect(serviceWorker).not.toContain('"/offline-seed.json"');
    expect(serviceWorker).toContain("self.registration.scope");
    expect(serviceWorker).toContain("NETWORK_FIRST_ASSETS");
    expect(serviceWorker).toContain("private-insurance-question-bank-v6");
    expect(serviceWorker).toContain("matchAll");
    expect(packageJson).toContain('"build:offline"');
  });
});
