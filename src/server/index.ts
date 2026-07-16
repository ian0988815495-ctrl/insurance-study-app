import "dotenv/config";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { QuestionDatabase } from "./db.ts";

const port = Number(process.env.PORT ?? 3001);
const database = new QuestionDatabase(join(process.cwd(), "data", "question-bank.sqlite"));
const app = createApp({ database });

app.listen(port, "127.0.0.1", () => {
  console.log(`本機 API 已啟動：http://127.0.0.1:${port}`);
});
