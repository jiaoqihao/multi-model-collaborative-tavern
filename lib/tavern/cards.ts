import { parseDocument, stringify } from "yaml";
import { z } from "zod";
import type { Character } from "./types";

export type CharacterCard = { format: "yaml" | "json"; filename: string; source: string };
export class CardError extends Error {}
export const cardMemoryUpdateSchema = z.object({
  summary: z.string().min(1).max(4000),
  facts: z.array(z.string().min(1).max(400)).max(24),
  beliefs: z.array(z.string().min(1).max(400)).max(12),
  openThreads: z.array(z.string().min(1).max(400)).max(12),
}).strict().superRefine((value, ctx) => {
  if (JSON.stringify(value).length > 10000) ctx.addIssue({code:"custom", message:"记忆超过 10,000 字符，请合并压缩。"});
});
export type CardMemoryUpdate = z.infer<typeof cardMemoryUpdateSchema>;
export const cardMemoryDeltaSchema = z.object({
  summaryAppend:z.string().min(1).max(1000),
  factsAdd:z.array(z.string().min(1).max(400)).max(10), factsRemove:z.array(z.string().min(1).max(400)).max(10),
  beliefsAdd:z.array(z.string().min(1).max(400)).max(8), beliefsRemove:z.array(z.string().min(1).max(400)).max(8),
  openThreadsAdd:z.array(z.string().min(1).max(400)).max(8), openThreadsResolve:z.array(z.string().min(1).max(400)).max(8),
}).strict();
export type CardMemoryDelta = z.infer<typeof cardMemoryDeltaSchema>;
const savedMemorySchema = z.object({
  version:z.union([z.literal(1),z.literal(2)]), updatedTurnId:z.string(), mode:z.enum(["model","demo"]), revision:z.number().int().nonnegative().optional(),
  currentState:z.object({location:z.string(),clothing:z.string(),condition:z.string(),emotion:z.string(),thought:z.string(),goal:z.string(),relationship:z.string()}).strict(),
  ...cardMemoryUpdateSchema.innerType().shape,
}).strict();
export function characterCard(c:Character):CharacterCard {
  return c.card || {format:"yaml",filename:`${c.name}.yaml`,source:stringify({name:c.name,role:c.role,persona:c.persona,secret:c.secret})};
}
function memoryPath(data:Record<string,unknown>):string[] {
  if(cardBody(data)!==data){
    const extensions=cardBody(data).extensions;
    if(extensions!==undefined&&(!extensions||typeof extensions!=="object"||Array.isArray(extensions)))throw new CardError("角色卡 data.extensions 必须是对象，才能保存记忆。");
    return ["data","extensions","mytavern_memory"];
  }
  return ["mytavern_memory"];
}
export function readCardMemory(card:CharacterCard) {
  const data=parseCharacterCard(card.source);let value:unknown=data;
  for(const key of memoryPath(data))value=value&&typeof value==="object"?(value as Record<string,unknown>)[key]:undefined;
  if(value===undefined)return undefined;
  const parsed=savedMemorySchema.safeParse(value);
  if(!parsed.success)throw new CardError("卡片 mytavern_memory 字段格式不正确，请修正后继续；原字段未覆盖。");
  return parsed.data;
}
export function writeCardMemory(card:CharacterCard,update:CardMemoryUpdate,state:Character["state"],turnId:string,mode:"model"|"demo"):CharacterCard {
  const parsed=parseCharacterCard(card.source);readCardMemory(card);
  const previous=readCardMemory(card);const memory={...cardMemoryUpdateSchema.parse(update),version:2 as const,revision:(previous?.revision||0)+1,updatedTurnId:turnId,mode,currentState:{...state}};
  const path=memoryPath(parsed);let source:string;
  if(card.format==="json"){
    let target=parsed;for(const key of path.slice(0,-1)){if(!Object.hasOwn(target,key))target[key]={};target=target[key] as Record<string,unknown>;}target[path.at(-1)!]=memory;source=JSON.stringify(parsed,null,2);
  }else{
    const document=parseDocument(card.source.replace(/^\uFEFF/,""));document.setIn(path,memory);source=document.toString({lineWidth:0});
  }
  if(source.length>60000)throw new CardError("角色卡加入记忆后超过 60,000 字符，请精简卡片后重试；本轮未保存。");
  parseCharacterCard(source);
  return {...card,source};
}
function normalized(value:string){return value.trim().replace(/\s+/g," ")}
function mergeList(existing:string[],add:string[],remove:string[],limit:number){
  const removed=new Set(remove.map(normalized));const result=existing.filter(item=>!removed.has(normalized(item)));
  const seen=new Set(result.map(normalized));for(const item of add){const key=normalized(item);if(key&&!seen.has(key)){seen.add(key);result.push(item.trim())}}
  return result.slice(-limit);
}
function compactSummary(existing:string,append:string){
 const lines=[...new Set([existing,append].flatMap(text=>text.split(/\r?\n/)).map(normalized).filter(Boolean))];const joined=lines.join("\n");if(joined.length<=4000)return joined;
 const important=lines.filter(line=>/约定|承诺|秘密|身份|关系|目标|线索|失踪|死亡|受伤|归还|欠|必须|不能/.test(line));
 const early=lines.slice(0,Math.min(8,lines.length));const recent=lines.slice(-18);const selected=[...new Set([...important,...early,...recent])];
 const output:string[]=[];let size=0;for(const line of selected){if(size+line.length+1>3950)continue;output.push(line);size+=line.length+1;}
 return `[分层摘要：保留早期关键经历、长期约定与近期变化]\n${output.join("\n")}`.slice(0,4000);
}
export function mergeCardMemory(previous:ReturnType<typeof readCardMemory>,delta:CardMemoryDelta):CardMemoryUpdate {
  const base=previous||{summary:"",facts:[],beliefs:[],openThreads:[]};
  return cardMemoryUpdateSchema.parse({summary:compactSummary(base.summary,delta.summaryAppend.trim()),facts:mergeList(base.facts,delta.factsAdd,delta.factsRemove,24),beliefs:mergeList(base.beliefs,delta.beliefsAdd,delta.beliefsRemove,12),openThreads:mergeList(base.openThreads,delta.openThreadsAdd,delta.openThreadsResolve,12)});
}
export function writeCardMemoryDelta(card:CharacterCard,delta:CardMemoryDelta,state:Character["state"],turnId:string,mode:"model"|"demo"){return writeCardMemory(card,mergeCardMemory(readCardMemory(card),cardMemoryDeltaSchema.parse(delta)),state,turnId,mode)}
export function clearCardMemory(card:CharacterCard):CharacterCard {
  const parsed=parseCharacterCard(card.source);readCardMemory(card);const path=memoryPath(parsed);let source:string;
  if(card.format==="json"){
    let target:Record<string,unknown>|undefined=parsed;for(const key of path.slice(0,-1)){const next:unknown=target?.[key];target=next&&typeof next==="object"&&!Array.isArray(next)?next as Record<string,unknown>:undefined;}
    if(target)delete target[path.at(-1)!];source=JSON.stringify(parsed,null,2);
  }else{const document=parseDocument(card.source.replace(/^\uFEFF/,""));document.deleteIn(path);source=document.toString({lineWidth:0});}
  parseCharacterCard(source);return {...card,source};
}
export function parseCharacterCard(source: string): Record<string, unknown> {
  if (!source.trim()) throw new CardError("角色卡内容不能为空。");
  if (source.length > 60000) throw new CardError("角色卡最多支持 60,000 字符。");
  let data: unknown;
  try {
    const doc = parseDocument(source.replace(/^\uFEFF/, ""), { uniqueKeys: true, version: "1.2" });
    if (doc.errors.length) throw new Error(doc.errors[0].message);
    data = doc.toJS({ maxAliasCount: 0 });
  } catch (error) { throw new CardError("YAML / JSON 格式错误：" + (error as Error).message); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new CardError("角色卡顶层必须是对象，包含 name 字段。");
  const stack = [{ value: data, depth: 0 }]; let count = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++count > 12000 || depth > 30) throw new CardError("角色卡嵌套或字段数量过多。");
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 });
    } else if (!["string", "number", "boolean"].includes(typeof value) && value !== null) throw new CardError("角色卡包含不支持的字段类型。");
  }
  const record = data as Record<string, unknown>;
  const body = cardBody(record);
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 40) throw new CardError("角色卡 name 必须是 1–40 字的名称。");
  return record;
}
export function cardBody(data: Record<string, unknown>): Record<string, unknown> {
  return ["chara_card_v2", "chara_card_v3"].includes(String(data.spec)) && data.data && typeof data.data === "object" && !Array.isArray(data.data)
    ? data.data as Record<string, unknown> : data;
}
export function cardIdentity(source: string) {
  const data = cardBody(parseCharacterCard(source));
  return { name: (data.name as string).trim(), role: typeof data.role === "string" ? data.role.slice(0, 2000) : Array.isArray(data.identities) ? data.identities.filter(x => typeof x === "string").join("；").slice(0, 2000) : "" };
}
