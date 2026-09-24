import type { Character, Memory, Profile } from "./types";
import { selectMemoryEvidence } from "./context-builder";
import { embedTexts } from "./embeddings";
import { db } from "./store";
import { branchMemories, rankHybridMemories } from "./vector-retrieval";

type Scope={owner:string;storyId:string;modelKey:string;profile:Profile;key:string;embeddingModel:string;ancestorTurnIds:ReadonlySet<string>};
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
export async function searchMemoryVectors(scope:Scope,character:Character,query:string,budgetTokens:number){
 const fallback=()=>{const scoped={...character,memories:branchMemories(character,scope.ancestorTurnIds)};const result=selectMemoryEvidence(scoped,query,budgetTokens);return {items:result.items,usedVector:false,indexed:0,total:scoped.memories.length}};
 if(!query.trim()||!character.memories.length)return fallback();
 try{
  const state=await vectorState(scope,character);
  const queryVectors=await embedTexts(scope.profile,scope.key,scope.embeddingModel,[query.slice(0,2000)],"query");
  const added=await indexMissing(scope,character.id,state.missing,24);
  for(const [id,vector] of added)state.valid.set(id,vector);
  return rankHybridMemories({...character,memories:state.memories},query,budgetTokens,state.valid,queryVectors[0]);
 }catch(error){console.warn("Vector retrieval fell back to lexical",error instanceof Error?error.name:"unknown");return fallback()}
}
export async function indexStoryMemoryBatch(scope:Scope,characters:Character[]){
 let total=0,indexed=0;let candidate:{characterId:string;missing:Memory[]}|undefined;
 for(const character of characters){const state=await vectorState(scope,character);total+=state.memories.length;indexed+=state.valid.size;if(!candidate&&state.missing.length)candidate={characterId:character.id,missing:state.missing}}
 if(candidate){const added=await indexMissing(scope,candidate.characterId,candidate.missing,32);indexed+=added.size}
 return {indexed,total,remaining:Math.max(0,total-indexed)};
}
