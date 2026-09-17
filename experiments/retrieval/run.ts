import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { character, corpus, queries, scopeFor, type Query } from "./fixtures";
import { evidenceKey, retrieve, type Method, type Vector } from "./hybrid";

const model="Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const modelHost=process.argv.includes("--mirror")?"https://hf-mirror.com":"https://huggingface.co";
const runtime=resolve(".tmp/retrieval-runtime/node_modules/@huggingface/transformers/dist/transformers.node.mjs");
if(!existsSync(runtime))throw new Error("Install the isolated runtime: npm install --prefix .tmp/retrieval-runtime @huggingface/transformers@3.8.1 --no-audit --no-fund");
const offline=process.argv.includes("--offline");
const cachePath=resolve(".tmp/retrieval-embeddings.json");
const texts=[...corpus.map(row=>row.memory.content),...queries.map(query=>query.text)];
const fingerprint=createHash("sha256").update(JSON.stringify({model,dtype:"q8",pooling:"mean",normalize:true,texts})).digest("hex");
type Cache={fingerprint:string;model:string;revision:string;vectors:number[][];documentEmbeddingMs:number;queryEmbeddingMs:number[];loadMs:number};
let cache:Cache|undefined;
if(existsSync(cachePath)){const saved=JSON.parse(readFileSync(cachePath,"utf8")) as Cache;if(saved.fingerprint===fingerprint&&saved.vectors.length===texts.length)cache=saved;}
const cacheHit=!!cache;
if(!cache){
 if(offline)throw new Error("No matching embedding cache. Run once online to download the public model; text inference stays local.");
 const response=await fetch(`${modelHost}/api/models/${model}`,{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Model metadata unavailable: ${response.status}`);
 const metadata=await response.json() as {sha:string};if(!/^[0-9a-f]{40}$/.test(metadata.sha))throw new Error("Missing immutable model revision");
 const {pipeline,env}=await import(pathToFileURL(runtime).href);
 env.cacheDir=resolve(".tmp/retrieval-models");
 env.remoteHost=modelHost+"/";
 console.log(`Loading public model ${model} @ ${metadata.sha}; synthetic texts are encoded locally.`);
 const start=performance.now();const encoder=await pipeline("feature-extraction",model,{revision:metadata.sha,dtype:"q8",device:"cpu"});const loadMs=performance.now()-start;
 const vectors:number[][]=[];const documentStart=performance.now();
 for(let offset=0;offset<corpus.length;offset+=8){
  const output=await encoder(texts.slice(offset,offset+8>corpus.length?corpus.length:offset+8),{pooling:"mean",normalize:true});vectors.push(...output.tolist());
 }
 const documentEmbeddingMs=performance.now()-documentStart;const queryEmbeddingMs:number[]=[];
 for(const query of queries){const start=performance.now();const output=await encoder([query.text],{pooling:"mean",normalize:true});vectors.push(...output.tolist());queryEmbeddingMs.push(performance.now()-start);}
 await encoder.dispose();
 cache={fingerprint,model,revision:metadata.sha,vectors,loadMs,documentEmbeddingMs,queryEmbeddingMs};
 writeFileSync(cachePath,JSON.stringify(cache));
}
const modelVersion=`${cache.model}@${cache.revision}:q8:mean`;
const vectors=new Map(corpus.map((row,index)=>[evidenceKey(row),{model:modelVersion,values:cache.vectors[index]}]));
const methods:Method[]=["lexical","vector","hybrid"];
const mean=(values:number[])=>values.reduce((sum,n)=>sum+n,0)/Math.max(1,values.length);
const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
function score(query:Query,ids:string[]){
 const ranks=query.relevant.map(id=>ids.indexOf(id)).filter(rank=>rank>=0);
 const dcg=ranks.reduce((sum,rank)=>sum+1/Math.log2(rank+2),0);
 const ideal=query.relevant.slice(0,3).reduce((sum,_,index)=>sum+1/Math.log2(index+2),0);
 return {hit1:Number(query.relevant.includes(ids[0])),recall3:ranks.length/query.relevant.length,mrr3:ranks.length?1/(Math.min(...ranks)+1):0,ndcg3:dcg/ideal};
}
const details=queries.flatMap((query,index)=>methods.map(method=>{
 const queryVector:Vector={model:modelVersion,values:cache.vectors[corpus.length+index]};
 const start=performance.now();const result=retrieve({rows:corpus,scope:scopeFor(query),character,query:query.text,method,vectors,queryVector,budgetTokens:900,limit:3});
 const retrievalMs=performance.now()-start;const ids=result.items.map(row=>row.memory.id);
 if(result.fallback)throw new Error("Full-vector experiment unexpectedly fell back");
 const leaks=result.items.filter(row=>row.ownerId!=="synthetic-owner"||row.storyId!=="story-a"||row.characterId!==character.id||!["t1","t2"].includes(row.memory.turnId)||(!query.historical&&(row.memory.status||"active")!=="active")).length;
 return {queryId:query.id,category:query.category,method,ids,...score(query,ids),usedTokens:result.usedTokens,retrievalMs,leaks};
}));
const metrics=["all","direct","paraphrase","lifecycle"].flatMap(category=>methods.map(method=>{
 const rows=details.filter(row=>row.method===method&&(category==="all"||row.category===category));
 return {category,method,count:rows.length,hit1:mean(rows.map(row=>row.hit1)),recall3:mean(rows.map(row=>row.recall3)),mrr3:mean(rows.map(row=>row.mrr3)),ndcg3:mean(rows.map(row=>row.ndcg3)),meanTokens:mean(rows.map(row=>row.usedTokens)),p95RetrievalMs:percentile(rows.map(row=>row.retrievalMs),.95),leaks:rows.reduce((sum,row)=>sum+row.leaks,0)};
}));
const budgets=[180,450,900].flatMap(budgetTokens=>methods.map(method=>{
 const results=queries.map((query,index)=>{
  const result=retrieve({rows:corpus,scope:scopeFor(query),character,query:query.text,method,vectors,queryVector:{model:modelVersion,values:cache.vectors[corpus.length+index]},budgetTokens,limit:3});
  if(result.usedTokens>budgetTokens)throw new Error("Budget exceeded");return score(query,result.items.map(row=>row.memory.id));
 });return {budgetTokens,method,recall3:mean(results.map(result=>result.recall3))};
}));
const lexicalParaphrase=metrics.find(row=>row.category==="paraphrase"&&row.method==="lexical")!;
const hybridParaphrase=metrics.find(row=>row.category==="paraphrase"&&row.method==="hybrid")!;
const lexicalDirect=metrics.find(row=>row.category==="direct"&&row.method==="lexical")!;
const hybridDirect=metrics.find(row=>row.category==="direct"&&row.method==="hybrid")!;
const report={model,revision:cache.revision,runtime:"@huggingface/transformers@3.8.1",dtype:"q8",device:"cpu",dimensions:cache.vectors[0].length,cacheHit,fingerprint,corpusSize:corpus.length,queries:queries.length,rankFusion:{k:60,lexicalWeight:1,vectorWeight:1},embeddingTiming:{loadMs:cache.loadMs,documentEmbeddingMs:cache.documentEmbeddingMs,queryP50Ms:percentile(cache.queryEmbeddingMs,.5),queryP95Ms:percentile(cache.queryEmbeddingMs,.95),note:"Local first-run timings, reused when cacheHit is true; excludes network API inference because none is used."},metrics,budgets,gate:{paraphraseRecallGain:hybridParaphrase.recall3-lexicalParaphrase.recall3,directRecallLoss:lexicalDirect.recall3-hybridDirect.recall3,passes:hybridParaphrase.recall3-lexicalParaphrase.recall3>=.1&&lexicalDirect.recall3-hybridDirect.recall3<=.05&&metrics.every(row=>row.leaks===0)},details};
mkdirSync("outputs/retrieval",{recursive:true});writeFileSync("outputs/retrieval/report.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({...report,details:undefined},null,2));
