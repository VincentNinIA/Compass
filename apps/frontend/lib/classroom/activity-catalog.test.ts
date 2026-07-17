import { describe, expect, it } from "vitest";

import {
  CLASSROOM_VARIGNON_SOURCE_SHA256,
  getClassroomVarignonCatalogEntryV1,
  hashClassroomActivityContractV1,
} from "./activity-catalog";

describe("T25-C03 Varignon classroom catalog", () => {
  it("binds the exact bilingual publication to the supplied PDF", () => {
    const french = getClassroomVarignonCatalogEntryV1("fr");
    const english = getClassroomVarignonCatalogEntryV1("en");

    expect(french.sourceSha256).toBe(CLASSROOM_VARIGNON_SOURCE_SHA256);
    expect(french.publication.content.exercise).toMatchObject({
      schemaVersion: "geometry_investigation.v1",
      template: "varignon.v1",
      locale: "fr",
    });
    expect(french.publication.content.exercise.missions).toHaveLength(9);
    expect(french.contractHash).toBe(
      hashClassroomActivityContractV1(french.publication),
    );
    expect(getClassroomVarignonCatalogEntryV1("fr").contractHash).toBe(
      french.contractHash,
    );
    expect(english.contractHash).not.toBe(french.contractHash);
  });

  it("hashes JSON contracts independently of object key order", () => {
    expect(
      hashClassroomActivityContractV1({ beta: 2, alpha: { delta: 4, charlie: 3 } }),
    ).toBe(
      hashClassroomActivityContractV1({ alpha: { charlie: 3, delta: 4 }, beta: 2 }),
    );
  });
});
