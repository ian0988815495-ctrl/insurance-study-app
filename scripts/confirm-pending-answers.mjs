import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const inputPath = resolve(process.argv[2] ?? join(root, "work", "offline-seed.with-chatgpt-analyses.json"));
const outputPath = resolve(process.argv[3] ?? join(root, "work", "offline-seed.with-confirmed-answers.json"));
const evidencePath = resolve(process.argv[4] ?? join(root, "work", "pending-39-answer-evidence.json"));

const sources = {
  employment: "https://www.mol.gov.tw/1607/28162/28472/28480/",
  microinsurance: "https://law.fsc.gov.tw/LawContentHistory.aspx?hid=1264&media=print",
  nationalPension: "https://child.bli.gov.tw/0000000051.html",
  annuityRules: "https://law.fsc.gov.tw/EngLawContent.aspx?id=1507&lan=C&media=print",
  yzuPractice: "https://www.cm.yzu.edu.tw/File/TabInfo/Item/15101/%E4%BF%9D%E9%9A%AA%E5%AF%A6%E5%8B%99.pdf",
  agentRules: "https://www.cm.yzu.edu.tw/File/TabInfo/Item/15101/%E4%BF%9D%E9%9A%AA%E5%AF%A6%E5%8B%99.pdf",
  studentInsurance: "https://edu.law.moe.gov.tw/LawContent.aspx?id=GL001776",
  accidentRules: "https://gazette.nat.gov.tw/EG_FileManager/eg022133/ch04/type2/gov36/num8/Eg.htm",
  longTermCare: "https://files.chcg.gov.tw/files/4.107%E5%B9%B4%E5%8F%8B%E5%96%84%E5%AE%B6%E5%BA%AD%E5%BA%A7%E8%AB%87%E6%9C%83-%E5%B0%88%E9%A1%8C%E7%B0%A1%E5%A0%B1_15_1071128.pdf",
  nhi: "https://media.nhi.gov.tw/md/dl-51939-22c20553daad430ea05c073d00b44b53-3.pdf",
  investmentDisclosure: "https://law.fsc.gov.tw/LawContent.aspx?id=FL026720",
  investmentReview: "https://law.fsc.gov.tw/LawContent.aspx?id=FL040352",
  laborPension: "https://www.bli.gov.tw/0012933.html",
  laborPensionQuestion: "https://www.tikutang.com/a/ElNG10M560Dm60uIc8o7IK724.html",
  occupationalClassification: "https://www.allianz.com.tw/content/dam/onemarketing/aztw/allianzcomtw/zh_tw/news-and-annoucement/regulation/20230314/ipa.pdf",
  medicalControl: "https://law.fsc.gov.tw/LawContent.aspx?id=GL004244&media=print",
  groupInsurance: "https://law.fsc.gov.tw/EngLawContent.aspx?id=1500&lan=C"
};

const confirmations = [
  ["047b6f7f-73a8-4f4f-80d8-3774bbe0ef09", "1%", "official_rule", [sources.employment], "勞動部資料載明目前就業保險費率按月投保薪資 1% 計收。"],
  ["05bd2672-8a12-46b6-91e9-58f7d34dd716", "總保費之15%", "official_rule", [sources.microinsurance], "微型保險附加費用率上限為總保費之 15%。"],
  ["0796b4f1-eea5-4ca0-94a8-fccc8d6c4126", "CD", "official_rule", [sources.nationalPension], "國民年金有喪葬給付與遺屬年金，沒有眷屬喪葬津貼與失業給付。"],
  ["0c31eec1-ec98-4d33-87e8-4c14adf09abb", "AB", "exact_answer_key", ["https://www.austinquiz.com/questions/c87f17d75af541f6002a2fbb"], "逐題題庫頁列出正確組合為 AB。"],
  ["0f8cdad1-d2a1-426b-80cc-d03ae9b4e8c9", "ABC", "exact_answer_key", [sources.agentRules], "答案檔將不當招攬三項 A、B、C 列為處分事由；D 為教育訓練規範，未列入本題組合。"],
  ["1282cb83-5c5f-4e3c-aa9d-0ed747447ca5", "連生共存年金中多名年金受領人，若僅其中1人生存，保險人仍應依約給付年金", "exact_answer_key", [sources.yzuPractice], "連生共存年金並非僅一人生存即當然繼續給付，該敘述為錯誤。"],
  ["1d3ab0f1-2afa-4152-bdef-cb759bc8db2d", "AB", "official_rule", [sources.nhi], "健康保險主要處理疾病與傷害造成的就醫或工作能力損失。"],
  ["258f0953-3519-4dde-9bc8-1b8ebc18d939", "仰賴人口係指0至14歲的人口", "official_rule", ["https://www.ndc.gov.tw/"], "仰賴人口包含幼年與老年人口，不只 0 至 14 歲。"],
  ["26355dbe-98c1-475f-bb15-c0304ce56ba2", "BD", "official_rule", [sources.accidentRules], "官方規範列明意外失能發生率為死亡發生率 40%，重大事故特別準備金提存率為 1%，第二類費率比為 1.25；因此 B、D 正確。"],
  ["3d413eb2-432a-446b-ab07-43d9c816a3bb", "認知功能障礙常運用簡易智能測驗（MMSE）進行評估", "cross_check", [sources.longTermCare, "https://yamol.tw/item-10%2B%E7%8F%BE%E8%A1%8C%E9%95%B7%E6%9C%9F%E7%85%A7%E9%A1%A7%E4%BF%9D%E9%9A%AA%E6%9C%89%E9%97%9C%E8%AA%8D%E7%9F%A5%E5%8A%9F%E8%83%BD%E9%9A%9C%E7%A4%99%E4%B9%8B%E8%AA%8D%E5%AE%9A%EF%BC%8C%E4%BD%95%E8%80%85%E6%AD%A3%E7%A2%BA%EF%BC%9F%28A%29%E8%A2%AB%E4%BF%9D%E9%9A%AA%E4%BA%BA%E7%B6%93%E5%B0%88%E7%A7%91%E9%86%AB%E5%B8%AB-2679563.htm"], "歷史示範條款曾以 MMSE 或 CDR 作為認知功能評估工具；逐題討論亦指出正確項為 MMSE。"],
  ["47550706-4394-4ebf-87d1-4d1d0f06a41f", "AB", "official_rule", [sources.nhi], "全民健保以強制納保為原則，保險事故包含疾病、傷害、生育；主管機關與保險人不是題目所述的 C、D。"],
  ["4b466f11-9a9c-4823-8e2e-235d43ddb5e6", "幼兒參加本保險，於保險契約訂立時已在疾病中，保險人對該項疾病不負給付保險金責任", "official_rule", [sources.studentInsurance], "教育部現行條例第 13 條明定，契約訂立時已在疾病中者，保險人對該疾病負給付責任；因此本敘述為非。"],
  ["4d5b1e81-9f7c-4e64-8bdf-0be4d13ed693", "90%", "exact_answer_key", ["https://paallpass.com/post-406383357/"], "逐題答案與解析明列民國 94 年 1 月至 101 年 6 月底為年金生命表死亡率 90%。"],
  ["4e9bafb2-5c95-487b-9f78-777d8b0bebae", "BD", "official_rule", ["https://www.bli.gov.tw/0014111.htm"], "職業災害保險給付為傷病、醫療、失能、死亡，不包括失業、老年、生育及避孕。"],
  ["5a69bde9-b3b7-417c-8ad6-b64f8ef2face", "AC", "official_rule", [sources.annuityRules], "甲型給付開始時依年齡、預定利率及年金生命表換算定額年金，對應 A、C。"],
  ["628c1c92-3060-4af0-b4c8-722e55645898", "甲型於給付期間僅採不分紅方式設計", "exact_answer_key", ["https://yamol.tw/item-193%E6%9C%89%E9%97%9C%E5%88%A9%E7%8E%87%E8%AE%8A%E5%8B%95%E5%9E%8B%E5%B9%B4%E9%87%91%E4%B9%8B%E6%95%98%E8%BF%B0%E4%BD%95%E8%80%85%E7%82%BA%E9%9D%9E%EF%BC%9F%28A%29%E4%B9%99%E5%9E%8B%E6%96%BC%E7%B5%A6%E4%BB%98%E6%9C%9F%E9%96%93%E9%80%9A%E5%B8%B8%E7%84%A1%E7%B4%85%E5%88%A9%E7%B5%A6%E4%BB%98%28B%29-2680054.htm"], "逐題資料指出甲型並非一律僅能採不分紅設計。"],
  ["6ed07861-f30f-4b28-beea-9f3b08dd4290", "整體保險業於醫療保險及傷害醫療保險投保1張銜接原給付限額具自負額商品，該張可不列入張數計算", "official_rule", [sources.medicalControl], "實支實付張數控管對具自負額、銜接原給付限額的特定商品有不列入計算的例外。"],
  ["703c18bd-6bce-400c-b15e-ef79d62eeba3", "六類", "official_rule", [sources.occupationalClassification], "臺灣地區傷害保險個人職業分類表實務上分為第一至第六類，另有未承保類。"],
  ["7c34ef18-b3ca-4ee2-8724-e020cdbe52ff", "ABC", "cross_check", [sources.investmentReview, "https://www.austinquiz.com/questions/46d7f2efe9c2dd1a92d30eb8"], "逐題資料的答案組合為 ABC；結構型商品不列入本題所述全權委任運用範圍。"],
  ["88db162f-394d-4585-abde-49d6ad4c569b", "最小值", "exact_answer_key", [sources.yzuPractice], "答案檔明列兩項利率取最小值計算。"],
  ["916adf04-98d9-4fee-9d27-598fb1357117", "萬能年金", "official_rule", [sources.investmentReview], "投資型人壽保險與投資型年金保險的題目分類不包含萬能年金這個獨立種類。"],
  ["94db0d62-86c2-43b0-9eb1-bd976753c6db", "ABCD", "exact_answer_key", ["https://www.scribd.com/document/1006467351/2-%E5%A3%BD%E9%9A%AA%E8%80%83%E9%A1%8C"], "該歷史題目版本的答案組合為 ABCD；目前規範門檻已改以財政部公告年度標準計算，保留版本註記。"],
  ["a93b0f92-32a4-4fab-9b7c-9a3496f6bf2c", "身故保險金受益人僅以被保險人家屬為限", "official_rule", [sources.microinsurance], "微型保險身故受益人以家屬或法定繼承人為限，不是僅限家屬。"],
  ["abbf7885-f712-4907-8557-a6217ddf601f", "失能保險金得指定及變更受益人", "official_rule", [sources.microinsurance], "微型保險失能保險金受益人為被保險人本人，保險業不得受理指定或變更。"],
  ["ad945763-1e3c-418e-bd96-4519aa0256ab", "當保費資金來源為貸款，原招攬人員應於承保前對客戶進行電訪並保留錄音紀錄以供查核", "official_rule", ["https://law.fsc.gov.tw/LawContentHistory.aspx?hid=713&media=print"], "貸款、解約或保單借款案件的承保前電話訪問應由非銷售通路人員辦理，不是原招攬人員。"],
  ["b4c5c401-ceee-4a0c-9e16-cdd630caf2aa", "CD", "official_rule", ["https://www.bli.gov.tw/0014246.html"], "國民年金納保條件包括國內設籍且未參加勞保、農保、公教保或軍保；題目 A 的年齡起點 20 歲不符。"],
  ["b79c528e-255a-4731-ad30-c18965115bf8", "延後退休", "cross_check", ["https://www.ndc.gov.tw/"], "少子高齡化會提高扶養與退休制度壓力，延後退休是題目選項中符合的影響。"],
  ["ba0e1d75-060e-4d65-a95d-c2d821806e6b", "3 個月", "official_rule", [sources.investmentDisclosure], "費用變更至少應於三個月前通知要保人。"],
  ["bf394749-512c-44f9-9dfc-52972025390c", "保單價值準備金全額", "official_rule", [sources.annuityRules, "https://law.fsc.gov.tw/LawContent.aspx?id=FL035279&media=print"], "累積期間以扣除附加費用後依宣告利率累積的年金保單價值準備金為基礎。"],
  ["c6960ca8-3df9-4b55-8695-fe5200d982a1", "團體責任保險", "official_rule", [sources.groupInsurance], "壽險公司推出的團體人身保險種類不包括財產保險性質的團體責任保險。"],
  ["d35b2024-cfe9-48db-b4ce-861f190eee2a", "員工的工作性質", "exact_answer_key", [sources.yzuPractice], "答案檔的同題不同選項順序中，非保險金額決定基礎為工作性質。"],
  ["d7755250-9551-4488-819c-00e884329f5d", "變額萬能壽險指彈性繳納保險費，保單現金價值有高低起伏但不可能降低至零", "official_rule", [sources.investmentReview], "投資損失及費用扣除可能使變額萬能壽險的保單帳戶價值降至零。"],
  ["d883caf0-60b9-429e-84d6-9eb13f30523a", "6 個月", "official_rule", [sources.longTermCare], "長期照顧保險示範條款允許的免責期間上限為六個月。"],
  ["d99030c0-b800-476d-9981-d6a810bf00f8", "ABCD", "official_rule", ["https://law.fsc.gov.tw/LawContent.aspx?id=FL040352"], "團體一年定期壽險平均保險費率會依團體危險程度及員工性別、年齡、保險金額計算。"],
  ["ee9fc5e8-4136-47a1-a256-9640511bf893", "給付開始日", "official_rule", [sources.annuityRules], "預定利率不得高於年金給付開始日當月的宣告利率。"],
  ["efc9378f-ab03-42c0-ac52-6a6638f1a38a", "當銷售予65歳以上保戶未能取得其同意者，免除銷售過程之錄音或錄影", "official_rule", [sources.investmentReview], "未取得高齡客戶同意不會使銷售過程的錄音錄影義務自動免除。"],
  ["f1decda6-cd89-4de0-9a9d-f203046e2a18", "不得有除外責任", "exact_answer_key", [sources.yzuPractice], "生存年金部分不得以除外責任排除生存給付。"],
  ["f9a35b1a-c77f-4b34-9249-f6be5398f583", "勞工按月提繳退休金，可選擇儲存於勞保局設立之勞工退休金個人專戶", "official_rule", [sources.laborPension], "勞保局資料明定退休金應儲存於勞保局設立的個人專戶，並非勞工可任意選擇；同時也支持自提率 6% 範圍與自提扣除所得的規則。"],
  ["fde12c70-3c15-4c4b-9dc9-4019c3b2f06c", "ABC", "cross_check", [sources.investmentReview, "https://www.austinquiz.com/questions/46d7f2efe9c2dd1a92d30eb8"], "與同一題型交叉比對後答案組合為 ABC。"]
].map(([questionId, answerText, basis, evidenceSources, note]) => ({ questionId, answerText, basis, sources: evidenceSources, note }));

const seed = JSON.parse(readFileSync(inputPath, "utf8"));
if (!Array.isArray(seed.questions)) throw new Error("找不到題庫 questions 陣列。");

const evidenceById = new Map(confirmations.map((item) => [item.questionId, item]));
const pending = seed.questions.filter((question) => question.answerStatus === "pending-review" || !question.correctOptionId);
if (pending.length !== 39 || evidenceById.size !== 39) {
  throw new Error(`待確認題數或核對表數量不符：待確認 ${pending.length}、核對表 ${evidenceById.size}。`);
}

const questions = seed.questions.map((question) => {
  const item = evidenceById.get(question.id);
  if (!item) return question;
  const option = question.options.find((candidate) => candidate.text === item.answerText);
  if (!option) throw new Error(`題目 ${question.id} 找不到核對答案選項：${item.answerText}`);
  const answerEvidence = {
    status: "confirmed",
    basis: item.basis,
    sources: item.sources,
    note: item.note,
    confirmedAt: new Date().toISOString()
  };
  return {
    ...question,
    correctOptionId: option.id,
    answerStatus: "ready",
    answerEvidence,
    aiOptionAnalysis: question.aiOptionAnalysis?.map((analysis) => ({
      ...analysis,
      verdict: analysis.optionId === option.id ? "correct" : "incorrect"
    }))
  };
});

const confirmed = questions.filter((question) => question.answerStatus === "ready");
const remaining = questions.filter((question) => question.answerStatus !== "ready");
if (confirmed.length !== 655 || remaining.length !== 0) {
  throw new Error(`核對後答案狀態不完整：已確認 ${confirmed.length}、仍待確認 ${remaining.length}。`);
}

mkdirSync(resolve(outputPath, ".."), { recursive: true });
writeFileSync(outputPath, JSON.stringify({ ...seed, generatedAt: new Date().toISOString(), answerReviewVersion: 1, questions }, null, 2), "utf8");
writeFileSync(evidencePath, JSON.stringify({ generatedAt: new Date().toISOString(), questionCount: confirmations.length, confirmations }, null, 2), "utf8");
console.log(JSON.stringify({ outputPath, evidencePath, questionCount: questions.length, confirmedAnswerCount: confirmed.length, pendingReviewCount: remaining.length }, null, 2));
