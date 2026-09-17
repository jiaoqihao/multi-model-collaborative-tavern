import type { Character, GenerationStage, Memory, StoryState, Turn } from "./types";
import type { ChatMessage } from "./presets";
import { cardBody, characterCard, parseCharacterCard, readCardMemory } from "./cards";

export function estimateContextTokens(text:string){const ascii=(text.match(/[\x00-\x7F]/g)||[]).length;return Math.ceil(ascii/4+(text.length-ascii)/1.7)}
function terms(text:string){const segments=text.match(/[\p{L}\p{N}]{2,}/gu)||[];return [...new Set(segments.flatMap(word=>/[\u4e00-\u9fff]/.test(word)?Array.from({length:Math.max(1,word.length-1)},(_,i)=>word.slice(i,i+2)):[word.toLowerCase()]))].slice(0,200)}
function historicalIntent(query:string){return /曾经|以前|之前|当时|最初|历史|为何改变|怎么变|回忆|过去/.test(query)}
function memoryCost(memory:Memory){return estimateContextTokens(memory.content)+24}

export type MemorySelection={items:Memory[];budgetTokens:number;usedTokens:number;omitted:number};
export function selectMemoryEvidence(character:Character,query:string,budgetTokens=1400):MemorySelection{
 const words=terms(`${query} ${character.state.location} ${character.state.goal}`);const history=historicalIntent(query);const tagSet=new Set([character.name,...words]);
 const ranked=character.memories.map((memory,index)=>{
  const status=memory.status||"active";if(status!=="active"&&!history)return null;
  const content=memory.content.toLowerCase();const lexical=words.filter(word=>content.includes(word)).length;
  const tags=(memory.tags||[]).filter(tag=>tagSet.has(tag)||query.includes(tag)).length;
  const recency=(index+1)/Math.max(1,character.memories.length);
  const lifecycle=memory.scope==="durable"?3:memory.scope==="scene"?1:0;
  const statusScore=status==="active"?4:history?1:-20;
  return {memory,score:memory.importance*4+lexical*5+tags*6+recency*3+lifecycle+statusScore};
 }).filter((item):item is {memory:Memory;score:number}=>!!item).sort((a,b)=>b.score-a.score);
 const items:Memory[]=[];let usedTokens=0;
 for(const {memory} of ranked){const cost=memoryCost(memory);if(usedTokens+cost>budgetTokens)continue;items.push(memory);usedTokens+=cost;}
 return {items,budgetTokens,usedTokens,omitted:Math.max(0,ranked.length-items.length)};
}

function packHistory(messages:ChatMessage[],budgetTokens:number){const selected:ChatMessage[]=[];let usedTokens=0;for(const message of [...messages].reverse()){const cost=estimateContextTokens(message.content)+12;if(usedTokens+cost>budgetTokens)continue;selected.unshift(message);usedTokens+=cost;}return {selected,usedTokens,omitted:messages.length-selected.length}}

export function buildContextHistory(stage:GenerationStage,story:StoryState,history:Turn[],visible:string,character?:Character,budgetTokens=2200){
 const actor=stage==="actor"||stage==="memory";let selectedMemories=0,omittedMemories=0;
 const messages:ChatMessage[]=[];
 if(actor&&character){const selection=selectMemoryEvidence(character,visible,Math.floor(budgetTokens*.65));messages.push(...selection.items.map(memory=>({role:"user" as const,content:`[${memory.kind}/${memory.status||"active"}] ${memory.content}`})));selectedMemories=selection.items.length;omittedMemories=selection.omitted;}
 else messages.push(...history.map(turn=>({role:"assistant" as const,content:stage==="director"?turn.trace.events.join("\n"):turn.narrative})));
 if(visible)messages.push({role:"user",content:visible});
 const packed=packHistory(messages,budgetTokens);return {history:packed.selected,diagnostics:{budgetTokens,usedTokens:packed.usedTokens,selectedMemories,omittedMemories:omittedMemories+packed.omitted,historyItems:packed.selected.length}};
}

function withoutEmbeddedMemory(data:Record<string,unknown>){const clone=structuredClone(data);const body=cardBody(clone);if(body.extensions&&typeof body.extensions==="object"&&!Array.isArray(body.extensions))delete (body.extensions as Record<string,unknown>).mytavern_memory;delete body.mytavern_memory;return clone}
export function compactCharacterContext(character:Character,query:string,budgetTokens=1200){
 const card=characterCard(character);const parsed=withoutEmbeddedMemory(parseCharacterCard(card.source));const memory=readCardMemory(card);const selection=selectMemoryEvidence(character,query,Math.max(240,Math.floor(budgetTokens*.45)));
 const base={id:character.id,name:character.name,role:character.role,persona:character.persona,secret:character.secret,state:character.state,card:parsed,cardMemory:memory?{summary:memory.summary,facts:memory.facts,beliefs:memory.beliefs,openThreads:memory.openThreads}:undefined,relevantMemories:selection.items};
 const raw=JSON.stringify(base);if(estimateContextTokens(raw)<=budgetTokens)return base;
 const body=cardBody(parsed);return {id:character.id,name:character.name,role:character.role,persona:character.persona,secret:character.secret,state:character.state,cardExcerpt:JSON.stringify(body).slice(0,Math.max(600,budgetTokens*3)),cardMemory:base.cardMemory,relevantMemories:selection.items.slice(0,6)};
}

export function contextBudgetFor(stage:GenerationStage){return {director:3600,actor:2600,settlement:3600,narrator:2200,memory:2800}[stage]}
