import { z } from "zod";
import { AppError, ancestry, characterSchema, profileSchema, storySchema, turnSchema } from "@/lib/tavern/validation";
import { allTurns, characterLibraryRows, commitTurn, createStory, db, encryptionSecret, generationStageCache, getStory, getWorkspace, owner, profileRows, presetRows, pruneGenerationStages, requireOrigin } from "@/lib/tavern/store";
import { complete, cryptKey, validateEndpoint } from "@/lib/tavern/models";
import { isolateCreativeMessages, PROTOCOL_VERSION } from "@/lib/tavern/protocols";
import { demoTurn, runTurn } from "@/lib/tavern/engine";
import type { Profile, StoryState, Turn } from "@/lib/tavern/types";
import { compilePreset, PresetError } from "@/lib/tavern/presets";
import type { PresetContext } from "@/lib/tavern/presets";
import { modelDiscoverySchema, discoveryKey, listAvailableModels } from "@/lib/tavern/model-discovery";
import { clearCardMemory } from "@/lib/tavern/cards";

export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
function fail(error:unknown){if(error instanceof AppError)return Response.json({error:error.message},{status:error.status,headers});if(error instanceof z.ZodError)return Response.json({error:"输入格式不正确："+error.issues.map(i=>i.path.join(".")+" "+i.message).slice(0,3).join("；")},{status:400,headers});console.error("Tavern operation failed",error instanceof Error?error.name:"unknown");return Response.json({error:"操作暂时失败，输入已保留。请重试；若持续失败请检查数据库迁移与服务端配置。"},{status:500,headers});}
export async function GET(request:Request){try{return Response.json(await getWorkspace(owner(request),new URL(request.url).searchParams.get("story")||undefined),{headers});}catch(e){return fail(e)}}
export async function POST(request:Request){try{
 requireOrigin(request);const user=owner(request);const raw=await request.text();if(new TextEncoder().encode(raw).length>2*1024*1024)throw new AppError("请求内容超过 2 MB。",413);let body;try{body=JSON.parse(raw)}catch{throw new AppError("请求不是有效的 JSON。");}
 const action=z.string().parse(body.action);
 if(action==="createStory"){const id=await createStory(user,body.story?storySchema.parse(body.story):undefined);return Response.json(await getWorkspace(user,id),{headers});}
 if(action==="saveLibraryCharacter"){
  const character=characterSchema.parse({...body.character,memories:[]});if(character.card)character.card=clearCardMemory(character.card);const id=body.libraryId?z.string().uuid().parse(body.libraryId):crypto.randomUUID();
  const profiles=await profileRows(user);if(character.modelId!=="default"&&!profiles.some(p=>p.id===character.modelId))throw new AppError("角色引用了不存在的模型。");
  const presets=await presetRows(user);if(character.presetId&&character.presetId!=="inherit"&&!presets.some(p=>p.id===character.presetId))throw new AppError("角色引用了不存在的预设。");
  const now=new Date().toISOString();
  if(body.libraryId){const revision=z.number().int().positive().parse(body.libraryRevision);const result=await db().prepare("UPDATE character_library SET data=?,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=?").bind(JSON.stringify(character),now,id,user,revision).run();if(!result.meta.changes)throw new AppError("角色库条目已修改或不存在，请重新打开。",409);}
  else{if((await characterLibraryRows(user)).length>=100)throw new AppError("角色库最多保存 100 个角色，请先整理已有角色。");await db().prepare("INSERT INTO character_library (id,owner,data,revision,created_at,updated_at) VALUES (?,?,?,1,?,?)").bind(id,user,JSON.stringify(character),now,now).run();}
  return Response.json(await getWorkspace(user,body.storyId),{headers});
 }
 if(action==="deleteLibraryCharacter"){
  const id=z.string().uuid().parse(body.libraryId);const revision=z.number().int().positive().parse(body.libraryRevision);
  const result=await db().prepare("DELETE FROM character_library WHERE id=? AND owner=? AND revision=?").bind(id,user,revision).run();if(!result.meta.changes)throw new AppError("角色库条目已修改或不存在，请重新打开。",409);
  return Response.json(await getWorkspace(user,body.storyId),{headers});
 }
 if(action==="importLibraryCharacter"){
  const storyId=z.string().parse(body.storyId);const revision=z.number().int().nonnegative().parse(body.revision);const libraryId=z.string().uuid().parse(body.libraryId);const row=await getStory(user,storyId);if(row.revision!==revision)throw new AppError("故事已更新，请刷新后重试。",409);
  const stored=(await characterLibraryRows(user)).find(item=>item.id===libraryId);if(!stored)throw new AppError("找不到这个角色库条目。",404);
  const story=storySchema.parse(JSON.parse(row.data));if(story.characters.length>=6)throw new AppError("每个故事最多 6 个角色。");
  const character=characterSchema.parse({...structuredClone(stored.character),id:crypto.randomUUID(),memories:[]});if(character.card)character.card=clearCardMemory(character.card);
  const profiles=await profileRows(user);if(character.modelId!=="default"&&!profiles.some(p=>p.id===character.modelId))throw new AppError("这个角色使用的模型已不存在，请先编辑角色库条目。");
  const presets=await presetRows(user);if(character.presetId&&character.presetId!=="inherit"&&!presets.some(p=>p.id===character.presetId))throw new AppError("这个角色使用的预设已不存在，请先编辑角色库条目。");
  story.characters.push(character);const result=await db().prepare("UPDATE stories SET data=?,root=CASE WHEN head_id IS NULL THEN ? ELSE root END,revision=revision+1 WHERE id=? AND owner=? AND revision=?").bind(JSON.stringify(story),JSON.stringify(story),storyId,user,revision).run();if(!result.meta.changes)throw new AppError("导入冲突，请刷新后重试。",409);
  return Response.json(await getWorkspace(user,storyId),{headers});
 }
 if(action==="listModels"){
  const input=modelDiscoverySchema.parse(body.connection);
  const stored=input.id?(await profileRows(user)).find(p=>p.id===input.id):undefined;
  if(input.id&&!stored)throw new AppError("找不到此模型配置。",404);
  const key=await discoveryKey(input,stored,encryptionSecret);
  return Response.json(await listAvailableModels(input,key,request.signal),{headers});
 }
 if(action==="saveProfile"){
  const p=profileSchema.parse(body.profile);validateEndpoint(p);
  const existing=p.id?(await profileRows(user)).find(r=>r.id===p.id):undefined;
  if(p.id&&!existing)throw new AppError("找不到模型配置。",404);
  const id=p.id||crypto.randomUUID();const {apiKey,clearKey,...profile}=p;
  let encrypted=existing?.encrypted_key||"";if(clearKey)encrypted="";else if(apiKey)encrypted=await cryptKey(apiKey,encryptionSecret());
  await db().prepare("INSERT INTO profiles (id,owner,data,encrypted_key) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, encrypted_key=excluded.encrypted_key WHERE profiles.owner=excluded.owner").bind(id,user,JSON.stringify({...profile,id}),encrypted).run();
  return Response.json(await getWorkspace(user,body.storyId),{headers});
 }
 if(action==="testProfile"){
  const p=(await profileRows(user)).find(p=>p.id===body.profileId);if(!p)throw new AppError("请先保存模型配置。",404);
  const start=Date.now();await complete(JSON.parse(p.data),p.encrypted_key?await cryptKey(p.encrypted_key,encryptionSecret(),true):"","这是 API 连接测试。仅回复 OK。","请回复 OK。");return Response.json({ok:true,elapsed:Date.now()-start},{headers});
 }
 if(action==="deleteProfile"){
  const using=await db().prepare("SELECT id FROM stories WHERE owner=? AND (director_id=? OR data LIKE ?)").bind(user,body.profileId,`%"modelId":"${z.string().uuid().parse(body.profileId)}"%`).first();
  const libraryUsing=await db().prepare("SELECT id FROM character_library WHERE owner=? AND instr(data,?)>0").bind(user,JSON.stringify(body.profileId)).first();
  if(using||libraryUsing)throw new AppError("这个模型仍被故事或角色库使用，请先更换分配。");
  await db().prepare("DELETE FROM profiles WHERE id=? AND owner=?").bind(body.profileId,user).run();return Response.json(await getWorkspace(user,body.storyId),{headers});
 }
 if(action==="saveStory"||action==="switchHead"||action==="configure"){
  const id=z.string().parse(body.storyId);const revision=z.number().int().parse(body.revision);const row=await getStory(user,id);if(row.revision!==revision)throw new AppError("故事已更新，请刷新后重试。",409);
  if(action==="saveStory"){
   const story=storySchema.parse(body.story);const current=JSON.parse(row.data) as StoryState;
   story.characters.forEach(c=>{c.memories=current.characters.find(old=>old.id===c.id)?.memories||[];});
   const valid=new Set((await profileRows(user)).map(p=>p.id));if(story.characters.some(c=>c.modelId!=="default"&&!valid.has(c.modelId))||Object.values(story.stageModels).some(id=>id&&!valid.has(id)))throw new AppError("故事阶段或角色引用了不存在的模型。");
   const available=new Set((await presetRows(user)).map(p=>p.id));
   const selected=[...Object.values(story.presetSelection),...story.characters.map(c=>c.presetId).filter(id=>id!=="inherit")].filter(Boolean);
   if(selected.some(id=>!available.has(id)))throw new AppError("所选预设不存在或无权访问。");
   const result=await db().prepare("UPDATE stories SET data=?,title=?,root=CASE WHEN head_id IS NULL THEN ? ELSE root END,revision=revision+1 WHERE id=? AND owner=? AND revision=?").bind(JSON.stringify(story),story.title,JSON.stringify(story),id,user,revision).run();if(!result.meta.changes)throw new AppError("保存冲突，请刷新。",409);
  }else if(action==="switchHead"){
   const head=z.string().nullable().parse(body.headId);const turn=head?(await allTurns(id)).find(t=>t.id===head):null;if(head&&!turn)throw new AppError("找不到这个回合。",404);
   const story=turn?.snapshot||JSON.parse(row.root);
   const result=await db().prepare("UPDATE stories SET data=?,title=?,head_id=?,revision=revision+1 WHERE id=? AND owner=? AND revision=?").bind(JSON.stringify(story),story.title,head,id,user,revision).run();if(!result.meta.changes)throw new AppError("切换冲突，请刷新。",409);
  }else{
   const demo=z.boolean().parse(body.demo);const directorId=z.string().parse(body.directorId);
   const profiles=await profileRows(user);if(directorId&&!profiles.some(p=>p.id===directorId))throw new AppError("找不到主 AI 模型。");
   if(!demo&&!profiles.some(p=>p.id===directorId&&p.encrypted_key))throw new AppError("请先配置带密钥的主 AI 模型，再关闭演示模式。");
   const result=await db().prepare("UPDATE stories SET demo=?,director_id=?,revision=revision+1 WHERE id=? AND owner=? AND revision=?").bind(demo?1:0,directorId,id,user,revision).run();if(!result.meta.changes)throw new AppError("配置冲突，请刷新。",409);
  }
  return Response.json(await getWorkspace(user,id),{headers});
 }
 if(action!=="generate")throw new AppError("未知操作。");
 const args=turnSchema.parse(body.turn);const row=await getStory(user,args.storyId);const turns=await allTurns(row.id);
 // Repeating a completed request never triggers another billable generation.
 if(turns.some(t=>t.id===args.requestId))return Response.json(await getWorkspace(user,row.id),{headers});
 if(row.revision!==args.revision)throw new AppError("故事已经更新，请刷新后重试。",409);
 if(turns.length>=150)throw new AppError("第一版每个故事最多保留 150 个回合版本，请新建故事继续。");
 let parentId=row.head_id;let story:StoryState=storySchema.parse(JSON.parse(row.data));
 if(args.regenerate){const head=turns.find(t=>t.id===row.head_id);if(!head)throw new AppError("当前没有可以重新生成的回合。");parentId=head.parentId;story=storySchema.parse(parentId?turns.find(t=>t.id===parentId)!.snapshot:JSON.parse(row.root));}
 const profiles=await profileRows(user);const keys=new Map<string,string>();
 const presets=await presetRows(user);
 const appliedPresets=new Map<string,NonNullable<Turn["trace"]["presets"]>[number]>();
 const call=async(id:string,system:string,prompt:string,context?:PresetContext)=>{
  const row=profiles.find(p=>p.id===id);if(!row)throw new AppError("角色或主 AI 的模型配置不存在，请检查模型分配。");
  if(!keys.has(id))keys.set(id,row.encrypted_key?await cryptKey(row.encrypted_key,encryptionSecret(),true):"");
  let options;
  if(context){
   const override=story.characters.find(c=>c.id===context.characterId)?.presetId;
   const presetId=context.stage==="actor"&&override!==undefined&&override!=="inherit"?override:story.presetSelection?.[context.stage];
   if(presetId){
    const preset=presets.find(p=>p.id===presetId);if(!preset)throw new AppError("本回合引用的预设不存在，请重新分配预设。");
    try{const compiled=compilePreset(preset,context);const messages=isolateCreativeMessages(compiled.messages,context.stage);options={...compiled,messages,characters:messages.reduce((sum,message)=>sum+message.content.length,0),structured:true}}catch(error){if(error instanceof PresetError)throw new AppError(error.message);throw error;}
    const provider=(JSON.parse(row.data) as Profile).provider;
    if(provider==="anthropic"||provider==="gemini")options.warnings.push("此服务商将 system 条目合并为系统指令，无法保留它们与对话交错的位置。frequency/presence penalty 未应用。");
    if(provider==="anthropic")options.warnings.push("Claude 适配的 temperature 上限为 1；与 top_p 同时配置时仅发送 temperature。");
    appliedPresets.set(context.stage+":"+(context.characterId||""),{stage:context.stage+(context.characterId?":"+context.characterId:""),name:preset.name,revision:preset.revision,warnings:options.warnings,characters:options.characters});
   }
  }
  const modelOptions=options?{messages:options.messages,sampling:options.sampling,structured:true}:{messages:[],sampling:{},structured:true};
  const text=await complete(JSON.parse(row.data) as Profile,keys.get(id)!,system,prompt,modelOptions);return {text,contextCharacters:options?.characters||0};
 };
 const stream=new ReadableStream({async start(controller){
  const encoder=new TextEncoder();let open=true;const send=(event:string,data:unknown)=>{if(open)try{controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));}catch{open=false;}};
  try{
   send("progress",{message:row.demo?"正在生成规则演示…":"开始本轮创作…"});
   const fingerprintBytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({protocolVersion:PROTOCOL_VERSION,storyId:row.id,revision:row.revision,parentId,input:args.input,mode:args.mode,regenerate:!!args.regenerate,profiles:profiles.map(p=>[p.id,p.data]),presets:presets.map(p=>[p.id,p.revision])})));const fingerprint=Array.from(new Uint8Array(fingerprintBytes),b=>b.toString(16).padStart(2,"0")).join("");
   const describeModel=(id:string)=>{const profile=profiles.find(p=>p.id===id);if(!profile)return id;const data=JSON.parse(profile.data) as Profile;return `${data.name} · ${data.model}`};
   if(!row.demo)await pruneGenerationStages(user);const result=row.demo?demoTurn(story,args.input,args.mode,args.requestId):await runTurn({story,history:ancestry(turns,parentId),input:args.input,mode:args.mode,directorId:row.director_id,turnId:args.requestId,call,cache:generationStageCache(args.requestId,row.id,user,fingerprint),describeModel,regenerate:args.regenerate,progress:message=>send("progress",{message})});
   const turn:Turn={id:args.requestId,parentId,input:args.input,mode:args.mode,createdAt:new Date().toISOString(),demo:!!row.demo,...result,trace:{...result.trace,presets:[...appliedPresets.values()]},snapshot:storySchema.parse(result.snapshot)};
   await commitTurn(row,turn);send("done",await getWorkspace(user,row.id));
  }catch(e){send("error",{error:e instanceof AppError?e.message:"本轮生成未完成，请刷新确认进度后重试。"});}
  finally{keys.clear();if(open)try{controller.close()}catch{ /* client closed */ }}
 }});
 return new Response(stream,{headers:{...headers,"Content-Type":"text/event-stream; charset=utf-8","X-Accel-Buffering":"no"}});
}catch(e){return fail(e)}}


