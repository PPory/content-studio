import { assertXmlStructure } from '../acquisition/parsing.mjs';
import { DOMParser, parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { assertPublicArticleUrl } from '../lib/article.mjs';
import { proxyFetch } from '../lib/fetch.mjs';
import { xhtmlToMd } from '../lib/books.mjs';
import { createUlid } from '../storage/ids.mjs';
import { addIntelligenceSource } from './intelligence.mjs';
import { canonicalSourceUrl, sourceFromRow } from './intelligence-quality.mjs';

const now = () => new Date().toISOString();
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const categories = ['official', 'practice', 'questions', 'deep', 'adjacent'];
const formats = ['rss', 'atom', 'github', 'manual'];
const active = new WeakSet();
// These are channel addresses, not a claim that their content has been collected.
// Manual channels intentionally have no automatic adapter. Health is observed at runtime.
export const INTELLIGENCE_CHANNEL_CATALOG = [
  ['openai','OpenAI 官方动态','https://openai.com/news/rss.xml','official','rss',true],
  ['huggingface','Hugging Face 实践与模型','https://huggingface.co/blog/feed.xml','official','rss',true],
  ['google-ai','Google AI','https://blog.google/technology/ai/rss/','official','rss',false],
  ['deepmind','Google DeepMind','https://deepmind.google/blog/rss.xml','official','rss',false],
  ['github','GitHub Blog','https://github.blog/feed/','official','rss',false],
  ['cloudflare','Cloudflare 实践','https://blog.cloudflare.com/rss/','practice','rss',true],
  ['microsoft-research','Microsoft Research','https://www.microsoft.com/en-us/research/feed/','official','rss',false],
  ['ollama','Ollama 版本发布','https://api.github.com/repos/ollama/ollama/releases?per_page=10','official','github',true],
  ['open-webui','Open WebUI 版本发布','https://api.github.com/repos/open-webui/open-webui/releases?per_page=10','practice','github',false],
  ['simonwillison','Simon Willison · AI 实践','https://simonwillison.net/atom/entries/','practice','atom',true],
  ['jvns','Julia Evans · 学习与实践','https://jvns.ca/atom.xml','practice','atom',false],
  ['interconnected','Matt Webb · Interconnected','https://interconnected.org/home/feed','practice','rss',false],
  ['martinfowler','Martin Fowler','https://martinfowler.com/feed.atom','deep','atom',false],
  ['oneusefulthing','Ethan Mollick · One Useful Thing','https://www.oneusefulthing.org/feed','deep','rss',true],
  ['interconnects','Nathan Lambert · Interconnects','https://www.interconnects.ai/feed','deep','rss',false],
  ['importai','Jack Clark · Import AI','https://importai.substack.com/feed','deep','rss',false],
  ['latentspace','Latent Space','https://www.latent.space/feed','deep','rss',true],
  ['hn-ask','Ask Hacker News · 用户问题','https://hnrss.org/ask','questions','rss',true],
  ['hf-discuss','Hugging Face · 用户讨论','https://discuss.huggingface.co/latest.rss','questions','rss',true],
  ['python-discuss','Python · 使用讨论','https://discuss.python.org/latest.rss','questions','rss',false],
  ['openai-community','OpenAI 开发者社区','https://community.openai.com/','questions','manual',false],
  ['austinkleon','Austin Kleon · 创作','https://austinkleon.com/feed/','adjacent','rss',true],
  ['nesslabs','Ness Labs · 思考与学习','https://nesslabs.com/feed','adjacent','rss',false],
  ['farnamstreet','Farnam Street · 判断与思考','https://fs.blog/feed/','adjacent','rss',false],
  ['sspai','少数派 · 个人生产力','https://sspai.com/feed','adjacent','rss',true],
  ['ruanyifeng','阮一峰 · 科技与创造','https://www.ruanyifeng.com/blog/atom.xml','adjacent','atom',true],
  ['anthropic','Anthropic 官方动态（人工）','https://www.anthropic.com/news','official','manual',false],
  ['figma','Figma 设计实践（人工）','https://www.figma.com/blog/','adjacent','manual',false],
].map(([slug,name,url,category,format,enabled]) => ({id:`channel-${slug}`,name,url,siteUrl:new URL(url).origin,category,format,enabled,publisherKey:format==='github'?new URL(url).pathname.split('/').slice(1,4).join('/'):(slug==='hn-ask'?'news.ycombinator.com':new URL(url).hostname.replace(/^www\./,''))}));

function view(row) {
  return {id:row.id,name:row.name,url:row.url,siteUrl:row.site_url,format:row.format,category:row.category,publisherKey:row.publisher_key,enabled:Boolean(row.enabled),builtin:Boolean(row.builtin),health:row.health,lastAttemptAt:row.last_attempt_at,lastSuccessAt:row.last_success_at,lastError:row.last_error,consecutiveFailures:row.consecutive_failures,lastItemCount:row.last_item_count,createdAt:row.created_at,updatedAt:row.updated_at};
}
export function ensureIntelligenceChannels(w) {
  const insert = w.db.prepare('INSERT OR IGNORE INTO intel_channels(id,name,url,site_url,format,category,publisher_key,enabled,builtin,health,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?,?)');
  w.db.transaction(() => {const at=now();for(const c of INTELLIGENCE_CHANNEL_CATALOG)insert.run(c.id,c.name,c.url,c.siteUrl,c.format,c.category,c.publisherKey,Number(c.enabled),c.format==='manual'?'manual':'never',at,at);})();
}
export function intelligenceChannels(w) {
  const channels=w.db.prepare("SELECT * FROM intel_channels WHERE id LIKE 'channel-%' OR builtin=0 ORDER BY enabled DESC,category,name").all().map(view);
  return {channels,summary:{total:channels.length,enabled:channels.filter(c=>c.enabled&&c.format!=='manual').length,healthy:channels.filter(c=>['ok','empty','not_modified'].includes(c.health)).length,failed:channels.filter(c=>['partial','failed'].includes(c.health)).length,manual:channels.filter(c=>c.format==='manual').length}};
}
// URL validation is repeated for every redirect and item; catalog entries get no exemption.
export async function assertChannelUrl(value, deps={}) {
  let target;try{target=new URL(value);}catch{throw bad('请输入完整的公开网址');}
  if(!['https:','http:'].includes(target.protocol)||target.username||target.password||target.hash||(target.port&&!['80','443'].includes(target.port)))throw bad('渠道仅支持不含账号和非标准端口的公开 HTTP(S) 网址');
  const host=target.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(host.includes(':')||/^(localhost|0\.0\.0\.0|127\.|10\.|169\.254\.|192\.168\.)/.test(host)||/\.(local|internal|localhost)\.?$/.test(host))throw bad('不能采集本机、内网或云元数据地址');
  await (deps.assertPublicUrl||assertPublicArticleUrl)(target.href);
  return target;
}
export async function saveIntelligenceChannel(w,input,deps={}) {
  ensureIntelligenceChannels(w);
  const old=input.id?w.db.prepare('SELECT * FROM intel_channels WHERE id=?').get(String(input.id)):null;
  if(input.id&&!old)throw bad('渠道不存在',404);
  const base=old?view(old):{},c={...base,...input};
  if(typeof c.name!=='string'||!c.name.trim()||c.name.length>120)throw bad('渠道名称不能为空，最多120字');
  if(!formats.includes(c.format||'rss')||!categories.includes(c.category||'practice'))throw bad('渠道类型或分类无效');
  if(c.enabled!==undefined&&typeof c.enabled!=='boolean')throw bad('启用状态无效');
  const urlChanged=!old||c.url!==old.url;
  const target=urlChanged?await assertChannelUrl(c.url,deps):new URL(c.url);
  if((c.format||'rss')==='github'&&!(target.hostname==='api.github.com'&&/^\/repos\/[\w.-]+\/[\w.-]+\/releases$/.test(target.pathname)))throw bad('GitHub 渠道请使用公开仓库 releases API 地址');
  if(c.format==='manual'&&c.enabled)throw bad('人工渠道只能手动阅读，不能自动采集');
  const duplicate=w.db.prepare('SELECT id FROM intel_channels WHERE url=?').get(target.href);
  if(duplicate&&duplicate.id!==old?.id)throw bad('这个渠道地址已经存在',409);
  const id=old?.id||createUlid(),at=now(),reset=urlChanged||(old&&c.format!==old.format);
  w.db.prepare(`INSERT INTO intel_channels(id,name,url,site_url,format,category,publisher_key,enabled,builtin,health,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,site_url=excluded.site_url,format=excluded.format,category=excluded.category,publisher_key=excluded.publisher_key,enabled=excluded.enabled,updated_at=excluded.updated_at`).run(id,c.name.trim(),target.href,target.origin,c.format||'rss',c.category||'practice',(c.format==='github'?target.pathname.split('/').slice(1,4).join('/'):(old?.publisher_key&&target.href===old.url?old.publisher_key:target.hostname.replace(/^www\./,''))),Number(c.enabled??false),(c.format==='manual'?'manual':'never'),old?.created_at||at,at);
  if(reset)w.db.prepare("UPDATE intel_channels SET etag='',last_modified='',health=?,last_attempt_at=NULL,last_success_at=NULL,last_error='',consecutive_failures=0,last_item_count=0 WHERE id=?").run(c.format==='manual'?'manual':'never',id);
  if(w.db.pragma('user_version',{simple:true})>=29 && old?.stable_key) {
    if(input.enabled!==undefined)w.db.prepare('UPDATE intel_channels SET desired_enabled=?,user_disabled=?,next_due_at=NULL WHERE id=?').run(Number(input.enabled),Number(!input.enabled),id);
    if(reset)w.db.prepare("UPDATE intel_channels SET validation_status='pending',next_due_at=NULL WHERE id=?").run(id);
  }
  return view(w.db.prepare('SELECT * FROM intel_channels WHERE id=?').get(id));
}

const text = node => node?.textContent?.trim()||'';
function child(node,name){return [...node.children].find(n=>n.localName?.split(':').at(-1)===name||n.nodeName===name);}
function date(value){const n=Date.parse(value);return Number.isFinite(n)?new Date(n).toISOString():null;}
export function parseChannelFeed(raw, channel) {
  if(channel.format==='github'){
    let rows;try{rows=JSON.parse(raw);}catch{throw bad('GitHub 返回了无效 JSON');}
    if(!Array.isArray(rows))throw bad('GitHub 返回内容不是版本列表');
    return rows.filter(r=>!r.draft&&!r.prerelease).map(r=>({title:r.name||r.tag_name,url:r.html_url,body:String(r.body||''),publishedAt:date(r.published_at),author:r.author?.login||'',original:true}));
  }
  if(/<!DOCTYPE|<!ENTITY/i.test(raw.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")))throw bad('订阅含不支持的 XML 实体声明');
  assertXmlStructure(raw);
  const doc=new DOMParser().parseFromString(raw,'text/xml');
  const root=doc.documentElement?.localName?.toLowerCase();
  if(!['rss','feed','rdf','rdf:rdf'].includes(root))throw bad('地址未返回有效 RSS 或 Atom 订阅');
  const nodes=[...doc.getElementsByTagName('item'),...doc.getElementsByTagName('entry')];
  return nodes.slice(0,Math.max(1,Math.min(1000,channel.limit||100))).map(node=>{
    const links=[...node.children].filter(n=>n.localName==='link'),link=links.find(n=>!n.getAttribute('rel')||n.getAttribute('rel')==='alternate');
    const rawUrl=link?.getAttribute('href')||text(link)||text(child(node,'guid'));
    let url;try{url=new URL(rawUrl,channel.url).href;}catch{return null;}
    return {title:text(child(node,'title')),url,publishedAt:date(text(child(node,'published'))||text(child(node,'pubDate'))||text(child(node,'date'))),author:text(child(node,'creator'))||text(child(node,'author')),original:false};
  }).filter(i=>i?.url&&i.title);
}

async function boundedText(response,maxBytes=2_000_000){
  if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw bad('渠道内容超出读取上限');}
  if(!response.body)return '';
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw bad('渠道内容超出读取上限');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks).toString('utf8');
}
async function request(url,headers,deps,signal){
  for(let attempt=0;attempt<2;attempt++){
    try{
      let target=await assertChannelUrl(url,deps);
      const timeout=AbortSignal.timeout(15_000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
      for(let redirect=0;redirect<=4;redirect++){
        combined.throwIfAborted();
        const response=await(deps.fetch||proxyFetch)(target.href,{headers:{'user-agent':'Xenho-Intelligence/2.0','accept':'application/rss+xml,application/atom+xml,application/json,text/html;q=0.8',...headers},redirect:'manual',signal:combined});
        if([301,302,303,307,308].includes(response.status)){
          const next=response.headers.get('location');await response.body?.cancel();if(!next)throw bad('渠道重定向缺少目标');
          target=await assertChannelUrl(new URL(next,target).href,deps);continue;
        }
        if(response.status===304){await response.body?.cancel();return {status:304,headers:response.headers,url:target.href,body:''};}
        if(!response.ok){await response.body?.cancel();throw Object.assign(bad(`渠道返回 HTTP ${response.status}`,response.status),{retryable:response.status>=500});}
        return {status:response.status,headers:response.headers,url:target.href,body:await boundedText(response)};
      }
      throw bad('渠道重定向次数过多');
    }catch(e){if(signal?.aborted||e.cancelled||e.leaseLost)throw e;if(attempt||e.status===400||e.retryable===false||/HTTP (4\d\d)/.test(e.message))throw e;await new Promise(r=>setTimeout(r,150));}
  }
}
export async function readChannelArticle(item,deps={},signal){
  await assertChannelUrl(item.url,deps);
  if(deps.readArticle){const result=await deps.readArticle(item.url,{});return {body:result.markdown||result.body||'',title:result.title||item.title,url:result.url||item.url};}
  const page=await request(item.url,{accept:'text/html,application/xhtml+xml'},deps,signal);
  if(!/html/i.test(page.headers.get('content-type')||''))throw bad('原文不是可读取的网页');
  const {document}=parseHTML(page.body);
  const base=document.createElement('base');base.href=page.url;document.head.appendChild(base);
  const result=new Readability(document).parse();
  if(!result?.content||result.textContent?.trim().length<180)throw bad('未读取到足够原文，订阅摘要不会当作原文');
  if(result.textContent.length<500&&/安全验证|人机验证|checking your browser|are you a robot|access denied/i.test(result.textContent))throw bad('原文需要验证，不能用验证页作为证据');
  return {body:xhtmlToMd(result.content,src=>{try{const url=new URL(src,page.url);return /^https?:$/.test(url.protocol)?url.href:'';}catch{return '';}}),title:result.title||item.title,url:page.url};
}
function safeError(error,env){let message=String(error?.message||error).replace(/Bearer\s+\S+/gi,'Bearer [redacted]');for(const[k,v]of Object.entries(env||{}))if(/KEY|TOKEN|SECRET|PASSWORD/i.test(k)&&typeof v==='string'&&v.length>5)message=message.split(v).join('[redacted]');return message.slice(0,500);}

export async function collectIntelligenceChannels(w,env={},options={},deps={}) {
  if(active.has(w))throw bad('渠道正在采集，请等待当前采集完成',409);
  ensureIntelligenceChannels(w);
  const selected=options.channelIds;
  if(selected!==undefined&&(!Array.isArray(selected)||selected.length>60||selected.some(id=>typeof id!=='string')))throw bad('渠道选择无效');
  const channels=w.db.prepare("SELECT * FROM intel_channels WHERE enabled=1 AND format!='manual' ORDER BY category,id").all().filter(c=>!selected?.length||selected.includes(c.id)).slice(0,60);
  const limit=Math.max(1,Math.min(3,Number(options.limit)||2));
  const output=[],failures=[],results=[];
  active.add(w);
  try{
    for(const c of channels){
      deps.assertCurrent?.();options.signal?.throwIfAborted();
      const attempt=now(),rows=[],errors=[];
      w.db.prepare('UPDATE intel_channels SET last_attempt_at=? WHERE id=?').run(attempt,c.id);
      try{
        const headers={};if(c.etag)headers['if-none-match']=c.etag;if(c.last_modified)headers['if-modified-since']=c.last_modified;
        const response=await request(c.url,headers,deps,options.signal);
        deps.assertCurrent?.();
        if(response.status===304){
          // A new run still needs the verified originals when only the feed is unchanged.
          const cached=w.db.prepare("SELECT * FROM intel_sources WHERE channel_id=? ORDER BY created_at DESC LIMIT 40").all(c.id).map(sourceFromRow).filter(s=>s.readLevel==='original'&&(!s.publishedAt||!options.window||Date.parse(s.publishedAt)>=Date.parse(options.window.start)&&Date.parse(s.publishedAt)<=Date.parse(options.window.end))).slice(0,limit);
          for(const row of cached){deps.assertCurrent?.();output.push(addIntelligenceSource(w,row,options.runId));}
          w.db.prepare("UPDATE intel_channels SET health='not_modified',last_success_at=?,last_error='',consecutive_failures=0,last_item_count=0,updated_at=? WHERE id=?").run(attempt,attempt,c.id);
          results.push({id:c.id,name:c.name,status:'not_modified',count:0,reused:cached.length});continue;
        }
        const items=parseChannelFeed(response.body,view(c)).filter(i=>!i.publishedAt||!options.window||Date.parse(i.publishedAt)>=Date.parse(options.window.start)&&Date.parse(i.publishedAt)<=Date.parse(options.window.end)).slice(0,limit);
        for(const item of items){
          deps.assertCurrent?.();options.signal?.throwIfAborted();
          try{
            await assertChannelUrl(item.url,deps);
            const page=item.original?item:await readChannelArticle(item,deps,options.signal);
            deps.assertCurrent?.();options.signal?.throwIfAborted();
            const body=String(page.body||'').trim();if(body.length<40)throw bad('没有足够原文，未保存订阅摘要');
            const row={title:page.title||item.title,body:body.slice(0,70000),url:page.url||item.url,publishedAt:item.publishedAt,author:item.author,provider:'channels',readLevel:'original',contentKind:c.category==='questions'?'post':'article',sourceKind:c.format==='github'?'release':c.category==='questions'?'community_post':'article',originKind:'external',channelId:c.id,publisherKey:c.publisher_key,provenanceGroupKey:canonicalSourceUrl(item.url),dateBasis:item.publishedAt?'publication':'unknown',background:!item.publishedAt};
            const saved=addIntelligenceSource(w,row,options.runId);rows.push(saved);output.push(saved);
          }catch(error){if(error.cancelled||error.leaseLost||options.signal?.aborted)throw error;errors.push({channelId:c.id,url:item.url,error:safeError(error,env)});}
        }
        deps.assertCurrent?.();
        const status=errors.length?(rows.length?'partial':'failed'):(rows.length?'ok':'empty');
        w.db.prepare('UPDATE intel_channels SET health=?,last_success_at=?,last_error=?,consecutive_failures=?,last_item_count=?,etag=?,last_modified=?,updated_at=? WHERE id=?').run(status,errors.length?c.last_success_at:attempt,errors.map(e=>e.error).join('; ').slice(0,500),errors.length?c.consecutive_failures+1:0,rows.length,errors.length?c.etag:response.headers.get('etag')||'',errors.length?c.last_modified:response.headers.get('last-modified')||'',attempt,c.id);
        results.push({id:c.id,name:c.name,status,count:rows.length,failures:errors.length});failures.push(...errors);
      }catch(error){
        if(error.cancelled||error.leaseLost||options.signal?.aborted)throw error;
        deps.assertCurrent?.();const message=safeError(error,env);
        w.db.prepare("UPDATE intel_channels SET health='failed',last_error=?,consecutive_failures=consecutive_failures+1,last_item_count=0,updated_at=? WHERE id=?").run(message,attempt,c.id);
        failures.push({channelId:c.id,url:c.url,error:message});results.push({id:c.id,name:c.name,status:'failed',count:0,error:message});
      }
    }
    return {output,failures,channels:results};
  }finally{active.delete(w);}
}
