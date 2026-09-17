import { estimateContextTokens, selectMemoryEvidence } from "../../lib/tavern/context-builder";
import type { Character, Memory } from "../../lib/tavern/types";

// Experimental only: no production route imports this module.
export type Evidence = { ownerId:string; storyId:string; characterId:string; memory:Memory };
export type RetrievalScope = { ownerId:string; storyId:string; characterId:string; ancestorTurnIds:ReadonlySet<string>; historical:boolean };
export type Vector = { model:string; values:readonly number[] };
export type Method = "lexical" | "vector" | "hybrid";
export function evidenceKey(row:Evidence){return JSON.stringify([row.ownerId,row.storyId,row.characterId,row.memory.turnId,row.memory.id])}
export function eligibleEvidence(rows:Evidence[],scope:RetrievalScope){
 return rows.filter(row=>{
  const memory=row.memory;
  return row.ownerId===scope.ownerId&&row.storyId===scope.storyId&&row.characterId===scope.characterId
   &&scope.ancestorTurnIds.has(memory.turnId)
   &&(!memory.validFromTurnId||scope.ancestorTurnIds.has(memory.validFromTurnId))
   &&(scope.historical||((memory.status||"active")==="active"&&(!memory.validUntilTurnId||!scope.ancestorTurnIds.has(memory.validUntilTurnId))));
 });
}
function validVector(vector:Vector,model:string,dimensions:number){return vector.model===model&&vector.values.length===dimensions&&dimensions>0&&vector.values.every(Number.isFinite)&&vector.values.some(value=>value!==0)}
export function cosine(a:readonly number[],b:readonly number[]){
 let product=0,left=0,right=0;for(let i=0;i<a.length;i++){product+=a[i]*b[i];left+=a[i]**2;right+=b[i]**2;}
 return product/Math.sqrt(left*right);
}
export function retrieve(args:{rows:Evidence[];scope:RetrievalScope;character:Character;query:string;method:Method;vectors?:ReadonlyMap<string,Vector>;queryVector?:Vector;budgetTokens:number;limit:number}){
 if(!Number.isFinite(args.budgetTokens)||args.budgetTokens<0||!Number.isInteger(args.limit)||args.limit<0)throw new Error("Invalid retrieval limits");
 const candidates=eligibleEvidence(args.rows,args.scope);
 const keys=candidates.map(evidenceKey);if(new Set(keys).size!==keys.length)throw new Error("Duplicate evidence key");
 // Baseline implementation is reused unchanged; explicit historical mode supplies
 // its existing intent marker. All methods receive identical eligible candidates.
 const memories=candidates.map((row,index)=>({...row.memory,id:String(index)}));
 const ranked=selectMemoryEvidence({...args.character,memories},args.scope.historical?`历史 ${args.query}`:args.query,Number.MAX_SAFE_INTEGER).items;
 const lexical=ranked.map(memory=>candidates[Number(memory.id)]);
 const q=args.queryVector;
 const vectorReady=!!q&&validVector(q,q.model,q.values.length)&&candidates.every(row=>{
  const vector=args.vectors?.get(evidenceKey(row));return !!vector&&validVector(vector,q.model,q.values.length);
 });
 let order=lexical;let fallback=false;
 if(args.method!=="lexical"){
  if(!vectorReady){fallback=true;}
  else{
   const semantic=[...candidates].sort((a,b)=>cosine(q!.values,args.vectors!.get(evidenceKey(b))!.values)-cosine(q!.values,args.vectors!.get(evidenceKey(a))!.values));
   if(args.method==="vector")order=semantic;
   else{
    // Fixed, equal-weight reciprocal rank fusion; no query-specific tuning.
    const scores=new Map<string,number>();
    for(const list of [lexical,semantic])list.forEach((row,index)=>{const key=evidenceKey(row);scores.set(key,(scores.get(key)||0)+1/(60+index+1));});
    order=[...lexical].sort((a,b)=>scores.get(evidenceKey(b))!-scores.get(evidenceKey(a))!);
   }
  }
 }
 const items:Evidence[]=[];let usedTokens=0;
 for(const row of order){
  if(items.length>=args.limit)break;
  // Count serialized metadata as well as content, using the application's estimator.
  const cost=estimateContextTokens(JSON.stringify(row.memory))+12;
  if(usedTokens+cost>args.budgetTokens)continue;
  items.push(row);usedTokens+=cost;
 }
 return {items,usedTokens,fallback,candidateCount:candidates.length};
}
