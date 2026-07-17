import {
  GeometryInvestigationV1,
  parseGeometryInvestigationV1,
} from "./contracts";

export const VARIGNON_MISSION_COUNT = 9 as const;
export const VARIGNON_RELATION_COUNT = 10 as const;

const sharedRelations = [
  {
    id: "rel_midpoint_e",
    relation: "midpoint",
    objects: ["E", "A", "B"],
    expected: true,
    toleranceVersion: "scaled-midpoint-v1",
  },
  {
    id: "rel_midpoint_f",
    relation: "midpoint",
    objects: ["F", "B", "C"],
    expected: true,
    toleranceVersion: "scaled-midpoint-v1",
  },
  {
    id: "rel_midpoint_g",
    relation: "midpoint",
    objects: ["G", "C", "D"],
    expected: true,
    toleranceVersion: "scaled-midpoint-v1",
  },
  {
    id: "rel_midpoint_h",
    relation: "midpoint",
    objects: ["H", "D", "A"],
    expected: true,
    toleranceVersion: "scaled-midpoint-v1",
  },
  {
    id: "rel_configuration_convex",
    relation: "configuration_type",
    objects: ["A", "B", "C", "D"],
    expected: "convex",
    toleranceVersion: "ordered-quadrilateral-v1",
  },
  {
    id: "rel_configuration_concave",
    relation: "configuration_type",
    objects: ["A", "B", "C", "D"],
    expected: "concave",
    toleranceVersion: "ordered-quadrilateral-v1",
  },
  {
    id: "rel_configuration_crossed",
    relation: "configuration_type",
    objects: ["A", "B", "C", "D"],
    expected: "crossed",
    toleranceVersion: "ordered-quadrilateral-v1",
  },
  {
    id: "rel_parallel_ef_gh",
    relation: "parallel",
    objects: ["E", "F", "G", "H"],
    expected: true,
    toleranceVersion: "normalized-cross-product-v1",
  },
  {
    id: "rel_parallel_fg_he",
    relation: "parallel",
    objects: ["F", "G", "H", "E"],
    expected: true,
    toleranceVersion: "normalized-cross-product-v1",
  },
  {
    id: "rel_parallelogram_efgh",
    relation: "parallelogram",
    objects: ["E", "F", "G", "H"],
    expected: true,
    toleranceVersion: "opposite-sides-parallel-v1",
  },
] as const;

const sharedScaffold = {
  version: "varignon-scaffold.v1",
  freePoints: [
    { label: "A", x: -4, y: -1 },
    { label: "B", x: -1, y: -3 },
    { label: "C", x: 4, y: -1 },
    { label: "D", x: 1, y: 3 },
  ],
  edges: [
    { from: "A", to: "B" },
    { from: "B", to: "C" },
    { from: "C", to: "D" },
    { from: "D", to: "A" },
  ],
} as const;

const localeContent = {
  fr: {
    id: "varignon_fr_v1",
    title: "Varignon — le quadrilatère des milieux",
    level: "Collège et lycée",
    objective:
      "Identifier puis justifier la nature du quadrilatère obtenu en joignant les milieux des côtés d'un quadrilatère quelconque.",
    targetedDifficulties: [
      "Construire un milieu par dépendance exacte",
      "Explorer plusieurs configurations sans généraliser trop vite",
      "Distinguer preuve expérimentale et démonstration",
    ],
    teacherGuidance:
      "Laisser l'élève construire et déplacer avant toute aide matérielle. Demander une conjecture après les trois captures, puis guider la justification par le théorème des milieux.",
    conjecturePrompt:
      "Quelle propriété du quadrilatère EFGH semble rester vraie dans les trois configurations ?",
    proofPrompts: [
      "Dans le triangle ABC, que permet d'affirmer le théorème des milieux pour E et F ?",
      "Dans le triangle CDA, que permet d'affirmer le théorème des milieux pour G et H ?",
      "Comment conclure pour les côtés opposés EF et GH, puis FG et HE ?",
    ],
    transferPrompt:
      "Observe les diagonales AC et BD. Quelle condition sur ces diagonales semble rendre le parallélogramme EFGH rectangle ?",
    missions: [
      ["Construire les quatre milieux", "Construis E, F, G et H, milieux respectifs de AB, BC, CD et DA."],
      ["Relier les milieux", "Relie E, F, G et H dans cet ordre pour former le quadrilatère intérieur."],
      ["Capturer un cas convexe", "Obtiens une configuration convexe puis capture cet état."],
      ["Capturer un cas concave", "Déplace un sommet pour obtenir une configuration concave puis capture cet état."],
      ["Capturer un cas croisé", "Déplace un sommet pour obtenir une configuration croisée puis capture cet état."],
      ["Formuler une conjecture", "Décris avec tes mots la propriété qui semble rester vraie."],
      ["Vérifier la conjecture", "Vérifie les deux paires de côtés opposés sur les trois états capturés."],
      ["Justifier", "Explique pourquoi le théorème des milieux permet de conclure."],
      ["Transférer", "Réponds à la question sur les diagonales du quadrilatère initial."],
    ],
  },
  en: {
    id: "varignon_en_v1",
    title: "Varignon — the midpoint quadrilateral",
    level: "Middle and high school",
    objective:
      "Identify and justify the type of quadrilateral obtained by joining the midpoints of any quadrilateral.",
    targetedDifficulties: [
      "Constructing a midpoint with an exact dependency",
      "Exploring several configurations before generalizing",
      "Distinguishing experimental evidence from proof",
    ],
    teacherGuidance:
      "Let the learner construct and drag before providing material help. Ask for a conjecture after all three captures, then guide the proof with the midpoint theorem.",
    conjecturePrompt:
      "Which property of quadrilateral EFGH seems to remain true in all three configurations?",
    proofPrompts: [
      "In triangle ABC, what does the midpoint theorem say about E and F?",
      "In triangle CDA, what does the midpoint theorem say about G and H?",
      "How can you conclude for opposite sides EF and GH, then FG and HE?",
    ],
    transferPrompt:
      "Look at diagonals AC and BD. What condition on these diagonals seems to make parallelogram EFGH a rectangle?",
    missions: [
      ["Construct the four midpoints", "Construct E, F, G and H as the midpoints of AB, BC, CD and DA."],
      ["Join the midpoints", "Join E, F, G and H in that order to form the inner quadrilateral."],
      ["Capture a convex case", "Create a convex configuration and capture this state."],
      ["Capture a concave case", "Drag one vertex to create a concave configuration and capture it."],
      ["Capture a crossed case", "Drag one vertex to create a crossed configuration and capture it."],
      ["State a conjecture", "Describe in your own words the property that seems to remain true."],
      ["Check the conjecture", "Check both pairs of opposite sides in all three captured states."],
      ["Justify", "Explain why the midpoint theorem lets you conclude."],
      ["Transfer", "Answer the question about the diagonals of the original quadrilateral."],
    ],
  },
} as const;

const missionConfiguration = [
  {
    kind: "construct",
    requiredEvidence: [
      "rel_midpoint_e",
      "rel_midpoint_f",
      "rel_midpoint_g",
      "rel_midpoint_h",
    ],
    allowedActions: [
      "inspect_geometry_workspace",
      "activate_geometry_tool",
      "highlight_geometry_objects",
      "check_geometry_relation",
    ],
    completion: "deterministic",
  },
  {
    kind: "construct",
    requiredEvidence: [],
    allowedActions: [
      "inspect_geometry_workspace",
      "activate_geometry_tool",
      "highlight_geometry_objects",
    ],
    completion: "deterministic",
  },
  {
    kind: "capture",
    requiredEvidence: ["rel_configuration_convex"],
    allowedActions: [
      "classify_geometry_configuration",
      "capture_geometry_evidence",
      "create_geometry_variation",
    ],
    completion: "deterministic",
  },
  {
    kind: "capture",
    requiredEvidence: ["rel_configuration_concave"],
    allowedActions: [
      "classify_geometry_configuration",
      "capture_geometry_evidence",
      "create_geometry_variation",
    ],
    completion: "deterministic",
  },
  {
    kind: "capture",
    requiredEvidence: ["rel_configuration_crossed"],
    allowedActions: [
      "classify_geometry_configuration",
      "capture_geometry_evidence",
      "create_geometry_variation",
    ],
    completion: "deterministic",
  },
  {
    kind: "conjecture",
    requiredEvidence: [],
    allowedActions: ["inspect_geometry_workspace", "focus_geometry_view"],
    completion: "learner_reflection",
  },
  {
    kind: "verify",
    requiredEvidence: ["rel_parallel_ef_gh", "rel_parallel_fg_he"],
    allowedActions: [
      "check_geometry_relation",
      "restore_geometry_checkpoint",
      "highlight_geometry_objects",
    ],
    completion: "deterministic",
  },
  {
    kind: "justify",
    requiredEvidence: ["rel_parallelogram_efgh"],
    allowedActions: [
      "highlight_geometry_objects",
      "demonstrate_geometry_step",
    ],
    completion: "hybrid",
  },
  {
    kind: "transfer",
    requiredEvidence: [],
    allowedActions: ["inspect_geometry_workspace"],
    completion: "learner_reflection",
  },
] as const;

function createVarignonActivity(
  locale: keyof typeof localeContent,
): GeometryInvestigationV1 {
  const content = localeContent[locale];
  return parseGeometryInvestigationV1({
    schemaVersion: "geometry_investigation.v1",
    id: content.id,
    locale,
    title: content.title,
    level: content.level,
    topic: "geometry",
    template: "varignon.v1",
    objective: content.objective,
    targetedDifficulties: content.targetedDifficulties,
    teacherGuidance: content.teacherGuidance,
    assistancePolicy: {
      mode: "standard",
      maxProactiveLevel: 2,
      allowToolActivation: true,
      allowTemporaryHighlight: true,
      allowAssistantVariationAfterConsent: true,
      allowDemonstrationAfterConsent: true,
    },
    scaffold: sharedScaffold,
    missions: content.missions.map(([title, instruction], index) => ({
      id: `V${index + 1}`,
      order: index + 1,
      title,
      instruction,
      ...missionConfiguration[index],
    })),
    relationDefinitions: sharedRelations,
    hintLadder: createHintLadder(locale),
    demonstrationSteps: createDemonstrationSteps(locale),
    conjecturePrompt: content.conjecturePrompt,
    proofPrompts: content.proofPrompts,
    transferPrompt: content.transferPrompt,
  });
}

function createHintLadder(locale: "fr" | "en") {
  const fr = locale === "fr";
  return [
    {
      id: "hint_v1_l1",
      missionId: "V1",
      level: 1,
      prompt: fr
        ? "Qu'est-ce qui distingue un milieu exact d'un point placé à vue ?"
        : "What distinguishes an exact midpoint from a point placed by eye?",
      objectNames: ["A", "B", "C", "D"],
    },
    {
      id: "hint_v1_l2",
      missionId: "V1",
      level: 2,
      prompt: fr
        ? "Utilise l'outil Milieu, puis clique sur les deux extrémités de chaque côté."
        : "Use the Midpoint tool, then click the two endpoints of each side.",
      action: "activate_tool",
      objectNames: ["A", "B", "C", "D"],
    },
    {
      id: "hint_v1_l3",
      missionId: "V1",
      level: 3,
      prompt: fr
        ? "Commence par le côté AB mis en évidence."
        : "Start with the highlighted side AB.",
      action: "highlight_objects",
      objectNames: ["A", "B"],
    },
    {
      id: "hint_v3_l1",
      missionId: "V3",
      level: 1,
      prompt: fr
        ? "Les côtés du quadrilatère initial se croisent-ils ?"
        : "Do any sides of the original quadrilateral cross?",
      objectNames: ["A", "B", "C", "D"],
    },
    {
      id: "hint_v4_l2",
      missionId: "V4",
      level: 2,
      prompt: fr
        ? "Déplace un sommet vers l'intérieur sans faire croiser deux côtés."
        : "Drag one vertex inward without crossing two sides.",
      objectNames: ["A", "B", "C", "D"],
    },
    {
      id: "hint_v5_l2",
      missionId: "V5",
      level: 2,
      prompt: fr
        ? "Cherche une position où deux côtés opposés se coupent."
        : "Look for a position where two opposite sides intersect.",
      objectNames: ["A", "B", "C", "D"],
    },
    {
      id: "hint_v8_l4",
      missionId: "V8",
      level: 4,
      prompt: fr
        ? "Après ta tentative, Compass peut montrer une étape analogue et restaurer ton travail."
        : "After your attempt, Compass can show an analogous step and restore your work.",
      action: "demonstrate_step",
      objectNames: ["E", "F", "G", "H"],
    },
  ] as const;
}

function createDemonstrationSteps(locale: "fr" | "en") {
  const fr = locale === "fr";
  const narration = fr
    ? [
        "E et F sont les milieux de deux côtés du triangle ABC.",
        "Le théorème des milieux donne EF parallèle à AC.",
        "G et H sont les milieux de deux côtés du triangle CDA.",
        "Le théorème des milieux donne GH parallèle à AC.",
        "Ainsi EF et GH sont parallèles.",
        "Le même raisonnement donne FG parallèle à HE.",
        "Les côtés opposés de EFGH sont parallèles : EFGH est un parallélogramme.",
      ]
    : [
        "E and F are the midpoints of two sides of triangle ABC.",
        "The midpoint theorem gives EF parallel to AC.",
        "G and H are the midpoints of two sides of triangle CDA.",
        "The midpoint theorem gives GH parallel to AC.",
        "Therefore EF and GH are parallel.",
        "The same reasoning gives FG parallel to HE.",
        "Both pairs of opposite sides are parallel, so EFGH is a parallelogram.",
      ];
  const objectNames = [
    ["E", "F", "A", "B", "C"],
    ["E", "F", "A", "C"],
    ["G", "H", "C", "D", "A"],
    ["G", "H", "A", "C"],
    ["E", "F", "G", "H"],
    ["F", "G", "H", "E"],
    ["E", "F", "G", "H"],
  ];
  return narration.map((stepNarration, index) => ({
    id: `demo_v8_${index + 1}`,
    missionId: "V8",
    order: index + 1,
    narration: stepNarration,
    operation: index === narration.length - 1 ? "restore" : "highlight",
    objectNames: objectNames[index],
  }));
}

export const VARIGNON_ACTIVITY_FR_V1 = createVarignonActivity("fr");
export const VARIGNON_ACTIVITY_EN_V1 = createVarignonActivity("en");

export function getVarignonActivityV1(
  locale: "fr" | "en",
): GeometryInvestigationV1 {
  return locale === "fr" ? VARIGNON_ACTIVITY_FR_V1 : VARIGNON_ACTIVITY_EN_V1;
}
