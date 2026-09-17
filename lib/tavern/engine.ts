import { z } from "zod";
import type { Character, Mode, SceneSummary, StageTrace, StoryState, StoryThread, Turn } from "./types";
import { AppError } from "./validation";
import type { PresetContext } from "./presets";
import { parseCharacterCard, characterCard, cardMemoryDeltaSchema, cardMemoryUpdateSchema, readCardMemory, writeCardMemory, writeCardMemoryDelta } from "./cards";
import { outputContract, outputIssue, parseModelObject } from "./model-output";
import { buildContextHistory, compactCharacterContext, contextBudgetFor, selectMemoryEvidence } from "./context-builder";
import { PROTOCOL_VERSION, protocolBaseRule, protocolContract } from "./protocols";

export type ModelCallResult=string|{text:string;contextCharacters?:number};
export type CallModel=(modelId:string,system:string,prompt:string,context?:PresetContext)=>Promise<ModelCallResult>;
export type StageCache={load:(key:string)=>Promise<unknown|undefined>;save:(key:string,value:unknown)=>Promise<void>};
const line=z.string().max(2000);
const planSchema=(limit:number)=>z.object({deliveries:z.array(z.object({characterId:z.string(),visible:line,direction:line})).max(limit)});
const actorSchema=z.object({speech:line,actionIntent:line,emotion:line,thought:line,goal:line,relationship:line});
const resultSchema=z.object({events:z.array(z.object({description:line,visibleTo:z.array(z.string()).max(6),visibleToPlayer:z.boolean()})).min(1).max(12),changes:z.array(z.object({characterId:z.string(),location:line.optional(),clothing:line.optional(),condition:line.optional()})).max(6),playerChanges:z.object({location:line.optional(),clothing:line.optional(),condition:line.optional(),inventory:line.optional()}).optional(),threads:z.array(z.object({action:z.enum(["open","resolve"]),description:z.string().min(1).max(1000),characterIds:z.array(z.string()).max(6),sourceEventIndex:z.number().int().nonnegative().optional()})).max(8).default([])});
const narrationSchema=z.object({narrative:z.string().min(1).max(14000)});
async function jsonCall<T>(call:CallModel,id:string,system:string,input:unknown,schema:z.ZodType<T>,context:PresetContext|undefined,stage:string,diagnostics?:StageTrace[],modelLabel=id):Promise<T>{
 const contract=protocolContract(outputContract(schema));
 let issue="";const started=Date.now();const payload=JSON.stringify(input);let inputCharacters=system.length+payload.length;
 for(let attempt=0;attempt<2;attempt++){
  let text:string;
  const requestSystem=protocolBaseRule+"\n"+system+contract+(attempt?"\n上次输出校验失败："+issue+"。请依据相同输入重新生成完整 JSON，修正上述问题，不要附加解释。":"");
  try{const result=await call(id,requestSystem,payload,context);text=typeof result==="string"?result:result.text;inputCharacters=requestSystem.length+payload.length+(typeof result==="string"?0:result.contextCharacters||0);}
  catch(error){if(error instanceof AppError)throw new AppError(`${stage}：${error.message}`,error.status);throw error;}
  try { const value=schema.parse(parseModelObject(text));diagnostics?.push({stage,modelId:id,modelLabel,attempts:attempt+1,durationMs:Date.now()-started,cached:false,inputCharacters,estimatedInputTokens:Math.ceil(inputCharacters/2.4),outputCharacters:text.length,protocolVersion:PROTOCOL_VERSION,context:context?.diagnostics});return value; }catch(error) {
   issue=outputIssue(error);
   if(attempt===1)throw new AppError(`${stage}连续返回无效结构：${issue}。本轮没有保存。请检查预设中的输出格式与长度设置后重试。`,502);
  }
 }
 throw new AppError("结构化生成失败",502);
}
async function stageCall<T>(key:string,call:CallModel,id:string,system:string,input:unknown,schema:z.ZodType<T>,context:PresetContext|undefined,label:string,args:{cache?:StageCache;diagnostics:StageTrace[];describeModel?:(id:string)=>string}){
 const cached=args.cache?await args.cache.load(key):undefined;if(cached!==undefined){const parsed=schema.safeParse(cached);if(parsed.success){args.diagnostics.push({stage:label,modelId:id,modelLabel:args.describeModel?.(id)||id,attempts:0,durationMs:0,cached:true,inputCharacters:0,estimatedInputTokens:0,outputCharacters:JSON.stringify(cached).length,protocolVersion:PROTOCOL_VERSION,context:context?.diagnostics});return parsed.data}}
 const value=await jsonCall(call,id,system,input,schema,context,label,args.diagnostics,args.describeModel?.(id)||id);await args.cache?.save(key,value);return value;
}
export function retrieveMemories(c:Character,visible:string,budgetTokens=1400){return selectMemoryEvidence(c,visible,budgetTokens).items;}
export function actorContext(c:Character,visible:string,direction:string){const selected=selectMemoryEvidence(c,visible,1400);return {character:{id:c.id,name:c.name,role:c.role,persona:c.persona,secret:c.secret,state:c.state,card:parseCharacterCard(characterCard(c).source)},memories:selected.items,recentPerceptions:c.memories.filter(m=>m.kind==="observation"&&(m.status||"active")==="active").slice(-6),visible,direction};}
function memoryTags(content:string,story:StoryState){return [...new Set(story.characters.filter(c=>content.includes(c.name)).map(c=>c.name))].slice(0,20)}
function appendMemory(c:Character,memory:Character["memories"][number]){const duplicate=[...c.memories].reverse().find(m=>(m.status||"active")==="active"&&m.kind===memory.kind&&m.content.trim()===memory.content.trim());if(duplicate){duplicate.status="superseded";duplicate.validUntilTurnId=memory.turnId;memory.supersedes=[duplicate.id]}c.memories.push(memory)}
function ensureIds(ids:string[],allowed:Set<string>){if(ids.some(id=>!allowed.has(id)))throw new AppError("模型引用了不存在的角色，本轮未保存。",502);}
export function buildPresetContext(stage:PresetContext["stage"],story:StoryState,history:Turn[],visible:string,character?:Character,trigger:PresetContext["trigger"]="normal"):PresetContext {
 const actor=stage==="actor"||stage==="memory";
 const packed=buildContextHistory(stage,story,history,visible,character,contextBudgetFor(stage));const knownHistory=packed.history;
 const description=actor?[character?.role,character?.persona].filter(Boolean).join("\n"):"";
 const scenario=actor?character?.state.location||"":story.world;
 return {stage,characterId:character?.id,trigger,history:knownHistory,diagnostics:packed.diagnostics,macros:{char:character?.name||(stage==="director"?"导演":"旁白"),charIfNotGroup:character?.name||"",user:story.player,description,personality:description,persona:actor?"":story.playerPersona,scenario,mesExamples:"",lastUserMessage:visible,lastMessage:knownHistory.at(-1)?.content||""},markers:{charDescription:description,charPersonality:description,personaDescription:actor?"":story.playerPersona,scenario,worldInfoBefore:actor?"":story.world,worldInfoAfter:"",dialogueExamples:""}};
}
function collaborationComplexity(input:string,mode:Mode,deliveries:number){return Math.min(10,deliveries+(mode==="director"?1:0)+[/同时|争抢|阻止|冲突|攻击|追逐/.test(input),/秘密|隐瞒|低声|密信/.test(input),/交给|归还|拿走|物品|钥匙|信件/.test(input),/死亡|受伤|离开|失踪|承诺|约定|时间跳|多年后/.test(input)].filter(Boolean).length)}
function mergeStoryThreads(story:StoryState,updates:z.infer<typeof resultSchema>["threads"],turnId:string){
 const context=story.context||{threads:[],sceneSummaries:[],chapterSummaries:[]};story.context=context;const changes:StoryThread[]=[];
 for(const update of updates){
  const normalized=update.description.trim().replace(/\s+/g," ");
  if(update.action==="open"){
   const existing=context.threads.find(thread=>thread.status==="open"&&thread.description.trim().replace(/\s+/g," ")===normalized);if(existing)continue;
   const thread:StoryThread={id:crypto.randomUUID(),description:update.description.trim(),characterIds:[...new Set(update.characterIds)],status:"open",openedTurnId:turnId,...(update.sourceEventIndex===undefined?{}:{sourceEventIndex:update.sourceEventIndex})};context.threads.push(thread);changes.push(thread);
  }else{
   const candidates=context.threads.filter(thread=>thread.status==="open");const target=[...candidates].reverse().find(thread=>normalized.includes(thread.description)||thread.description.includes(normalized));if(!target)continue;target.status="resolved";target.resolvedTurnId=turnId;changes.push({...target});
  }
 }
 return changes;
}
function buildSceneSummary(story:StoryState,history:Turn[],events:string[],turnId:string,input:string):SceneSummary|undefined{
 const shouldSummarize=(history.length+1)%8===0||/转场|翌日|第二天|数日后|多年后|离开这里|前往/.test(input);if(!shouldSummarize)return;
 const source=[...history.slice(-7).map(turn=>({id:turn.id,events:turn.trace.events})),{id:turnId,events}];const lines=[...new Set(source.flatMap(item=>item.events).map(line=>line.trim()).filter(Boolean))];
 const important=lines.filter(line=>/约定|承诺|秘密|身份|关系|线索|归还|得到|失去|受伤|死亡|离开|抵达/.test(line));const chosen=[...new Set([...important,...lines.slice(0,8),...lines.slice(-10)])].slice(0,24);
 return {id:crypto.randomUUID(),content:chosen.map(line=>`- ${line}`).join("\n").slice(0,6000),sourceTurnIds:source.map(item=>item.id),createdTurnId:turnId,level:"scene"};
}
function updateSummaries(story:StoryState,history:Turn[],events:string[],turnId:string,input:string){
 const context=story.context||{threads:[],sceneSummaries:[],chapterSummaries:[]};story.context=context;const scene=buildSceneSummary(story,history,events,turnId,input);if(!scene)return;
 context.sceneSummaries.push(scene);const records=[scene];
 if(context.sceneSummaries.length%4===0){const group=context.sceneSummaries.slice(-4);const chapter:SceneSummary={id:crypto.randomUUID(),content:group.map((summary,index)=>`场景 ${index+1}\n${summary.content}`).join("\n").slice(0,6000),sourceTurnIds:[...new Set(group.flatMap(summary=>summary.sourceTurnIds))],createdTurnId:turnId,level:"chapter"};context.chapterSummaries.push(chapter);records.push(chapter);}
 return records;
}
export async function runTurn(args:{story:StoryState;history:Turn[];input:string;mode:Mode;directorId:string;turnId:string;call:CallModel;regenerate?:boolean;progress?:(text:string)=>void;cache?:StageCache;describeModel?:(id:string)=>string}){
 const {history,input,mode,directorId,turnId,call}=args;const story=structuredClone(args.story);
 const diagnostics:StageTrace[]=[];const stageArgs={cache:args.cache,diagnostics,describeModel:args.describeModel};const stageModel=(stage:"settlement"|"narrator"|"memory")=>story.stageModels?.[stage]||directorId;
 try{for(const c of story.characters){c.card=characterCard(c);readCardMemory(c.card)}}catch(error){throw new AppError((error as Error).message)}
 const ids=new Set(story.characters.map(c=>c.id));const collaborationMode=story.collaborationMode||"balanced";const deliveryLimit=collaborationMode==="economy"?2:4;
 const characterCards=story.characters.map(c=>compactCharacterContext(c,input,collaborationMode==="economy"?700:1200));
 const trigger=args.regenerate?"regenerate":"normal";
 const directorContext=buildPresetContext("director",story,history,input,undefined,trigger);
 args.progress?.("导演正在组织场景…");
 const publicCast=story.characters.map(c=>({id:c.id,name:c.name,role:c.role,location:c.state.location,clothing:c.state.clothing,condition:c.state.condition}));
 const plan=await stageCall("director",call,directorId,
  '你负责信息分发。选择本轮需要回应的 0–4 个角色。characterCards 是按角色隔离的卡片与累积记忆，不是所有人的共同知识；不得把某人的私密记忆直接分发给其他角色。根据距离、在场情况和交谈音量，为每人生成各自实际感知的 visible。低声、密信、私聊只对接收人披露内容；其他人至多看到外部动作。不复制完整用户输入给无关角色。director 输入是幕后创作要求，只在 direction 下发该角色必要的表演要求，不作为听见的台词。roleplay 输入中未明说的想法不能成为事实。不得凭空添加玩家行动。输出 {"deliveries":[{"characterId":"id","visible":"本角色看见听见的内容","direction":"必要的幕后表演要求，没有则为空"}]}。',
  {world:story.world,opening:story.opening,player:story.player,playerPersona:story.playerPersona,playerState:story.playerState,cast:publicCast,characterCards,contextHistory:directorContext.history.filter(message=>message.role==="assistant"),sceneSummaries:story.context?.sceneSummaries.slice(-3)||[],openThreads:story.context?.threads.filter(thread=>thread.status==="open").slice(-12)||[],input,mode,collaborationMode,maxRespondingCharacters:deliveryLimit},planSchema(deliveryLimit),directorContext,"导演组织场景",stageArgs);
 ensureIds(plan.deliveries.map(d=>d.characterId),ids);
 if(new Set(plan.deliveries.map(d=>d.characterId)).size!==plan.deliveries.length)throw new AppError("导演重复分配同一角色，本轮未保存。",502);
 args.progress?.(plan.deliveries.length?`${plan.deliveries.map(d=>story.characters.find(c=>c.id===d.characterId)!.name).join("、")}正在回应…`:"场景正在发展…");
 const responses=await Promise.all(plan.deliveries.map(async d=>{
  const c=story.characters.find(c=>c.id===d.characterId)!;
  const actorModel=c.modelId==="default"?directorId:c.modelId;const response=await stageCall(`actor:${c.id}`,call,actorModel,
   '只扮演给定角色。每次读取完整 character.card，包括 mytavern_memory 累积记忆；character.state 为当前状态，优先于卡片中的历史状态。仅依据自己的设定、记忆与 visible 行动，不知道其他角色的秘密或未获得的信息。direction 是幕后指导，不可当作故事台词。可以说谎、沉默、误解；actionIntent 只是动作意图，不能强行决定他人的结果。固定性格不轻易改变。thought 是简短的虚构角色内心独白。返回 {"speech":"台词或空串","actionIntent":"尝试的动作","emotion":"当前情绪","thought":"角色内心","goal":"当前目标","relationship":"对玩家的态度及理由"}。',actorContext(c,d.visible,d.direction),actorSchema,buildPresetContext("actor",story,history,d.visible,c,trigger),`角色「${c.name}」回应`,stageArgs);
  return {characterId:c.id,...response};
 }));
 args.progress?.("正在协调行动与状态…");
 const settlementId=stageModel("settlement");const settlementContext=buildPresetContext("settlement",story,history,input,undefined,trigger);let settled=await stageCall("settlement",call,settlementId,
  '你协调实际事件。只处理本轮输入及角色动作意图，解决矛盾，保持人物位置、服饰、物品与事实连续。不要增写玩家未提出的行动和情绪。对 director 指令合理落实，对与既有事实冲突的强制改写不得悄悄追溯修改，应保留原事实并在事件中说明需要作者建立分支。每个事件单独标注玩家是否实际能感知 visibleToPlayer（布尔值），以及实际能感知的角色 visibleTo；私下发生的事件不能标给其他人。playerChanges 可选，仅记录玩家明确提出的行动或确定事件造成的客观变化。changes 仅记录最终实际发生的角色位置、服饰、身体变化。threads 只记录本轮新建立或解决的承诺、目标和线索；action 为 open 或 resolve，characterIds 仅包含知情或相关角色。返回 {"events":[{"description":"确定发生的事件和有效台词","visibleTo":["id"],"visibleToPlayer":true}],"changes":[{"characterId":"id","location":"变化后的完整值（可省略）","clothing":"变化后的完整值（可省略）","condition":"变化后的完整值（可省略）"}],"threads":[]}。',
  {world:story.world,player:story.player,playerState:story.playerState,cast:publicCast,characterContext:characterCards,contextHistory:settlementContext.history.filter(message=>message.role==="assistant"),input,mode,deliveries:plan.deliveries,responses:responses.map(({characterId,speech,actionIntent})=>({characterId,speech,actionIntent})),openThreads:story.context?.threads.filter(thread=>thread.status==="open")||[]},resultSchema,settlementContext,"协调事件与状态",stageArgs);
 for(const e of settled.events)ensureIds(e.visibleTo,ids);ensureIds(settled.changes.map(c=>c.characterId),ids);for(const thread of settled.threads||[]){ensureIds(thread.characterIds,ids);if(thread.sourceEventIndex!==undefined&&thread.sourceEventIndex>=settled.events.length)throw new AppError("剧情线索引用了不存在的事件，本轮未保存。",502);}
 if(new Set(settled.changes.map(c=>c.characterId)).size!==settled.changes.length)throw new AppError("状态变更重复，本轮未保存。",502);
 const complexityScore=collaborationComplexity(input,mode,plan.deliveries.length);
 if(collaborationMode==="precise"&&complexityScore>=3){args.progress?.("正在复核冲突与状态一致性…");settled=await stageCall("review",call,settlementId,
  '你是事件一致性复核器。核对 candidate 是否满足输入、角色行动、已知状态、信息可见范围和玩家自主性。修正互斥结果、物品归属冲突、越权知情或追溯改写；没有问题则原样返回。只返回与事件裁决相同的结构。',
  {world:story.world,player:story.player,playerState:story.playerState,cast:publicCast,input,mode,candidate:settled,openThreads:story.context?.threads.filter(thread=>thread.status==="open")||[]},resultSchema,settlementContext,"一致性复核",stageArgs);for(const event of settled.events)ensureIds(event.visibleTo,ids);ensureIds(settled.changes.map(change=>change.characterId),ids);for(const thread of settled.threads||[]){ensureIds(thread.characterIds,ids);if(thread.sourceEventIndex!==undefined&&thread.sourceEventIndex>=settled.events.length)throw new AppError("剧情线索引用了不存在的事件，本轮未保存。",502);}if(new Set(settled.changes.map(change=>change.characterId)).size!==settled.changes.length)throw new AppError("状态变更重复，本轮未保存。",502);}
 args.progress?.("正在写下旁白…");
 const narratorId=stageModel("narrator");const publicEvents=settled.events.filter(e=>e.visibleToPlayer).map(e=>e.description);const narratorContext=buildPresetContext("narrator",story,history,publicEvents.join("\n"),undefined,trigger);const output=await stageCall("narrator",call,narratorId,
  '你是叙事编辑，按给定文风将已经确定的 events 写成连贯正文。仅组织、衔接这些事件，不新增改变事实、位置、服饰或物品的动作。忠实保留有效角色台词，不能统一成同一种口吻。严格遵守玩家有限视角，不透露角色秘密或未被玩家感知的事件；不写角色内心。不要把幕后指令引用为台词。不擅自代写玩家。停在玩家可以回应的位置，不替玩家完成下一回合。返回 {"narrative":"正文，段落用换行分隔"}。',
  {style:story.style,player:story.player,world:story.world,contextHistory:narratorContext.history.filter(message=>message.role==="assistant"),opening:history.length?undefined:story.opening,events:publicEvents,cast:publicCast},narrationSchema,narratorContext,"生成旁白",stageArgs);
 const snapshot=structuredClone(story);
 const threadChanges=mergeStoryThreads(snapshot,settled.threads||[],turnId);const summaryRecords=updateSummaries(snapshot,history,settled.events.map(event=>event.description),turnId,input);const sceneSummary=summaryRecords?.find(summary=>summary.level==="scene");
 if(settled.playerChanges)Object.assign(snapshot.playerState,settled.playerChanges);
 for(const c of snapshot.characters){
  const response=responses.find(r=>r.characterId===c.id);
  if(response){for(const key of ["emotion","thought","goal","relationship"] as const)c.state[key]=response[key];}
  const change=settled.changes.find(r=>r.characterId===c.id);
  if(change)for(const key of ["location","clothing","condition"] as const){if(change[key]!==undefined)c.state[key]=change[key]!;}
  const events=settled.events.map((event,eventIndex)=>({event,eventIndex})).filter(({event})=>event.visibleTo.includes(c.id));
  for(const {event,eventIndex} of events)appendMemory(c,{id:crypto.randomUUID(),turnId,content:event.description,kind:"observation",importance:/约定|承诺|秘密|归还|死亡|受伤|身份/.test(event.description)?5:3,source:{type:"event",eventIndex},tags:memoryTags(event.description,story),status:"active",scope:/情绪|看向|停顿|暂时/.test(event.description)?"transient":/约定|承诺|秘密|身份|关系|归还/.test(event.description)?"durable":"scene",validFromTurnId:turnId});
  if(response?.thought)appendMemory(c,{id:crypto.randomUUID(),turnId,content:response.thought,kind:"belief",importance:2,source:{type:"inference"},tags:memoryTags(response.thought,story),status:"active",scope:"transient",validFromTurnId:turnId});
 }
 const affected=snapshot.characters.filter(c=>plan.deliveries.some(d=>d.characterId===c.id)||settled.events.some(e=>e.visibleTo.includes(c.id))||settled.changes.some(change=>change.characterId===c.id));
 if(affected.length)args.progress?.(collaborationMode==="economy"?"正在整理本轮记忆…":"主 AI 正在更新角色卡记忆…");
 if(collaborationMode==="economy")for(const c of affected){const visibleEvents=settled.events.filter(event=>event.visibleTo.includes(c.id)).map(event=>event.description);c.card=writeCardMemoryDelta(c.card!,{summaryAppend:visibleEvents.join("；")||"本轮角色状态发生变化，未形成新的可见事件。",factsAdd:visibleEvents.slice(0,10),factsRemove:[],beliefsAdd:[],beliefsRemove:[],openThreadsAdd:threadChanges.filter(thread=>thread.status==="open"&&thread.characterIds.includes(c.id)).map(thread=>thread.description),openThreadsResolve:threadChanges.filter(thread=>thread.status==="resolved"&&thread.characterIds.includes(c.id)).map(thread=>thread.description)},c.state,turnId,"model");}
 else await Promise.all(affected.map(async c=>{
  const previous=story.characters.find(old=>old.id===c.id)!;
  const visible=plan.deliveries.find(d=>d.characterId===c.id)?.visible||"";
  const schema=z.union([cardMemoryDeltaSchema,cardMemoryUpdateSchema]).superRefine((update,ctx)=>{try{if("summary" in update)writeCardMemory(c.card!,update,c.state,turnId,"model");else writeCardMemoryDelta(c.card!,update,c.state,turnId,"model")}catch(error){ctx.addIssue({code:"custom",message:(error as Error).message})}});
  const memoryId=stageModel("memory");const update=await stageCall(`memory:${c.id}`,call,memoryId,
   '你负责更新角色卡记忆，并以增量方式整理当前这一位角色的记忆；不扮演角色，不创作新事件。card 中 mytavern_memory 是旧记忆。只返回本轮变化：summaryAppend 是不超过 1000 字的本轮记忆摘要；factsAdd 是新增确定事实，转述内容必须注明“某人声称”；factsRemove 只能逐字复制已过时的旧事实；beliefsAdd / beliefsRemove 管理主观判断；openThreadsAdd / openThreadsResolve 管理约定与待办线索。没有变化使用 []。received 是角色实际看见听见的内容，events 是已裁决且该角色可感知的事件，personalBelief 是角色主观判断。不得加入未知秘密、幕后指令、玩家内心、未成立的动作意图或其他角色知识。仅返回 {"summaryAppend":"本轮新增摘要","factsAdd":[],"factsRemove":[],"beliefsAdd":[],"beliefsRemove":[],"openThreadsAdd":[],"openThreadsResolve":[]}。',
   {characterId:c.id,name:c.name,card:parseCharacterCard(c.card!.source),currentState:c.state,received:visible,events:settled.events.filter(e=>e.visibleTo.includes(c.id)).map(e=>e.description),personalBelief:responses.find(r=>r.characterId===c.id)?.thought||"",relevantPastMemories:retrieveMemories(previous,visible)},schema,buildPresetContext("memory",story,history,visible,c,trigger),`角色「${c.name}」记忆更新`,stageArgs);
  c.card="summary" in update?writeCardMemory(c.card!,update,c.state,turnId,"model"):writeCardMemoryDelta(c.card!,update,c.state,turnId,"model");
 }));
 return {snapshot,narrative:output.narrative,trace:{selected:plan.deliveries.map(d=>d.characterId),events:settled.events.map(e=>e.description),eventRecords:settled.events,deliveries:plan.deliveries.map(({characterId,visible})=>({characterId,visible})),stages:diagnostics,collaborationMode,complexityScore,...(sceneSummary?{sceneSummary}:{}),...(summaryRecords?.length?{summaryRecords}:{}),...(threadChanges.length?{threadChanges}:{})}};
}

export function demoTurn(story:StoryState,input:string,mode:Mode,turnId:string){
 const snapshot=structuredClone(story);for(const c of snapshot.characters)c.card=characterCard(c);const target=snapshot.characters.find(c=>input.includes(c.name))||snapshot.characters[0];
 const privateTalk=/悄|低声|私下|耳语|秘密/.test(input);const cast=target?(privateTalk?[target]:snapshot.characters.slice(0,2)):[];
 const hasLetter=/信|徽记|纸条/.test(input);const hasKnock=/敲门|打断/.test(input);const hasClothing=/脱下|脱掉/.test(input)&&/外套|披风|围裙/.test(input);
 const paras:string[]=[]; const events:string[]=[];
 if(mode==="director")paras.push("【规则演示】本模式只演示有限的剧情与状态变化；完整理解导演指令需要接入真实模型。");
 if(hasKnock){paras.push("门外响起两声轻叩。屋内的交谈停了下来，众人的目光转向门口。");events.push("有人敲门，交谈被打断。");}
 else if(hasLetter&&target){paras.push(`${target.name}的视线在纸张边缘停了一瞬。${privateTalk?"声音压低了些":"片刻之后才开口"}：“这东西是从哪里来的？”`);events.push(`${target.name}询问纸张的来历。`);}
 else if(target){paras.push(`${target.name}稍稍侧过身，认真听着，没有急于下结论。“可以再说得具体一些吗？”`);events.push(`${target.name}倾听并请玩家进一步说明。`);}
 else{paras.push("场景随着你的描述向前推进。这里还没有故事角色回应，你可以继续叙述，或先从角色库导入角色。");events.push("玩家推动了当前场景。");}
 if(hasClothing&&target){const item=input.includes("围裙")?"围裙":input.includes("披风")?"披风":"外套";if(target.state.clothing.includes(item)){target.state.clothing=`${target.state.clothing}（${item}已脱下，放在身边）`;paras.push(`${target.name}脱下${item}，将它放在身边。`);events.push(`${target.name}脱下${item}，放在身边。`);}}
 for(const c of cast){c.state.emotion=hasKnock?"被敲门声打断，警觉":hasLetter?"好奇，带着谨慎":"专注于当前交谈";c.state.thought=hasLetter?"先弄清这件事的来历，再决定是否继续追问。":"先听听接下来会发生什么。";c.state.goal=hasKnock?"留意门口的动静":"理解眼前的情况";c.memories.push({id:crypto.randomUUID(),turnId,content:events.join(" "),kind:"observation",importance:3});}
 for(const c of cast){
  const old=readCardMemory(c.card!);
  const facts=[...(old?.facts||[]),...(mode==="roleplay"?[`玩家向该角色说／做：${input.slice(0,350)}`]:[]),...events];
  c.card=writeCardMemory(c.card!,{summary:old?.summary.slice(0,2000)||"规则演示经历（未调用模型总结）",facts:[...new Set(facts)].slice(-12).map(f=>f.slice(0,400)),beliefs:(old?.beliefs||[]).slice(-4),openThreads:(old?.openThreads||[]).slice(-4)},c.state,turnId,"demo");
 }
 if(cast.length>1&&!hasKnock){paras.push(`${cast[1].name}暂时没有插话，给这段交谈留出了空间。`);}
 paras.push("话音落下，场景暂时停在这里，等待你的回应。");
 return {snapshot,narrative:paras.join("\n\n"),trace:{selected:cast.map(c=>c.id),events,deliveries:cast.map(c=>({characterId:c.id,visible:mode==="director"?events.join(" "):privateTalk?`仅 ${target!.name} 收到的交谈：${input}`:input}))}};
}



