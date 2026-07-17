CREATE UNIQUE INDEX compass_groups_classroom_label_ci_idx
  ON compass_classroom_groups (classroom_id, lower(label));

CREATE TABLE compass_assignment_recipients (
  assignment_id text NOT NULL
    REFERENCES compass_assignments(assignment_id) ON DELETE CASCADE,
  learner_alias_id text NOT NULL
    REFERENCES compass_learner_aliases(learner_alias_id) ON DELETE CASCADE,
  created_at bigint NOT NULL,
  PRIMARY KEY (assignment_id, learner_alias_id)
);

CREATE INDEX compass_assignment_recipients_alias_idx
  ON compass_assignment_recipients(learner_alias_id, assignment_id);
