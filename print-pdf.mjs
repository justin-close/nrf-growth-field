import {PALETTE_SOURCE,colorComponents,artworkInks} from './print-colors.mjs';

const n=value=>{if(!Number.isFinite(value))throw new Error('Invalid PDF geometry.');return value.toFixed(7).replace(/\.?0+$/,'');};
const array=values=>values.map(n).join(' ');
const literal=value=>'('+String(value).replace(/[^\x20-\x7e]/g,'-').replace(/([\\()])/g,'\\$1')+')';
const name=value=>'/'+String(value).replace(/[^A-Za-z0-9_-]/g,c=>'#'+c.charCodeAt(0).toString(16).padStart(2,'0'));
const ref=id=>`${id} 0 R`;

// Small PDF 1.7 writer: vector marks, DeviceCMYK or named ink spaces, and live
// transparency. No RGB conversion, raster artwork, automatic overprint or flattening.
class PDF {
  constructor(){this.objects=[];}
  add(value=''){this.objects.push(value);return this.objects.length;}
  set(id,value){this.objects[id-1]=value;}
  stream(data,entries=''){return this.add(`<< ${entries} /Length ${data.length} >>\nstream\n${data}\nendstream`);}
  bytes(root,info){
    let text='%PDF-1.7\n%NRF vector print\n',offsets=[0];
    for(let i=0;i<this.objects.length;i++){offsets.push(text.length);text+=`${i+1} 0 obj\n${this.objects[i]}\nendobj\n`;}
    const start=text.length;text+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    for(const offset of offsets.slice(1))text+=String(offset).padStart(10,'0')+' 00000 n \n';
    text+=`trailer\n<< /Size ${offsets.length} /Root ${ref(root)} /Info ${ref(info)} >>\nstartxref\n${start}\n%%EOF\n`;
    return new TextEncoder().encode(text);
  }
}
function circlePath(x,y,r){
  const k=r*.5522847498307936;
  return `${array([x+r,y])} m ${array([x+r,y+k,x+k,y+r,x,y+r])} c ${array([x-k,y+r,x-r,y+k,x-r,y])} c ${array([x-r,y-k,x-k,y-r,x,y-r])} c ${array([x+k,y-r,x+r,y-k,x+r,y])} c h`;
}
function tintFunction(pdf,inks){
  if(inks.length===1)return pdf.add(`<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${array(inks[0].cmyk.map(v=>v/100))}] /N 1 >>`);
  // Calculator function keeps each tint's approved recipe exact, including mixtures.
  const code=inks[0].cmyk.map((v,i)=>`${i+1} index ${n(v/100)} mul ${i+1} index ${n(inks[1].cmyk[i]/100)} mul add dup 1 gt { pop 1 } if`).join(' ');
  return pdf.stream(`{ ${code} 6 -2 roll pop pop }`,'/FunctionType 4 /Domain [0 1 0 1] /Range [0 1 0 1 0 1 0 1]');
}
export function buildPrintPDF(artwork,mode='cmyk'){
  if(!['cmyk','pms'].includes(mode))throw new Error('Choose CMYK or PMS PDF.');
  if(!artwork.shapes.length)throw new Error('No visible artwork to export.');
  const pdf=new PDF(),catalog=pdf.add(),pages=pdf.add(),page=pdf.add(),states=[],spaces=[],spaceCache=new Map(),alphaCache=new Map();
  const inks=artworkInks(artwork),width=artwork.layout.width*72,height=artwork.layout.height*72;
  // PDF 1.6+ supports pages up to 381 km via UserUnit. Keep coordinates <=14400.
  const userUnit=Math.max(1,Math.max(width,height)/14400),w=width/userUnit,h=height/userUnit;
  const crop=artwork.crop,scale=w/crop.width,commands=[];
  const registerState=id=>{const key='G'+states.length;states.push(`/${key} ${ref(id)}`);return key;};
  const constantAlpha=alpha=>{
    const key=n(alpha);if(alphaCache.has(key))return alphaCache.get(key);
    const state=registerState(pdf.add(`<< /Type /ExtGState /CA ${key} /ca ${key} /BM /Normal /OP false /op false /SMask /None >>`));alphaCache.set(key,state);return state;
  };
  const inkCommands=(ink,stroke)=>{
    const {primary,secondary,tone,cmyk}=colorComponents(ink),op=stroke?'SCN':'scn';
    if(mode==='cmyk')return `${array(cmyk)} ${stroke?'K':'k'}`;
    const mixed=tone>0&&tone<1&&primary.hex!==secondary.hex,used=mixed?[primary,secondary]:[tone===1?secondary:primary],key=used.map(c=>c.hex).join(',');
    if(!spaceCache.has(key)){
      const fn=tintFunction(pdf,used),space=mixed?`[/DeviceN [${used.map(c=>name('PANTONE '+c.pms)).join(' ')}] /DeviceCMYK ${ref(fn)}]`:`[/Separation ${name('PANTONE '+used[0].pms)} /DeviceCMYK ${ref(fn)}]`;
      const id=pdf.add(space),label='Ink'+spaces.length;spaces.push(`/${label} ${ref(id)}`);spaceCache.set(key,label);
    }
    return `/${spaceCache.get(key)} ${stroke?'CS':'cs'} ${mixed?array([1-tone,tone]):'1'} ${op}`;
  };
  const fadeState=(shape,stops)=>{
    const functions=stops.slice(1).map((stop,i)=>pdf.add(`<< /FunctionType 2 /Domain [0 1] /C0 [${n(stops[i][1])}] /C1 [${n(stop[1])}] /N 1 >>`));
    const fn=pdf.add(`<< /FunctionType 3 /Domain [0 1] /Functions [${functions.map(ref).join(' ')}] /Bounds [${array(stops.slice(1,-1).map(s=>s[0]))}] /Encode [${functions.map(()=>'0 1').join(' ')}] >>`);
    const shading=pdf.add(`<< /ShadingType 2 /ColorSpace /DeviceGray /Coords [${array([shape.a.x,shape.a.y,shape.b.x,shape.b.y])}] /Function ${ref(fn)} /Extend [true true] >>`);
    const r=shape.width/2+.001,box=[Math.min(shape.a.x,shape.b.x)-r,Math.min(shape.a.y,shape.b.y)-r,Math.max(shape.a.x,shape.b.x)+r,Math.max(shape.a.y,shape.b.y)+r];
    const group=pdf.stream('/Fade sh',`/Type /XObject /Subtype /Form /FormType 1 /BBox [${array(box)}] /Group << /S /Transparency /CS /DeviceGray /I true >> /Resources << /Shading << /Fade ${ref(shading)} >> >>`);
    return registerState(pdf.add(`<< /Type /ExtGState /CA 1 /ca 1 /BM /Normal /OP false /op false /SMask << /S /Luminosity /G ${ref(group)} /BC [0] >> >>`));
  };
  commands.push('q',`${array([scale,0,0,-scale,-crop.x*scale,h+crop.y*scale])} cm`,`${array([crop.x,crop.y,crop.width,crop.height])} re W n`,'1 J 1 j');
  if(artwork.background)commands.push(inkCommands(artwork.background,false),`${array([crop.x,crop.y,crop.width,crop.height])} re f`);
  for(const shape of artwork.shapes){
    if(shape.type==='circle'){
      commands.push('q',`/${constantAlpha(shape.alpha)} gs`,inkCommands(shape.ink,false),circlePath(shape.x,shape.y,shape.radius),'f','Q');
    }else if(shape.type==='line'){
      const stops=shape.stops;
      const uniform=stops.every(s=>Math.abs(s[1]-stops[0][1])<.0001),zeroLength=Math.hypot(shape.b.x-shape.a.x,shape.b.y-shape.a.y)<1e-7;
      const state=uniform||zeroLength?constantAlpha(stops[0][1]):fadeState(shape,stops);
      commands.push('q',`/${state} gs`,inkCommands(shape.ink,true),`${n(shape.width)} w`,`${array([shape.a.x,shape.a.y])} m ${array([shape.b.x,shape.b.y])} l S`,'Q');
    }else throw new Error('Unsupported print geometry.');
  }
  commands.push('Q');
  const content=pdf.stream(commands.join('\n'));
  const specification=inks.map(c=>`${c.name}: CMYK ${c.cmyk.join('/')} ; PMS ${c.pms}`).join(' | ');
  const info=pdf.add(`<< /Title ${literal('NRF Growth Field - '+mode.toUpperCase())} /Creator (NRF Growth Field) /Subject ${literal(`${mode==='cmyk'?'Exact approved process CMYK recipes':'Named PANTONE spot inks with approved CMYK alternates'}. Live transparency; no automatic overprint. ${specification}. Source: ${PALETTE_SOURCE}. PMS coating suffix and press ICC profile not specified by the palette; confirm with printer. Not PDF/X.`)} >>`);
  pdf.set(page,`<< /Type /Page /Parent ${ref(pages)} /MediaBox [0 0 ${array([w,h])}] /CropBox [0 0 ${array([w,h])}] /TrimBox [0 0 ${array([w,h])}] ${userUnit>1?`/UserUnit ${n(userUnit)}`:''} /Resources << /ExtGState << ${states.join(' ')} >> /ColorSpace << ${spaces.join(' ')} >> >> /Group << /S /Transparency /CS /DeviceCMYK /I true >> /Contents ${ref(content)} >>`);
  pdf.set(pages,`<< /Type /Pages /Kids [${ref(page)}] /Count 1 >>`);pdf.set(catalog,`<< /Type /Catalog /Pages ${ref(pages)} >>`);
  return new Blob([pdf.bytes(catalog,info)],{type:'application/pdf'});
}
