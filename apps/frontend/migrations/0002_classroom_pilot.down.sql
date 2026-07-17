DROP TABLE IF EXISTS compass_classroom_control;
DROP INDEX IF EXISTS compass_aliases_classroom_pseudonym_ci_idx;

ALTER TABLE compass_learner_aliases
  ADD CONSTRAINT compass_learner_aliases_classroom_id_pseudonym_key
  UNIQUE (classroom_id, pseudonym);
