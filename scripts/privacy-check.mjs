import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { spawnSync } from "node:child_process";

const includeHistory = process.argv.includes("--history");

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout;
}

const sensitivePathRules = [
  { name: "environment file", test: path => /(^|\/)\.env(?:\.|$)/i.test(path) && !/(^|\/)\.env\.example$/i.test(path) },
  { name: "local secret file", test: path => /(^|\/)\.dev\.vars(?:\.|$)/i.test(path) },
  { name: "private data directory", test: path => /(^|\/)(?:private|imports?|exports?|character[-_ ]?cards?|role[-_ ]?cards?)(\/|$)/i.test(path) },
  { name: "database file", test: path => /\.(?:sqlite3?|db)(?:-(?:wal|shm))?$/i.test(path) },
  { name: "character-card export", test: path => /\.(?:card|character)\.(?:json|ya?ml)$/i.test(path) },
  { name: "credential/private key", test: path => /(^|\/)(?:credentials?|secrets?)(?:\.|\/|$)|\.(?:pem|key|p12|pfx)$/i.test(path) },
];

const secretRules = [
  ["OpenAI-style API key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["hard-coded API credential", /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key)\b\s*[:=]\s*["'](?!\s*(?:example|sample|fake|test|placeholder|replace|your[-_]|))[A-Za-z0-9_./+=-]{16,}["']/gi],
];

const cardSignatures = [
  /["']spec["']\s*:\s*["']chara_card_v[23]["']/i,
  /\bspec\s*:\s*chara_card_v[23]\b/i,
];

const findings = [];
const checked = new Set();

function inspectPath(path, source, contentProvider) {
  const normalized = path.replaceAll("\\", "/");
  for (const rule of sensitivePathRules) {
    if (rule.test(normalized)) findings.push({ source, path: normalized, rule: rule.name });
  }

  const key = `${source}\0${normalized}`;
  if (checked.has(key)) return;
  checked.add(key);

  let content;
  try { content = contentProvider(); } catch { return; }
  if (content.includes("\0")) return;
  for (const [name, pattern] of secretRules) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push({ source, path: normalized, rule: name });
  }
  if ([".json", ".yaml", ".yml"].includes(extname(normalized).toLowerCase()) && cardSignatures.some(pattern => pattern.test(content))) {
    findings.push({ source, path: normalized, rule: "character-card content" });
  }
}

for (const path of git(["ls-files", "-z"]).split("\0").filter(Boolean)) {
  inspectPath(path, "Git index", () => git(["show", `:${path}`]));
  inspectPath(path, "working tree", () => readFileSync(path, "utf8"));
}

if (includeHistory) {
  for (const revision of git(["rev-list", "--all"]).split(/\r?\n/).filter(Boolean)) {
    const source = `commit ${revision.slice(0, 12)}`;
    for (const path of git(["ls-tree", "-r", "--name-only", "-z", revision]).split("\0").filter(Boolean)) {
      inspectPath(path, source, () => git(["show", `${revision}:${path}`]));
    }
  }
}

const unique = [...new Map(findings.map(item => [`${item.source}\0${item.path}\0${item.rule}`, item])).values()];
if (unique.length) {
  console.error("Privacy check failed. Suspected private data was not printed; only its location is shown:");
  for (const item of unique) console.error(`- ${item.source}: ${item.path} (${item.rule})`);
  console.error("Remove the file or value from Git before pushing. If it was already committed, rotate the credential before rewriting history.");
  process.exit(1);
}

console.log(`Privacy check passed for tracked files${includeHistory ? " and repository history" : ""}.`);
