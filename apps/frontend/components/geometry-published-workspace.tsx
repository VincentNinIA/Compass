"use client";

import { useCallback, useRef, useState } from "react";

import type { GeometryLearningSessionReportV1 } from "@/lib/geometry-investigation/contracts";
import type { GeometryRealtimePedagogyContextV1 } from "@/lib/geometry-investigation/learning-runtime";
import type { GeometryWorldCommitV2 } from "@/lib/geometry-investigation/stabilizer";
import type { TeacherExercisePublicationV2 } from "@/lib/teacher/geometry-exercise";
import type { ToolRuntime } from "@/lib/tools/runtime";

import {
  GeoGebraScratchpad,
  type GeometryLearnerInteractionRuntime,
} from "./geogebra-scratchpad";
import { useLanguage } from "./language-provider";
import { RealtimeSpike } from "./realtime-spike";

export function GeometryPublishedWorkspace({
  publication,
  onHome,
  onReport,
}: Readonly<{
  publication: TeacherExercisePublicationV2;
  onHome(): void;
  onReport?(report: GeometryLearningSessionReportV1): void;
}>) {
  const { text } = useLanguage();
  const [toolRuntime, setToolRuntime] = useState<ToolRuntime>();
  const [geometryWorldObservation, setGeometryWorldObservation] = useState<
    Readonly<{
      commit: GeometryWorldCommitV2;
      pedagogy?: GeometryRealtimePedagogyContextV1;
    }>
  >();
  const learnerInteractionRuntimeRef =
    useRef<GeometryLearnerInteractionRuntime | undefined>(undefined);
  const handleGeometryWorldCommit = useCallback(
    (
      commit?: GeometryWorldCommitV2,
      pedagogy?: GeometryRealtimePedagogyContextV1,
    ) => {
      setGeometryWorldObservation(
        commit ? { commit, ...(pedagogy ? { pedagogy } : {}) } : undefined,
      );
    },
    [],
  );
  const handleLearnerInteractionRuntime = useCallback(
    (runtime?: GeometryLearnerInteractionRuntime) => {
      learnerInteractionRuntimeRef.current = runtime;
    },
    [],
  );
  if (publication.content.kind !== "geometry_investigation") return null;
  const activity = publication.content.exercise;

  return (
    <section
      className="geometry-published-workspace"
      aria-labelledby="geometry-published-title"
    >
      <div className="teacher-screen-topbar">
        <button type="button" className="screen-back" onClick={onHome}>
          {text("Back home", "Retour à l’accueil")}
        </button>
        <span>{text("Anonymous session · no grade", "Session anonyme · sans note")}</span>
      </div>
      <header>
        <p className="eyebrow">
          {text("Teacher investigation", "Investigation du professeur")}
        </p>
        <h1 id="geometry-published-title" tabIndex={-1} data-screen-title>
          {activity.title}
        </h1>
        <p>{activity.objective}</p>
      </header>
      <RealtimeSpike
        tutorProfile="geogebra_tutor"
        toolRuntime={toolRuntime}
        geometryWorldObservation={geometryWorldObservation}
        onLearnerSpeechStart={() =>
          learnerInteractionRuntimeRef.current?.cancel("student_speech")
        }
        layout="panorama"
      />
      <GeoGebraScratchpad
        investigation={activity}
        onGeometryLearningReport={onReport}
        onGeometryWorldCommit={handleGeometryWorldCommit}
        onLearnerInteractionRuntime={handleLearnerInteractionRuntime}
        onToolRuntime={setToolRuntime}
      />
    </section>
  );
}
