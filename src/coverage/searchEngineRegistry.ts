export type SearchEngineRiskLevel = "low" | "medium" | "high";

export interface SearchEngineManifest {
  name: string;
  bucket: string;
  description: string;
  available: boolean;
  deterministic: boolean;
  requiresNetwork: boolean;
  expectedOutputSchema: string;
  defaultLimit: number;
  riskLevel: SearchEngineRiskLevel;
}

const SOURCE_SCHEMA = "ResearchSource[] or searched_but_no_signal record";

export const SEARCH_ENGINE_REGISTRY: SearchEngineManifest[] = [
  {
    name: "local_files",
    bucket: "local_repo",
    description: "Read local repository files selected by path, extension, or manifest.",
    available: true,
    deterministic: true,
    requiresNetwork: false,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 20,
    riskLevel: "low"
  },
  {
    name: "rg",
    bucket: "local_repo",
    description: "Search local repository text with ripgrep.",
    available: true,
    deterministic: true,
    requiresNetwork: false,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 30,
    riskLevel: "low"
  },
  {
    name: "package_files",
    bucket: "local_repo",
    description: "Inspect package manifests, lockfiles, and project metadata.",
    available: true,
    deterministic: true,
    requiresNetwork: false,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 10,
    riskLevel: "low"
  },
  {
    name: "web_official_docs",
    bucket: "official_docs",
    description: "Search official product, framework, API, and vendor documentation.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "vendor_docs",
    bucket: "official_docs",
    description: "Search vendor docs, changelogs, release notes, and support pages.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "github_repos",
    bucket: "github",
    description: "Search GitHub repositories, READMEs, examples, and code references.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "github_issues",
    bucket: "github",
    description: "Search GitHub issues and maintainer responses.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "github_discussions",
    bucket: "github",
    description: "Search GitHub discussions and Q&A threads.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 6,
    riskLevel: "medium"
  },
  {
    name: "arxiv",
    bucket: "academic",
    description: "Search arXiv papers and preprints.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 6,
    riskLevel: "medium"
  },
  {
    name: "semantic_scholar",
    bucket: "academic",
    description: "Search Semantic Scholar metadata and related work.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 6,
    riskLevel: "medium"
  },
  {
    name: "openalex",
    bucket: "academic",
    description: "Search OpenAlex scholarly metadata.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 6,
    riskLevel: "medium"
  },
  {
    name: "google_scholar_if_available",
    bucket: "academic",
    description: "Use Google Scholar only when an approved integration is available.",
    available: false,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 5,
    riskLevel: "high"
  },
  {
    name: "npm",
    bucket: "package_registry",
    description: "Search npm package metadata, versions, and release notes.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "pypi",
    bucket: "package_registry",
    description: "Search PyPI package metadata, versions, and release notes.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "crates",
    bucket: "package_registry",
    description: "Search crates.io package metadata.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "maven",
    bucket: "package_registry",
    description: "Search Maven package metadata.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "go_packages",
    bucket: "package_registry",
    description: "Search Go package metadata and module docs.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "nvd",
    bucket: "security",
    description: "Search NVD CVE records.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "github_security_advisories",
    bucket: "security",
    description: "Search GitHub Security Advisories.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "snyk",
    bucket: "security",
    description: "Search Snyk vulnerability records.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "vendor_advisories",
    bucket: "security",
    description: "Search vendor security advisories and incident notes.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "reddit",
    bucket: "community",
    description: "Search Reddit discussions and user reports.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 6,
    riskLevel: "high"
  },
  {
    name: "stackoverflow",
    bucket: "community",
    description: "Search Stack Overflow questions and accepted answers.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 6,
    riskLevel: "medium"
  },
  {
    name: "hacker_news",
    bucket: "community",
    description: "Search Hacker News discussions and launch feedback.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 6,
    riskLevel: "high"
  },
  {
    name: "forums",
    bucket: "community",
    description: "Search project, product, and vendor forums.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 6,
    riskLevel: "high"
  },
  {
    name: "web_engineering_blogs",
    bucket: "blogs_engineering",
    description: "Search engineering blogs, postmortems, and implementation writeups.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 8,
    riskLevel: "medium"
  },
  {
    name: "competitor_official_docs",
    bucket: "competitors",
    description: "Search product/vendor docs and official product pages for comparable systems.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 5,
    riskLevel: "medium"
  },
  {
    name: "competitor_github",
    bucket: "competitors",
    description: "Search GitHub repos and open-source project pages for comparable systems.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 5,
    riskLevel: "medium"
  },
  {
    name: "competitor_engineering_blogs",
    bucket: "competitors",
    description: "Search engineering blogs, launch posts, changelogs, and product architecture posts.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 5,
    riskLevel: "medium"
  },
  {
    name: "competitor_product_docs",
    bucket: "competitors",
    description: "Search product documentation for commercial coding-agent and multi-agent systems.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 5,
    riskLevel: "medium"
  },
  {
    name: "default_web_search",
    bucket: "codex_default_discovery",
    description: "Run default web discovery without bucket-specific constraints.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 10,
    riskLevel: "medium"
  },
  {
    name: "default_codex_search",
    bucket: "codex_default_discovery",
    description: "Record Codex default discovery coverage and missed buckets.",
    available: true,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 10,
    riskLevel: "medium"
  },
  {
    name: "private_connector_search",
    bucket: "private_connectors",
    description: "Search explicitly requested private/internal connectors only when a safe connector is configured.",
    available: false,
    deterministic: false,
    requiresNetwork: true,
    expectedOutputSchema: SOURCE_SCHEMA,
    defaultLimit: 5,
    riskLevel: "high"
  }
];

export function listSearchEngines(): SearchEngineManifest[] {
  return SEARCH_ENGINE_REGISTRY.map((engine) => ({ ...engine }));
}

export function searchEnginesForBucket(bucket: string): SearchEngineManifest[] {
  return listSearchEngines().filter((engine) => engine.bucket === bucket);
}

export function searchEngineNamesForBucket(bucket: string): string[] {
  return searchEnginesForBucket(bucket).map((engine) => engine.name);
}
