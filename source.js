import {validateUrl,buildPlan,assetUrl,parsePlaylist} from './core.js';
export function allowedOrigins(){const patterns=chrome.runtime.getManifest().host_permissions;return patterns.some(x=>x.includes('127.0.0.1'))?patterns.map(x=>new URL(x).origin):undefined;}
export async function getBytes(url,signal,limit=40_000_000){
 for(let attempt=0;attempt<3;attempt++){
  signal?.throwIfAborted();const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);
  const stop=()=>controller.abort();signal?.addEventListener('abort',stop,{once:true});
  try{
   const response=await fetch(url,{credentials:'include',signal:controller.signal});
   if(!response.ok)throw Error(`Сервер не выдал материал (${response.status}). Откройте запись и повторите проверку.`);
   const chunks=[];let size=0;const reader=response.body.getReader();
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){controller.abort();throw Error('Материал слишком велик для этой версии расширения.');}chunks.push(value);}}finally{reader.releaseLock();}
   const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}return data;
  }catch(e){if(signal?.aborted||attempt===2)throw e;await new Promise(r=>setTimeout(r,750*(attempt+1)));}
  finally{clearTimeout(timeout);signal?.removeEventListener('abort',stop);}
 }
}
async function getJson(url,signal){const text=new TextDecoder().decode(await getBytes(url,signal));let json;try{json=JSON.parse(text);}catch{throw Error('Сервер вернул страницу входа вместо данных записи. Откройте вебинар в этом браузере.');}if(!json.data)throw Error('Сервер не выдал описание записи.');return json.data;}
export async function sessionForTab(tabId,source){
 if(!tabId)return '';
 try{
  const tab=await chrome.tabs.get(tabId);
  const a=new URL(tab.url),b=new URL(source);if(a.origin!==b.origin||a.searchParams.get('recordId')!==b.searchParams.get('recordId'))return '';
  const [result]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:()=>{
   if(typeof window.temporarySessionId==='string')return window.temporarySessionId;
   for(const entry of performance.getEntriesByType('resource')){try{const u=new URL(entry.name);if(u.hostname==='virtualroom.ru'||u.hostname.endsWith('.virtualroom.ru')){const value=u.searchParams.get('temporarySession');if(value)return value;}}catch{}}
   return '';
  }});return /^[-a-f0-9]{36}$/i.test(result?.result||'')?result.result:'';
 }catch{return '';}
}
export async function readRecord(source,tabId,signal,onProgress){
 const origins=allowedOrigins(),url=validateUrl(source,origins),session=await sessionForTab(tabId,source);
 const base=url.origin+'/vr/player/records/'+url.searchParams.get('recordId')+'/';
 const infoUrl=new URL(base+'info');if(url.searchParams.has('viewToken'))infoUrl.searchParams.set('viewToken',url.searchParams.get('viewToken'));
 onProgress?.('Получение описания записи');const info=await getJson(infoUrl.href,signal);
 const snapshot=await getJson(base+'snapshots?time=0',signal),events=new Map(),translations=new Map();
 let cursor=snapshot.lastEvent?.id;const end=Date.parse(info.endDate)-Date.parse(info.startDate);let complete=false;
 for(let page=0;page<200;page++){
  onProgress?.('Получение событий записи');const query=new URL(base+'events');query.searchParams.set(cursor?'spanStart':'time',cursor||'0');
  const data=await getJson(query.href,signal);const before=events.size;
  for(const event of data.events||[])events.set(event.id,event);
  for(const track of data.translations||[])translations.set(track.id,track);
  if(data.to>=end-1){complete=true;break;}
  const last=data.events?.at(-1)?.id;if(!last||last===cursor||before===events.size)break;cursor=last;
  if(events.size>200000)throw Error('Слишком много событий для этой версии расширения.');
 }
 if(!complete)throw Error('Сервер не выдал события до конца записи. Повторите проверку позже.');
 return buildPlan(info,snapshot,{events:[...events.values()],translations:[...translations.values()]},source,session,origins);
}
export async function downloadAudio(track,index,encoder,signal,onProgress,maxDuration){
 const origins=allowedOrigins(),bytes=await getBytes(track.url,signal,3_000_000);
 const parsed=parsePlaylist(new TextDecoder().decode(bytes),track.url),renamed=new Map();
 const wanted=new Set();let elapsed=0;
 // A preview only needs the fragments covering its interval; full exports retain every fragment.
 for(let i=0;i<parsed.lines.length;i++){const line=parsed.lines[i],map=line.match(/^#EXT-X-MAP:URI="([^"]+)"/);if(map)wanted.add(map[1]);const duration=line.match(/^#EXTINF:([\d.]+)/);if(duration){if(elapsed<=maxDuration)wanted.add(parsed.lines[i+1]?.trim());elapsed+=Number(duration[1]);}}
 const files=parsed.files.filter(file=>[...parsed.remap].some(([uri,other])=>other===file&&wanted.has(uri)));
 let size=0,done=0;
 const queue=[...files];
 const local=new AbortController(),combined=AbortSignal.any([signal,local.signal]);
 async function worker(){while(queue.length){combined.throwIfAborted();const file=queue.shift();const safe=assetUrl(file.url,track.url,'',origins),data=await getBytes(safe,combined);size+=data.length;if(size>700_000_000)throw Error('Звуковая дорожка слишком велика для сборки в браузере.');combined.throwIfAborted();await encoder.write(`audio_${index}_${file.name}`,data);done++;onProgress?.(done/files.length);}}
 const workers=Array.from({length:4},worker);
 try{await Promise.all(workers);}catch(e){local.abort();await Promise.allSettled(workers);throw e;}
 for(const [uri,file]of parsed.remap)renamed.set(uri,`audio_${index}_${file.name}`);
 const lines=[];elapsed=0;
 for(let i=0;i<parsed.lines.length;i++){
  const line=parsed.lines[i],map=line.match(/^#EXT-X-MAP:URI="([^"]+)"/),duration=line.match(/^#EXTINF:([\d.]+)/);
  if(map)lines.push(line.replace(map[1],renamed.get(map[1])));
  else if(duration){const uri=parsed.lines[++i]?.trim();if(elapsed<=maxDuration)lines.push(line,renamed.get(uri));elapsed+=Number(duration[1]);}
  else if(line.startsWith('#'))lines.push(line);
 }
 await encoder.write(`audio_${index}.m3u8`,new TextEncoder().encode(lines.join('\n')));return size;
}
