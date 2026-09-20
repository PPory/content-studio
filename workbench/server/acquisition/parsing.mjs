export function assertXmlStructure(raw) {
  const input=String(raw).replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g,'');
  if(/<!DOCTYPE|<!ENTITY/i.test(input))throw new Error('订阅包含不允许的 XML 声明');
  const stack=[];let count=0,end=0;
  const tags=/<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  for(const match of input.matchAll(tags)) {
    if(input.slice(end,match.index).includes('<'))throw new Error('订阅 XML 标签损坏');
    end=match.index+match[0].length;
    if(++count>100000)throw new Error('订阅标签数量超过预算');
    const token=match[0],name=token.match(/^<\/?\s*([A-Za-z_][\w:.-]*)/)?.[1];
    if(!name)throw new Error('订阅 XML 标签无效');
    if(/^<\//.test(token)){if(stack.pop()!==name)throw new Error('订阅 XML 闭合标签不匹配');}
    else if(!/\/\s*>$/.test(token)){stack.push(name);if(stack.length>64)throw new Error('订阅 XML 嵌套过深');}
  }
  if(stack.length||input.slice(end).includes('<'))throw new Error('订阅 XML 未完整闭合');
}
export function assertJsonDepth(value,max=64) {
  const queue=[[value,0]];let count=0;
  while(queue.length){const [node,depth]=queue.pop();if(node&&typeof node==='object'){if(depth>max||++count>300000)throw new Error('JSON 结构超过解析预算');for(const child of Object.values(node))if(child&&typeof child==='object')queue.push([child,depth+1]);}}
}
