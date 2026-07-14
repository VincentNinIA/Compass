import { readFileSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";

const root = process.cwd();

function fail(message) {
  throw new Error(message);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function frontmatterArray(markdown, field, file) {
  const match = markdown.match(new RegExp(`^${field}: (\\[.*\\])$`, "m"));
  if (!match) fail(`${file}: missing ${field}`);
  try {
    return JSON.parse(match[1]);
  } catch {
    fail(`${file}: ${field} must be a JSON-compatible array`);
  }
}

const cardsRoot = join(root, "docs", "tranches");
const cardFiles = walk(cardsRoot)
  .filter((file) => file.includes(`${join("cards", "")}`) && file.endsWith(".md"))
  .sort();

if (cardFiles.length !== 49) {
  fail(`expected 49 card files, found ${cardFiles.length}`);
}

const references = readFileSync(join(root, "docs", "REFERENCES.md"), "utf8");
const ids = new Set();
const cards = [];

for (const absoluteFile of cardFiles) {
  const file = relative(root, absoluteFile);
  const markdown = readFileSync(absoluteFile, "utf8");
  const id = markdown.match(/^id: (T\d-C\d{2})$/m)?.[1];
  if (!id) fail(`${file}: missing or malformed id`);
  if (basename(file, ".md") !== id) fail(`${file}: filename does not match id ${id}`);
  if (ids.has(id)) fail(`${file}: duplicate id ${id}`);
  ids.add(id);

  const status = markdown.match(/^status: (\w+)$/m)?.[1];
  if (
    !status ||
    !["backlog", "ready", "active", "in_progress", "blocked", "done"].includes(
      status,
    )
  ) {
    fail(`${file}: invalid status ${status ?? "missing"}`);
  }

  for (let section = 1; section <= 14; section += 1) {
    if (!new RegExp(`^## ${section}\\. `, "m").test(markdown)) {
      fail(`${file}: missing section ${section}`);
    }
  }

  const dependencies = frontmatterArray(markdown, "depends_on", file);
  const sourceRefs = frontmatterArray(markdown, "source_refs", file);
  for (const sourceRef of sourceRefs) {
    if (!new RegExp(`\\| ${sourceRef.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")} \\|`).test(references)) {
      fail(`${file}: unknown source reference ${sourceRef}`);
    }
  }
  cards.push({ file, id, dependencies });
}

for (const card of cards) {
  for (const dependency of card.dependencies) {
    if (!ids.has(dependency)) fail(`${card.file}: unknown dependency ${dependency}`);
    if (dependency === card.id) fail(`${card.file}: self dependency ${dependency}`);
  }
}

for (const pilot of [
  "agents/SPEC.md",
  "agents/CONTRACT.md",
  "agents/DECISIONS.md",
  "agents/TODO_NEXT.md",
  "docs/ARCHITECTURE.md",
  "docs/ROADMAP.md",
]) {
  readFileSync(join(root, pilot), "utf8");
}

console.log(
  `T0 documentation validation passed: ${cardFiles.length} cards, unique IDs, valid dependencies, source references and 14 sections.`,
);
