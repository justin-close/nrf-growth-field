import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPrintPDF} from '../print-pdf.mjs';
const available=spawnSync('pdftoppm',['-v'],{encoding:'utf8'}).status===0;
test('Poppler renders CMYK and spot mixtures, small tints and continuous masks without PDF syntax errors',{skip:!available},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'nrf-pdf-'));
  const artwork={layout:{width:3,height:2},crop:{x:0,y:0,width:300,height:200},background:'#F6F5EF',shapes:[
    {type:'circle',x:80,y:80,radius:25,alpha:.7,ink:{primary:'#1F41FF',secondary:'#062059',tone:.0000001}},
    {type:'circle',x:200,y:140,radius:25,alpha:1,ink:{primary:'#5AEB41',secondary:'#F6F5EF',tone:.8}},
    {type:'line',a:{x:25,y:50},b:{x:280,y:175},width:2,stops:[[0,0],[.25,.5],[.5,1],[.75,.5],[1,0]],ink:'#FF5825'}
  ]};
  try{for(const mode of ['cmyk','pms']){
    const path=join(folder,mode+'.pdf');await writeFile(path,new Uint8Array(await buildPrintPDF(artwork,mode).arrayBuffer()));
    const result=spawnSync('pdftoppm',['-scale-to','400','-png','-singlefile',path,join(folder,mode)],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
  }}finally{await rm(folder,{recursive:true,force:true});}
});
