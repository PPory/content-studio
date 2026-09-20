import { contentHash } from '../domain/intelligence-quality.mjs';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { xhtmlToMd } from '../lib/books.mjs';

export const REVIEW_RULE_VERSION = 'ai-reading-1.1';
export const processingHash = source => contentHash(JSON.stringify([source.title || '', source.body || '', source.contentStatus || source.readLevel || '', source.sourceKind || source.contentKind || '']));
const direct = /\b(?:ChatGPT|GPT[- ]?\d[\w.-]*|LLMs?|large language models?|generative AI|machine learning|neural networks?|diffusion models?|language models?|Claude(?: Code)?|Gemini|DeepSeek|Qwen|Llama|Codex)\b|人工智能|大语言模型|大模型|生成式|神经网络|机器学习|智能体/iu;
const mechanism = /(?:\bagents?\b.{0,150}\b(?:tools?|MCP|inference|reasoning|autonomous|tasks?|prompts?)\b|\b(?:fine[- ]?tun\w*|tokeni[sz]\w*|inference|transformer|model weights|context window|tool calling|reinforcement learning)\b)|模型.{0,30}(?:推理|训练|参数|权重|上下文)|(?:自主|工具调用|多轮).{0,20}(?:代理|模型)/isu;
const substance = /\b(?:use|using|used|prompt\w*|model\w*|train\w*|inferen\w*|agent\w*|build\w*|research|benchmark|release\w*|launch\w*|eval\w*|reason\w*|capabilit\w*|safety|copyright|lawsuit|regulat\w*)\b|使用|实践|提示词|模型|推理|训练|发布|智能体|评测|研究|监管|版权|安全|能力|应用/iu;
const ambiguous = /\b(?:AI|agents?|models?|MCP|skills?|prompts?|Muse|Instinct|OpenAI|Anthropic|Copilot)\b|模型|代理|人工智能|上下文|提示词/iu;
const lifestyle = /\b(?:Netflix|Apple TV|movies?|TV shows?|linux desktop|Silo season|Severance|racial discrimination)\b|影视推荐|追剧|电视剧|生活方式/iu;
const excerpt = (text, match) => { const start = Math.max(0, (match?.index || 0) - 80); return text.slice(start, start + 300); };

// Publisher, discovery channel, job title and feed name are deliberately absent.
export function classifyAiRelevance(source = {}) {
 const body = String(source.body || ''), text = `${source.title || ''}\n${body}`;
 const hit = text.match(direct) || text.match(mechanism);
 const lead=`${source.title || ''}\n${body.slice(0,600)}`;
 const core=(/\bAI\b|\bRAG\b|retrieval.augmented generation/i.test(source.title||'')||direct.test(source.title||'')||mechanism.test(source.title||'')||((direct.test(lead)||mechanism.test(lead))&&body.length<1000)||mechanism.test(lead));
 if (hit && substance.test(text) && !core) return {relevance:'needs_context',reason:'AI 仅在正文局部出现，尚不能确认它是主体或与核心事件直接相关。',evidence:[excerpt(text,hit)],method:'rules'};
 if (hit && substance.test(text) && core) return {relevance:'ai_relevant',reason:'原文直接讨论模型、智能体或 AI 的具体使用、能力或影响。',evidence:[excerpt(text, hit)],method:'rules'};
 if (lifestyle.test(text) && !hit && !ambiguous.test(text)) return {relevance:'not_ai',reason:'现有正文是影视、生活或普通桌面话题，没有实质 AI 上下文。',evidence:[text.slice(0,300)],method:'rules'};
 if (hit || ambiguous.test(text) || !body.trim() || source.readLevel==='summary') return {relevance:'needs_context',reason:'现有材料不足以确认实质 AI 关系，需补上下文或授权后的语义复核。',evidence:[excerpt(text,text.match(ambiguous))],method:'rules'};
 return {relevance:'not_ai',reason:'已取得的材料未提供直接、实质的 AI 关系。',evidence:[text.slice(0,300)],method:'rules'};
}

export function readingVersion(source = {}) {
 const original = String(source.body || ''); let body = original;
 if (source.sourceKind==='external_digest' && source.metadata?.stream==='hot') {
  let data;try { data=JSON.parse(original); }catch{}
  const story=data?.story || data;
  if (Array.isArray(story?.reports)) body=[story.title,...story.reports.map(r=>[
   '## '+String(r.title||'未提供标题'),r.source?.name ? '发布者：'+r.source.name : '',r.publishedAt?'原始发布时间：'+r.publishedAt:'',r.summary||'',r.links?.original?'原文：'+r.links.original:''
  ].filter(Boolean).join('\n\n'))].filter(Boolean).join('\n\n');
 }

 if (/<(?:html|article|main|div|p)[\s>]/i.test(body)) {
  const {document} = parseHTML(`<html><body>${body}</body></html>`);
  document.querySelectorAll('script,style,nav,header,footer,aside,iframe,form,[role="navigation"],[role="banner"],.cookie-banner,.advertisement').forEach(n=>n.remove());
  const article = new Readability(document).parse();
  body = xhtmlToMd(article?.content || document.body.innerHTML, value => /^https?:\/\//i.test(value) ? value : '');
 }
 body = body.split(/\r?\n/).filter(line=>!/^\s*(?:accept (?:all )?cookies|manage cookies|cookie (?:policy|preferences)|advertisement|skip to (?:main )?content|all rights reserved|订阅广告|接受所有 Cookie|隐私设置)\s*[.!。]?\s*$/i.test(line)).join('\n').replace(/\n{4,}/g,'\n\n\n').trim();
 const text = body.replace(/!?(?:\[[^\]]*\])?\(https?:\/\/[^)]+\)|https?:\/\/\S+/g,'').replace(/[#*_>`|\s]/g,'');
 const bad = /^(?:404|403|500|502|access denied|forbidden|page not found|just a moment|enable javascript|checking your browser|请求失败|页面不存在)/i.test(body.trim()) || (!text || text.length < 12);
 let readability = bad ? (original.trim() ? 'body_failed' : 'metadata') : source.contentStatus==='context_missing' ? 'body_failed' : /podcast|transcript/.test(source.sourceKind || source.contentKind || '') ? 'transcript' : source.readLevel==='original' || source.contentStatus==='full_text' ? (/post|comment|tweet/.test(source.sourceKind || source.contentKind || '') && source.metadata?.bodyOrigin!=='github_readme' ? 'short_content':'full_text') : text.length>=80 ? 'summary' : 'metadata';
 if (/^(?:home|about|contact|login|sign in|menu|首页|登录|导航)(?:\s*[|·\n]\s*(?:home|about|contact|login|sign in|menu|privacy|首页|登录|导航|关于我们))+$/i.test(body)) readability='body_failed';
 // Convert only timestamps and speaker labels actually present in the transcript.
 if (readability==='transcript') body=body.replace(/^(Speaker \d+\s*\|\s*\d{1,2}:\d{2}(?::\d{2})?\s*-\s*\d{1,2}:\d{2}(?::\d{2})?)$/gm,'### $1');
 return {readability,readingBody:body,readable:['full_text','short_content','transcript','summary'].includes(readability),readingReason:bad?'仅链接、元数据或正文失败，不能进入默认阅读列表。':readability==='summary'?'仅取得摘要，不代表全文。':readability==='metadata'?'有效正文不足，等待补全。':'保留实际取得的正文；阅读版只做结构整理。'};
}
