export function createDefaultJobHandlers(workspace) {
  return {
    "pipeline.dispatch": async () => {
      const captures = workspace.db.prepare(`SELECT c.id FROM captures c
        JOIN entities e ON e.id = c.id AND e.deleted_at IS NULL
        WHERE c.status IN ('pending', 'needs_review') ORDER BY e.updated_at, c.id LIMIT 100`).all();
      const projects = workspace.db.prepare(`SELECT p.id FROM projects p
        JOIN entities e ON e.id = p.id AND e.deleted_at IS NULL
        WHERE p.status = 'generating' ORDER BY e.updated_at, p.id LIMIT 100`).all();
      return {
        mode: "candidate-input-scan",
        captureIds: captures.map((item) => item.id),
        projectIds: projects.map((item) => item.id),
      };
    },
    "materials.synthesize": async () => {
      const materials = workspace.db.prepare(`SELECT m.id FROM materials m
        JOIN entities e ON e.id = m.id AND e.deleted_at IS NULL
        WHERE m.verification_status <> '待核验'
        ORDER BY e.updated_at DESC, m.id DESC LIMIT 300`).all();
      return {
        mode: "candidate-input-scan",
        materialIds: materials.map((item) => item.id),
      };
    },
  };
}
