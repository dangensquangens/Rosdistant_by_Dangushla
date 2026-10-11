const NS='http://www.w3.org/2000/svg';
export function safeSvg(text){
 const doc=new DOMParser().parseFromString(text,'image/svg+xml');if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')throw Error('Не удалось прочитать слайд.');
 for(const element of doc.querySelectorAll('*')){
  if(['script','foreignObject','iframe','animate','animateMotion','animateTransform','set'].includes(element.localName))throw Error('Слайд содержит неподдерживаемый интерактивный элемент.');
  for(const attr of [...element.attributes]){
   if(/^on/i.test(attr.name))element.removeAttribute(attr.name);
   else if(attr.localName==='href'&&attr.value&&!/^(#|data:)/i.test(attr.value))throw Error('Слайд содержит внешние вложения. Этот вариант пока не поддерживается.');
  }
 }
 for(const match of text.matchAll(/url\(\s*['"]?([^\s)'";]+)/gi))if(!/^(#|data:)/i.test(match[1]))throw Error('Слайд содержит внешний шрифт или изображение.');
 return doc;
}
export class SlideRenderer{
 constructor(height){this.height=height;this.width=Math.round(height*16/9/2)*2;this.canvas=document.createElement('canvas');this.canvas.width=this.width;this.canvas.height=height;this.context=this.canvas.getContext('2d');this.cache=new Map();}
 async image(blob){const url=URL.createObjectURL(blob);try{const image=new Image();image.src=url;await image.decode();return image;}finally{URL.revokeObjectURL(url);}}
 async addPage(id,bytes){
  const text=new TextDecoder().decode(bytes);if(/^\s*(<\?xml[^>]*>\s*)?<svg\b/.test(text)){const doc=safeSvg(text),box=doc.documentElement.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);const width=box?.[2]||Number(doc.documentElement.getAttribute('width')),height=box?.[3]||Number(doc.documentElement.getAttribute('height'));if(!(width>0&&height>0&&width<20000&&height<20000))throw Error('Неизвестный размер слайда.');this.cache.set(id,{blob:new Blob([new XMLSerializer().serializeToString(doc)],{type:'image/svg+xml'}),image:null,width,height});}
  else {const blob=new Blob([bytes]),image=await this.image(blob);this.cache.set(id,{blob,image:null,width:image.naturalWidth,height:image.naturalHeight});}
 }
 async frame(frame){
  const ctx=this.context;ctx.fillStyle='white';ctx.fillRect(0,0,this.width,this.height);
  const page=this.cache.get(frame.pageId);if(page){
   const ratio=Math.min(this.width/page.width,this.height/page.height),width=page.width*ratio,height=page.height*ratio,x=(this.width-width)/2,y=(this.height-height)/2;
   if(!page.image){for(const other of this.cache.values())other.image=null;page.image=await this.image(page.blob);}
   ctx.drawImage(page.image,x,y,width,height);
   if(frame.board?.objects?.length||frame.board?.pointer?.active){
    const doc=document.implementation.createDocument(NS,'svg');const root=doc.documentElement;root.setAttribute('viewBox',`0 0 ${page.width} ${page.height}`);root.setAttribute('width',page.width);root.setAttribute('height',page.height);
    for(const item of frame.board.objects||[]){const shape=safeSvg(`<svg xmlns="${NS}">${item.object.svg}</svg>`);for(const child of [...shape.documentElement.children])root.append(doc.importNode(child,true));}
    const coords=frame.board.pointer?.coordinates;if(frame.board.pointer?.active&&Number.isFinite(coords?.x)&&Number.isFinite(coords?.y)){
     const cursor=doc.createElementNS(NS,'path');cursor.setAttribute('d','M0 0 L0 25 L7 19 L13 29 L18 26 L12 17 L21 17 Z');cursor.setAttribute('fill','#e53935');cursor.setAttribute('stroke','white');cursor.setAttribute('stroke-width','2');cursor.setAttribute('transform',`translate(${coords.x} ${coords.y})`);root.append(cursor);
    }
    const overlay=await this.image(new Blob([new XMLSerializer().serializeToString(doc)],{type:'image/svg+xml'}));ctx.drawImage(overlay,x,y,width,height);
   }
  }
  const blob=await new Promise(resolve=>this.canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Не удалось отрисовать слайд.');return new Uint8Array(await blob.arrayBuffer());
 }
 close(){this.cache.clear();this.canvas.width=1;this.canvas.height=1;}
}
