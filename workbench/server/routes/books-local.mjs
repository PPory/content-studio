import path from "node:path";
import { fail, json, readJsonBody, readRawBody } from "../lib/http.mjs";
import { parseEpub, parsePdf, safeName, SUPPORTED } from "../lib/books.mjs";
import { createUlid } from "../storage/ids.mjs";

const iso = (value = new Date()) => new Date(value).toISOString();
const parseJson = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };
const bookIdOf = (value) => String(value || "").replace(/^book(?:notes)?:/, "").split(":")[0];
const documentIdOf = (value) => String(value || "").replace(/^bookdoc:/, "").replace(/\.highlights\.md$/i, "");

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

function guard(handler) {
  return async (context) => {
    try { await handler({ ...context, workspace: await ready(context.workspace) }); }
    catch (error) { fail(context.res, error.message || "书架操作失败", { status: error.status || (/不存在|找不到/.test(error.message || "") ? 404 : 400), hint: error.hint }); }
  };
}

function docs(workspace, bookId) {
  return workspace.db.prepare(`SELECT d.*, e.version, e.updated_at FROM book_documents d
    JOIN entities e ON e.id=d.id AND e.deleted_at IS NULL WHERE d.book_id=? ORDER BY d.document_order`).all(bookId);
}

function bookDto(workspace, row) {
  const metadata = parseJson(row.metadata_json);
  const chapters = docs(workspace, row.id);
  const mapped = chapters.map((item) => ({ file: item.id, title: item.title || row.title, order: item.document_order, chars: item.body_markdown.length, path: `bookdoc:${item.id}` }));
  return {
    id: row.id,
    name: row.title,
    title: row.title,
    dir: `book:${row.id}`,
    bookPath: mapped[0]?.path || "",
    notePath: `booknotes:${row.id}`,
    cover: metadata.coverAssetId ? `asset://${metadata.coverAssetId}` : "",
    chapters: mapped.length > 1 ? mapped : [],
    chapterCount: mapped.length,
    kind: metadata.kind || "资料",
    sourceKind: row.source_kind || "书籍",
    author: row.author || "",
    status: row.reading_status,
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    importedAt: metadata.importedAt || String(row.created_at || "").slice(0, 10),
    excerpt: chapters[0]?.body_markdown?.slice(0, 160) || "",
  };
}

function getBook(workspace, bookId, { deleted = false } = {}) {
  const row = workspace.db.prepare(`SELECT b.*, e.created_at, e.updated_at, e.deleted_at FROM books b JOIN entities e ON e.id=b.id
    WHERE b.id=? ${deleted ? "" : "AND e.deleted_at IS NULL"}`).get(bookId);
  if (!row) throw new Error("书籍不存在");
  return row;
}

function getDocument(workspace, documentId) {
  const row = workspace.db.prepare(`SELECT d.*, e.version FROM book_documents d
    JOIN entities e ON e.id=d.id AND e.deleted_at IS NULL
    JOIN books b ON b.id=d.book_id
    JOIN entities be ON be.id=b.id AND be.deleted_at IS NULL
    WHERE d.id=?`).get(documentId);
  if (!row) throw new Error("文档不存在");
  return row;
}

function setBookDeleted(workspace, bookId, deleted) {
  const book = getBook(workspace, bookId, { deleted: true });
  const condition = deleted ? "e.deleted_at IS NULL" : "e.deleted_at=?";
  const params = deleted ? [bookId] : [bookId, book.deleted_at];
  const documentIds = workspace.db.prepare(`SELECT d.id FROM book_documents d JOIN entities e ON e.id=d.id WHERE d.book_id=? AND ${condition}`).all(...params).map((row) => row.id);
  const markIds = workspace.db.prepare(`SELECT m.id FROM book_marks m JOIN entities e ON e.id=m.id WHERE m.book_id=? AND ${condition}`).all(...params).map((row) => row.id);
  const method = deleted ? "softDeleteEntity" : "restoreEntity";
  const orderedIds = deleted ? [...markIds, ...documentIds, bookId] : [bookId, ...documentIds, ...markIds];
  const stamp = new Date();
  workspace.repository.transaction(() => {
    for (const id of orderedIds) workspace.domain[method](id, { actor: "user", now: stamp });
  });
}

function noteItems(workspace, bookId) {
  return workspace.db.prepare(`SELECT m.id AS "index", m.quote_text AS quote, m.note_markdown AS body, CAST(e.version AS TEXT) AS stamp, m.created_at AS at,
      '本地书架' AS source, d.title, d.id AS documentId
    FROM book_marks m JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL
    JOIN book_documents d ON d.id=m.document_id WHERE m.book_id=? AND m.mark_kind='note' ORDER BY m.created_at`).all(bookId);
}

function notesMarkdown(items) {
  return items.map((item) => `## ${item.at || item.stamp}\n\n> ${item.quote}\n\n${item.body}`).join("\n\n---\n\n");
}

function highlights(workspace, documentId) {
  return workspace.db.prepare(`SELECT m.id, m.quote_text AS text, m.color FROM book_marks m JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL
    WHERE m.document_id=? AND m.mark_kind='highlight' ORDER BY m.created_at`).all(documentId);
}

function mimeOf(name) {
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".epub": "application/epub+zip", ".pdf": "application/pdf", ".md": "text/markdown", ".markdown": "text/markdown", ".txt": "text/plain" })[path.extname(name).toLowerCase()] || "application/octet-stream";
}

function parseText(text) {
  const source = String(text || "");
  const matches = [...source.matchAll(/^#\s+(.+)$/gm)];
  if (matches.length < 3) return { text: source };
  return { chapters: matches.map((match, index) => ({ title: match[1].trim(), text: source.slice(match.index + match[0].length, matches[index + 1]?.index ?? source.length).trim() })) };
}

async function parsedBook(fileName, bytes) {
  const ext = path.extname(fileName).toLowerCase();
  if (!SUPPORTED.includes(ext)) throw Object.assign(new Error(`不支持 ${ext || "这种"} 格式，只能导入 ${SUPPORTED.join(" / ")}`), { status: 400 });
  if (ext === ".epub") return parseEpub(bytes);
  if (ext === ".pdf") return parsePdf(bytes);
  return parseText(new TextDecoder("utf-8").decode(bytes));
}

export async function createBookRecord(workspace, { title, author = "", kind = "资料", sourceKind = "书籍", sourceAssetId = null, coverAssetId = null, chapters = [], importedAt = iso().slice(0, 10) }) {
  const id = createUlid();
  const stamp = new Date();
  const normalized = chapters.length ? chapters : [{ title, text: "" }];
  workspace.repository.transaction(() => {
    workspace.repository.createEntity({ id, type: "book", now: stamp });
    workspace.db.prepare("INSERT INTO books(id,title,author,reading_status,source_asset_id,metadata_json,source_kind) VALUES (?,?,?,?,?,?,?)")
      .run(id, title, author, "在读", sourceAssetId, JSON.stringify({ kind, coverAssetId, tags: [], importedAt }), sourceKind);
    workspace.repository.setEntityText(id, { title, body: normalized.map((item) => item.text).join("\n\n"), now: stamp });
    normalized.forEach((chapter, index) => {
      const documentId = createUlid();
      const chapterTitle = safeName(chapter.title || (normalized.length === 1 ? title : `第 ${index + 1} 节`), 100) || title;
      const body = String(chapter.text || "").trim();
      workspace.repository.createEntity({ id: documentId, type: "book_document", now: stamp });
      workspace.db.prepare("INSERT INTO book_documents(id,book_id,title,body_markdown,document_order) VALUES (?,?,?,?,?)").run(documentId, id, chapterTitle, body, index + 1);
      workspace.repository.setEntityText(documentId, { title: chapterTitle, body, now: stamp });
      workspace.domain.saveRevision(documentId, { title: chapterTitle, bodyMarkdown: body, authorKind: "import", reason: "book import", now: stamp });
    });
    workspace.domain.audit("book.created", id, { chapters: normalized.length, sourceAssetId }, stamp);
  });
  return bookDto(workspace, getBook(workspace, id));
}

function marksForBook(workspace, bookId) {
  const chapters = docs(workspace, bookId).map((document) => {
    const items = workspace.db.prepare(`SELECT m.id,m.mark_kind AS kind,m.quote_text AS quote,m.note_markdown AS note,m.color,m.created_at AS at
      FROM book_marks m JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL WHERE m.document_id=? ORDER BY m.created_at`).all(document.id);
    return { file: document.id, path: `bookdoc:${document.id}`, label: document.title, items: items.map((item) => ({ ...item, at: item.kind === "highlight" ? "" : item.at })) };
  }).filter((chapter) => chapter.items.length);
  const all = chapters.flatMap((chapter) => chapter.items);
  return { chapters, total: all.length, highlights: all.filter((item) => item.kind === "highlight").length, notes: all.filter((item) => item.kind === "note").length, unplaced: 0 };
}

export const localBookRoutes = [
  { method: "GET", path: "/api/workspace/books", handler: guard(async ({ workspace, res }) => {
    const rows = workspace.db.prepare("SELECT b.*,e.created_at,e.updated_at FROM books b JOIN entities e ON e.id=b.id AND e.deleted_at IS NULL ORDER BY e.updated_at DESC").all();
    json(res, { ok: true, shelfDir: "local", exists: true, books: rows.map((row) => bookDto(workspace, row)) });
  }) },
  { method: "POST", path: "/api/workspace/books", handler: guard(async ({ workspace, req, res }) => {
    const body = await readJsonBody(req); const title = safeName(body.name, 100); if (!title) throw new Error("书名不能为空");
    json(res, { ok: true, book: await createBookRecord(workspace, { title, kind: "资料", chapters: [{ title, text: body.content || "" }] }) });
  }) },
  { method: "POST", path: "/api/workspace/books/import", handler: guard(async ({ workspace, req, res, url }) => {
    const fileName = url.searchParams.get("filename") || ""; const bytes = await readRawBody(req); if (!bytes.length) throw new Error("文件是空的");
    const parsed = await parsedBook(fileName, bytes); const title = safeName(url.searchParams.get("name") || parsed.title || path.basename(fileName, path.extname(fileName)), 100); if (!title) throw new Error("书名不能为空");
    const source = await workspace.assets.importBuffer({ bytes, type: "book", originalName: fileName, mimeType: mimeOf(fileName) });
    const imageUris = new Map();
    for (const image of parsed.images || []) { const asset = await workspace.assets.importBuffer({ bytes: image.bytes, type: "image", originalName: image.name, mimeType: mimeOf(image.name) }); imageUris.set(image.name, asset.uri); }
    let coverAssetId = null;
    if (parsed.cover?.bytes) coverAssetId = (await workspace.assets.importBuffer({ bytes: parsed.cover.bytes, type: "image", originalName: parsed.cover.name || "cover.jpg", mimeType: mimeOf(parsed.cover.name || "cover.jpg") })).id;
    const sourceChapters = parsed.chapters?.length ? parsed.chapters : [{ title, text: parsed.text || "" }];
    const chapters = sourceChapters.map((chapter) => ({ ...chapter, text: [...imageUris].reduce((text, [name, uri]) => String(text).split(name).join(uri), String(chapter.text || "")) }));
    const book = await createBookRecord(workspace, { title, author: parsed.author || "", kind: "藏书", sourceAssetId: source.id, coverAssetId, chapters });
    json(res, { ok: true, book, supported: SUPPORTED });
  }) },
  { method: "POST", path: "/api/workspace/books/kind", handler: guard(async ({ workspace, req, res }) => {
    const body = await readJsonBody(req); if (!["资料", "藏书"].includes(body.kind)) throw new Error("类型只能是资料或藏书"); const id = bookIdOf(body.dir); const row = getBook(workspace, id); const metadata = { ...parseJson(row.metadata_json), kind: body.kind };
    workspace.db.prepare("UPDATE books SET metadata_json=? WHERE id=?").run(JSON.stringify(metadata), id); workspace.domain.touch(id, new Date()); workspace.domain.audit("book.kind_updated", id, { kind: body.kind }, new Date()); json(res, { ok: true, dir: body.dir, kind: body.kind });
  }) },
  { method: "POST", path: "/api/workspace/books/trash", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const id=bookIdOf(body.dir); setBookDeleted(workspace,id,true); json(res,{ok:true,from:`book:${id}`,to:`book:${id}`,recoverable:true}); }) },
  { method: "POST", path: "/api/workspace/books/restore", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const id=bookIdOf(body.from||body.to); setBookDeleted(workspace,id,false); json(res,{ok:true,from:`book:${id}`,to:`book:${id}`}); }) },
  { method: "POST", path: "/api/workspace/books/cover", handler: guard(async ({ workspace, req, res, url }) => { const id=bookIdOf(url.searchParams.get("dir")); const row=getBook(workspace,id); const bytes=await readRawBody(req,12_000_000); if(!bytes.length) throw new Error("文件是空的"); const name=`cover${url.searchParams.get("ext")||".jpg"}`; const asset=await workspace.assets.importBuffer({bytes,type:"image",originalName:name,mimeType:mimeOf(name)}); const metadata={...parseJson(row.metadata_json),coverAssetId:asset.id}; workspace.db.prepare("UPDATE books SET metadata_json=? WHERE id=?").run(JSON.stringify(metadata),id); workspace.domain.touch(id,new Date()); json(res,{ok:true,cover:asset.uri}); }) },
  { method: "GET", path: "/api/workspace/books/search", handler: guard(async ({ workspace, res, url }) => { const id=bookIdOf(url.searchParams.get("dir")); getBook(workspace,id); const q=String(url.searchParams.get("q")||"").trim(); const results=!q?[]:docs(workspace,id).map((doc)=>{const at=doc.body_markdown.toLowerCase().indexOf(q.toLowerCase()); return at<0?null:{path:`bookdoc:${doc.id}`,title:doc.title,hits:[{text:doc.body_markdown.slice(Math.max(0,at-60),at+q.length+100),at:Math.min(60,at),len:q.length}]};}).filter(Boolean); json(res,{ok:true,q,results}); }) },
  { method: "GET", path: "/api/workspace/doc", handler: guard(async ({ workspace, res, url }) => { const id=documentIdOf(url.searchParams.get("path")); const doc=getDocument(workspace,id); const items=noteItems(workspace,doc.book_id); json(res,{ok:true,path:`bookdoc:${id}`,meta:{},content:doc.body_markdown,stamp:String(doc.version),notePath:`booknotes:${doc.book_id}`,notes:notesMarkdown(items),noteItems:items}); }) },
  { method: "POST", path: "/api/workspace/doc", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const id=documentIdOf(body.path); const doc=getDocument(workspace,id); const book=getBook(workspace,doc.book_id); if((parseJson(book.metadata_json).kind||"资料")==="藏书") throw new Error("藏书正文只读，请先明确改为资料"); if(body.stamp && String(body.stamp)!==String(doc.version)) return fail(res,"正文已在别处更新，请刷新后再保存",{status:409}); const stamp=new Date(); workspace.repository.transaction(()=>{workspace.db.prepare("UPDATE book_documents SET body_markdown=? WHERE id=?").run(String(body.content||""),id); workspace.repository.setEntityText(id,{title:doc.title,body:String(body.content||""),now:stamp}); workspace.domain.saveRevision(id,{title:doc.title,bodyMarkdown:String(body.content||""),authorKind:"user",reason:"book edit",now:stamp}); workspace.domain.touch(id,stamp); workspace.domain.touch(doc.book_id,stamp); workspace.domain.audit("book.document_updated",id,{bookId:doc.book_id},stamp);}); json(res,{ok:true,stamp:String(workspace.repository.getEntity(id).version)}); }) },
  { method: "GET", path: "/api/workspace/highlights", handler: guard(async ({ workspace, res, url }) => { const id=documentIdOf(url.searchParams.get("path")); getDocument(workspace,id); json(res,{ok:true,path:url.searchParams.get("path"),highlights:highlights(workspace,id)}); }) },
  { method: "POST", path: "/api/workspace/highlights", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const id=documentIdOf(body.path); const doc=getDocument(workspace,id); const text=String(body.add?.text||body.remove?.text||"").replace(/\s+/g," ").trim(); const existing=workspace.db.prepare("SELECT id FROM book_marks WHERE document_id=? AND mark_kind='highlight' AND quote_text=?").get(id,text); if(body.remove&&existing) workspace.domain.softDeleteEntity(existing.id,{actor:"user",now:new Date()}); else if(body.add&&text&&!existing){const markId=createUlid(),stamp=new Date(); workspace.repository.transaction(()=>{workspace.repository.createEntity({id:markId,type:"book_mark",now:stamp});workspace.db.prepare("INSERT INTO book_marks(id,book_id,document_id,mark_kind,quote_text,color,created_at) VALUES (?,?,?,'highlight',?,?,?)").run(markId,doc.book_id,id,text,body.add.color||"yellow",iso(stamp));workspace.repository.setEntityText(markId,{title:"高亮",body:text,now:stamp});});} json(res,{ok:true,highlights:highlights(workspace,id)}); }) },
  { method: "POST", path: "/api/workspace/note", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const bookId=bookIdOf(body.path); getBook(workspace,bookId); const all=docs(workspace,bookId); const norm=String(body.quote||"").replace(/\s+/g,""); const document=all.find((doc)=>doc.body_markdown.replace(/\s+/g,"").includes(norm))||all[0]; if(!document) throw new Error("书籍没有正文"); const id=createUlid(),stamp=new Date(); workspace.repository.transaction(()=>{workspace.repository.createEntity({id,type:"book_mark",now:stamp});workspace.db.prepare("INSERT INTO book_marks(id,book_id,document_id,mark_kind,quote_text,note_markdown,created_at) VALUES (?,?,?,'note',?,?,?)").run(id,bookId,document.id,String(body.quote||""),String(body.body||""),iso(stamp));workspace.repository.setEntityText(id,{title:"批注",body:`${body.quote||""}\n\n${body.body||""}`,now:stamp});}); const items=noteItems(workspace,bookId); json(res,{ok:true,notes:notesMarkdown(items),noteItems:items}); }) },
  { method: "POST", path: "/api/workspace/note/edit", handler: guard(async ({ workspace, req, res }) => { const body=await readJsonBody(req); const bookId=bookIdOf(body.path); getBook(workspace,bookId); const id=String(body.index||""); const entity=workspace.repository.getEntity(id); const mark=workspace.db.prepare("SELECT * FROM book_marks WHERE id=? AND book_id=? AND mark_kind='note'").get(id,bookId); if(!entity||!mark) throw new Error("批注不存在"); if(body.stamp&&String(body.stamp)!==String(entity.version)) throw Object.assign(new Error("批注已更新，请刷新后重试"),{status:409}); if(body.remove) workspace.domain.softDeleteEntity(id,{actor:"user",now:new Date()}); else {const stamp=new Date();workspace.db.prepare("UPDATE book_marks SET note_markdown=? WHERE id=?").run(String(body.body||""),id);workspace.repository.setEntityText(id,{title:"批注",body:`${mark.quote_text}\n\n${body.body||""}`,now:stamp});workspace.domain.touch(id,stamp);} const items=noteItems(workspace,bookId); json(res,{ok:true,notes:notesMarkdown(items),noteItems:items}); }) },
  { method: "GET", path: "/api/workspace/book-marks", handler: guard(async ({ workspace, res, url }) => { const bookId=bookIdOf(url.searchParams.get("dir")); getBook(workspace,bookId); json(res,{ok:true,dir:url.searchParams.get("dir"),...marksForBook(workspace,bookId)}); }) },
  { method: "GET", path: "/api/workspace/recent-marks", handler: guard(async ({ workspace, res, url }) => { const limit=Math.min(50,Math.max(1,Number(url.searchParams.get("limit"))||12)); const rows=workspace.db.prepare(`SELECT m.id,m.mark_kind AS kind,m.quote_text AS quote,m.note_markdown AS note,m.color,CASE WHEN m.mark_kind='note' THEN m.created_at ELSE '' END AS at,b.title AS book,b.id AS bookId,d.title AS chapter,d.id AS documentId FROM book_marks m JOIN entities e ON e.id=m.id AND e.deleted_at IS NULL JOIN books b ON b.id=m.book_id JOIN entities be ON be.id=b.id AND be.deleted_at IS NULL JOIN book_documents d ON d.id=m.document_id ORDER BY m.created_at DESC`).all(); const items=rows.map((row)=>({...row,bookDir:`book:${row.bookId}`,path:`bookdoc:${row.documentId}`})); json(res,{ok:true,items:items.slice(0,limit),total:items.length}); }) },
];
