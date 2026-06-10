import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { researchRunEvidenceLedgerPath } from "../paths.js";
import type { ResearchSource } from "../schemas.js";
import type { CoveragePlan } from "./coveragePlan.js";

export interface EvidenceItem {
  id: string;
  runId: string;
  bucket: string;
  engine: string;
  query: string;
  sourceType: string;
  title: string;
  urlOrRef: string;
  dateOrVersion: string;
  claim: string;
  confidence: "high" | "medium" | "low";
  retrievedAt: string;
  perspectiveId: string | null;
  researchQuestionId: string | null;
}

export interface EvidenceLedger {
  runId: string;
  updatedAt: string;
  items: EvidenceItem[];
}

export interface AddEvidenceInput extends Partial<Pick<EvidenceItem, "id" | "retrievedAt" | "perspectiveId" | "researchQuestionId">> {
  runId: string;
  bucket: string;
  engine: string;
  query: string;
  sourceType: string;
  title: string;
  urlOrRef: string;
  dateOrVersion: string;
  claim: string;
  confidence?: EvidenceItem["confidence"];
}

function hashEvidence(value: Omit<EvidenceItem, "id">): string {
  return createHash("sha256")
    .update([value.runId, value.bucket, value.engine, value.query, value.sourceType, value.title, value.urlOrRef, value.claim].join("\u0000"))
    .digest("hex")
    .slice(0, 20);
}

function ledgerPath(cwd: string, runId: string): string {
  return researchRunEvidenceLedgerPath(cwd, runId);
}

export function loadEvidenceLedger(cwd: string, runId: string): EvidenceLedger {
  const target = ledgerPath(cwd, runId);
  if (!existsSync(target)) return { runId, updatedAt: new Date().toISOString(), items: [] };
  const parsed = JSON.parse(readFileSync(target, "utf8")) as EvidenceLedger;
  return {
    runId: parsed.runId || runId,
    updatedAt: parsed.updatedAt || new Date().toISOString(),
    items: Array.isArray(parsed.items) ? parsed.items : []
  };
}

export function writeEvidenceLedger(cwd: string, ledger: EvidenceLedger): EvidenceLedger {
  const target = ledgerPath(cwd, ledger.runId);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger;
}

export function addEvidence(cwd: string, input: AddEvidenceInput): EvidenceItem {
  const retrievedAt = input.retrievedAt ?? new Date().toISOString();
  const withoutId: Omit<EvidenceItem, "id"> = {
    runId: input.runId,
    bucket: input.bucket,
    engine: input.engine,
    query: input.query,
    sourceType: input.sourceType,
    title: input.title,
    urlOrRef: input.urlOrRef,
    dateOrVersion: input.dateOrVersion,
    claim: input.claim,
    confidence: input.confidence ?? "medium",
    retrievedAt,
    perspectiveId: input.perspectiveId ?? null,
    researchQuestionId: input.researchQuestionId ?? null
  };
  const item: EvidenceItem = {
    id: input.id ?? `ev-${hashEvidence(withoutId)}`,
    ...withoutId
  };
  const ledger = loadEvidenceLedger(cwd, input.runId);
  const existingIndex = ledger.items.findIndex((candidate) => candidate.id === item.id);
  if (existingIndex >= 0) ledger.items[existingIndex] = item;
  else ledger.items.push(item);
  ledger.updatedAt = retrievedAt;
  writeEvidenceLedger(cwd, ledger);
  return item;
}

export function listEvidence(cwd: string, runId: string): EvidenceItem[] {
  return loadEvidenceLedger(cwd, runId).items;
}

export function evidenceByBucket(cwd: string, runId: string, bucket: string): EvidenceItem[] {
  return listEvidence(cwd, runId).filter((item) => item.bucket === bucket);
}

export function evidenceByQuestion(cwd: string, runId: string, researchQuestionId: string): EvidenceItem[] {
  return listEvidence(cwd, runId).filter((item) => item.researchQuestionId === researchQuestionId);
}

export function evidenceByPerspective(cwd: string, runId: string, perspectiveId: string): EvidenceItem[] {
  return listEvidence(cwd, runId).filter((item) => item.perspectiveId === perspectiveId);
}

export function isNoSignalEvidence(item: EvidenceItem): boolean {
  return item.sourceType === "searched_but_no_signal" || item.urlOrRef.startsWith("no-signal:");
}

export function hasEvidenceForRequiredBuckets(
  plan: CoveragePlan,
  items: EvidenceItem[]
): { passed: boolean; missingBuckets: string[]; coveredBuckets: string[] } {
  const requiredBuckets = plan.sourceBuckets.filter((bucket) => bucket.required).map((bucket) => bucket.bucket);
  const covered = new Set(items.map((item) => item.bucket));
  const missingBuckets = requiredBuckets.filter((bucket) => !covered.has(bucket));
  return {
    passed: missingBuckets.length === 0,
    missingBuckets,
    coveredBuckets: requiredBuckets.filter((bucket) => covered.has(bucket))
  };
}

export function toResearchSourcesForReport(items: EvidenceItem[]): ResearchSource[] {
  return items
    .filter((item) => !isNoSignalEvidence(item))
    .map((item) => ({
      bucket: item.bucket,
      title: item.title,
      source_type: item.sourceType,
      url_or_ref: item.urlOrRef,
      date_or_version: item.dateOrVersion,
      claim: item.claim,
      confidence: item.confidence,
      notes: `EvidenceLedger item ${item.id} via ${item.engine}.`
    }));
}

export function researchQuestionForBucket(plan: CoveragePlan | undefined, bucket: string): string | null {
  return plan?.researchQuestions.find((question) => question.bucket === bucket)?.id ?? null;
}

export function perspectiveForBucket(plan: CoveragePlan | undefined, bucket: string): string | null {
  const question = plan?.researchQuestions.find((candidate) => candidate.bucket === bucket);
  if (question?.perspectiveId) return question.perspectiveId;
  return plan?.perspectives.find((perspective) => perspective.id === "primary_answer")?.id ?? null;
}
