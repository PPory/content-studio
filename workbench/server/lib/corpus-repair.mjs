import crypto from "node:crypto";
import { createUlid } from "../storage/ids.mjs";

function activeDocuments(workspace, bookId) {
  return workspace.db.prepare("SELECT d.id,d.title,d.body_markdown AS text,d.document_order AS documentOrder FROM book_documents d JOIN entities e ON e.id=d.id AND e.deleted_at IS NULL WHERE d.book_id=? ORDER BY d.document_order").all(bookId);
}

export function planExistingCourseRepair(workspace, book, chapters) {
  const current = activeDocuments(workspace, book.id);
  const unused = [...current];
  const wanted = chapters.map((chapter, index) => {
    const exact = unused.findIndex((item) => item.title === chapter.title);
    const prefixed = unused.findIndex((item) => item.title.startsWith(chapter.title + " · "));
    const found = exact >= 0 ? exact : prefixed;
    return { ...chapter, order: index + 1, reused: found >= 0 ? unused.splice(found, 1)[0] : null };
  });
  const ids = current.map((item) => item.id);
  if (!ids.length) return { current, wanted, removed: unused, references: {}, blocked: false };
  const marks = ids.map(() => "?").join(",");
  const count = (sql, values = ids) => workspace.db.prepare(sql).get(...values).count;
  const references = {
    "提炼记录": count("SELECT COUNT(*) AS count FROM source_ingests WHERE source_entity_id IN (" + marks + ")"),
    "词条事实": count("SELECT COUNT(*) AS count FROM entry_facts WHERE source_entity_id IN (" + marks + ")"),
    "词条定义": count("SELECT COUNT(*) AS count FROM entries WHERE definition_source_id IN (" + marks + ")"),
    "关系证据": count("SELECT COUNT(*) AS count FROM entry_relation_evidence WHERE source_entity_id IN (" + marks + ")"),
    "标注批注": count("SELECT COUNT(*) AS count FROM book_marks WHERE document_id IN (" + marks + ")"),
    "待确认候选": count("SELECT COUNT(*) AS count FROM action_candidates WHERE target_id IN (" + marks + ") OR json_extract(payload_json, '$.sourceId') IN (" + marks + ")", [...ids, ...ids]),
    "后台任务": count("SELECT COUNT(*) AS count FROM local_jobs WHERE json_extract(payload_json, '$.sourceId') IN (" + marks + ")"),
  };
  return { current, wanted, removed: unused, references, blocked: Object.values(references).some(Boolean) };
}

export function applyExistingCourseRepair(workspace, book, plan) {
  if (plan.blocked) throw new Error("现有章节已有提炼、引用、标注或任务，不能自动覆盖；请先人工对账。");
  const stamp = new Date();
  const combinedBody = plan.wanted.map((item) => String(item.text || "").trim()).join("\n\n");
  const fingerprint = crypto.createHash("sha256").update(combinedBody).digest("hex");
  workspace.repository.transaction(() => {
    workspace.db.prepare("UPDATE book_documents SET document_order=document_order+10000 WHERE book_id=?").run(book.id);
    for (const item of plan.wanted) {
      const title = String(item.title || "").slice(0, 100);
      const body = String(item.text || "").trim();
      const id = item.reused?.id || createUlid();
      if (item.reused) workspace.db.prepare("UPDATE book_documents SET title=?,body_markdown=?,document_order=? WHERE id=?").run(title, body, item.order, id);
      else {
        workspace.repository.createEntity({ id, type: "book_document", now: stamp });
        workspace.db.prepare("INSERT INTO book_documents(id,book_id,title,body_markdown,document_order) VALUES (?,?,?,?,?)").run(id, book.id, title, body, item.order);
      }
      workspace.repository.setEntityText(id, { title, body, now: stamp });
      workspace.domain.saveRevision(id, { title, bodyMarkdown: body, authorKind: "import", reason: "repair source file boundary", now: stamp });
    }
    for (const item of plan.removed) workspace.repository.softDeleteEntity(item.id, { now: stamp });
    workspace.db.prepare("UPDATE books SET content_sha256=? WHERE id=?").run(fingerprint, book.id);
    workspace.repository.setEntityText(book.id, { title: book.title, body: combinedBody, now: stamp });
    workspace.db.prepare("UPDATE entities SET updated_at=?,version=version+1 WHERE id=?").run(stamp.toISOString(), book.id);
    workspace.domain.audit("book.chapter_boundaries_repaired", book.id, { before: plan.current.length, after: plan.wanted.length, removed: plan.removed.length }, stamp);
  });
}