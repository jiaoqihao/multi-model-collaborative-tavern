import { env } from "cloudflare:workers";
import type { D1Database } from "@cloudflare/workers-types";
import type { LibraryCharacter, Profile, StoryState, Turn, Workspace } from "./types";
import { initialStory } from "./seed";
import { AppError, characterSchema, storySchema } from "./validation";
import { presetSchema, summarizePreset } from "./presets";
import type { StageCache } from "./engine";
export function db(){const binding=(env as unknown as {DB:D1Database}).DB;if(!binding)throw new AppError("故事数据库尚未就绪，请应用数据库迁移后重试。",503);return binding;}
export function encryptionSecret(){return (env as unknown as {TAVERN_ENCRYPTION_KEY?:string}).TAVERN_ENCRYPTION_KEY||"";}
export function owner(request:Request){const user=request.headers.get("oai-authenticated-user-id");if(!user)throw new AppError("请登录后使用你的故事工作台。",401);return user;}
export function requireOrigin(request:Request){const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)throw new AppError("不接受来自其他站点的修改请求。",403);if(request.headers.get("sec-fetch-site")==="cross-site")throw new AppError("不接受跨站请求。",403);}
export type StoryRow={id:string;owner:string;title:string;data:string;root:string;head_id:string|null;revision:number;demo:number;director_id:string;created_at:string};
export async function getStory(user:string,id:string){const row=await db().prepare("SELECT * FROM stories WHERE id = ? AND owner = ?").bind(id,user).first<StoryRow>();if(!row)throw new AppError("找不到这个故事。",404);return row;}
export async function createStory(user:string,data:StoryState=initialStory()) {const id=crypto.randomUUID();const json=JSON.stringify(data);await db().prepare("INSERT INTO stories (id,owner,title,data,root,revision,demo,director_id,created_at) VALUES (?,?,?,?,?,0,1,'',?)").bind(id,user,data.title,json,json,new Date().toISOString()).run();return id;}
export async function allTurns(storyId:string){const rows=await db().prepare("SELECT data FROM turns WHERE story_id = ? ORDER BY created_at,id").bind(storyId).all<{data:string}>();return rows.results.map(r=>JSON.parse(r.data) as Turn);}
export async function profileRows(user:string){return (await db().prepare("SELECT id,data,encrypted_key FROM profiles WHERE owner = ?").bind(user).all<{id:string;data:string;encrypted_key:string}>()).results;}
export async function presetRows(user:string){return (await db().prepare("SELECT id,data,revision FROM presets WHERE owner = ? ORDER BY rowid DESC").bind(user).all<{id:string;data:string;revision:number}>()).results.map(r=>presetSchema.parse({...JSON.parse(r.data),id:r.id,revision:r.revision}));}
export async function characterLibraryRows(user:string):Promise<LibraryCharacter[]>{return (await db().prepare("SELECT id,data,revision FROM character_library WHERE owner = ? ORDER BY updated_at DESC,id").bind(user).all<{id:string;data:string;revision:number}>()).results.map(r=>({id:r.id,revision:r.revision,character:characterSchema.parse(JSON.parse(r.data))}));}
export function generationStageCache(requestId:string,storyId:string,user:string,fingerprint:string):StageCache{return {
 async load(stageKey){const row=await db().prepare("SELECT data FROM generation_stages WHERE request_id=? AND stage_key=? AND story_id=? AND owner=? AND fingerprint=?").bind(requestId,stageKey,storyId,user,fingerprint).first<{data:string}>();return row?JSON.parse(row.data):undefined},
 async save(stageKey,value){const result=await db().prepare("INSERT INTO generation_stages (request_id,stage_key,story_id,owner,fingerprint,data,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(request_id,stage_key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE generation_stages.story_id=excluded.story_id AND generation_stages.owner=excluded.owner AND generation_stages.fingerprint=excluded.fingerprint").bind(requestId,stageKey,storyId,user,fingerprint,JSON.stringify(value),new Date().toISOString()).run();if(!result.meta.changes)throw new AppError("本次重试标识与先前输入不一致，请修改输入后重新发送。",409)}
}}
export async function pruneGenerationStages(user:string){const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();await db().prepare("DELETE FROM generation_stages WHERE owner=? AND updated_at<?").bind(user,cutoff).run()}
export async function getWorkspace(user:string,id?:string):Promise<Workspace>{
 let listing=(await db().prepare("SELECT id,title FROM stories WHERE owner = ? ORDER BY created_at DESC,id").bind(user).all<{id:string;title:string}>()).results;
 if(!listing.length){const newId="initial-"+user;const seed=initialStory();const json=JSON.stringify(seed);await db().prepare("INSERT OR IGNORE INTO stories (id,owner,title,data,root,created_at) VALUES (?,?,?,?,?,?)").bind(newId,user,seed.title,json,json,new Date().toISOString()).run();listing=[{id:newId,title:seed.title}];}
 const row=await getStory(user,id||listing[0].id);
 const profiles=(await profileRows(user)).map(r=>({...JSON.parse(r.data),hasKey:!!r.encrypted_key})) as Profile[];
 return {id:row.id,stories:listing,revision:row.revision,story:storySchema.parse(JSON.parse(row.data)),headId:row.head_id,turns:(await allTurns(row.id)).map(t=>({...t,snapshot:storySchema.parse(t.snapshot)})),profiles,presets:(await presetRows(user)).map(summarizePreset),characterLibrary:await characterLibraryRows(user),directorId:row.director_id,demo:!!row.demo};
}
export async function commitTurn(row:StoryRow,turn:Turn){
 const eventStatements=(turn.trace.eventRecords||[]).map((event,eventIndex)=>db().prepare("INSERT INTO story_events (id,story_id,turn_id,event_index,description,visible_to,visible_to_player,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(`${turn.id}:event:${eventIndex}`,row.id,turn.id,eventIndex,event.description,JSON.stringify(event.visibleTo),event.visibleToPlayer?1:0,turn.createdAt));
 const summaries=turn.trace.summaryRecords||(turn.trace.sceneSummary?[turn.trace.sceneSummary]:[]);const summaryStatements=summaries.map(summary=>db().prepare("INSERT INTO story_summary_records (id,story_id,turn_id,level,content,source_turn_ids,created_at) VALUES (?,?,?,?,?,?,?)").bind(summary.id,row.id,turn.id,summary.level,summary.content,JSON.stringify(summary.sourceTurnIds),turn.createdAt));
 const threadStatements=(turn.trace.threadChanges||[]).map((thread,index)=>db().prepare("INSERT INTO story_thread_records (id,thread_id,story_id,turn_id,description,character_ids,status,source_event_index,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(`${turn.id}:thread:${index}`,thread.id,row.id,turn.id,thread.description,JSON.stringify(thread.characterIds),thread.status,thread.sourceEventIndex??null,turn.createdAt));
 const result=await db().batch([
  db().prepare("INSERT INTO turns (id,story_id,parent_id,data,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM stories WHERE id = ? AND owner = ? AND revision = ?)").bind(turn.id,row.id,turn.parentId,JSON.stringify(turn),turn.createdAt,row.id,row.owner,row.revision),
  db().prepare("UPDATE stories SET data = ?, title = ?, head_id = ?, revision = revision + 1 WHERE id = ? AND owner = ? AND revision = ?").bind(JSON.stringify(turn.snapshot),turn.snapshot.title,turn.id,row.id,row.owner,row.revision),
  ...eventStatements,...summaryStatements,...threadStatements,
  db().prepare("DELETE FROM generation_stages WHERE request_id=? AND story_id=? AND owner=?").bind(turn.id,row.id,row.owner)
 ]);
 if(!result[0].meta.changes)throw new AppError("故事已在另一处修改，请刷新后重试；本次生成没有覆盖新进度。",409);
}

