export type GeometryDependencyParseResult =
  | { status: "known"; parents: string[] }
  | { status: "unknown"; parents: [] };

const MAX_COMMAND_LENGTH = 240;
const MAX_PARENTS = 16;
const OBJECT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * Extracts construction parents from GeoGebra's non-localized command string.
 * It intentionally recognizes only command calls and never guesses from a
 * coordinate-only expression or malformed input.
 */
export function parseGeometryDependencies(
  source: unknown,
): GeometryDependencyParseResult {
  if (typeof source !== "string") return unknownDependencies();
  const command = source.trim();
  if (
    command.length === 0 ||
    command.length > MAX_COMMAND_LENGTH ||
    command.includes('"') ||
    command.includes("'")
  ) {
    return unknownDependencies();
  }

  const expression = stripAssignment(command);
  const openIndex = firstDelimiterIndex(expression);
  if (openIndex <= 0) return unknownDependencies();
  const open = expression[openIndex];
  const close = open === "(" ? ")" : "]";
  if (!balancedDelimiters(expression, openIndex, open, close)) {
    return unknownDependencies();
  }
  const commandName = expression.slice(0, openIndex).trim();
  if (!OBJECT_NAME.test(commandName)) return unknownDependencies();

  const parents = new Set<string>();
  const argumentsSource = expression.slice(openIndex + 1, -1);
  const matches = argumentsSource.matchAll(/[A-Za-z][A-Za-z0-9_]{0,63}/g);
  for (const match of matches) {
    const token = match[0];
    const next = nextNonWhitespace(argumentsSource, (match.index ?? 0) + token.length);
    if (next === "(" || next === "[") continue;
    if (token === "true" || token === "false" || token === "undefined") continue;
    parents.add(token);
    if (parents.size > MAX_PARENTS) return unknownDependencies();
  }
  return { status: "known", parents: [...parents] };
}

function stripAssignment(command: string): string {
  const assignment = command.indexOf("=");
  return assignment === -1 ? command : command.slice(assignment + 1).trim();
}

function firstDelimiterIndex(expression: string): number {
  const round = expression.indexOf("(");
  const square = expression.indexOf("[");
  if (round === -1) return square;
  if (square === -1) return round;
  return Math.min(round, square);
}

function balancedDelimiters(
  expression: string,
  openIndex: number,
  open: string,
  close: string,
): boolean {
  if (expression.at(-1) !== close) return false;
  let depth = 0;
  for (let index = openIndex; index < expression.length; index += 1) {
    const character = expression[index];
    if (character === open) depth += 1;
    if (character === close) depth -= 1;
    if (depth < 0) return false;
    if (depth === 0 && index !== expression.length - 1) return false;
  }
  return depth === 0;
}

function nextNonWhitespace(value: string, start: number): string | undefined {
  for (let index = start; index < value.length; index += 1) {
    if (!/\s/.test(value[index])) return value[index];
  }
  return undefined;
}

function unknownDependencies(): GeometryDependencyParseResult {
  return { status: "unknown", parents: [] };
}
