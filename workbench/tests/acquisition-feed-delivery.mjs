// Explicitly synthetic feed fixtures; no production storage or network.
import assert from 'node:assert/strict';
import {normalizeCommunityFeed} from '../server/acquisition/connectors/community.mjs';
import {parseChannelFeed} from '../server/domain/intelligence-channels.mjs';
const channel={url:'https://example.org/feed',platform:'web'};
const prose='A grounded account of language models and agent evaluation with explicit experimental observations. '.repeat(8);
const item=(url,content)=>'<item><title>Same title</title><link>'+url+'</link><description>Short summary</description>'+content+'</item>';
const feed=items=>'<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>'+items+'</channel></rss>';
const rows=normalizeCommunityFeed(feed(item('https://example.org/a','<content:encoded><![CDATA[<h2>Evidence</h2><p>'+prose+'</p>]]></content:encoded>')+item('https://example.org/b','')),channel);
assert.equal(rows[0].contentStatus,'full_text');assert.match(rows[0].body,/Evidence/);assert.equal(rows[0].summary,'Short summary');
assert.equal(rows[1].body,'');assert.equal(rows[1].readLevel,'summary');assert.equal(rows[1].metadata.fulltextPending,true);
const excerpt=normalizeCommunityFeed(feed(item('https://example.org/a','<content:encoded><![CDATA[<p>'+prose+'</p><a>Read the full story at The Verge.</a>]]></content:encoded>')),channel)[0];
assert.equal(excerpt.body,'');assert.equal(excerpt.metadata.feedBodyExcerpt,true);
assert.throws(()=>parseChannelFeed('<!DOCTYPE html><html><head><title>Data service</title></head></html>',channel),e=>e.code==='FEED_HTML_RESPONSE');
assert.throws(()=>parseChannelFeed('<!DOCTYPE rss [<!ENTITY xx SYSTEM "file:///secret">]><rss/>',channel),/实体声明/);
const atom='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom content</title><link href="https://example.org/atom"/><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><h2>Heading</h2><p>'+prose+'</p></div></content></entry></feed>';
assert.match(normalizeCommunityFeed(atom,channel)[0].body,/## Heading/);
assert.equal(normalizeCommunityFeed(atom.replace('<content type="xhtml">','<content type="xhtml" src="https://example.org/external">'),channel)[0].body,'');
console.log('PASS synthetic feed full content, excerpts, duplicate titles, XHTML, HTML diagnosis, XML entity safety');
