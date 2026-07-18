"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  GeometryHintDirectiveV1,
} from "@/lib/geometry-investigation/learning-policy";
import {
  GeometryCoachTurnV1,
  type GeometryCoachTurnV1 as GeometryCoachTurnV1Type,
  type GeometryRealtimePedagogyContextV1,
} from "@/lib/geometry-investigation/learning-runtime";
import type {
  GeometryLearningSessionReportV1,
  GeometryMissionV1,
  GeometryWorldObjectV2,
} from "@/lib/geometry-investigation/contracts";
import type { GeometrySessionStateV1 } from "@/lib/geometry-investigation/session";
import type { GeometryWorldCommitV2 } from "@/lib/geometry-investigation/stabilizer";
import type { TeacherExercisePublicationV2 } from "@/lib/teacher/geometry-exercise";
import type { ToolRuntime } from "@/lib/tools/runtime";
import type { RealtimeGeometryCoachRuntime } from "@/lib/realtime/webrtc-session";

import {
  CompassMascot,
  MascotProvider,
  useMascotController,
  type MascotActivity,
  type MascotFocusSide,
} from "./compass-mascot";
import {
  GeoGebraScratchpad,
  type GeometryLearnerInteractionRuntime,
} from "./geogebra-scratchpad";
import { useLanguage } from "./language-provider";
import { RealtimeSpike } from "./realtime-spike";

type GeometryMascotCameo = Readonly<{
  source: string;
  kind: "welcome" | "focus" | "mission" | "hint" | "proof" | "tool";
  title?: string;
  detail?: string;
  targetNames: readonly string[];
  focusSide: MascotFocusSide;
  anchorSide: "left" | "right";
  quiet: boolean;
}>;

type GeometryMascotProofPin = Readonly<{
  missionId: string;
  order: number;
  title: string;
}>;

const LEARNER_FOCUS_CHANGES = new Set([
  "add",
  "update",
  "drag_end",
  "moved_geos",
  "select",
]);

export function geometryMascotFocusFromCommit(
  commit: GeometryWorldCommitV2,
): Pick<
  GeometryMascotCameo,
  "targetNames" | "focusSide" | "anchorSide"
> | undefined {
  const { change, objects } = commit.world;
  if (
    change?.actor !== "learner" ||
    !change.terminal ||
    !LEARNER_FOCUS_CHANGES.has(change.kind) ||
    change.objectNames.length === 0
  ) {
    return undefined;
  }
  const targetNames = [...change.objectNames].slice(0, 4);
  const selected = new Set(targetNames);
  const coordinates = objects
    .filter((object) => selected.has(object.name) && object.x !== undefined)
    .map((object) => object.x as number);
  const meanX =
    coordinates.length > 0
      ? coordinates.reduce((sum, coordinate) => sum + coordinate, 0) /
        coordinates.length
      : 0;
  const focusSide: MascotFocusSide =
    meanX < -0.25 ? "left" : meanX > 0.25 ? "right" : "center";
  return {
    targetNames,
    focusSide,
    anchorSide: focusSide === "left" ? "right" : "left",
  };
}

export function newlyVerifiedGeometryMissions(
  previous: GeometrySessionStateV1 | undefined,
  next: GeometrySessionStateV1,
  missions: readonly GeometryMissionV1[],
): GeometryMascotProofPin[] {
  if (!previous) return [];
  const previousStatus = new Map(
    previous.missions.map((mission) => [mission.missionId, mission.status]),
  );
  const definitions = new Map(missions.map((mission) => [mission.id, mission]));
  return next.missions.flatMap((mission) => {
    if (
      mission.status !== "verified" ||
      previousStatus.get(mission.missionId) === "verified"
    ) {
      return [];
    }
    const definition = definitions.get(mission.missionId);
    return definition
      ? [{ missionId: definition.id, order: definition.order, title: definition.title }]
      : [];
  });
}

export function geometryCoachTurnForMissionTransition(
  previous: GeometrySessionStateV1 | undefined,
  next: GeometrySessionStateV1,
  missions: readonly GeometryMissionV1[],
): GeometryCoachTurnV1Type | undefined {
  if (
    !previous?.activeMissionId ||
    previous.activeMissionId === next.activeMissionId
  ) {
    return undefined;
  }
  const definitions = new Map(missions.map((mission) => [mission.id, mission]));
  const previousMission = definitions.get(previous.activeMissionId);
  const previousProgress = next.missions.find(
    ({ missionId }) => missionId === previous.activeMissionId,
  );
  const outcome = previousProgress?.status;
  if (
    !previousMission ||
    (outcome !== "verified" && outcome !== "completed")
  ) {
    return undefined;
  }
  const currentMission = next.activeMissionId
    ? definitions.get(next.activeMissionId)
    : undefined;
  return GeometryCoachTurnV1.parse({
    schemaVersion: "geometry_coach_turn.v1",
    activityId: next.activityId,
    epoch: next.epoch,
    revision: next.revision,
    reason: "mission_advanced",
    previousMission: {
      id: previousMission.id,
      order: previousMission.order,
      title: previousMission.title.slice(0, 160),
      outcome,
    },
    ...(currentMission
      ? { currentMission: coachMissionPayload(currentMission) }
      : {}),
  });
}

export function GeometryPublishedWorkspace({
  publication,
  onHome,
  returnLabel,
  onReport,
}: Readonly<{
  publication: TeacherExercisePublicationV2;
  onHome(): void;
  returnLabel?: string;
  onReport?(report: GeometryLearningSessionReportV1): void;
}>) {
  if (publication.content.kind !== "geometry_investigation") return null;
  return (
    <MascotProvider>
      <GeometryPublishedWorkspaceContent
        publication={publication}
        onHome={onHome}
        returnLabel={returnLabel}
        onReport={onReport}
      />
    </MascotProvider>
  );
}

function GeometryPublishedWorkspaceContent({
  publication,
  onHome,
  returnLabel,
  onReport,
}: Readonly<{
  publication: TeacherExercisePublicationV2;
  onHome(): void;
  returnLabel?: string;
  onReport?(report: GeometryLearningSessionReportV1): void;
}>) {
  const { text } = useLanguage();
  const { pulse: pulseMascot } = useMascotController();
  const activity = publication.content.kind === "geometry_investigation"
    ? publication.content.exercise
    : undefined;
  const [toolRuntime, setToolRuntime] = useState<ToolRuntime>();
  const [geometryWorldObservation, setGeometryWorldObservation] = useState<
    Readonly<{
      commit: GeometryWorldCommitV2;
      pedagogy?: GeometryRealtimePedagogyContextV1;
    }>
  >();
  const [cameo, setCameo] = useState<GeometryMascotCameo>();
  const [proofPins, setProofPins] = useState<readonly GeometryMascotProofPin[]>([]);
  const [lastFocusSide, setLastFocusSide] =
    useState<MascotFocusSide>("right");
  const geometryWorldObservationRef = useRef<
    Readonly<{
      commit: GeometryWorldCommitV2;
      pedagogy?: GeometryRealtimePedagogyContextV1;
    }> | undefined
  >(undefined);
  const lastFocusSideRef = useRef<MascotFocusSide>("right");
  const previousLearningStateRef = useRef<GeometrySessionStateV1 | undefined>(
    undefined,
  );
  const currentLearningStateRef = useRef<GeometrySessionStateV1 | undefined>(
    undefined,
  );
  const geometryCoachRuntimeRef = useRef<
    RealtimeGeometryCoachRuntime | undefined
  >(undefined);
  const pendingCoachTurnRef = useRef<GeometryCoachTurnV1Type | undefined>(
    undefined,
  );
  const coachTurnSentForRuntimeRef = useRef(false);
  const welcomedRef = useRef(false);
  const learnerInteractionRuntimeRef =
    useRef<GeometryLearnerInteractionRuntime | undefined>(undefined);

  const presentCameo = useCallback(
    (
      next: GeometryMascotCameo,
      mascotActivity: Exclude<MascotActivity, "idle">,
      durationMs: number,
    ) => {
      setCameo(next);
      pulseMascot(next.source, mascotActivity, durationMs);
    },
    [pulseMascot],
  );

  const requestCoachTurn = useCallback((turn: GeometryCoachTurnV1Type) => {
    const world = geometryWorldObservationRef.current?.commit.world;
    if (
      !world ||
      world.activityId !== turn.activityId ||
      world.epoch !== turn.epoch ||
      world.revision !== turn.revision
    ) {
      pendingCoachTurnRef.current = turn;
      return false;
    }
    const accepted =
      geometryCoachRuntimeRef.current?.requestCoachTurn(turn) ?? false;
    if (accepted) {
      pendingCoachTurnRef.current = undefined;
      coachTurnSentForRuntimeRef.current = true;
      return true;
    }
    pendingCoachTurnRef.current = turn;
    return false;
  }, []);

  const flushPendingCoachTurn = useCallback(() => {
    const pending = pendingCoachTurnRef.current;
    const world = geometryWorldObservationRef.current?.commit.world;
    if (!pending || !world) return false;
    if (
      world.activityId !== pending.activityId ||
      world.epoch !== pending.epoch ||
      world.revision !== pending.revision
    ) {
      pendingCoachTurnRef.current = undefined;
      return false;
    }
    return requestCoachTurn(pending);
  }, [requestCoachTurn]);

  const handleGeometryWorldCommit = useCallback(
    (
      commit?: GeometryWorldCommitV2,
      pedagogy?: GeometryRealtimePedagogyContextV1,
    ) => {
      const observation = commit
        ? { commit, ...(pedagogy ? { pedagogy } : {}) }
        : undefined;
      geometryWorldObservationRef.current = observation;
      setGeometryWorldObservation(observation);
      if (!commit) return;
      const focus = geometryMascotFocusFromCommit(commit);
      if (!focus) return;
      lastFocusSideRef.current = focus.focusSide;
      setLastFocusSide(focus.focusSide);
      presentCameo(
        {
          source: `geometry-focus:${commit.world.epoch}:${commit.world.revision}`,
          kind: "focus",
          ...focus,
          quiet: true,
        },
        "receiving",
        1_250,
      );
    },
    [presentCameo],
  );

  useEffect(() => {
    flushPendingCoachTurn();
  }, [flushPendingCoachTurn, geometryWorldObservation]);

  const handleGeometryLearningState = useCallback(
    (next?: GeometrySessionStateV1) => {
      if (!next || !activity) {
        previousLearningStateRef.current = undefined;
        currentLearningStateRef.current = undefined;
        pendingCoachTurnRef.current = undefined;
        welcomedRef.current = false;
        setProofPins([]);
        return;
      }
      currentLearningStateRef.current = next;
      const previous = previousLearningStateRef.current;
      const activeMission = activity.missions.find(
        (mission) => mission.id === next.activeMissionId,
      );

      if (!welcomedRef.current && next.phase !== "loading") {
        welcomedRef.current = true;
        presentCameo(
          {
            source: `geometry-welcome:${next.epoch}`,
            kind: "welcome",
            title: text("Compass is beside you", "Compass est à tes côtés"),
            detail:
              activeMission?.title ??
              text("Let’s explore the figure.", "Explorons la figure."),
            targetNames: [],
            focusSide: "right",
            anchorSide: "left",
            quiet: false,
          },
          "receiving",
          2_800,
        );
      } else if (
        previous?.activeMissionId &&
        next.activeMissionId &&
        previous.activeMissionId !== next.activeMissionId &&
        activeMission
      ) {
        const focusSide = lastFocusSideRef.current;
        presentCameo(
          {
            source: `geometry-mission:${activeMission.id}:${next.revision}`,
            kind: "mission",
            title: text(
              `Mission ${activeMission.order}`,
              `Mission ${activeMission.order}`,
            ),
            detail: activeMission.title,
            targetNames: [],
            focusSide,
            anchorSide: focusSide === "left" ? "right" : "left",
            quiet: false,
          },
          "receiving",
          2_500,
        );
      }

      const verified = newlyVerifiedGeometryMissions(
        previous,
        next,
        activity.missions,
      );
      if (verified.length > 0) {
        setProofPins((current) => {
          const known = new Set(current.map(({ missionId }) => missionId));
          return [
            ...current,
            ...verified.filter(({ missionId }) => !known.has(missionId)),
          ];
        });
        const latest = verified.at(-1)!;
        const focusSide = lastFocusSideRef.current;
        presentCameo(
          {
            source: `geometry-proof:${latest.missionId}:${next.revision}`,
            kind: "proof",
            title: text("Proof pinned", "Preuve épinglée"),
            detail: latest.title,
            targetNames: [],
            focusSide,
            anchorSide: focusSide === "left" ? "right" : "left",
            quiet: false,
          },
          "celebrating",
          2_700,
        );
      }
      const coachTurn = geometryCoachTurnForMissionTransition(
        previous,
        next,
        activity.missions,
      );
      if (coachTurn) requestCoachTurn(coachTurn);
      previousLearningStateRef.current = next;
    },
    [activity, presentCameo, requestCoachTurn, text],
  );

  const handleGeometryLearningDirective = useCallback(
    (directive?: GeometryHintDirectiveV1) => {
      if (!directive) return;
      const objects =
        geometryWorldObservationRef.current?.commit.world.objects ?? [];
      const focus = focusForObjectNames(objects, directive.objectNames);
      presentCameo(
        {
          source: `geometry-hint:${directive.id}`,
          kind: "hint",
          title: text(`Hint L${directive.level}`, `Indice L${directive.level}`),
          detail: directive.prompt,
          targetNames: directive.objectNames,
          ...focus,
          quiet: false,
        },
        "hinting",
        directive.action ? 3_600 : 2_800,
      );
      const learningState = currentLearningStateRef.current;
      const currentMission = activity?.missions.find(
        ({ id }) => id === learningState?.activeMissionId,
      );
      if (learningState && currentMission) {
        requestCoachTurn(
          GeometryCoachTurnV1.parse({
            schemaVersion: "geometry_coach_turn.v1",
            activityId: learningState.activityId,
            epoch: learningState.epoch,
            revision: learningState.revision,
            reason: "learning_hint",
            currentMission: coachMissionPayload(currentMission),
            hint: {
              directiveId: directive.id,
              source: directive.source,
              level: directive.level,
              prompt: directive.prompt.slice(0, 360),
              objectNames: [...directive.objectNames].slice(0, 16),
              ...(directive.action ? { action: directive.action } : {}),
            },
          }),
        );
      }
    },
    [activity, presentCameo, requestCoachTurn, text],
  );

  const handleGeometryCoachRuntime = useCallback(
    (runtime?: RealtimeGeometryCoachRuntime) => {
      geometryCoachRuntimeRef.current = runtime;
      if (!runtime) {
        coachTurnSentForRuntimeRef.current = false;
        return;
      }
      if (flushPendingCoachTurn() || coachTurnSentForRuntimeRef.current) return;
      const learningState = currentLearningStateRef.current;
      const world = geometryWorldObservationRef.current?.commit.world;
      const currentMission = activity?.missions.find(
        ({ id }) => id === learningState?.activeMissionId,
      );
      if (
        !learningState ||
        !world ||
        !currentMission ||
        learningState.activityId !== world.activityId ||
        learningState.epoch !== world.epoch ||
        learningState.revision !== world.revision
      ) {
        return;
      }
      requestCoachTurn(
        GeometryCoachTurnV1.parse({
          schemaVersion: "geometry_coach_turn.v1",
          activityId: world.activityId,
          epoch: world.epoch,
          revision: world.revision,
          reason: "mission_orientation",
          currentMission: coachMissionPayload(currentMission),
        }),
      );
    },
    [activity, flushPendingCoachTurn, requestCoachTurn],
  );

  const handleLearnerInteractionRuntime = useCallback(
    (runtime?: GeometryLearnerInteractionRuntime) => {
      learnerInteractionRuntimeRef.current = runtime;
    },
    [],
  );

  if (!activity) return null;

  return (
    <section
      className="geometry-published-workspace"
      aria-labelledby="geometry-published-title"
    >
      <div className="teacher-screen-topbar">
        <button type="button" className="screen-back" onClick={onHome}>
          {returnLabel ?? text("Back home", "Retour à l’accueil")}
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
      <div className="geometry-published-coach-stage">
        <CompassMascot placement="coach" focusSide={lastFocusSide} />
        <RealtimeSpike
          tutorProfile="geogebra_tutor"
          toolRuntime={toolRuntime}
          geometryWorldObservation={geometryWorldObservation}
          onGeometryCoachRuntime={handleGeometryCoachRuntime}
          onLearnerSpeechStart={() =>
            learnerInteractionRuntimeRef.current?.cancel("student_speech")
          }
          layout="panorama"
        />
      </div>
      <GeoGebraScratchpad
        investigation={activity}
        onGeometryLearningReport={onReport}
        onGeometryLearningState={handleGeometryLearningState}
        onGeometryLearningDirective={handleGeometryLearningDirective}
        onGeometryWorldCommit={handleGeometryWorldCommit}
        onLearnerInteractionRuntime={handleLearnerInteractionRuntime}
        onToolRuntime={setToolRuntime}
        canvasOverlay={
          <GeometryMascotCanvasLayer cameo={cameo} proofPins={proofPins} />
        }
      />
    </section>
  );
}

function coachMissionPayload(mission: GeometryMissionV1) {
  return {
    id: mission.id,
    order: mission.order,
    title: mission.title.slice(0, 160),
    instruction: mission.instruction.slice(0, 360),
  };
}

function GeometryMascotCanvasLayer({
  cameo,
  proofPins,
}: Readonly<{
  cameo?: GeometryMascotCameo;
  proofPins: readonly GeometryMascotProofPin[];
}>) {
  const { text } = useLanguage();
  const { current } = useMascotController();
  const source = current.source ?? "";
  const cameoMatches = Boolean(
    cameo &&
      (cameo.source === source ||
        (cameo.kind === "hint" && source.startsWith("geometry-hint-action:"))),
  );
  const toolCameo =
    current.activity === "modifying" && source.startsWith("realtime-");
  const visible = cameoMatches || toolCameo;
  const activeCameo: GeometryMascotCameo | undefined = cameoMatches
    ? cameo
    : toolCameo
      ? {
          source,
          kind: "tool",
          title: text("Compass checks the board", "Compass vérifie le plan"),
          targetNames: [],
          focusSide: "right",
          anchorSide: "left",
          quiet: false,
        }
      : undefined;

  return (
    <div
      className="geometry-mascot-layer"
      data-visible={visible ? "true" : "false"}
      aria-hidden="true"
    >
      {proofPins.length > 0 ? (
        <ol className="geometry-mascot-proof-pins" data-count={proofPins.length}>
          {proofPins.map((pin) => (
            <li key={pin.missionId} title={pin.title}>
              <span>✓</span>
              <small>{text(`Proof ${pin.order}`, `Preuve ${pin.order}`)}</small>
            </li>
          ))}
        </ol>
      ) : null}
      {activeCameo ? (
        <div
          key={activeCameo.source}
          className="geometry-mascot-cameo"
          data-kind={activeCameo.kind}
          data-anchor={activeCameo.anchorSide}
          data-targets={activeCameo.targetNames.join(",") || "none"}
        >
          <CompassMascot
            placement="canvas"
            focusSide={activeCameo.focusSide}
            labelOverride={activeCameo.title}
            quiet={activeCameo.quiet}
          />
          {!activeCameo.quiet && activeCameo.detail ? (
            <p className="geometry-mascot-cameo__detail">
              {activeCameo.detail}
            </p>
          ) : null}
          {activeCameo.targetNames.length > 0 ? (
            <span className="geometry-mascot-cameo__targets">
              {activeCameo.targetNames.join(" · ")}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function focusForObjectNames(
  objects: readonly GeometryWorldObjectV2[],
  names: readonly string[],
): Pick<GeometryMascotCameo, "focusSide" | "anchorSide"> {
  const selected = new Set(names);
  const coordinates = objects
    .filter((object) => selected.has(object.name) && object.x !== undefined)
    .map((object) => object.x as number);
  const meanX =
    coordinates.length > 0
      ? coordinates.reduce((sum, coordinate) => sum + coordinate, 0) /
        coordinates.length
      : 0;
  const focusSide: MascotFocusSide =
    meanX < -0.25 ? "left" : meanX > 0.25 ? "right" : "center";
  return {
    focusSide,
    anchorSide: focusSide === "left" ? "right" : "left",
  };
}
