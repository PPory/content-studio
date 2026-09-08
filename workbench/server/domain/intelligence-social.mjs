// Normalize actual Bright Data records; fetching and billing stay in the runner.
const clean=v=>String(v||'').trim();
const iso=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const inWindow=(date,w)=>!date||Date.parse(date)>=Date.parse(w.start)&&Date.parse(date)<=Date.parse(w.end);
export function isSocialPost(url,provider){try{const u=new URL(url);return provider==='x'?/^(?:www\.)?(?:x|twitter)\.com$/.test(u.hostname)&&/\/status\/\d+/.test(u.pathname):provider==='reddit'?/(^|\.)reddit\.com$/.test(u.hostname)&&/\/comments\/[^/]+/.test(u.pathname):true;}catch{return false;}}
export function normalizeSocialRows(raw,provider,{window,limit,accounts=[],subreddits=[]}){
 const sources=[],seen=new Set(),groups=new Map(),stats={receivedRecords:raw.length,keptPosts:0,keptComments:0,emptyPosts:0,outOfRange:0,undatedPosts:0};
 const cap=(provider==='x'?accounts.length:subreddits.length)*limit;let keptRecords=0;
 for(const r of raw){
  const url=clean(r.url||r.post_url||r.link),body=clean(r.description||r.selftext||r.text),publishedAt=iso(r.date_posted||r.created_at);
  if(!isSocialPost(url,provider)||seen.has(url))continue;seen.add(url);
  if(!inWindow(publishedAt,window)){stats.outOfRange++;continue;}
  const community=clean(r.community_name||r.subreddit||url.match(/\/r\/([^/]+)/i)?.[1]);
  const discoveredFrom=clean(r.discovery_input?.url||r.input?.url);
  const group=(discoveredFrom||community||url.split('/')[3]||'unknown').toLowerCase();
  if(keptRecords>=cap||(groups.get(group)||0)>=limit)continue;keptRecords++;groups.set(group,(groups.get(group)||0)+1);
  const title=clean(r.title||r.post_title||body.slice(0,100)||'讨论帖');
  if(body){sources.push({url,body:body.slice(0,70000),title,publishedAt,dateBasis:publishedAt?'publication':'unknown',provider,readLevel:'original',contentKind:'post',author:clean(r.user_posted||r.author||r.user_name),community,discoveredFrom,quotedBody:typeof r.quoted_post==='string'?r.quoted_post:clean(r.quoted_post?.description),quotedAuthor:clean(r.quoted_post?.user_posted)});stats.keptPosts++;if(!publishedAt)stats.undatedPosts++;}else stats.emptyPosts++;
  if(provider==='reddit'){
   const comments=(Array.isArray(r.comments)?r.comments:[]).filter(c=>!/^\s*TL;DR of the discussion generated automatically/i.test(clean(c.comment||c.body||c.text))&&!/(^|[-_])(bot|automoderator)$/i.test(clean(c.user_commenting||c.author))).sort((a,b)=>Number(b.num_upvotes||b.score||0)-Number(a.num_upvotes||a.score||0));
   for(const c of comments.slice(0,5)){const comment=clean(c.comment||c.body||c.text),date=iso(c.date_posted||c.created_at);if(comment.length<10||!inWindow(date,window))continue;sources.push({url,body:comment.slice(0,15000),title:'评论 · '+title,publishedAt:date,dateBasis:date?'publication':'unknown',provider,readLevel:'original',contentKind:'comment',author:clean(c.user_commenting||c.author),community,discoveredFrom});stats.keptComments++;}
  }
 }
 return {sources,stats};
}
