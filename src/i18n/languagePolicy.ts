export interface OutputLanguagePolicy {
  requestedLanguage: string | null;
  detectedUserLanguage: string;
  outputLanguage: string;
  confidence: number;
  reason: string;
}

interface LanguageSpec {
  code: string;
  name: string;
  explicit: RegExp[];
  script?: RegExp;
  words?: RegExp[];
}

const LANGUAGE_SPECS: LanguageSpec[] = [
  { code: "zh", name: "Chinese", explicit: [/中文回答/i, /用中文/i, /以中文/i, /请用中文/i, /answer in chinese/i, /in chinese/i, /to chinese/i], script: /[\u3400-\u9fff]/g },
  { code: "en", name: "English", explicit: [/answer in english/i, /in english/i, /english answer/i], words: [/\b(the|and|for|with|what|how|current|solution|answer)\b/gi] },
  { code: "ja", name: "Japanese", explicit: [/日本語で/i, /日本語/i], script: /[\u3040-\u30ff]/g },
  { code: "ko", name: "Korean", explicit: [/한국어로/i, /한국어/i], script: /[\uac00-\ud7af]/g },
  { code: "es", name: "Spanish", explicit: [/responde en español/i, /en español/i, /español/i], words: [/[¿¡ñáéíóú]/gi, /\b(el|la|los|las|que|para|soluci[oó]n|actual)\b/gi] },
  { code: "fr", name: "French", explicit: [/en français/i, /réponds en français/i, /français/i], words: [/[àâçéèêëîïôûùüÿœ]/gi, /\b(le|la|les|des|pour|avec|réponse)\b/gi] },
  { code: "de", name: "German", explicit: [/auf deutsch/i, /in deutsch/i, /answer in german/i], words: [/[äöüß]/gi, /\b(der|die|das|und|mit|für|antwort)\b/gi] },
  { code: "pt", name: "Portuguese", explicit: [/em português/i, /português/i], words: [/[ãõçáéíóú]/gi, /\b(para|com|não|solução|resposta)\b/gi] },
  { code: "ru", name: "Russian", explicit: [/по-русски/i, /на русском/i, /answer in russian/i], script: /[\u0400-\u04ff]/g },
  { code: "ar", name: "Arabic", explicit: [/بالعربية/i, /answer in arabic/i], script: /[\u0600-\u06ff]/g },
  { code: "hi", name: "Hindi", explicit: [/हिंदी में/i, /answer in hindi/i], script: /[\u0900-\u097f]/g },
  { code: "vi", name: "Vietnamese", explicit: [/tiếng việt/i, /answer in vietnamese/i], words: [/[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/gi] },
  { code: "th", name: "Thai", explicit: [/ภาษาไทย/i, /answer in thai/i], script: /[\u0e00-\u0e7f]/g },
  { code: "it", name: "Italian", explicit: [/in italiano/i, /answer in italian/i], words: [/\b(il|la|gli|che|per|con|risposta|soluzione)\b/gi] },
  { code: "nl", name: "Dutch", explicit: [/in het nederlands/i, /answer in dutch/i], words: [/\b(de|het|een|voor|met|antwoord|oplossing)\b/gi] },
  { code: "tr", name: "Turkish", explicit: [/türkçe/i, /answer in turkish/i], words: [/[çğıöşü]/gi, /\b(ve|için|ile|cevap|çözüm)\b/gi] },
  { code: "id", name: "Indonesian", explicit: [/bahasa indonesia/i, /answer in indonesian/i], words: [/\b(yang|untuk|dengan|jawaban|solusi)\b/gi] }
];

function countMatches(pattern: RegExp, text: string): number {
  const matches = text.match(pattern);
  return matches?.length ?? 0;
}

function explicitLanguage(text: string): LanguageSpec | undefined {
  return LANGUAGE_SPECS.find((spec) => spec.explicit.some((pattern) => pattern.test(text)));
}

function scoreLanguage(spec: LanguageSpec, text: string): number {
  let score = 0;
  if (spec.script) score += countMatches(spec.script, text) * 3;
  for (const pattern of spec.words ?? []) score += countMatches(pattern, text);
  return score;
}

function dominantLanguageScore(text: string): { spec: LanguageSpec; score: number; confidence: number } {
  const scores = LANGUAGE_SPECS.map((spec) => ({ spec, score: scoreLanguage(spec, text) })).sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  if (best && best.score > 0) {
    const margin = second ? best.score - second.score : best.score;
    const confidence = Math.max(0.45, Math.min(0.98, 0.55 + margin / Math.max(best.score + (second?.score ?? 0), 1)));
    return { spec: best.spec, score: best.score, confidence };
  }
  if (/^[\x00-\x7f\s\p{P}\p{N}]+$/u.test(text)) {
    return { spec: LANGUAGE_SPECS.find((spec) => spec.code === "en") ?? LANGUAGE_SPECS[1], score: 1, confidence: 0.55 };
  }
  return { spec: { code: "same_as_user", name: "same_as_user", explicit: [] }, score: 0, confidence: 0.35 };
}

function dominantLanguage(text: string): LanguageSpec {
  return dominantLanguageScore(text).spec;
}

function lastSentence(text: string): string {
  const parts = text
    .split(/[\n。！？!?]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? text;
}

export function resolveOutputLanguagePolicy(prompt: string): OutputLanguagePolicy {
  const explicit = explicitLanguage(prompt);
  const detectedScore = dominantLanguageScore(prompt);
  const detected = detectedScore.spec;
  if (explicit) {
    return {
      requestedLanguage: explicit.name,
      detectedUserLanguage: detected.name,
      outputLanguage: explicit.name,
      confidence: 0.99,
      reason: "User explicitly requested the answer language."
    };
  }
  const fullScore = scoreLanguage(detected, prompt);
  const last = dominantLanguage(lastSentence(prompt));
  const lastScore = scoreLanguage(last, lastSentence(prompt));
  const chosen = fullScore > 0 && fullScore >= lastScore ? detected : last;
  return {
    requestedLanguage: null,
    detectedUserLanguage: chosen.name,
    outputLanguage: chosen.name,
    confidence: chosen.code === detected.code ? detectedScore.confidence : 0.62,
    reason: "No explicit language was requested; using the dominant user prompt language."
  };
}

export function outputLanguageCode(language: string): string {
  return LANGUAGE_SPECS.find((spec) => spec.name === language || spec.code === language)?.code ?? "same_as_user";
}

export function languageInstruction(policy: OutputLanguagePolicy): string {
  return `Answer in ${policy.outputLanguage} unless the user explicitly asked otherwise. Localize headings and explanations. Keep source titles, URLs, evidence IDs, product names, paper titles, package names, and API names unchanged.`;
}
