// Physical artwork sizes are independent of the browser viewport and device DPR.
export const PRINT_PPI = 300;
export const RASTER_LIMITS = {edge:16384, pixels:64_000_000};
export function printLayout({width,height,unit='in',line=.35,dot=1,opacity=35,reinforce=true}){
  const values={width:Number(width),height:Number(height),line:Number(line),dot:Number(dot),opacity:Number(opacity)};
  if(!['in','mm'].includes(unit))throw new Error('Choose inches or millimetres.');
  if(Object.values(values).some(v=>!Number.isFinite(v)))throw new Error('Enter a number in every print field.');
  const divisor=unit==='mm'?25.4:1,w=values.width/divisor,h=values.height/divisor;
  if(w<.1||h<.1||w>2400||h>2400)throw new Error('Maximum dimensions must be between 0.1 and 2400 inches.');
  if(w/h>100||h/w>100)throw new Error('Use an aspect ratio between 1:100 and 100:1.');
  if(values.line<.1||values.line>20||values.dot<.2||values.dot>40||values.opacity<0||values.opacity>100)throw new Error('Use 0.1–20 pt lines, 0.2–40 pt dots and 0–100% minimum opacity.');
  return sizedLayout({line:values.line,dot:values.dot,opacity:values.opacity/100,reinforce:Boolean(reinforce)},w,h);
}
function sizedLayout(layout,width,height){
  const pixelWidth=Math.max(1,Math.round(width*PRINT_PPI)),pixelHeight=Math.max(1,Math.round(height*PRINT_PPI));
  const rasterOK=pixelWidth<=RASTER_LIMITS.edge&&pixelHeight<=RASTER_LIMITS.edge&&pixelWidth*pixelHeight<=RASTER_LIMITS.pixels;
  return {...layout,width,height,totalWidth:width,totalHeight:height,pixelWidth,pixelHeight,rasterOK,ppi:PRINT_PPI};
}
// Dimensions bound the artwork, rather than imposing an unrelated canvas ratio.
export function cropPrintLayout(request,bounds){
  if(![bounds.minX,bounds.minY,bounds.maxX,bounds.maxY].every(Number.isFinite))throw new Error('No visible artwork at this moment. Advance the growth before exporting.');
  const w=Math.max(.001,bounds.maxX-bounds.minX),h=Math.max(.001,bounds.maxY-bounds.minY),margin=.03;
  const crop={x:bounds.minX-w*margin,y:bounds.minY-h*margin,width:w*(1+2*margin),height:h*(1+2*margin)};
  const scale=Math.min(request.width/crop.width,request.height/crop.height);
  return {crop,layout:sizedLayout(request,crop.width*scale,crop.height*scale)};
}
export function printStroke(original,layout,unitsPerInch){return layout?.reinforce?Math.max(original,layout.line/72*unitsPerInch):original;}
export function printRadius(original,layout,unitsPerInch){return layout?.reinforce?Math.max(original,layout.dot/144*unitsPerInch):original;}
export function printAlpha(alpha,layout){const a=Math.max(0,Math.min(1,alpha));return layout?.reinforce&&a>=.001?Math.max(a,layout.opacity):a;}
export function svgPhysicalFrame(width,height,layout,crop=null){
  const frame=crop||{x:0,y:0,width,height};
  const dimensions=layout?`width="${layout.width}in" height="${layout.height}in"`:`width="${width}" height="${height}"`;
  return {...frame,attributes:`${dimensions} viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}"`};
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return(crc^0xffffffff)>>>0;}
function pngChunk(type,data){const bytes=new Uint8Array(data.length+12),view=new DataView(bytes.buffer);view.setUint32(0,data.length);bytes.set(new TextEncoder().encode(type),4);bytes.set(data,8);view.setUint32(bytes.length-4,crc32(bytes.subarray(4,-4)));return bytes;}
// Canvas encoders commonly write 96 PPI. Replace it with the actual export density.
export async function tagPrintPNG(blob,ppi=PRINT_PPI){return tagPrintPNGBytes(new Uint8Array(await blob.arrayBuffer()),ppi);}
export function tagPrintPNGBytes(source,ppi=PRINT_PPI){
  const view=new DataView(source.buffer,source.byteOffset,source.byteLength),parts=[source.subarray(0,8)];
  if(source.length<33||source[0]!==137||new TextDecoder().decode(source.subarray(1,4))!=='PNG')throw new Error('Invalid PNG data.');
  const density=new Uint8Array(9),d=new DataView(density.buffer),ppm=Math.round(ppi/.0254);d.setUint32(0,ppm);d.setUint32(4,ppm);density[8]=1;
  let offset=8,hasSRGB=false;while(offset<source.length){const n=view.getUint32(offset),type=new TextDecoder().decode(source.subarray(offset+4,offset+8));if(offset+n+12>source.length)throw new Error('Incomplete PNG data.');if(type==='sRGB'||type==='iCCP')hasSRGB=true;offset+=n+12;}
  offset=8;while(offset<source.length){const n=view.getUint32(offset),type=new TextDecoder().decode(source.subarray(offset+4,offset+8));if(type!=='pHYs')parts.push(source.subarray(offset,offset+n+12));if(type==='IHDR'){parts.push(pngChunk('pHYs',density));if(!hasSRGB)parts.push(pngChunk('sRGB',new Uint8Array([0])));}offset+=n+12;}
  return new Blob(parts,{type:'image/png'});
}
export async function rasterizePrint(svg,layout,onStatus=()=>{}){
  if(!layout.rasterOK)throw new Error('This size exceeds the PNG limit. Export the scalable SVG instead.');
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  const canvas=document.createElement('canvas');
  try{
    onStatus('Loading vector artwork…');
    const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('The browser could not load the vector artwork. Export SVG instead.'));image.src=url;});
    onStatus('Rasterizing at 300 PPI…');canvas.width=layout.pixelWidth;canvas.height=layout.pixelHeight;
    const context=canvas.getContext('2d');if(!context)throw new Error('The browser could not allocate the print canvas. Use SVG.');
    context.drawImage(image,0,0,canvas.width,canvas.height);
    onStatus('Encoding print PNG…');
    const blob=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('PNG encoding timed out. Use SVG or a smaller size.')),30000);canvas.toBlob(result=>{clearTimeout(timer);resolve(result);},'image/png');});
    if(!blob)throw new Error('PNG encoding failed. Use SVG or a smaller size.');
    onStatus('Adding 300 PPI metadata…');return await tagPrintPNG(blob);
  }finally{canvas.width=canvas.height=1;URL.revokeObjectURL(url);}
}
