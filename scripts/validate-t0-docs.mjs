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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const cardsRoot = join(root, "docs", "tranches");
const cardFiles = walk(cardsRoot)
  .filter((file) => file.includes(`${join("cards", "")}`) && file.endsWith(".md"))
  .sort();

const references = readFileSync(join(root, "docs", "REFERENCES.md"), "utf8");
const roadmap = readFileSync(join(root, "docs", "ROADMAP.md"), "utf8");
const registry = roadmap.match(
  /## Registre des cartes([\s\S]*?)(?=\n## Matrice de traçabilité PRD)/,
)?.[1];
if (!registry) fail("docs/ROADMAP.md: missing card registry");

const registryRows = [
  ...registry.matchAll(/^\| (T\d+-C\d{2}) \| ([^|]+) \| ([^|]+) \|/gm),
];
const roadmapIds = new Set(registryRows.map((match) => match[1]));
if (roadmapIds.size !== registryRows.length) {
  fail("docs/ROADMAP.md: duplicate card ID in registry");
}
if (cardFiles.length !== roadmapIds.size) {
  fail(
    `card file/roadmap mismatch: ${cardFiles.length} files, ${roadmapIds.size} registry rows`,
  );
}

const ids = new Set();
const cards = [];

for (const absoluteFile of cardFiles) {
  const file = relative(root, absoluteFile);
  const markdown = readFileSync(absoluteFile, "utf8");
  const structured = markdown.startsWith("---\n");
  const id =
    markdown.match(/^id: (T\d+-C\d{2})$/m)?.[1] ??
    markdown.match(/^# (T\d+-C\d{2})\b/m)?.[1];
  if (!id) fail(`${file}: missing or malformed id`);
  if (basename(file, ".md") !== id) fail(`${file}: filename does not match id ${id}`);
  if (ids.has(id)) fail(`${file}: duplicate id ${id}`);
  ids.add(id);

  const compactStatus = markdown.match(
    /^## Statut\s*\n+([\s\S]*?)(?=\n## |$)/m,
  )?.[1];
  const status =
    markdown.match(/^status: (\w+)$/m)?.[1] ??
    compactStatus?.match(
      /\b(backlog|ready|active|in_progress|blocked|done)\b/,
    )?.[1];
  if (
    !status ||
    !["backlog", "ready", "active", "in_progress", "blocked", "done"].includes(
      status,
    )
  ) {
    fail(`${file}: invalid status ${status ?? "missing"}`);
  }

  if (structured) {
    for (let section = 1; section <= 14; section += 1) {
      if (!new RegExp(`^## ${section}\\. `, "m").test(markdown)) {
        fail(`${file}: missing section ${section}`);
      }
    }

    const dependencies = frontmatterArray(markdown, "depends_on", file);
    const sourceRefs = frontmatterArray(markdown, "source_refs", file);
    for (const sourceRef of sourceRefs) {
      if (!new RegExp(`\\| ${escapeRegExp(sourceRef)} \\|`).test(references)) {
        fail(`${file}: unknown source reference ${sourceRef}`);
      }
    }
    cards.push({ file, id, dependencies });
  } else {
    for (const heading of ["Statut", "Vérification"]) {
      if (!new RegExp(`^## ${heading}`, "m").test(markdown)) {
        fail(`${file}: compact card missing ${heading} section`);
      }
    }
    const row = registryRows.find((match) => match[1] === id);
    const dependencyCell = row?.[3]?.trim() ?? "—";
    const dependencies =
      dependencyCell === "—"
        ? []
        : dependencyCell.match(/T\d+-C\d{2}/g) ?? [];
    cards.push({ file, id, dependencies });
  }
}

for (const roadmapId of roadmapIds) {
  if (!ids.has(roadmapId)) fail(`docs/ROADMAP.md: missing card file for ${roadmapId}`);
}
for (const id of ids) {
  if (!roadmapIds.has(id)) fail(`card ${id} is missing from docs/ROADMAP.md registry`);
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
  `Documentation validation passed: ${cardFiles.length} cards match the roadmap; IDs, dependencies, structured references and card formats are valid.`,
);
