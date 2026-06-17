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
  routingFailed: string;
  details: string;
  jobNotFound: string;
  jobNotComplete: string;
  degraded: string;
  sourceGaps: string;
  noEvidence: string;
  noFindings: string;
  requiredBuckets: string;
  sourceCount: string;
  evidenceItemCount: string;
  coverageScore: string;
  fullReport: string;
  moreSources: string;
  totalEvidenceCoverage: string;
  synthesisProviderUnavailable: string;
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
  routingFailed: "Routing failed",
  details: "Details",
  jobNotFound: "HardFlow job not found",
  jobNotComplete: "HardFlow job is not complete",
  degraded: "Degraded",
  sourceGaps: "Source gaps",
  noEvidence: "No source-bearing EvidenceLedger items were available; answer is limited to no-signal and coverage metadata.",
  noFindings: "No useful findings were recorded in the research report.",
  requiredBuckets: "required buckets",
  sourceCount: "sources",
  evidenceItemCount: "evidence items",
  coverageScore: "coverage score",
  fullReport: "Full report",
  moreSources: "more sources; use --show-all-sources for the full list",
  totalEvidenceCoverage: "Total evidence",
  synthesisProviderUnavailable: "Answer synthesis provider unavailable; showing evidence summary."
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
    routingFailed: "路由失败",
    details: "详情",
    jobNotFound: "未找到 HardFlow job",
    jobNotComplete: "HardFlow job 尚未完成",
    degraded: "降级",
    sourceGaps: "来源缺口",
    noEvidence: "EvidenceLedger 中没有带来源的证据项；回答仅限于无信号记录和覆盖元数据。",
    noFindings: "research_report 中没有记录可用发现。",
    requiredBuckets: "必查来源桶",
    sourceCount: "来源数",
    evidenceItemCount: "证据项",
    coverageScore: "覆盖分数",
    fullReport: "完整报告",
    moreSources: "个更多来源；使用 --show-all-sources 查看完整列表",
    totalEvidenceCoverage: "证据覆盖",
    synthesisProviderUnavailable: "答案合成 provider 不可用；当前显示证据摘要。"
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
    routingFailed: "ルーティング失敗",
    details: "詳細",
    jobNotFound: "HardFlow job が見つかりません",
    jobNotComplete: "HardFlow job はまだ完了していません",
    degraded: "低下",
    sourceGaps: "ソースギャップ",
    noEvidence: "EvidenceLedger にソース付き証拠がないため、回答は no-signal とカバレッジ情報に限定されます。",
    noFindings: "research_report に有用な発見は記録されていません。",
    requiredBuckets: "必須バケット",
    sourceCount: "ソース数",
    evidenceItemCount: "証拠項目",
    coverageScore: "カバレッジスコア",
    fullReport: "完全なレポート",
    moreSources: "件の追加ソース。完全な一覧は --show-all-sources を使用",
    totalEvidenceCoverage: "証拠カバレッジ",
    synthesisProviderUnavailable: "回答合成 provider を利用できないため、証拠概要を表示します。"
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
    routingFailed: "Falló el enrutamiento",
    details: "Detalles",
    jobNotFound: "No se encontró el job de HardFlow",
    jobNotComplete: "El job de HardFlow no está completo",
    degraded: "Degradado",
    sourceGaps: "Brechas de fuentes",
    noEvidence: "No hay elementos con fuente en EvidenceLedger; la respuesta se limita a señales ausentes y metadatos de cobertura.",
    noFindings: "El research_report no registró hallazgos útiles.",
    requiredBuckets: "buckets requeridos",
    sourceCount: "fuentes",
    evidenceItemCount: "elementos de evidencia",
    coverageScore: "puntuación de cobertura",
    fullReport: "Reporte completo",
    moreSources: "fuentes más; usa --show-all-sources para ver la lista completa",
    totalEvidenceCoverage: "Cobertura de evidencia",
    synthesisProviderUnavailable: "El proveedor de síntesis no está disponible; se muestra un resumen de evidencia."
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
  rawEvidenceSummary?: boolean;
  answerBody?: string;
  synthesisWarning?: string | null;
  fullReportPath?: string;
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

const BUCKET_PRIORITY: Record<string, number> = {
  official_docs: 0,
  academic: 1,
  security: 2,
  github: 3,
  package_registry: 4,
  blogs_engineering: 5,
  competitors: 6,
  codex_default_discovery: 7,
  local_repo: 8,
  community: 9
};

function confidenceRank(value: string): number {
  if (/high/i.test(value)) return 0;
  if (/medium/i.test(value)) return 1;
  if (/low/i.test(value)) return 2;
  return 3;
}

function buildSourceSummary(items: EvidenceItem[], limit: number, showEvidenceIds: boolean): AskSourceSummary[] {
  const seen = new Set<string>();
  return [...items]
    .filter((item) => !isNoSignalEvidence(item))
    .sort((a, b) => {
      const bucketDelta = (BUCKET_PRIORITY[a.bucket] ?? 50) - (BUCKET_PRIORITY[b.bucket] ?? 50);
      if (bucketDelta !== 0) return bucketDelta;
      const confidenceDelta = confidenceRank(a.confidence) - confidenceRank(b.confidence);
      if (confidenceDelta !== 0) return confidenceDelta;
      return a.title.localeCompare(b.title);
    })
    .filter((item) => {
      const key = `${item.bucket}|${item.urlOrRef || item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
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

function bucketList(items: EvidenceItem[]): string {
  return Array.from(new Set(items.filter((item) => !isNoSignalEvidence(item)).map((item) => item.bucket)))
    .sort((a, b) => (BUCKET_PRIORITY[a] ?? 50) - (BUCKET_PRIORITY[b] ?? 50))
    .join(", ");
}

function fallbackAnswerBody(labels: Labels, policy: OutputLanguagePolicy, coverageSummary: AskCoverageSummary, supportingItems: EvidenceItem[]): string {
  const buckets = bucketList(supportingItems) || "n/a";
  const code = outputLanguageCode(policy.outputLanguage);
  if (code === "zh") {
    return [
      `本次 HardFlow 研究收集了 ${coverageSummary.evidenceItemCount} 条证据，覆盖 ${coverageSummary.completedRequiredBucketCount}/${coverageSummary.requiredBucketCount} 个必查来源桶。`,
      `证据主要来自这些来源桶：${buckets}。`,
      "下面的回答是基于已收集证据做出的保守摘要；产品名、论文名、API 名和 URL 保持原文。"
    ].join("\n");
  }
  if (code === "ja") {
    return [
      `今回の HardFlow 研究では ${coverageSummary.evidenceItemCount} 件の証拠を収集し、必須ソースバケット ${coverageSummary.completedRequiredBucketCount}/${coverageSummary.requiredBucketCount} 件をカバーしました。`,
      `主な証拠バケット: ${buckets}.`,
      "以下は収集済み証拠に基づく保守的な要約です。製品名、論文名、API 名、URL は原文のままです。"
    ].join("\n");
  }
  if (code === "es") {
    return [
      `HardFlow reunió ${coverageSummary.evidenceItemCount} elementos de evidencia y cubrió ${coverageSummary.completedRequiredBucketCount}/${coverageSummary.requiredBucketCount} buckets requeridos.`,
      `Los buckets principales son: ${buckets}.`,
      "La respuesta siguiente es un resumen conservador basado en la evidencia recopilada; nombres de productos, papers, APIs y URLs se mantienen sin traducir."
    ].join("\n");
  }
  return [
    `HardFlow collected ${coverageSummary.evidenceItemCount} evidence items and covered ${coverageSummary.completedRequiredBucketCount}/${coverageSummary.requiredBucketCount} required buckets.`,
    `The main evidence buckets are: ${buckets}.`,
    "The answer below is a conservative synthesis from collected evidence; product names, paper titles, API names, and URLs are left unchanged."
  ].join("\n");
}

function formatSourceLines(sourceSummary: AskSourceSummary[], showEvidenceIds: boolean): string[] {
  const lines: string[] = [];
  let currentBucket = "";
  for (const item of sourceSummary) {
    if (item.bucket !== currentBucket) {
      currentBucket = item.bucket;
      lines.push(`${currentBucket}:`);
    }
    const id = showEvidenceIds && item.id ? `[${item.id}] ` : "";
    lines.push(`- ${id}${item.title} ${item.urlOrRef}`);
  }
  return lines;
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
  const caveats = [
    ...(options.synthesisWarning ? [`${labels.synthesisProviderUnavailable} ${options.synthesisWarning}`] : []),
    ...(report.status === "degraded" ? [`${labels.degraded}: research_report status is degraded.`] : []),
    ...(report.failure_reason ? [`${labels.failed}: ${report.failure_reason}`] : []),
    ...(report.searched_but_no_signal.length > 0 ? [`${labels.searchedButNoSignal}: ${report.searched_but_no_signal.join(", ")}`] : []),
    ...(report.excludedBuckets?.length ? [`${labels.excludedBuckets}: ${report.excludedBuckets.map((bucket) => `${bucket.bucket} (${bucket.reason})`).join(", ")}`] : []),
    ...(report.source_gaps.length > 0 ? [`${labels.sourceGaps}: ${report.source_gaps.join(", ")}`] : []),
    ...(supportingItems.length === 0 ? [labels.noEvidence] : [])
  ];
  const coverageSummary = buildCoverageSummary(report, items, coverage);
  const sourceSummary = buildSourceSummary(supportingItems, maxSources, options.showEvidenceIds === true);
  const answerBody = options.answerBody?.trim() || fallbackAnswerBody(labels, policy, coverageSummary, supportingItems);
  const lines = [
    `${labels.runInfo}: runId=${report.runId}, status=${report.status}, route=research`,
    "",
    `${labels.question}: ${question}`,
    "",
    `${labels.answer}:`,
    answerBody,
    "",
    `${labels.coverage}: ${coverageSummary.coverageScore ?? "n/a"} ${labels.coverageScore}; ${coverageSummary.completedRequiredBucketCount}/${coverageSummary.requiredBucketCount} ${labels.requiredBuckets}; ${supportingItems.length} ${labels.evidenceItemCount}.`
  ];
  if (outputLanguageCode(policy.outputLanguage) === "zh") {
    lines.push(`${labels.totalEvidenceCoverage}: 共 ${coverageSummary.evidenceItemCount} 条证据，覆盖 ${coverageSummary.completedRequiredBucketCount}/${coverageSummary.requiredBucketCount} 个来源桶。`);
  }
  if (sourceSummary.length > 0) {
    lines.push(
      "",
      `${labels.sources}:`,
      ...formatSourceLines(sourceSummary, options.showEvidenceIds === true)
    );
    if (!options.showAllSources && supportingItems.length > maxSources) {
      const hiddenCount = supportingItems.length - maxSources;
      lines.push(outputLanguageCode(policy.outputLanguage) === "zh" ? `- ... ${hiddenCount}${labels.moreSources}` : `- ... ${hiddenCount} ${labels.moreSources}.`);
    }
  }
  if (options.rawEvidenceSummary && supportingItems.length > 0) {
    lines.push("", `${labels.evidence}:`, ...supportingItems.slice(0, maxSources).map((item) => `- ${item.claim}`));
  }
  if (caveats.length > 0) {
    lines.push("", `${labels.caveats}:`, ...caveats.map((caveat) => `- ${caveat}`));
  }
  lines.push("", `${labels.fullReport}: ${options.fullReportPath ?? report.runId}`);
  return {
    answer: lines.join("\n"),
    caveats,
    sourceSummary,
    coverageSummary,
    outputLanguagePolicy: policy
  };
}
