import { z } from "zod";
import { AppError } from "@/lib/tavern/validation";
import { db, owner, presetRows, requireOrigin } from "@/lib/tavern/store";
import { presetSchema, summarizePreset } from "@/lib/tavern/presets";
export const dynamic = "force-dynamic";
const headers = {"Cache-Control": "no-store"};
function failure(error:unknown) {
  if(error instanceof AppError) return Response.json({error:error.message},{status:error.status,headers});
  if(error instanceof z.ZodError) return Response.json({error:"预设字段格式不正确："+error.issues.map(i=>i.path.join(".")+" "+i.message).slice(0,3).join("；")},{status:400,headers});
  console.error("Preset storage failed",error instanceof Error?error.name:"unknown");
  return Response.json({error:"预设存储暂不可用，请确认数据库迁移已应用。"},{status:503,headers});
}
export async function GET(request:Request){try{
  const user=owner(request);const id=new URL(request.url).searchParams.get("id");const presets=await presetRows(user);
  if(!id)return Response.json(presets.map(summarizePreset),{headers});
  const preset=presets.find(p=>p.id===id);if(!preset)throw new AppError("找不到此预设。",404);
  return Response.json(preset,{headers});
}catch(error){return failure(error)}}
export async function DELETE(request:Request){try{
  requireOrigin(request);const user=owner(request);const input=z.object({id:z.string().min(1),revision:z.number().int()}).parse(await request.json());
  const stories=await db().prepare("SELECT data,root FROM stories WHERE owner=?").bind(user).all<{data:string;root:string}>();
  const references=(source:string)=>{const story=JSON.parse(source);return Object.values(story.presetSelection||{}).includes(input.id)||story.characters?.some((c:{presetId?:string})=>c.presetId===input.id)};
  const history=await db().prepare("SELECT turns.data FROM turns JOIN stories ON turns.story_id=stories.id WHERE stories.owner=?").bind(user).all<{data:string}>();
  const library=await db().prepare("SELECT data FROM character_library WHERE owner=?").bind(user).all<{data:string}>();
  if(stories.results.some(s=>references(s.data)||references(s.root))||history.results.some(t=>references(JSON.stringify(JSON.parse(t.data).snapshot)))||library.results.some(c=>(JSON.parse(c.data) as {presetId?:string}).presetId===input.id))throw new AppError("预设仍被故事、角色库或历史版本引用，请保留它，或改为编辑现有预设。");
  const token=JSON.stringify(input.id);
  const result=await db().prepare("DELETE FROM presets WHERE id=? AND owner=? AND revision=? AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.owner=? AND (instr(s.data,?)>0 OR instr(s.root,?)>0 OR EXISTS (SELECT 1 FROM turns t WHERE t.story_id=s.id AND instr(t.data,?)>0))) AND NOT EXISTS (SELECT 1 FROM character_library c WHERE c.owner=? AND instr(c.data,?)>0)").bind(input.id,user,input.revision,user,token,token,token,user,token).run();
  if(!result.meta.changes)throw new AppError("预设已修改或不存在，请重新打开。",409);
  return Response.json({ok:true},{headers});
}catch(error){return failure(error)}}
export async function POST(request:Request){try{
  requireOrigin(request);const user=owner(request);const text=await request.text();
  if(new TextEncoder().encode(text).length>1024*1024)throw new AppError("预设请求超过 1 MB。",413);
  let input;try{input=JSON.parse(text)}catch{throw new AppError("无效 JSON。");}
  const preset=presetSchema.parse(input);const rows=await presetRows(user);
  if(!preset.id){
    if(rows.length>=50)throw new AppError("第一版最多保存 50 份预设，请编辑已有预设。");
    preset.id=crypto.randomUUID();preset.revision=1;
    await db().prepare("INSERT INTO presets (id,owner,data,revision) VALUES (?,?,?,1)").bind(preset.id,user,JSON.stringify(preset)).run();
  }else{
    const existing=rows.find(p=>p.id===preset.id);if(!existing)throw new AppError("找不到此预设。",404);
    if(existing.revision!==preset.revision)throw new AppError("预设已在另一处修改，请重新打开后编辑。",409);
    const oldRevision=preset.revision;preset.revision++;
    const result=await db().prepare("UPDATE presets SET data=?,revision=revision+1 WHERE id=? AND owner=? AND revision=?").bind(JSON.stringify(preset),preset.id,user,oldRevision).run();
    if(!result.meta.changes)throw new AppError("预设保存冲突，请重新打开。",409);
  }
  return Response.json(preset,{headers});
}catch(error){return failure(error)}}
