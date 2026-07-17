import { beforeEach, describe, expect, it } from "vitest";

import { ClassroomPilotServiceV1 } from "./pilot-service";
import { MemoryClassroomPilotStoreV1 } from "./pilot-store";

const initialNow = 1_800_000_000_000;

describe("T25-C03 classroom assignment service", () => {
  let clock: number;
  let service: ClassroomPilotServiceV1;
  let teacherId: string;
  let classroomId: string;
  let learnerAliasId: string;

  beforeEach(async () => {
    clock = initialNow;
    service = new ClassroomPilotServiceV1(
      new MemoryClassroomPilotStoreV1(),
      () => clock,
    );
    teacherId = (
      await service.ensureTeacher(`sha256:${"7".repeat(64)}`, "fr")
    ).id;
    const created = await service.createClassroom(teacherId, "4e Varignon");
    classroomId = created.classroom.id;
    clock += 1;
    learnerAliasId = (
      await service.joinClassroom(created.joinCode, "Orion")
    ).learnerAlias.id;
  });

  it("assigns only the canonical PDF contract and exact assistance policy", async () => {
    const catalog = service.getActivityCatalog("fr")[0];
    const opensAt = clock + 1_000;
    const result = await service.createClassAssignment(teacherId, {
      classroomId,
      target: { kind: "learner", learnerAliasId },
      locale: "fr",
      expectedContractHash: catalog.contractHash,
      idempotencyKey: "service-assignment-key-0001",
      opensAt,
      closesAt: opensAt + 24 * 60 * 60 * 1_000,
    });
    expect(result.publication).toEqual(catalog.publication);
    expect(result.assignment.assistancePolicy).toEqual(
      catalog.publication.content.exercise.assistancePolicy,
    );
    expect(result.recipientAliasIds).toEqual([learnerAliasId]);
  });

  it("rejects a drifted hash and bounded-window violations before mutation", async () => {
    const catalog = service.getActivityCatalog("fr")[0];
    const common = {
      classroomId,
      target: { kind: "learner" as const, learnerAliasId },
      locale: "fr" as const,
      expectedContractHash: catalog.contractHash,
      idempotencyKey: "service-invalid-key-0001",
      opensAt: clock + 1_000,
      closesAt: clock + 1_000 + 24 * 60 * 60 * 1_000,
    };
    expect(() =>
      service.createClassAssignment(teacherId, {
        ...common,
        expectedContractHash: "0".repeat(64),
      }),
    ).toThrowError("assignment_contract_drift");
    expect(() =>
      service.createClassAssignment(teacherId, {
        ...common,
        opensAt: clock - 1,
      }),
    ).toThrowError("assignment_invalid_window");
    expect(() =>
      service.createClassAssignment(teacherId, {
        ...common,
        closesAt: common.opensAt + 59 * 60 * 1_000,
      }),
    ).toThrowError("assignment_invalid_window");
    await expect(service.listClassrooms(teacherId)).resolves.toMatchObject([
      { assignments: [] },
    ]);
  });
});
