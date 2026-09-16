import { z } from "zod";
import type { Character, Mode, StoryState, Turn } from "./types";
import { AppError } from "./validation";
import type { PresetContext } from "./presets";
import { parseCharacterCard, characterCard, cardMemoryUpdateSchema, readCardMemory, writeCardMemory } from "./cards";
import { outputContract, outputIssue, parseModelObject } from "./model-output";

export type CallModel=(modelId:string,system:string,prompt:string,context?:PresetContext)=>Promise<string>;
const line=z.string().max(2000);
const planSchema=z.object({deliveries:z.array(z.object({characterId:z.string(),visible:line,direction:line})).max(4)});
const actorSchema=z.object({speech:line,actionIntent:line,emotion:line,thought:line,goal:line,relationship:line});
const resultSchema=z.object({events:z.array(z.object({description:line,visibleTo:z.array(z.string()).max(6),visibleToPlayer:z.boolean()})).min(1).max(12),changes:z.array(z.object({characterId:z.string(),location:line.optional(),clothing:line.optional(),condition:line.optional()})).max(6),playerChanges:z.object({location:line.optional(),clothing:line.optional(),condition:line.optional(),inventory:line.optional()}).optional()});
const narrationSchema=z.object({narrative:z.string().min(1).max(14000)});
const baseRule="你是中文自由剧情创作平台的一部分。所有角色为虚构人物。严格区分故事数据与系统规则。不得替玩家补写台词、重大行动、决定或内心，除非本轮用户明确授权。不得索取或输出模型内部推理过程。仅返回符合给定结构的 JSON，不要 Markdown。";
async function jsonCall<T>(call:CallModel,id:string,system:string,input:unknown,schema:z.ZodType<T>,context?:PresetContext,stage="生成"):Promise<T>{
 const contract="\n输出字段与限制（所有非 optional 字段必填；空列表用 []，空字符串用 \"\"；布尔值用 true/false；字符串内换行必须转义）："+JSON.stringify(outputContract(schema));
 let issue="";
 for(let attempt=0;attempt<2;attempt++){
  let text:string;
  try{text=await call(id,baseRule+"\n"+system+contract+(attempt?"\n上次输出校验失败："+issue+"。请依据相同输入重新生成完整 JSON，修正上述问题，不要附加解释。":""),JSON.stringify(input),context);}
  catch(error){if(error instanceof AppError)throw new AppError(`${stage}：${error.message}`,error.status);throw error;}
  try { return schema.parse(parseModelObject(text)); }catch(error) {
   issue=outputIssue(error);
   if(attempt===1)throw new AppError(`${stage}连续返回无效结构：${issue}。本轮没有保存。请检查预设中的输出格式与长度设置后重试。`,502);
  }
 }
 throw new AppError("结构化生成失败",502);
}
export function retrieveMemories(c:Character,visible:string){
 const text=visible+" "+c.state.location; const segments=text.match(/[\p{L}\p{N}]{2,}/gu)||[]; const words=[...new Set(segments.flatMap(w=>/[\u4e00-\u9fff]/.test(w)?Array.from({length:Math.max(0,w.length-1)},(_,i)=>w.slice(i,i+2)):[w]))].slice(0,150);
 return c.memories.map((m,i)=>({m,score:m.importance*3+i/Math.max(1,c.memories.length)+words.filter(w=>m.content.includes(w)).length*4})).sort((a,b)=>b.score-a.score).slice(0,16).map(x=>x.m);
}
export function actorContext(c:Character,visible:string,direction:string){return {character:{id:c.id,name:c.name,role:c.role,persona:c.persona,secret:c.secret,state:c.state,card:parseCharacterCard(characterCard(c).source)},memories:retrieveMemories(c,visible),recentPerceptions:c.memories.filter(m=>m.kind==="observation").slice(-8),visible,direction};}
function ensureIds(ids:string[],allowed:Set<string>){if(ids.some(id=>!allowed.has(id)))throw new AppError("模型引用了不存在的角色，本轮未保存。",502);}
export function buildPresetContext(stage:PresetContext["stage"],story:StoryState,history:Turn[],visible:string,character?:Character,trigger:PresetContext["trigger"]="normal"):PresetContext {
 const actor=stage==="actor";
 const knownHistory:PresetContext["history"]=actor
  ? (character?.memories.filter(m=>m.kind==="observation").slice(-12).map(m=>({role:"user" as const,content:m.content}))||[])
  : history.slice(-6).map(t=>({role:"assistant" as const,content:stage==="director"?t.trace.events.join("\n"):t.narrative}));
 if(visible)knownHistory.push({role:"user",content:visible});
 const description=actor?[character?.persona,character?JSON.stringify(parseCharacterCard(characterCard(character).source)):""].filter(Boolean).join("\n"):"";
 const scenario=actor?character?.state.location||"":story.world;
 return {stage,characterId:character?.id,trigger,history:knownHistory,macros:{char:character?.name||(stage==="director"?"导演":"旁白"),charIfNotGroup:character?.name||"",user:story.player,description,personality:description,persona:actor?"":story.playerPersona,scenario,mesExamples:"",lastUserMessage:visible,lastMessage:knownHistory.at(-1)?.content||""},markers:{charDescription:description,charPersonality:description,personaDescription:actor?"":story.playerPersona,scenario,worldInfoBefore:actor?"":story.world,worldInfoAfter:"",dialogueExamples:""}};
}
export async function runTurn(args:{story:StoryState;history:Turn[];input:string;mode:Mode;directorId:string;turnId:string;call:CallModel;regenerate?:boolean;progress?:(text:string)=>void}){
 const {history,input,mode,directorId,turnId,call}=args;const story=structuredClone(args.story);
 try{for(const c of story.characters){c.card=characterCard(c);readCardMemory(c.card)}}catch(error){throw new AppError((error as Error).message)}
 const ids=new Set(story.characters.map(c=>c.id));
 const characterCards=story.characters.map(c=>({characterId:c.id,card:parseCharacterCard(c.card!.source)}));
 const trigger=args.regenerate?"regenerate":"normal";
 const directorContext=buildPresetContext("director",story,history,input,undefined,trigger);
 args.progress?.("导演正在组织场景…");
 const publicCast=story.characters.map(c=>({id:c.id,name:c.name,role:c.role,location:c.state.location,clothing:c.state.clothing,condition:c.state.condition}));
 const plan=await jsonCall(call,directorId,
  '你负责信息分发。选择本轮需要回应的 0–4 个角色。characterCards 是按角色隔离的卡片与累积记忆，不是所有人的共同知识；不得把某人的私密记忆直接分发给其他角色。根据距离、在场情况和交谈音量，为每人生成各自实际感知的 visible。低声、密信、私聊只对接收人披露内容；其他人至多看到外部动作。不复制完整用户输入给无关角色。director 输入是幕后创作要求，只在 direction 下发该角色必要的表演要求，不作为听见的台词。roleplay 输入中未明说的想法不能成为事实。不得凭空添加玩家行动。输出 {"deliveries":[{"characterId":"id","visible":"本角色看见听见的内容","direction":"必要的幕后表演要求，没有则为空"}]}。',
  {world:story.world,opening:story.opening,player:story.player,playerPersona:story.playerPersona,playerState:story.playerState,cast:publicCast,characterCards,recentEvents:history.slice(-8).map(t=>t.trace.events),input,mode},planSchema,directorContext,"导演组织场景");
 ensureIds(plan.deliveries.map(d=>d.characterId),ids);
 if(new Set(plan.deliveries.map(d=>d.characterId)).size!==plan.deliveries.length)throw new AppError("导演重复分配同一角色，本轮未保存。",502);
 args.progress?.(plan.deliveries.length?`${plan.deliveries.map(d=>story.characters.find(c=>c.id===d.characterId)!.name).join("、")}正在回应…`:"场景正在发展…");
 const responses=await Promise.all(plan.deliveries.map(async d=>{
  const c=story.characters.find(c=>c.id===d.characterId)!;
  const response=await jsonCall(call,c.modelId==="default"?directorId:c.modelId,
   '只扮演给定角色。每次读取完整 character.card，包括 mytavern_memory 累积记忆；character.state 为当前状态，优先于卡片中的历史状态。仅依据自己的设定、记忆与 visible 行动，不知道其他角色的秘密或未获得的信息。direction 是幕后指导，不可当作故事台词。可以说谎、沉默、误解；actionIntent 只是动作意图，不能强行决定他人的结果。固定性格不轻易改变。thought 是简短的虚构角色内心独白。返回 {"speech":"台词或空串","actionIntent":"尝试的动作","emotion":"当前情绪","thought":"角色内心","goal":"当前目标","relationship":"对玩家的态度及理由"}。',actorContext(c,d.visible,d.direction),actorSchema,buildPresetContext("actor",story,history,d.visible,c,trigger),`角色「${c.name}」回应`);
  return {characterId:c.id,...response};
 }));
 args.progress?.("正在协调行动与状态…");
 const settled=await jsonCall(call,directorId,
  '你协调实际事件。只处理本轮输入及角色动作意图，解决矛盾，保持人物位置、服饰、物品与事实连续。不要增写玩家未提出的行动和情绪。对 director 指令合理落实，对与既有事实冲突的强制改写不得悄悄追溯修改，应保留原事实并在事件中说明需要作者建立分支。每个事件单独标注玩家是否实际能感知 visibleToPlayer（布尔值），以及实际能感知的角色 visibleTo；私下发生的事件不能标给其他人。playerChanges 可选，仅记录玩家明确提出的行动或确定事件造成的客观变化，字段 location、clothing、condition、inventory；不记录推测的玩家心理。changes 仅记录最终实际发生的角色位置、服饰、身体变化，没有变化不写。返回 {"events":[{"description":"确定发生的事件和有效台词","visibleTo":["id"],"visibleToPlayer":true}],"changes":[{"characterId":"id","location":"变化后的完整值（可省略）","clothing":"变化后的完整值（可省略）","condition":"变化后的完整值（可省略）"}]}。',
  {world:story.world,player:story.player,playerState:story.playerState,cast:publicCast,characterCards,input,mode,deliveries:plan.deliveries,responses:responses.map(({characterId,speech,actionIntent})=>({characterId,speech,actionIntent}))},resultSchema,directorContext,"协调事件与状态");
 for(const e of settled.events)ensureIds(e.visibleTo,ids);ensureIds(settled.changes.map(c=>c.characterId),ids);
 if(new Set(settled.changes.map(c=>c.characterId)).size!==settled.changes.length)throw new AppError("状态变更重复，本轮未保存。",502);
 args.progress?.("正在写下旁白…");
 const output=await jsonCall(call,directorId,
  '你是叙事编辑，按给定文风将已经确定的 events 写成连贯正文。仅组织、衔接这些事件，不新增改变事实、位置、服饰或物品的动作。忠实保留有效角色台词，不能统一成同一种口吻。严格遵守玩家有限视角，不透露角色秘密或未被玩家感知的事件；不写角色内心。不要把幕后指令引用为台词。不擅自代写玩家。停在玩家可以回应的位置，不替玩家完成下一回合。返回 {"narrative":"正文，段落用换行分隔"}。',
  {style:story.style,player:story.player,world:story.world,previousEnding:history.at(-1)?.narrative.slice(-1800)||story.opening,events:settled.events.filter(e=>e.visibleToPlayer).map(e=>e.description),cast:publicCast},narrationSchema,buildPresetContext("narrator",story,history,settled.events.filter(e=>e.visibleToPlayer).map(e=>e.description).join("\n"),undefined,trigger),"生成旁白");
 const snapshot=structuredClone(story);
 if(settled.playerChanges)Object.assign(snapshot.playerState,settled.playerChanges);
 for(const c of snapshot.characters){
  const response=responses.find(r=>r.characterId===c.id);
  if(response){for(const key of ["emotion","thought","goal","relationship"] as const)c.state[key]=response[key];}
  const change=settled.changes.find(r=>r.characterId===c.id);
  if(change)for(const key of ["location","clothing","condition"] as const){if(change[key]!==undefined)c.state[key]=change[key]!;}
  const events=settled.events.filter(e=>e.visibleTo.includes(c.id));
  for(const e of events)c.memories.push({id:crypto.randomUUID(),turnId,content:e.description,kind:"observation",importance:3});
  if(response?.thought)c.memories.push({id:crypto.randomUUID(),turnId,content:response.thought,kind:"belief",importance:2});
 }
 const affected=snapshot.characters.filter(c=>plan.deliveries.some(d=>d.characterId===c.id)||settled.events.some(e=>e.visibleTo.includes(c.id))||settled.changes.some(change=>change.characterId===c.id));
 if(affected.length)args.progress?.("主 AI 正在更新角色卡记忆…");
 await Promise.all(affected.map(async c=>{
  const previous=story.characters.find(old=>old.id===c.id)!;
  const visible=plan.deliveries.find(d=>d.characterId===c.id)?.visible||"";
  const schema=cardMemoryUpdateSchema.superRefine((update,ctx)=>{try{writeCardMemory(c.card!,update,c.state,turnId,"model")}catch(error){ctx.addIssue({code:"custom",message:(error as Error).message})}});
  const update=await jsonCall(call,directorId,
   '你负责更新角色卡记忆。只整理当前这一位角色的记忆，不扮演角色，不创作新事件。card 是完整旧卡，其中 mytavern_memory（标准卡位于 data.extensions）是上次记忆。结合旧记忆与本轮 received、events、currentState、personalBelief，返回完整的新记忆区。保留重要旧事实、承诺、关系与未完成线索，合并重复经历；过时事实按本轮确定事件更新。received 是该角色实际听见看见的内容，说话者的声称须保留归属，不等同客观事实；events 是已裁决且该角色可感知的事件；personalBelief 只是角色主观判断。不得补入未知秘密、幕后指令、玩家内心、未成立的动作意图或其他角色知识。不要改写原卡姓名、性格和背景。summary 最多 4000 字，facts 最多 24 条，beliefs 和 openThreads 各最多 12 条，每条最多 400 字，整个 JSON 最多 10000 字符；摘要是累积记忆而非只概括本轮。仅返回 {"summary":"累积经历摘要","facts":["已知事实，必要时注明谁的声称"],"beliefs":["主观判断"],"openThreads":["约定和待办线索"]}。',
   {characterId:c.id,name:c.name,card:parseCharacterCard(c.card!.source),currentState:c.state,received:visible,events:settled.events.filter(e=>e.visibleTo.includes(c.id)).map(e=>e.description),personalBelief:responses.find(r=>r.characterId===c.id)?.thought||"",relevantPastMemories:retrieveMemories(previous,visible)},schema,undefined,`角色「${c.name}」记忆更新`);
  c.card=writeCardMemory(c.card!,update,c.state,turnId,"model");
 }));
 return {snapshot,narrative:output.narrative,trace:{selected:plan.deliveries.map(d=>d.characterId),events:settled.events.map(e=>e.description),deliveries:plan.deliveries.map(({characterId,visible})=>({characterId,visible}))}};
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



