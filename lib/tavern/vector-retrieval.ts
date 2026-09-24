import type { Character, Memory } from "./types";
import { estimateContextTokens, selectMemoryEvidence } from "./context-builder";

export function branchMemories(character:Character,ancestorTurnIds:ReadonlySet<string>){
 return character.memories.filter(memory=>ancestorTurnIds.has(memory.turnId)&&(!memory.validFromTurnId||ancestorTurnIds.has(memory.validFromTurnId)));
}

export function cosineSimilarity(a:readonly number[],b:readonly number[]){
 if(a.length!==b.length||!a.length)return 0;
 let product=0,left=0,right=0;for(let i=0;i<a.length;i++){product+=a[i]*b[i];left+=a[i]*a[i];right+=b[i]*b[i]}
 return left&&right?product/Math.sqrt(left*right):0;
}

export function rankHybridMemories(character:Character,query:string,budgetTokens:number,vectors:ReadonlyMap<string,readonly number[]>,queryVector?:readonly number[]){
 const lexical=selectMemoryEvidence(character,query,Number.MAX_SAFE_INTEGER).items;
 const semantic=queryVector?lexical.filter(memory=>vectors.get(memory.id)?.length===queryVector.length).sort((a,b)=>cosineSimilarity(queryVector,vectors.get(b.id)!)-cosineSimilarity(queryVector,vectors.get(a.id)!)):[];
 const indexed=semantic.length;
 // A partially built index must not push unindexed history out of the prompt.
 const usedVector=!!queryVector&&indexed>0&&indexed/Math.max(1,lexical.length)>=0.75;
 let ordered=lexical;
 if(usedVector){
  const scores=new Map<string,number>();
  for(const list of [lexical,semantic])list.forEach((memory,index)=>scores.set(memory.id,(scores.get(memory.id)||0)+1/(60+index+1)));
  ordered=[...lexical].sort((a,b)=>scores.get(b.id)!-scores.get(a.id)!);
 }
 const items:Memory[]=[];let usedTokens=0;
 for(const memory of ordered){const cost=estimateContextTokens(memory.content)+24;if(usedTokens+cost>budgetTokens)continue;items.push(memory);usedTokens+=cost}
 return {items,usedVector,indexed,total:lexical.length,usedTokens};
}
