import test from 'node:test';
import assert from 'node:assert/strict';
import {printLayout,printStroke,printRadius,printAlpha,svgPhysicalFrame,tagPrintPNG,crc32,printPresets} from '../print-export.mjs';

test('300 PPI includes bleed at actual artwork size in inches and millimetres',()=>{
  const inch=printLayout({...printPresets.card});
  assert.equal(inch.pixelWidth,1125);assert.equal(inch.pixelHeight,675);
  const mm=printLayout({width:88.9,height:50.8,bleed:3.175,unit:'mm'});
  assert.equal(mm.pixelWidth,inch.pixelWidth);assert.equal(mm.pixelHeight,inch.pixelHeight);
  assert.equal(inch.totalWidth,3.75);assert.equal(inch.totalHeight,2.25);
});
test('banner SVG remains available when raster dimensions would be excessive',()=>{
  const banner=printLayout({...printPresets.banner});assert.equal(banner.rasterOK,false);
  const svg=svgPhysicalFrame(600,1200,banner);
  assert.match(svg.attributes,/width="48.5in" height="96.5in"/);assert.equal(svg.inset,3.125);
  assert.equal(printLayout({...printPresets.poster}).rasterOK,true);
  assert.equal(printLayout({width:60,height:2}).rasterOK,false);
});
test('invalid physical sizes and weights are rejected instead of silently resized',()=>{
  for(const invalid of [{width:0},{height:NaN},{width:Infinity},{bleed:-1},{line:0},{dot:0},{opacity:101},{unit:'px'},{width:2400,height:.1}]){
    assert.throws(()=>printLayout({width:3.5,height:2,...invalid}));
  }
});
test('minimum lines and circles retain their physical weight regardless of vector viewBox',()=>{
  const layout=printLayout({width:3.5,height:2,line:.35,dot:1,opacity:35});
  for(const scale of [1,12.5,300,1000]){
    assert(Math.abs(printStroke(.00001,layout,scale)/scale*72-.35)<1e-10);
    assert(Math.abs(printRadius(.00001,layout,scale)/scale*144-1)<1e-10);
  }
  assert.equal(printStroke(10,layout,100),10);
  assert.equal(printAlpha(.05,layout),.35);assert.equal(printAlpha(0,layout),0);assert.equal(printAlpha(.0001,layout),.0001);
  assert.equal(printAlpha(.6,layout),.6);
  const off={...layout,reinforce:false};assert.equal(printAlpha(.05,off),.05);assert.equal(printStroke(.001,off,300),.001);assert.equal(printRadius(.001,off,300),.001);
});
test('PNG has one valid 300 PPI density chunk and sRGB declaration after retagging',async()=>{
  const original=new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0MsAAAAASUVORK5CYII=','base64')],{type:'image/png'});
  const blob=await tagPrintPNG(await tagPrintPNG(original)),bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),types=[];
  for(let offset=8;offset<bytes.length;){const n=view.getUint32(offset),type=new TextDecoder().decode(bytes.subarray(offset+4,offset+8));types.push(type);
    if(['pHYs','sRGB'].includes(type))assert.equal(view.getUint32(offset+8+n),crc32(bytes.subarray(offset+4,offset+8+n)));
    if(type==='pHYs'){assert.equal(view.getUint32(offset+8),11811);assert.equal(view.getUint32(offset+12),11811);assert.equal(bytes[offset+16],1);}
    offset+=n+12;
  }
  assert.equal(types.filter(t=>t==='pHYs').length,1);assert.equal(types.filter(t=>t==='sRGB').length,1);
  await assert.rejects(()=>tagPrintPNG(new Blob(['invalid'])));
});
