import {formatTime,safeFilename,validateUrl,samplePlan,makeEncodingJob} from './core.js';
import {readRecord,getBytes,downloadAudio,allowedOrigins} from './source.js';
import {SlideRenderer} from './render.js';
import {VideoEncoder} from './encoder.js';
const $=id=>document.getElementById(id);const sourceTab=Number(new URL(location.href).searchParams.get('source'));
const plural=(n,one,few,many)=>n%100>=11&&n%100<=14?many:n%10===1?one:n%10>=2&&n%10<=4?few:many;
let plan,busy=false,controller,encoder,renderer,videoUrl,resultPlan,isSample;
function error(text){$('error').hidden=!text;$('error').textContent=text||'';}
function lock(value){busy=value;for(const id of ['url','analyze','start','sample','quality'])$(id).disabled=value;}
function progress(title,detail,percent){$('status').textContent=title;$('detail').textContent=detail;$('progress').value=percent;}
async function analyze(){
 if(busy)return;lock(true);error('');plan=null;$('summary').hidden=true;$('progress-card').hidden=false;$('cancel').disabled=false;controller=new AbortController();
 try{
  plan=await readRecord($('url').value.trim(),sourceTab,controller.signal,text=>progress('Проверка вебинара',text,10));
  $('title').textContent=plan.title;$('facts').textContent=`${formatTime(plan.duration)} · ${plan.pages.length} ${plural(plan.pages.length,'слайд','слайда','слайдов')} · ${plan.audio.length} ${plural(plan.audio.length,'звуковая дорожка','звуковые дорожки','звуковых дорожек')}`;
  $('notes').textContent=plan.pointerEvents||plan.boardEvents?`События указателя: ${plan.pointerEvents}. Изменения пометок: ${plan.boardEvents}.`:'В этой записи нет движений указателя и пометок. Сохранится исходное время переключения слайдов.';
  $('summary').hidden=false;
 }catch(e){if(!controller.signal.aborted)error(e.message);}finally{$('progress-card').hidden=true;lock(false);}
}
async function start(){
 if(busy||!plan)return;lock(true);error('');$('result').hidden=true;$('progress-card').hidden=false;$('cancel').disabled=false;controller=new AbortController();
 if(videoUrl){URL.revokeObjectURL(videoUrl);videoUrl=null;}
 isSample=$('sample').checked;resultPlan=isSample?samplePlan(plan):structuredClone(plan);let phase='prepare';
 try{
  progress('Подготовка сборки','Загружаются компоненты расширения.',1);encoder=new VideoEncoder(time=>{if(phase==='encode')progress('Сборка MP4',`${formatTime(Math.min(time,resultPlan.duration))} из ${formatTime(resultPlan.duration)}`,60+Math.min(time/resultPlan.duration,1)*39);});await encoder.load();
  renderer=new SlideRenderer(Number($('quality').value));let inputBytes=0;
  for(let i=0;i<resultPlan.pages.length;i++){
   controller.signal.throwIfAborted();const page=resultPlan.pages[i];progress('Получение слайдов',`${i+1} из ${resultPlan.pages.length}`,3+17*i/resultPlan.pages.length);const bytes=await getBytes(page.url,controller.signal);inputBytes+=bytes.length;await renderer.addPage(page.id,bytes);
  }
  for(let i=0;i<resultPlan.frames.length;i++){
   controller.signal.throwIfAborted();progress('Восстановление презентации',`${i+1} из ${resultPlan.frames.length} изменений изображения`,20+15*i/resultPlan.frames.length);const bytes=await renderer.frame(resultPlan.frames[i]);inputBytes+=bytes.length;if(inputBytes>700_000_000)throw Error('Слишком много изображений для сборки в браузере.');await encoder.write(`frame_${i}.png`,bytes);
  }
  renderer.close();renderer=null;
  for(let i=0;i<resultPlan.audio.length;i++){
   const track=resultPlan.audio[i];inputBytes+=await downloadAudio(track,i,encoder,controller.signal,f=>progress('Получение звука',`Дорожка ${i+1} из ${resultPlan.audio.length}`,35+25*(i+f)/resultPlan.audio.length),resultPlan.duration-track.start);
   if(inputBytes>800_000_000)throw Error('Запись слишком велика для сборки в браузере.');
  }
  controller.signal.throwIfAborted();phase='encode';progress('Сборка MP4','Объединяются слайды и весь исходный звук.',60);
  const blob=await encoder.encode(makeEncodingJob(resultPlan,Number($('quality').value)));controller.signal.throwIfAborted();
  videoUrl=URL.createObjectURL(blob);$('preview').src=videoUrl;$('result-detail').textContent=`${formatTime(resultPlan.duration)} · ${$('quality').value}p · ${(blob.size/1048576).toFixed(1)} МБ${isSample?' · проба':''}`;$('result').hidden=false;$('progress-card').hidden=true;
 }catch(e){if(controller.signal.aborted)progress('Сборка остановлена','Можно запустить заново.',0);else{error(e.message);progress('Не удалось завершить сборку','Подробности указаны выше.',0);}}
 finally{renderer?.close();renderer=null;encoder?.stop();encoder=null;$('cancel').disabled=true;lock(false);}
}
$('analyze').addEventListener('click',analyze);$('start').addEventListener('click',start);
$('url').addEventListener('input',()=>{plan=null;$('summary').hidden=true;});
$('sample').addEventListener('change',()=>{$('start').textContent=$('sample').checked?'Создать пробное видео':'Создать полное видео';});
$('cancel').addEventListener('click',()=>{controller?.abort();encoder?.stop();$('cancel').disabled=true;});
$('download').addEventListener('click',()=>{if(videoUrl)chrome.downloads.download({url:videoUrl,filename:safeFilename(resultPlan.title)+(isSample?' — проба':'')+'.mp4',saveAs:true}).catch(e=>error(e.message));});
addEventListener('pagehide',()=>{controller?.abort();encoder?.stop();renderer?.close();});
try{if(sourceTab){const tab=await chrome.tabs.get(sourceTab);$('url').value=validateUrl(tab.url,allowedOrigins()).href;}}catch{}
