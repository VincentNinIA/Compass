ALTER TABLE compass_learner_aliases
  DROP CONSTRAINT IF EXISTS compass_learner_aliases_classroom_id_pseudonym_key;

CREATE UNIQUE INDEX compass_aliases_classroom_pseudonym_ci_idx
  ON compass_learner_aliases (classroom_id, lower(pseudonym));

CREATE TABLE compass_classroom_control (
  lock_key integer PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0
);

INSERT INTO compass_classroom_control (lock_key, revision) VALUES (1, 0);
