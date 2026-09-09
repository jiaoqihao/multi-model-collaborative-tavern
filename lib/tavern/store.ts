import { env } from "cloudflare:workers";
import type { D1Database } from "@cloudflare/workers-types";
import type { Profile, StoryState, Turn, Workspace } from "./types";
import { initialStory } from "./seed";
import { AppError, storySchema } from "./validation";
export function db(){const binding=(env as unknown as {DB:D1Database}).DB;if(!binding)throw new AppError("故事数据库尚未就绪，请应用数据库迁移后重试。",503);return binding;}
export function encryptionSecret(){return (env as unknown as {TAVERN_ENCRYPTION_KEY?:string}).TAVERN_ENCRYPTION_KEY||"";}
export function owner(request:Request){const user=request.headers.get("oai-authenticated-user-id");if(!user)throw new AppError("请登录后使用你的故事工作台。",401);return user;}
export function requireOrigin(request:Request){const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)throw new AppError("不接受来自其他站点的修改请求。",403);if(request.headers.get("sec-fetch-site")==="cross-site")throw new AppError("不接受跨站请求。",403);}
export type StoryRow={id:string;owner:string;title:string;data:string;root:string;head_id:string|null;revision:number;demo:number;director_id:string;created_at:string};
export async function getStory(user:string,id:string){const row=await db().prepare("SELECT * FROM stories WHERE id = ? AND owner = ?").bind(id,user).first<StoryRow>();if(!row)throw new AppError("找不到这个故事。",404);return row;}
export async function createStory(user:string,data:StoryState=initialStory()) {const id=crypto.randomUUID();const json=JSON.stringify(data);await db().prepare("INSERT INTO stories (id,owner,title,data,root,revision,demo,director_id,created_at) VALUES (?,?,?,?,?,0,1,'',?)").bind(id,user,data.title,json,json,new Date().toISOString()).run();return id;}
export async function allTurns(storyId:string){const rows=await db().prepare("SELECT data FROM turns WHERE story_id = ? ORDER BY created_at,id").bind(storyId).all<{data:string}>();return rows.results.map(r=>JSON.parse(r.data) as Turn);}
export async function profileRows(user:string){return (await db().prepare("SELECT id,data,encrypted_key FROM profiles WHERE owner = ?").bind(user).all<{id:string;data:string;encrypted_key:string}>()).results;}
export async function getWorkspace(user:string,id?:string):Promise<Workspace>{
 let listing=(await db().prepare("SELECT id,title FROM stories WHERE owner = ? ORDER BY created_at DESC,id").bind(user).all<{id:string;title:string}>()).results;
 if(!listing.length){const newId="initial-"+user;const seed=initialStory();const json=JSON.stringify(seed);await db().prepare("INSERT OR IGNORE INTO stories (id,owner,title,data,root,created_at) VALUES (?,?,?,?,?,?)").bind(newId,user,seed.title,json,json,new Date().toISOString()).run();listing=[{id:newId,title:seed.title}];}
 const row=await getStory(user,id||listing[0].id);
 const profiles=(await profileRows(user)).map(r=>({...JSON.parse(r.data),hasKey:!!r.encrypted_key})) as Profile[];
 return {id:row.id,stories:listing,revision:row.revision,story:storySchema.parse(JSON.parse(row.data)),headId:row.head_id,turns:(await allTurns(row.id)).map(t=>({...t,snapshot:storySchema.parse(t.snapshot)})),profiles,directorId:row.director_id,demo:!!row.demo};
}
export async function commitTurn(row:StoryRow,turn:Turn){
 const result=await db().batch([
  db().prepare("INSERT INTO turns (id,story_id,parent_id,data,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM stories WHERE id = ? AND owner = ? AND revision = ?)").bind(turn.id,row.id,turn.parentId,JSON.stringify(turn),turn.createdAt,row.id,row.owner,row.revision),
  db().prepare("UPDATE stories SET data = ?, title = ?, head_id = ?, revision = revision + 1 WHERE id = ? AND owner = ? AND revision = ?").bind(JSON.stringify(turn.snapshot),turn.snapshot.title,turn.id,row.id,row.owner,row.revision)
 ]);
 if(!result[0].meta.changes)throw new AppError("故事已在另一处修改，请刷新后重试；本次生成没有覆盖新进度。",409);
}
