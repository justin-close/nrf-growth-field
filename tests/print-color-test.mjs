import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PRINT_COLORS,printColor,colorComponents,artworkInks} from '../print-colors.mjs';
import {buildPrintPDF} from '../print-pdf.mjs';

const makeArtwork=()=>({layout:{width:3.5,height:2},crop:{x:-20,y:10,width:350,height:200},background:'#121412',shapes:[
  {type:'circle',x:100,y:100,radius:5,alpha:.6,ink:{primary:'#5AEB41',secondary:'#F6F5EF',tone:.2}},
  {type:'line',a:{x:0,y:40},b:{x:300,y:190},width:1,stops:[[0,.1],[.25,.4],[.5,.8],[.75,.4],[1,.1]],ink:'#5AEB41'}
]});
test('all eight ink recipes and PMS references exactly match the source palette',()=>{
  assert.deepEqual(PRINT_COLORS.map(c=>[c.hex,c.cmyk,c.pms]),[
    ['#5AEB41',[51,0,86,0],'7488'],['#0005C6',[100,90,0,7],'072'],['#FF5825',[0,74,100,0],'Orange 021'],['#173B2B',[88,24,66,74],'567'],
    ['#000F82',[100,87,0,20],'Reflex Blue'],['#65131A',[4,91,74,48],'7624'],['#121412',[100,61,32,96],'Black 6'],['#F6F5EF',[4,3,7,0],'9285']
  ]);
  assert.equal(printColor('#5aeb41').pms,'7488');assert.throws(()=>printColor('#123456'),/No approved/);
});
test('accent blends mix approved ink recipes, preserving exact endpoints and alpha separately',()=>{
  for(const tone of [0,.2,.5,1]){
    const result=colorComponents({primary:'#5AEB41',secondary:'#F6F5EF',tone});
    assert.deepEqual(result.cmyk,[51*(1-tone)+4*tone,3*tone,86*(1-tone)+7*tone,0].map(v=>v/100));
  }
  assert.deepEqual(artworkInks(makeArtwork()).map(c=>c.pms),['Black 6','7488','9285']);
  const transparent=makeArtwork();transparent.background=null;assert.equal(artworkInks(transparent).length,2);
});
test('revised blue screen presets, palette metadata and PDF inks stay aligned',async()=>{
  const palette=JSON.parse(await readFile(new URL('../palette.json',import.meta.url),'utf8'));
  const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
  for(const name of ['Vivid Blue','Oxford Blue']){
    const ink=PRINT_COLORS.find(c=>c.name===name);
    assert.equal(palette.colors[name],ink.hex);
    assert.deepEqual(palette.print[name],{cmyk:ink.cmyk,pms:ink.pms});
    assert.ok(app.includes(ink.hex));
  }
  const artwork=makeArtwork();artwork.background='#000F82';artwork.shapes=[
    {...artwork.shapes[0],ink:'#0005C6'},
    {...artwork.shapes[1],ink:{primary:'#0005C6',secondary:'#000F82',tone:.5}}
  ];
  const process=await buildPrintPDF(artwork,'cmyk').text();
  assert.match(process,/1 0\.87 0 0\.2 k/);assert.match(process,/1 0\.9 0 0\.07 k/);
  assert.match(process,/1 0\.885 0 0\.135 K/);
  const spot=await buildPrintPDF(artwork,'pms').text();
  assert.match(spot,/\/Separation \/PANTONE#20072/);
  assert.match(spot,/\/Separation \/PANTONE#20Reflex#20Blue/);
  assert.match(spot,/\/DeviceN \[\/PANTONE#20072 \/PANTONE#20Reflex#20Blue\]/);
  assert.doesNotMatch(app+process+spot,/#1F41FF|#062059|PANTONE#20285\b|PANTONE#202955\b/);
});
test('CMYK PDF has process operators, physical page dimensions, vector curves and grayscale fade masks',async()=>{
  const blob=buildPrintPDF(makeArtwork()),text=await blob.text();assert.equal(blob.type,'application/pdf');
  assert.match(text,/\/MediaBox \[0 0 252 144\]/);assert.match(text,/0\.416 0\.006 0\.702 0 k/);
  assert.match(text,/0\.51 0 0\.86 0 K/);assert.match(text,/\/SMask << \/S \/Luminosity/);assert.match(text,/\/ShadingType 2 \/ColorSpace \/DeviceGray/);
  assert.match(text,/1 J 1 j/);assert.match(text,/ c h\nf/);assert.doesNotMatch(text,/DeviceRGB|\/Subtype \/Image|\/Separation|\/DeviceN/);
  assert.match(text,/\/OP false \/op false/);
  const start=Number(text.match(/startxref\n(\d+)/)[1]);assert.equal(text.slice(start,start+4),'xref');
});
test('PMS PDF retains named plates and true DeviceN accent mixtures without RGB artwork',async()=>{
  const text=await buildPrintPDF(makeArtwork(),'pms').text();
  assert.match(text,/\/Separation \/PANTONE#20Black#206/);assert.match(text,/\/Separation \/PANTONE#207488/);
  assert.match(text,/\/DeviceN \[\/PANTONE#207488 \/PANTONE#209285\]/);assert.match(text,/0\.8 0\.2 scn/);
  assert.match(text,/\/FunctionType 4/);assert.doesNotMatch(text,/DeviceRGB|\/Subtype \/Image/);
  assert.match(text,/coating suffix and press ICC profile not specified/);
});
test('transparent output omits background inks, large pages retain actual dimensions, invalid modes fail',async()=>{
  const artwork=makeArtwork();artwork.background=null;artwork.layout={width:300,height:150};
  const text=await buildPrintPDF(artwork,'pms').text();
  assert.match(text,/\/UserUnit 1\.5/);assert.match(text,/\/MediaBox \[0 0 14400 7200\]/);assert.doesNotMatch(text,/Black#206/);
  assert.throws(()=>buildPrintPDF(artwork,'rgb'),/Choose/);assert.throws(()=>buildPrintPDF({...artwork,shapes:[]}),/No visible/);
});

test('PDF numbers use decimal syntax and tint functions only use supported calculator operators',async()=>{
  const artwork=makeArtwork();artwork.shapes[0].ink.tone=.0000001;
  const text=await buildPrintPDF(artwork,'pms').text();
  assert.doesNotMatch(text,/[0-9]e[+-][0-9]/i);assert.doesNotMatch(text,/add 1 min/);
  assert.match(text,/0\.0000001 scn/);assert.match(text,/dup 1 gt \{ pop 1 \} if/);
});
