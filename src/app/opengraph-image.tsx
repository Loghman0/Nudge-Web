import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
export const alt="Nudge — A little curiosity. A little more you.";
export const size={width:1200,height:630};
export const contentType="image/png";
export default async function Image(){
  const mark = await readFile(process.cwd()+"/public/brand/nudge-mark.svg", "base64");
  return new ImageResponse(<div style={{display:"flex",width:"100%",height:"100%",background:"#edf2f7",color:"#253348",flexDirection:"column",justifyContent:"center",padding:"100px",borderBottom:"20px solid #355db9"}}><div style={{display:"flex",alignItems:"center",gap:28,fontSize:100,fontWeight:700}}><img src={`data:image/svg+xml;base64,${mark}`} width={112} height={112} alt=""/>Nudge</div><div style={{fontSize:40,marginTop:36}}>A little curiosity. A little more you.</div><div style={{fontSize:32,marginTop:16}}>Know yourself, one question at a time.</div></div>,size);
}
