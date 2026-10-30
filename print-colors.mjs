// Approved values, transcribed from NRF 2027 / Color (4028:6979), 2026-10-30.
// PMS references have no coated/uncoated suffix in the source. Do not invent one.
export const PALETTE_SOURCE='https://www.figma.com/design/cxlHWMSFQl82XaRkXWEyVx/NRF-2027?node-id=4028-6979';
export const PRINT_COLORS=Object.freeze([
  {name:'Fresh Green',hex:'#5AEB41',cmyk:[51,0,86,0],pms:'7488'},
  {name:'Vivid Blue',hex:'#0005C6',cmyk:[100,90,0,7],pms:'072'},
  {name:'Orange',hex:'#FF5825',cmyk:[0,74,100,0],pms:'Orange 021'},
  {name:'Fir',hex:'#173B2B',cmyk:[88,24,66,74],pms:'567'},
  {name:'Oxford Blue',hex:'#000F82',cmyk:[100,87,0,20],pms:'Reflex Blue'},
  {name:'Mahogany',hex:'#65131A',cmyk:[4,91,74,48],pms:'7624'},
  {name:'Expanse Black',hex:'#121412',cmyk:[100,61,32,96],pms:'Black 6'},
  {name:'Chalk',hex:'#F6F5EF',cmyk:[4,3,7,0],pms:'9285'}
].map(color=>Object.freeze({...color,cmyk:Object.freeze(color.cmyk)})));
export function printColor(hex){const color=PRINT_COLORS.find(c=>c.hex===hex?.toUpperCase());if(!color)throw new Error(`No approved print ink for ${hex}.`);return color;}
export function colorComponents(ink){
  const primary=printColor(ink.primary||ink),tone=Math.max(0,Math.min(1,ink.tone||0));
  const secondary=tone>0?printColor(ink.secondary):primary;
  return {primary,secondary,tone,cmyk:primary.cmyk.map((v,i)=>(v*(1-tone)+secondary.cmyk[i]*tone)/100)};
}
export function artworkInks(artwork){
  const hexes=new Set(artwork.background?[artwork.background]:[]);
  for(const shape of artwork.shapes){const {primary,secondary,tone}=colorComponents(shape.ink);if(tone<1)hexes.add(primary.hex);if(tone>0)hexes.add(secondary.hex);}
  return [...hexes].map(printColor);
}
