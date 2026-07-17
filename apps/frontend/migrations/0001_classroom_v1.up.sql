CREATE TABLE compass_teacher_accounts (
  teacher_id text PRIMARY KEY,
  schema_version text NOT NULL CHECK (schema_version = 'teacher_identity.v1'),
  auth_subject_hash text NOT NULL UNIQUE,
  locale text NOT NULL CHECK (locale IN ('fr', 'en')),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL CHECK (
    expires_at > created_at AND expires_at - created_at <= 15552000000
  )
);

CREATE TABLE compass_classrooms (
  classroom_id text PRIMARY KEY,
  schema_version text NOT NULL CHECK (schema_version = 'classroom.v1'),
  teacher_id text NOT NULL REFERENCES compass_teacher_accounts(teacher_id) ON DELETE CASCADE,
  label text NOT NULL,
  join_code_hash text,
  join_code_issued_at bigint,
  status text NOT NULL CHECK (status IN ('active', 'archived', 'revoked')),
  created_at bigint NOT NULL,
  join_code_expires_at bigint,
  expires_at bigint NOT NULL CHECK (
    expires_at > created_at AND expires_at - created_at <= 7776000000
  ),
  CHECK (
    (join_code_hash IS NULL AND join_code_issued_at IS NULL AND join_code_expires_at IS NULL) OR
    (join_code_hash IS NOT NULL AND join_code_issued_at IS NOT NULL AND join_code_expires_at IS NOT NULL AND
      join_code_issued_at >= created_at AND join_code_expires_at > join_code_issued_at AND
      join_code_expires_at - join_code_issued_at <= 86400000 AND join_code_expires_at <= expires_at)
  ),
  CHECK (status = 'active' OR join_code_hash IS NULL)
);

CREATE TABLE compass_learner_aliases (
  learner_alias_id text PRIMARY KEY,
  schema_version text NOT NULL CHECK (schema_version = 'learner_alias.v1'),
  classroom_id text NOT NULL REFERENCES compass_classrooms(classroom_id) ON DELETE CASCADE,
  pseudonym text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL CHECK (
    expires_at > created_at AND expires_at - created_at <= 7776000000
  ),
  UNIQUE (classroom_id, pseudonym)
);

CREATE TABLE compass_classroom_groups (
  group_id text PRIMARY KEY,
  schema_version text NOT NULL CHECK (schema_version = 'classroom_group.v1'),
  classroom_id text NOT NULL REFERENCES compass_classrooms(classroom_id) ON DELETE CASCADE,
  label text NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL CHECK (expires_at > created_at),
  UNIQUE (classroom_id, label)
);

CREATE TABLE compass_classroom_group_members (
  group_id text NOT NULL REFERENCES compass_classroom_groups(group_id) ON DELETE CASCADE,
  learner_alias_id text NOT NULL REFERENCES compass_learner_aliases(learner_alias_id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, learner_alias_id)
);

CREATE TABLE compass_activity_templates (
  template_id text PRIMARY KEY,
  schema_version text NOT NULL CHECK (schema_version = 'class_activity_template.v1'),
  teacher_id text NOT NULL REFERENCES compass_teacher_accounts(teacher_id) ON DELETE CASCADE,
  publication jsonb NOT NULL,
  contract_hash text NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL CHECK (
    expires_at > created_at AND expires_at - created_at <= 7776000000
  )
);

CREATE TABLE compass_assignments (
  assignment_id text PRIMARY KEY,
  schema_version text NOT NULL CHECK (schema_version = 'class_assignment.v1'),
  classroom_id text NOT NULL REFERENCES compass_classrooms(classroom_id) ON DELETE CASCADE,
  template_id text NOT NULL REFERENCES compass_activity_templates(template_id) ON DELETE CASCADE,
  created_by_teacher_id text NOT NULL REFERENCES compass_teacher_accounts(teacher_id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN ('classroom', 'group', 'learner')),
  target_group_id text REFERENCES compass_classroom_groups(group_id) ON DELETE CASCADE,
  target_learner_alias_id text REFERENCES compass_learner_aliases(learner_alias_id) ON DELETE CASCADE,
  contract_hash text NOT NULL,
  assistance_policy jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled', 'active', 'closed', 'revoked')),
  created_at bigint NOT NULL,
  opens_at bigint NOT NULL,
  closes_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  CHECK (opens_at >= created_at),
  CHECK (closes_at > opens_at),
  CHECK (expires_at >= closes_at),
  CHECK (expires_at - closes_at <= 2592000000),
  CHECK (
    (target_kind = 'classroom' AND target_group_id IS NULL AND target_learner_alias_id IS NULL) OR
    (target_kind = 'group' AND target_group_id IS NOT NULL AND target_learner_alias_id IS NULL) OR
    (target_kind = 'learner' AND target_group_id IS NULL AND target_learner_alias_id IS NOT NULL)
  )
);

CREATE TABLE compass_learning_evidence (
  evidence_id text PRIMARY KEY,
  schema_version text NOT NULL CHECK (schema_version = 'class_learning_evidence.v1'),
  assignment_id text NOT NULL REFERENCES compass_assignments(assignment_id) ON DELETE CASCADE,
  learner_alias_id text NOT NULL REFERENCES compass_learner_aliases(learner_alias_id) ON DELETE CASCADE,
  activity_id text NOT NULL,
  contract_hash text NOT NULL,
  projection jsonb NOT NULL,
  updated_at bigint NOT NULL,
  expires_at bigint NOT NULL CHECK (
    expires_at > updated_at AND expires_at - updated_at <= 2592000000
  ),
  UNIQUE (assignment_id, learner_alias_id)
);

CREATE TABLE compass_session_checkpoints (
  checkpoint_id text PRIMARY KEY,
  schema_version text NOT NULL CHECK (schema_version = 'class_session_checkpoint.v1'),
  assignment_id text NOT NULL REFERENCES compass_assignments(assignment_id) ON DELETE CASCADE,
  learner_alias_id text NOT NULL REFERENCES compass_learner_aliases(learner_alias_id) ON DELETE CASCADE,
  activity_id text NOT NULL,
  contract_hash text NOT NULL,
  world_snapshot_hash text NOT NULL,
  safe_state jsonb NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL CHECK (
    expires_at > created_at AND expires_at - created_at <= 604800000
  ),
  UNIQUE (assignment_id, learner_alias_id)
);

CREATE INDEX compass_classrooms_teacher_idx
  ON compass_classrooms(teacher_id);
CREATE INDEX compass_aliases_classroom_idx
  ON compass_learner_aliases(classroom_id);
CREATE INDEX compass_assignments_classroom_idx
  ON compass_assignments(classroom_id, opens_at, closes_at);
CREATE INDEX compass_evidence_assignment_idx
  ON compass_learning_evidence(assignment_id, learner_alias_id);
CREATE INDEX compass_checkpoint_assignment_idx
  ON compass_session_checkpoints(assignment_id, learner_alias_id);
CREATE INDEX compass_classroom_expiry_idx
  ON compass_classrooms(expires_at);
CREATE INDEX compass_evidence_expiry_idx
  ON compass_learning_evidence(expires_at);
CREATE INDEX compass_checkpoint_expiry_idx
  ON compass_session_checkpoints(expires_at);
