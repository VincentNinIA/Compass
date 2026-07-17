import { createHash } from "node:crypto";

import {
  TeacherExercisePublicationV2,
  createTeacherGeometryDraftV2,
} from "@/lib/teacher/geometry-exercise";

export const CLASSROOM_VARIGNON_CATALOG_ID = "varignon-pdf.v1" as const;
export const CLASSROOM_VARIGNON_SOURCE_SHA256 =
  "4f10c5862107d5f0aa256678851d353c1c1d9c7e1eca6aaa78019801a0d61b03" as const;

export type ClassroomActivityCatalogEntryV1 = Readonly<{
  catalogId: typeof CLASSROOM_VARIGNON_CATALOG_ID;
  sourceDocument: "math.pdf";
  sourceSha256: typeof CLASSROOM_VARIGNON_SOURCE_SHA256;
  locale: "fr" | "en";
  contractHash: string;
  publication: TeacherExercisePublicationV2;
}>;

export function getClassroomVarignonCatalogEntryV1(
  locale: "fr" | "en",
): ClassroomActivityCatalogEntryV1 {
  const draft = createTeacherGeometryDraftV2(locale);
  const publication = TeacherExercisePublicationV2.parse({
    ...draft,
    schemaVersion: "teacher_exercise_publication.v2",
    id: `teacher_varignon-pdf-v1-${locale}`,
    publishedAt: 0,
  });
  return Object.freeze({
    catalogId: CLASSROOM_VARIGNON_CATALOG_ID,
    sourceDocument: "math.pdf",
    sourceSha256: CLASSROOM_VARIGNON_SOURCE_SHA256,
    locale,
    contractHash: hashClassroomActivityContractV1(publication),
    publication: structuredClone(publication),
  });
}

export function hashClassroomActivityContractV1(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non_finite_contract_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  throw new TypeError("non_json_contract_value");
}
