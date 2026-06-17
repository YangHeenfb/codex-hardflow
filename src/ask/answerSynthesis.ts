import type { CoverageEvalResult } from "../coverageEval.js";
import type { EvidenceItem } from "../coverage/evidenceLedger.js";
import { isNoSignalEvidence } from "../coverage/evidenceLedger.js";
import { outputLanguageCode, resolveOutputLanguagePolicy, type OutputLanguagePolicy } from "../i18n/languagePolicy.js";
import type { ResearchReport } from "../schemas.js";

export interface AskCoverageSummary {
  coverageMode: ResearchReport["coverageMode"];
  parallelPolicy: ResearchReport["parallelPolicy"];
  requiredBucketCount: number;
  completedRequiredBucketCount: number;
  searchedButNoSignalCount: number;
  excludedBucketCount: number;
  sourceCount: number;
  evidenceItemCount: number;
  coverageScore: number | null;
  coverageClaim: string | null;
}

export interface AskSourceSummary {
  id: string;
  bucket: string;
  title: string;
  urlOrRef: string;
  claim: string;
  confidence: string;
}

interface Labels {
  question: string;
  answer: string;
  coverage: string;
  coverageSummary: string;
  sources: string;
  sourceSummary: string;
  caveats: string;
  excludedBuckets: string;
  searchedButNoSignal: string;
  runInfo: string;
  evidence: string;
  failed: string;
  degraded: string;
  sourceGaps: string;
  noEvidence: string;
  noFindings: string;
  requiredBuckets: string;
  sourceCount: string;
  evidenceItemCount: string;
  coverageScore: string;
  fullReport: string;
}

const EN: Labels = {
  question: "Question",
  answer: "Answer from HardFlow evidence",
  coverage: "Coverage",
  coverageSummary: "Coverage summary",
  sources: "Sources",
  sourceSummary: "Source summary",
  caveats: "Caveats",
  excludedBuckets: "Excluded buckets",
  searchedButNoSignal: "Searched but no signal",
  runInfo: "Run info",
  evidence: "Evidence",
  failed: "Failed",
  degraded: "Degraded",
  sourceGaps: "Source gaps",
  noEvidence: "No source-bearing EvidenceLedger items were available; answer is limited to no-signal and coverage metadata.",
  noFindings: "No useful findings were recorded in the research report.",
  requiredBuckets: "required buckets",
  sourceCount: "sources",
  evidenceItemCount: "evidence items",
  coverageScore: "coverage score",
  fullReport: "Full report"
};

const LABELS: Record<string, Labels> = {
  en: EN,
  zh: {
    question: "问题",
    answer: "基于 HardFlow 证据的回答",
    coverage: "覆盖情况",
    coverageSummary: "覆盖摘要",
    sources: "主要来源",
    sourceSummary: "来源摘要",
    caveats: "注意事项",
    excludedBuckets: "排除的来源桶",
    searchedButNoSignal: "未发现有效信号的来源桶",
    runInfo: "运行信息",
    evidence: "证据",
    failed: "失败",
    degraded: "降级",
    sourceGaps: "来源缺口",
    noEvidence: "EvidenceLedger 中没有带来源的证据项；回答仅限于无信号记录和覆盖元数据。",
    noFindings: "research_report 中没有记录可用发现。",
    requiredBuckets: "必查来源桶",
    sourceCount: "来源数",
    evidenceItemCount: "证据项",
    coverageScore: "覆盖分数",
    fullReport: "完整报告"
  },
  ja: {
    question: "質問",
    answer: "HardFlow の証拠に基づく回答",
    coverage: "カバレッジ",
    coverageSummary: "カバレッジ概要",
    sources: "主なソース",
    sourceSummary: "ソース概要",
    caveats: "注意事項",
    excludedBuckets: "除外されたソースバケット",
    searchedButNoSignal: "検索したが有効なシグナルなし",
    runInfo: "実行情報",
    evidence: "証拠",
    failed: "失敗",
    degraded: "低下",
    sourceGaps: "ソースギャップ",
    noEvidence: "EvidenceLedger にソース付き証拠がないため、回答は no-signal とカバレッジ情報に限定されます。",
    noFindings: "research_report に有用な発見は記録されていません。",
    requiredBuckets: "必須バケット",
    sourceCount: "ソース数",
    evidenceItemCount: "証拠項目",
    coverageScore: "カバレッジスコア",
    fullReport: "完全なレポート"
  },
  es: {
    question: "Pregunta",
    answer: "Respuesta basada en evidencia de HardFlow",
    coverage: "Cobertura",
    coverageSummary: "Resumen de cobertura",
    sources: "Fuentes principales",
    sourceSummary: "Resumen de fuentes",
    caveats: "Advertencias",
    excludedBuckets: "Buckets excluidos",
    searchedButNoSignal: "Buckets buscados sin señal útil",
    runInfo: "Información de ejecución",
    evidence: "Evidencia",
    failed: "Falló",
    degraded: "Degradado",
    sourceGaps: "Brechas de fuentes",
    noEvidence: "No hay elementos con fuente en EvidenceLedger; la respuesta se limita a señales ausentes y metadatos de cobertura.",
    noFindings: "El research_report no registró hallazgos útiles.",
    requiredBuckets: "buckets requeridos",
    sourceCount: "fuentes",
    evidenceItemCount: "elementos de evidencia",
    coverageScore: "puntuación de cobertura",
    fullReport: "Reporte completo"
  },
  fr: { ...EN, question: "Question", answer: "Réponse basée sur les preuves HardFlow", coverage: "Couverture", sources: "Sources", caveats: "Réserves", runInfo: "Informations d'exécution" },
  de: { ...EN, question: "Frage", answer: "Antwort basierend auf HardFlow-Belegen", coverage: "Abdeckung", sources: "Quellen", caveats: "Hinweise", runInfo: "Laufinformationen" },
  pt: { ...EN, question: "Pergunta", answer: "Resposta baseada em evidências do HardFlow", coverage: "Cobertura", sources: "Fontes", caveats: "Ressalvas", runInfo: "Informações da execução" },
  ru: { ...EN, question: "Вопрос", answer: "Ответ на основе данных HardFlow", coverage: "Покрытие", sources: "Источники", caveats: "Ограничения", runInfo: "Информация о запуске" },
  ar: { ...EN, question: "السؤال", answer: "إجابة مبنية على أدلة HardFlow", coverage: "التغطية", sources: "المصادر", caveats: "تنبيهات", runInfo: "معلومات التشغيل" },
  hi: { ...EN, question: "प्रश्न", answer: "HardFlow साक्ष्य पर आधारित उत्तर", coverage: "कवरेज", sources: "स्रोत", caveats: "सावधानियां", runInfo: "रन जानकारी" },
  vi: { ...EN, question: "Câu hỏi", answer: "Câu trả lời dựa trên bằng chứng HardFlow", coverage: "Độ phủ", sources: "Nguồn", caveats: "Lưu ý", runInfo: "Thông tin chạy" },
  th: { ...EN, question: "คำถาม", answer: "คำตอบจากหลักฐาน HardFlow", coverage: "ความครอบคลุม", sources: "แหล่งข้อมูล", caveats: "ข้อควรระวัง", runInfo: "ข้อมูลการรัน" },
  it: { ...EN, question: "Domanda", answer: "Risposta basata sulle evidenze HardFlow", coverage: "Copertura", sources: "Fonti", caveats: "Avvertenze", runInfo: "Informazioni esecuzione" },
  nl: { ...EN, question: "Vraag", answer: "Antwoord op basis van HardFlow-bewijs", coverage: "Dekking", sources: "Bronnen", caveats: "Kanttekeningen", runInfo: "Run-informatie" },
  tr: { ...EN, question: "Soru", answer: "HardFlow kanıtlarına dayalı yanıt", coverage: "Kapsam", sources: "Kaynaklar", caveats: "Notlar", runInfo: "Çalıştırma bilgisi" },
  id: { ...EN, question: "Pertanyaan", answer: "Jawaban berdasarkan bukti HardFlow", coverage: "Cakupan", sources: "Sumber", caveats: "Catatan", runInfo: "Info run" }
};

export interface AnswerSynthesisOptions {
  maxSourcesInAnswer?: number;
  showAllSources?: boolean;
  showEvidenceIds?: boolean;
}

export interface AnswerSynthesisResult {
  answer: string;
  caveats: string[];
  sourceSummary: AskSourceSummary[];
  coverageSummary: AskCoverageSummary;
  outputLanguagePolicy: OutputLanguagePolicy;
}

export function labelsForLanguage(language: string): Labels {
  return LABELS[outputLanguageCode(language)] ?? EN;
}

export function buildCoverageSummary(report: ResearchReport, items: EvidenceItem[], coverage: CoverageEvalResult | null): AskCoverageSummary {
  return {
    coverageMode: report.coverageMode ?? report.source_matrix?.coverageMode,
    parallelPolicy: report.parallelPolicy,
    requiredBucketCount: report.requiredBucketCount ?? report.required_buckets.length,
    completedRequiredBucketCount: report.completedRequiredBucketCount ?? coverage?.completedRequiredBucketCount ?? 0,
    searchedButNoSignalCount: report.searchedButNoSignalCount ?? report.searched_but_no_signal.length,
    excludedBucketCount: report.excludedBucketCount ?? report.excludedBuckets?.length ?? 0,
    sourceCount: report.searched_sources_table.length,
    evidenceItemCount: items.length,
    coverageScore: coverage?.coverage_score ?? null,
    coverageClaim: coverage?.coverage_claim ?? null
  };
}

function buildSourceSummary(items: EvidenceItem[], limit: number, showEvidenceIds: boolean): AskSourceSummary[] {
  return items
    .filter((item) => !isNoSignalEvidence(item))
    .slice(0, limit)
    .map((item) => ({
      id: showEvidenceIds ? item.id : "",
      bucket: item.bucket,
      title: item.title,
      urlOrRef: item.urlOrRef,
      claim: item.claim,
      confidence: item.confidence
    }));
}

export function synthesizeResearchAnswer(
  question: string,
  report: ResearchReport,
  items: EvidenceItem[],
  coverage: CoverageEvalResult | null,
  options: AnswerSynthesisOptions = {}
): AnswerSynthesisResult {
  const policy = resolveOutputLanguagePolicy(question);
  const labels = labelsForLanguage(policy.outputLanguage);
  const supportingItems = items.filter((item) => !isNoSignalEvidence(item));
  const maxSources = options.showAllSources ? Math.max(supportingItems.length, 1) : options.maxSourcesInAnswer ?? 8;
  const findings = report.useful_findings.length > 0 ? report.useful_findings.slice(0, 8) : supportingItems.map((item) => item.claim).slice(0, 8);
  const caveats = [
    ...(report.status === "degraded" ? [`${labels.degraded}: research_report status is degraded.`] : []),
    ...(report.failure_reason ? [`${labels.failed}: ${report.failure_reason}`] : []),
    ...(report.searched_but_no_signal.length > 0 ? [`${labels.searchedButNoSignal}: ${report.searched_but_no_signal.join(", ")}`] : []),
    ...(report.excludedBuckets?.length ? [`${labels.excludedBuckets}: ${report.excludedBuckets.map((bucket) => `${bucket.bucket} (${bucket.reason})`).join(", ")}`] : []),
    ...(report.source_gaps.length > 0 ? [`${labels.sourceGaps}: ${report.source_gaps.join(", ")}`] : []),
    ...(supportingItems.length === 0 ? [labels.noEvidence] : [])
  ];
  const coverageSummary = buildCoverageSummary(report, items, coverage);
  const sourceSummary = buildSourceSummary(supportingItems, maxSources, options.showEvidenceIds === true);
  const idPrefix = (item: EvidenceItem): string => (options.showEvidenceIds ? `[${item.id}] ` : "");
  const evidenceLines =
    findings.length > 0
      ? findings.map((finding, index) => `${index + 1}. ${finding}`)
      : [labels.noFindings];
  const lines = [
    `${labels.runInfo}: runId=${report.runId}, status=${report.status}, route=research`,
    "",
    `${labels.question}: ${question}`,
    "",
    `${labels.answer}:`,
    ...evidenceLines,
    "",
    `${labels.coverage}: ${coverageSummary.coverageScore ?? "n/a"} ${labels.coverageScore}; ${coverageSummary.completedRequiredBucketCount}/${coverageSummary.requiredBucketCount} ${labels.requiredBuckets}; ${supportingItems.length} ${labels.evidenceItemCount}.`
  ];
  if (sourceSummary.length > 0) {
    lines.push(
      "",
      `${labels.sources}:`,
      ...supportingItems.slice(0, maxSources).map((item) => `- ${idPrefix(item)}${item.title} (${item.bucket}) ${item.urlOrRef}`)
    );
    if (!options.showAllSources && supportingItems.length > maxSources) {
      lines.push(`- ... ${supportingItems.length - maxSources} more; use --show-all-sources for the full list.`);
    }
  }
  if (caveats.length > 0) {
    lines.push("", `${labels.caveats}:`, ...caveats.map((caveat) => `- ${caveat}`));
  }
  lines.push("", `${labels.fullReport}: ${report.runId}`);
  return {
    answer: lines.join("\n"),
    caveats,
    sourceSummary,
    coverageSummary,
    outputLanguagePolicy: policy
  };
}
