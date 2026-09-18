import { cardMemoryUpdateSchema, compactSummary, readCardMemory, type CardMemoryUpdate } from "./cards";
import type { StoryThread } from "./types";

const notice="【规则整理：长内容为节选；完整记录见剧情和角色原始记忆】";
const omission="【卡片容量有限，部分条目未收录】";
const normalize=(text:string)=>text.trim().replace(/\s+/g," ");

// No invented summary: retain both ends and explicitly mark omitted text.
// Array.from avoids splitting UTF-16 surrogate pairs at an excerpt boundary.
export function memoryExcerpt(text:string,limit=400):string {
 if(text.length<=limit)return text;
 const marker="…【节选】…",room=limit-marker.length;
 const points=Array.from(text);let head="",tail="";
 for(const char of points){if(head.length+char.length>Math.floor(room*0.65))break;head+=char;}
 for(let i=points.length-1;i>=0;i--){if(tail.length+points[i].length>room-head.length)break;tail=points[i]+tail;}
 return head+marker+tail;
}
function unique(items:string[]){return [...new Map(items.filter(item=>item.trim()).map(item=>[normalize(item),item])).values()];}
function threadPrefix(thread:StoryThread){return `[线索 ${thread.id}] `;}
function threadEntry(thread:StoryThread){const prefix=threadPrefix(thread);return prefix+memoryExcerpt(thread.description,400-prefix.length);}

/** Deterministic, bounded card projection; full events/threads stay in the snapshot. */
export function economyMemoryUpdate(previous:ReturnType<typeof readCardMemory>,events:string[],threads:StoryThread[],characterId:string):CardMemoryUpdate {
 const base=previous||{summary:"",facts:[],beliefs:[],openThreads:[]};
 const changes=threads.filter(thread=>thread.characterIds.includes(characterId));
 const resolved=changes.filter(thread=>thread.status==="resolved");
 const open=changes.filter(thread=>thread.status==="open");
 const remaining=base.openThreads.filter(entry=>!resolved.some(thread=>entry.startsWith(threadPrefix(thread))||normalize(entry)===normalize(thread.description)));
 const candidates={
  openThreads:unique([...remaining.filter(entry=>!open.some(thread=>entry.startsWith(threadPrefix(thread)))),...open.map(threadEntry)]),
  facts:unique([...base.facts,...events.map(text=>memoryExcerpt(text))]),
  beliefs:unique(base.beliefs),
 };
 let summary=compactSummary(base.summary.replaceAll(notice,"").replaceAll(omission,"").trim(),events.length?events.map(text=>memoryExcerpt(text,250)).join("\n"):"本轮状态或线索已更新，无新增可见事件。");
 // Reserve space for active commitments, JSON escaping, and an omission notice.
 while(JSON.stringify(summary).length>3400)summary=memoryExcerpt(summary,Math.floor(summary.length*0.8));
 const update:CardMemoryUpdate={summary:notice+"\n"+summary,facts:[],beliefs:[],openThreads:[]};
 let omitted=false;
 for(const [field,limit] of [["openThreads",12],["facts",24],["beliefs",12]] as const){
  // Prefer recent entries; restore chronological order after budget selection.
  for(const item of [...candidates[field]].reverse()){
   if(update[field].length>=limit){omitted=true;continue;}
   update[field].unshift(item);
   if(JSON.stringify(update).length+omission.length+2>10000){update[field].shift();omitted=true;}
  }
 }
 if(omitted)update.summary+="\n"+omission;
 return cardMemoryUpdateSchema.parse(update);
}
