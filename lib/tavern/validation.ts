import { z } from "zod";
const short=z.string().trim().max(2000);
export const playerStateSchema=z.object({location:short,clothing:short,condition:short,inventory:short}).strict();
export const stateSchema=z.object({location:short,clothing:short,condition:short,emotion:short,thought:short,goal:short,relationship:short}).strict();
export const memorySchema=z.object({id:z.string(),turnId:z.string(),content:short,kind:z.enum(["observation","belief"]),importance:z.number().int().min(1).max(5)}).strict();
export const characterSchema=z.object({id:z.string().min(1).max(80),name:z.string().trim().min(1).max(40),role:short,persona:z.string().max(6000),secret:z.string().max(4000),color:z.enum(["amber","blue","gray"]),modelId:z.string().max(100),state:stateSchema,memories:z.array(memorySchema).max(2000)}).strict();
export const storySchema=z.object({title:z.string().trim().min(1).max(80),world:z.string().max(12000),opening:z.string().max(12000),player:z.string().trim().min(1).max(40),playerPersona:z.string().max(6000),playerState:playerStateSchema.default({location:"夜航酒馆 · 门前",clothing:"旅行外套",condition:"健康",inventory:"一封旧信"}),style:z.string().max(4000),characters:z.array(characterSchema).min(1).max(6)}).strict().refine(s=>new Set(s.characters.map(c=>c.id)).size===s.characters.length,"角色 ID 不可重复");
export const profileSchema=z.object({id:z.string().max(100),name:z.string().trim().min(1).max(80),provider:z.enum(["openai","compatible","anthropic","gemini"]),baseUrl:z.string().url().max(500),model:z.string().trim().min(1).max(150),apiKey:z.string().trim().max(4000).optional(),clearKey:z.boolean().optional()}).strict();
export const turnSchema=z.object({storyId:z.string(),revision:z.number().int().nonnegative(),input:z.string().trim().min(1).max(8000),mode:z.enum(["roleplay","director"]),regenerate:z.boolean().optional(),requestId:z.string().uuid()}).strict();
export class AppError extends Error { constructor(message:string,public status=400){super(message)} }
export function ancestry<T extends {id:string;parentId:string|null}>(all:T[],head:string|null):T[]{const map=new Map(all.map(t=>[t.id,t]));const path:T[]=[];const seen=new Set<string>();while(head){if(seen.has(head))throw new AppError("剧情分支存在循环",500);seen.add(head);const t=map.get(head);if(!t)throw new AppError("剧情分支缺少回合",500);path.unshift(t);head=t.parentId;}return path;}

