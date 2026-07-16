import {
  TeacherExercisePublicationV1,
  parseTeacherExerciseDraftV1,
  reviewTeacherExerciseDraft,
  type TeacherExerciseDraftV1,
  type TeacherExercisePublicationV1 as TeacherExercisePublication,
} from "./exercise";

export const TEACHER_EXERCISE_STORE_LIMIT = 64 as const;

type TeacherExerciseStoreState = {
  publications: TeacherExercisePublication[];
};

declare global {
  var __COMPASS_TEACHER_EXERCISES__: TeacherExerciseStoreState | undefined;
}

function state(): TeacherExerciseStoreState {
  globalThis.__COMPASS_TEACHER_EXERCISES__ ??= { publications: [] };
  return globalThis.__COMPASS_TEACHER_EXERCISES__;
}

export function listTeacherExercises(): readonly TeacherExercisePublication[] {
  return Object.freeze([...state().publications]);
}

export function publishTeacherExercise(
  draftInput: TeacherExerciseDraftV1,
  options: { id?: string; now?: number } = {},
): TeacherExercisePublication {
  const draft = parseTeacherExerciseDraftV1(draftInput);
  const review = reviewTeacherExerciseDraft(draft);
  if (!review.publishable) throw new Error("teacher_draft_not_publishable");

  const publication = TeacherExercisePublicationV1.parse({
    ...draft,
    id: options.id ?? `teacher_${crypto.randomUUID()}`,
    publishedAt: options.now ?? Date.now(),
  });
  const store = state();
  store.publications = [publication, ...store.publications]
    .filter(
      (candidate, index, all) =>
        all.findIndex((other) => other.id === candidate.id) === index,
    )
    .slice(0, TEACHER_EXERCISE_STORE_LIMIT);
  return publication;
}

export function clearTeacherExercisesForTests(): void {
  state().publications = [];
}
