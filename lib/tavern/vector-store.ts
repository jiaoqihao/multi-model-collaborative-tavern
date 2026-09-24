import type { Character, Memory, Profile } from "./types";
import { selectMemoryEvidence } from "./context-builder";
import { embedTexts } from "./embeddings";
import { db } from "./store";
import { branchMemories, rankHybridHits, rankHybridMemories } from "./vector-retrieval";
import { qdrantPointId, queryQdrantPoints, retrieveQdrantPoints, upsertQdrantPoints } from "./qdrant";
import type { QdrantConnection } from "./qdrant";

type Scope={owner:string;storyId:string;modelKey:string;profile:Profile;key:string;embeddingModel:string;ancestorTurnIds:ReadonlySet<string>;qdrant?:QdrantConnection};
type VectorRow={memory_id:string;content_hash:string;dimensions:number;vector:string};
const documentText=(memory:Memory)=>`${memory.kind}: ${memory.content}`.slice(0,2000);
async function digest(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("")}
export async function embeddingModelKey(profile:Profile,model:string){return digest(JSON.stringify([profile.provider,profile.baseUrl.replace(/\/$/,""),model.trim()]))}
function encodeVector(values:readonly number[]){const floats=new Float32Array(values);return btoa(String.fromCharCode(...new Uint8Array(floats.buffer)))}
function decodeVector(row:VectorRow){try{const bytes=Uint8Array.from(atob(row.vector),c=>c.charCodeAt(0));if(bytes.length!==row.dimensions*4||row.dimensions<32||row.dimensions>4096)return;const values=Array.from(new Float32Array(bytes.buffer));return values.every(Number.isFinite)&&values.some(value=>value!==0)?values:undefined}catch{return}}
async function rowsFor(scope:Scope,characterId:string){const result=await db().prepare("SELECT memory_id,content_hash,dimensions,vector FROM memory_vectors WHERE owner=? AND story_id=? AND character_id=? AND model_key=?").bind(scope.owner,scope.storyId,characterId,scope.modelKey).all<VectorRow>();return new Map(result.results.map(row=>[row.memory_id,row]));}
async function vectorState(scope:Scope,character:Character){
 const memories=branchMemories(character,scope.ancestorTurnIds);
 const stored=await rowsFor(scope,character.id);const valid=new Map<string,readonly number[]>();const missing:Memory[]=[];
 for(const memory of memories){const row=stored.get(memory.id);const hash=await digest(documentText(memory));const vector=row?.content_hash===hash?decodeVector(row):undefined;if(vector)valid.set(memory.id,vector);else missing.push(memory)}
 return {memories,valid,missing};
}
async function indexMissing(scope:Scope,characterId:string,missing:Memory[],limit:number){
 const picked=missing.slice(-limit);if(!picked.length)return new Map<string,readonly number[]>();
 const vectors=await embedTexts(scope.profile,scope.key,scope.embeddingModel,picked.map(documentText));
 const now=new Date().toISOString();const statements=await Promise.all(picked.map(async(memory,index)=>db().prepare("INSERT INTO memory_vectors (owner,story_id,character_id,model_key,memory_id,turn_id,content_hash,dimensions,vector,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,story_id,character_id,model_key,memory_id) DO UPDATE SET turn_id=excluded.turn_id,content_hash=excluded.content_hash,dimensions=excluded.dimensions,vector=excluded.vector,created_at=excluded.created_at").bind(scope.owner,scope.storyId,characterId,scope.modelKey,memory.id,memory.turnId,await digest(documentText(memory)),vectors[index].length,encodeVector(vectors[index]),now)));
 await db().batch(statements);
 return new Map(picked.map((memory,index)=>[memory.id,vectors[index]] as [string,readonly number[]]));
}
async function qdrantState(scope:Scope,character:Character){
 const state=await vectorState(scope,character);
 const entries=await Promise.all(state.memories.map(async memory=>({memory,id:await qdrantPointId([scope.owner,scope.storyId,character.id,scope.modelKey,memory.id]),hash:await digest(documentText(memory))})));
 const dimensions=state.valid.values().next().value?.length as number|undefined;
 if(!dimensions)return {state,entries,present:new Set<string>()};
 const stored=await retrieveQdrantPoints(scope.qdrant!,dimensions,entries.map(entry=>entry.id));
 const present=new Set(entries.filter(entry=>{const payload=stored.get(entry.id);return payload?.owner===scope.owner&&payload?.storyId===scope.storyId&&payload?.characterId===character.id&&payload?.modelKey===scope.modelKey&&payload?.memoryId===entry.memory.id&&payload?.contentHash===entry.hash}).map(entry=>entry.memory.id));
 return {state,entries,present};
}
async function syncQdrant(scope:Scope,character:Character,limit:number){
 const {state,entries,present}=await qdrantState(scope,character);
 const missing=entries.filter(entry=>!present.has(entry.memory.id));
 const picked=missing.slice(-limit);
 const uncached=picked.map(entry=>entry.memory).filter(memory=>!state.valid.has(memory.id));
 const added=await indexMissing(scope,character.id,uncached,limit);
 for(const [id,vector] of added)state.valid.set(id,vector);
 const points=picked.map(entry=>({id:entry.id,vector:state.valid.get(entry.memory.id),payload:{owner:scope.owner,storyId:scope.storyId,characterId:character.id,modelKey:scope.modelKey,memoryId:entry.memory.id,contentHash:entry.hash}})).filter((point):point is typeof point & {vector:readonly number[]}=>!!point.vector);
 if(points.length){await upsertQdrantPoints(scope.qdrant!,points);for(const point of points)present.add(point.payload.memoryId)}
 return {state,entries,present};
}
async function searchQdrant(scope:Scope,character:Character,query:string,budgetTokens:number){
 const {state,entries,present}=await syncQdrant(scope,character,24);
 if(!state.memories.length)return {items:[],usedVector:false,indexed:0,total:0,backend:"lexical" as const};
 const [queryVector]=await embedTexts(scope.profile,scope.key,scope.embeddingModel,[query.slice(0,2000)],"query");
 const allowed=entries.filter(entry=>present.has(entry.memory.id)&&state.valid.get(entry.memory.id)?.length===queryVector.length);
 const hits=await queryQdrantPoints(scope.qdrant!,queryVector,allowed.map(entry=>entry.id),{owner:scope.owner,storyId:scope.storyId,characterId:character.id,modelKey:scope.modelKey});
 const byPoint=new Map(allowed.map(entry=>[entry.id,entry]));
 const semanticIds=hits.filter(hit=>{const entry=byPoint.get(hit.id);return entry&&hit.payload.memoryId===entry.memory.id&&hit.payload.contentHash===entry.hash}).map(hit=>String(hit.payload.memoryId));
 const ranked=rankHybridHits({...character,memories:state.memories},query,budgetTokens,semanticIds,allowed.map(entry=>entry.memory.id));
 return {...ranked,backend:ranked.usedVector?"qdrant" as const:"lexical" as const};
}
export async function searchMemoryVectors(scope:Scope,character:Character,query:string,budgetTokens:number){
 const fallback=()=>{const scoped={...character,memories:branchMemories(character,scope.ancestorTurnIds)};const result=selectMemoryEvidence(scoped,query,budgetTokens);return {items:result.items,usedVector:false,indexed:0,total:scoped.memories.length,backend:"lexical" as const}};
 if(!query.trim()||!character.memories.length)return fallback();
 if(scope.qdrant)try{return await searchQdrant(scope,character,query,budgetTokens)}catch(error){console.warn("Qdrant retrieval fell back to D1",error instanceof Error?error.name:"unknown")}
 try{
  const state=await vectorState(scope,character);
  const queryVectors=await embedTexts(scope.profile,scope.key,scope.embeddingModel,[query.slice(0,2000)],"query");
  const added=await indexMissing(scope,character.id,state.missing,24);
  for(const [id,vector] of added)state.valid.set(id,vector);
  const ranked=rankHybridMemories({...character,memories:state.memories},query,budgetTokens,state.valid,queryVectors[0]);return {...ranked,backend:ranked.usedVector?"d1" as const:"lexical" as const};
 }catch(error){console.warn("Vector retrieval fell back to lexical",error instanceof Error?error.name:"unknown");return fallback()}
}
export async function indexStoryMemoryBatch(scope:Scope,characters:Character[]){
 if(scope.qdrant){let total=0,indexed=0,remaining=0;let worked=false;for(const character of characters){const state=worked?await qdrantState(scope,character):await syncQdrant(scope,character,32);total+=state.entries.length;indexed+=state.present.size;remaining+=state.entries.length-state.present.size;if(state.entries.length>state.present.size)worked=true}return {indexed,total,remaining}}
 let total=0,indexed=0;let candidate:{characterId:string;missing:Memory[]}|undefined;
 for(const character of characters){const state=await vectorState(scope,character);total+=state.memories.length;indexed+=state.valid.size;if(!candidate&&state.missing.length)candidate={characterId:character.id,missing:state.missing}}
 if(candidate){const added=await indexMissing(scope,candidate.characterId,candidate.missing,32);indexed+=added.size}
 return {indexed,total,remaining:Math.max(0,total-indexed)};
}
