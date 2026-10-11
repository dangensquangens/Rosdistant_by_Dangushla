export function validateUrl(value,allowedOrigins){
 const url=new URL(value);
 const host=url.hostname==='virtualroom.ru'||url.hostname.endsWith('.virtualroom.ru');
 if(url.username||url.password||!(allowedOrigins?allowedOrigins.includes(url.origin):url.protocol==='https:'&&host&&!url.port)||url.pathname!=='/record-player'||!/^[-a-f0-9]{36}$/i.test(url.searchParams.get('recordId')||''))throw Error('Нужна ссылка на запись Virtual Room: /record-player?recordId=…');
 url.hash='';return url;
}
export function assetUrl(value,base,session,allowedOrigins){
 const url=new URL(value,base);
 if(url.username||url.password||!(allowedOrigins?allowedOrigins.includes(url.origin):url.protocol==='https:'&&(url.hostname==='virtualroom.ru'||url.hostname.endsWith('.virtualroom.ru'))&&!url.port))throw Error('Материал находится на неподдерживаемом сервере.');
 if(session)url.searchParams.set('temporarySession',session);
 url.searchParams.set('recordPlayer','true');return url.href;
}
const date=value=>{const n=Date.parse(value);if(!Number.isFinite(n))throw Error('Неизвестный формат времени записи.');return n;};
export const formatTime=seconds=>{const n=Math.floor(seconds);return [Math.floor(n/3600),Math.floor(n/60)%60,n%60].map((v,i)=>i?String(v).padStart(2,'0'):v).join(':');};
export const safeFilename=value=>(value||'Вебинар').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'Вебинар';
const knownVisual=new Set(['ResourceActivePageChanged','SharedAreaParameters','LayoutChanged','ActiveTabSwitched','TabAdded','TabChanged','TabDeleted','AreaDeleted','AreaCollapsed','FullscreenAreaMade','Board','BoardObject','BoardObjectChanged','BoardObjectRemoved','BoardObjectMoved','PointerMoved','MovePointerStarted','MovePointerFinished']);
function cleanBoard(board){return {boardId:board.boardId,objects:(board.objects||[]).map(x=>({object:{id:x.object.id,svg:x.object.svg}})),pointer:board.pointer?.coordinates?{coordinates:board.pointer.coordinates,active:true}:null};}
export function buildPlan(info,snapshot,eventData,sourceUrl,session='',allowedOrigins){
 const base=validateUrl(sourceUrl,allowedOrigins);const origin=date(info.startDate);const duration=(date(info.endDate)-origin)/1000;
 if(duration<=0||duration>28800)throw Error('Поддерживаются завершённые записи длительностью до восьми часов.');
 const pages=new Map(),boards=new Map();let areas=[],fullscreen;
 function readContent(content){
  if(content?.type==='Documents')for(const page of content.pages||[])pages.set(page.id,{id:page.id,url:assetUrl(page.url,base.href,session,allowedOrigins)});
  if(content?.board)boards.set(content.board.boardId,cleanBoard(content.board));
 }
 function setLayout(data){areas=structuredClone(data.areas||[]).map(x=>x.area);fullscreen=data.fullscreenAreaId;for(const a of areas)for(const t of a.tabs||[])readContent(t.tab.content);}
 const initial=snapshot.snapshots?.find(x=>x.channel==='sharedArea.getParameters');
 if(initial)setLayout(initial.snapshot.data);
 function active(){
  let selected=areas;
  if(fullscreen!=null)selected=areas.filter(x=>x.id===fullscreen);
  const contents=selected.map(a=>(a.tabs||[]).find(x=>x.tab.id===a.activeTabId)?.tab.content).filter(x=>x&&x.type!=='Chat'&&x.type!=='Empty');
  if(contents.length>1)throw Error('Запись содержит несколько областей презентации одновременно. Этот вариант пока не поддерживается.');
  const content=contents[0];if(!content)return {pageId:null,board:null};
  if(content.type!=='Documents')throw Error('В этой записи показаны не слайды, а другой тип содержимого. Пока поддерживаются презентации.');
  if(!pages.has(content.activePage))throw Error('Не найдена текущая страница презентации.');
  return {pageId:content.activePage,board:structuredClone(boards.get(content.board?.boardId||content.activePage)||{objects:[]})};
 }
 const frames=[];let previous='';
 function save(time){const view=active(),key=JSON.stringify(view);if(key===previous)return;previous=key;const quantized=Math.max(0,Math.round(time*25)/25);if(quantized>=duration)return;const frame={time:quantized,...view};if(frames.at(-1)?.time===quantized)frames[frames.length-1]=frame;else frames.push(frame);}
 save(0);
 const events=[...new Map((eventData.events||[]).map(x=>[x.id,x])).values()].sort((a,b)=>date(a.timestamp)-date(b.timestamp));
 let pointerEvents=0,boardEvents=0;
 function findObject(id){for(const b of boards.values()){const o=b.objects.find(x=>x.object.id===id);if(o)return [b,o];}throw Error('Не удалось восстановить объект пометки.');}
 for(const event of events){
  const time=(date(event.timestamp)-origin)/1000;if(time<0||time>=duration)continue;
  const {type,data}=event.message;const channel=event.channel||'';
  if(!knownVisual.has(type)){
   if(/\/(whiteboard|sharedArea|resources)\//.test(channel)&&!/ConversionStatus|PublicResource|DrawingLine|ActiveTool|ChatLocation|ResourceRemoved/.test(type))throw Error('В записи есть неподдерживаемое событие презентации: '+type);
   continue;
  }
  if(type==='SharedAreaParameters'||type==='LayoutChanged')setLayout(data);
  else if(type==='FullscreenAreaMade')fullscreen=data.areaId;
  else if(type==='AreaCollapsed')fullscreen=undefined;
  else if(type==='AreaDeleted')areas=areas.filter(a=>a.id!==data.areaId);
  else if(['TabAdded','TabChanged','ActiveTabSwitched'].includes(type)){
   const area=areas.find(x=>x.id===data.areaId);if(!area)throw Error('Не найдена область презентации.');
   const index=area.tabs.findIndex(x=>x.tab.id===data.tab.id);if(index>=0)area.tabs[index]={tab:structuredClone(data.tab)};else area.tabs.push({tab:structuredClone(data.tab)});
   readContent(data.tab.content);if(type==='ActiveTabSwitched')area.activeTabId=data.tab.id;
  }else if(type==='TabDeleted'){
   const area=areas.find(x=>x.id===data.areaId);if(area)area.tabs=area.tabs.filter(x=>x.tab.id!==data.tabId);
  }else if(type==='ResourceActivePageChanged'){
   for(const a of areas)for(const t of a.tabs||[])if(t.tab.content?.id===data.resource.id){t.tab.content.activePage=data.resource.activePage;if(data.board){t.tab.content.board=data.board;boards.set(data.board.boardId,cleanBoard(data.board));}}
  }else if(type==='Board'){boards.set(data.boardId,cleanBoard(data));boardEvents++;}
  else if(type==='BoardObject'){
   const b=boards.get(data.object.boardId);if(!b)throw Error('Не найдена доска для пометки.');
   b.objects=b.objects.filter(x=>x.object.id!==data.object.id);b.objects.push({object:{id:data.object.id,svg:data.object.svg}});boardEvents++;
  }else if(type==='BoardObjectChanged'){const [,o]=findObject(data.object.id);o.object.svg=data.object.svg;boardEvents++;}
  else if(type==='BoardObjectRemoved'){const [b]=findObject(data.objectId);b.objects=b.objects.filter(x=>x.object.id!==data.objectId);boardEvents++;}
  else if(type==='BoardObjectMoved')throw Error('В записи перемещались готовые пометки. Эта операция пока не поддерживается.');
  else {
   pointerEvents++;const id=data.boardId||data.object?.boardId;const board=boards.get(id);if(!board)throw Error('Не найдена доска для указателя.');
   if(type==='PointerMoved')board.pointer={coordinates:data.coordinates,active:true};
   else board.pointer=null;
  }
  save(time);
 }
 const translations=[...new Map((eventData.translations||[]).map(x=>[x.id,x])).values()];
 if(translations.some(x=>x.source==='desktop'))throw Error('В записи есть демонстрация экрана. Эта версия предназначена для презентаций со слайдами.');
 const audio=translations.filter(x=>x.type==='audio').map(x=>({id:x.id,start:(date(x.start)-origin)/1000,end:(date(x.end)-origin)/1000,url:assetUrl(x.url,base.href,session,allowedOrigins)})).filter(x=>x.end>0&&x.start<duration);
 if(!audio.length)throw Error('В записи нет исходного звука. Возможно, вебинар не состоялся.');
 if(!frames.some(x=>x.pageId))throw Error('В записи нет презентации.');
 const used=new Set(frames.map(x=>x.pageId).filter(Boolean));
 return {title:info.roomParameters?.name||'Вебинар',sourceUrl:base.href,duration,frames,pages:[...pages.values()].filter(x=>used.has(x.id)),audio,pointerEvents,boardEvents};
}
export function samplePlan(plan,seconds=120){const copy=structuredClone(plan);copy.duration=Math.min(seconds,plan.duration);copy.frames=copy.frames.filter(x=>x.time<copy.duration);copy.audio=copy.audio.filter(x=>x.start<copy.duration).map(x=>({...x,end:Math.min(x.end,copy.duration)}));const used=new Set(copy.frames.map(x=>x.pageId));copy.pages=copy.pages.filter(x=>used.has(x.id));return copy;}
export function parsePlaylist(text,url){
 if(!text.startsWith('#EXTM3U')||!text.includes('#EXT-X-ENDLIST'))throw Error('Ожидался завершённый звуковой поток HLS.');
 if(/#EXT-X-KEY:/.test(text)||/#EXT-X-STREAM-INF:/.test(text)||/#EXT-X-BYTERANGE:/.test(text))throw Error('Этот вариант звукового потока пока не поддерживается.');
 const lines=text.split(/\r?\n/),files=new Map();let duration=0;
 for(const line of lines){
  const map=line.match(/^#EXT-X-MAP:URI="([^"]+)"/);const uri=map?.[1]||(!line.startsWith('#')?line.trim():null);
  if(uri&&!files.has(uri)){const remote=new URL(uri,url);const base=new URL(url);for(const [k,v]of base.searchParams)if(!remote.searchParams.has(k))remote.searchParams.set(k,v);files.set(uri,{url:remote.href,name:'part_'+files.size+'.mp4'});}
  const length=line.match(/^#EXTINF:([\d.]+)/);if(length)duration+=Number(length[1]);
 }
 if(!files.size||!Number.isFinite(duration)||duration<=0)throw Error('Звуковой поток пуст.');
 return {files:[...files.values()],duration,lines,remap:files};
}
export function makeEncodingJob(plan,height=1080){
 const num=n=>Number(n).toFixed(6),lines=['ffconcat version 1.0'];
 plan.frames.forEach((frame,i)=>{const end=plan.frames[i+1]?.time??plan.duration;const anchor=i===plan.frames.length-1&&end-frame.time>.08;lines.push(`file 'frame_${i}.png'`,`duration ${num(end-frame.time-(anchor ? 0.04 : 0))}`);if(anchor)lines.push(`file 'frame_${i}.png'`,'duration 0.040000');});
 lines.push(`file 'frame_${plan.frames.length-1}.png'`);
 const args=['-f','concat','-safe','0','-i','slides.ffconcat'];const filters=[],labels=[];
 plan.audio.forEach((a,i)=>{
  args.push('-protocol_whitelist','file,crypto,data','-i',`audio_${i}.m3u8`);
  const trim=Math.max(0,-a.start),start=Math.max(0,a.start),length=Math.max(0,Math.min(a.end,plan.duration)-start);
  filters.push(`[${i+1}:a]atrim=start=${num(trim)}:duration=${num(length)},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(start*48000)}S:all=1,apad,atrim=duration=${num(plan.duration)}[a${i}]`);labels.push(`[a${i}]`);
 });
 filters.push(labels.length===1?`${labels[0]}anull[audio]`:`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,alimiter=limit=0.95:level=0:latency=1[audio]`);
 args.push('-filter_complex_script','timeline.filter','-map','0:v:0','-map','[audio]','-vf',`scale=${Math.round(height*16/9/2)*2}:${height},format=yuv420p`,'-c:v','libx264','-preset','ultrafast','-tune','stillimage','-crf','18','-bf','0','-g','1','-fps_mode','vfr','-c:a','aac','-b:a','128k','-movflags','+faststart','-t',num(plan.duration),'-y','video.mp4');
 return {args,concat:lines.join('\n')+'\n',filter:filters.join(';\n')};
}
