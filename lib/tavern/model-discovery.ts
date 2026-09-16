import { z } from "zod";
import { AppError, profileSchema } from "./validation";
import { cryptKey, validateEndpoint } from "./models";
import type { Profile } from "./types";
import { fetchModelEndpoint } from "./model-http";

export const modelDiscoverySchema=profileSchema.pick({id:true,provider:true,baseUrl:true,apiKey:true,clearKey:true}).extend({id:z.string().max(100).default("")});
export type ModelDiscoveryInput=z.infer<typeof modelDiscoverySchema>;
export type AvailableModel={id:string;name:string};
export type ModelList={models:AvailableModel[]};
type StoredProfile={data:string;encrypted_key:string};
function endpoint(input:Pick<Profile,"provider"|"baseUrl">){return validateEndpoint({...input,id:"",name:"模型列表",model:""})}
export async function discoveryKey(input:ModelDiscoveryInput,stored:StoredProfile|undefined,secret:()=>string):Promise<string>{
 const base=endpoint(input);
 if(input.apiKey?.trim())return input.apiKey.trim();
 if(input.clearKey||!stored?.encrypted_key)throw new AppError("请先填写 API 密钥，再获取模型列表。");
 const previous=JSON.parse(stored.data) as Profile;
 if(previous.provider!==input.provider||endpoint(previous)!==base)throw new AppError("基础地址或协议已改变，请重新填写 API 密钥。");
 return cryptKey(stored.encrypted_key,secret(),true);
}
async function readJson(response:Response){
 const reader=response.body?.getReader();if(!reader)throw new AppError("服务商返回了空的模型列表响应。",502);
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw new AppError("服务商模型列表响应超过 2 MB，请手动填写模型 ID。",502);chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength}
 try{return JSON.parse(new TextDecoder().decode(bytes)) as Record<string,unknown>}catch{throw new AppError("服务商未返回有效的模型列表 JSON，请检查基础地址。",502)}
}
export async function listAvailableModels(input:Pick<Profile,"provider"|"baseUrl">,key:string,clientSignal?:AbortSignal):Promise<ModelList>{
 const base=endpoint(input);if(!key.trim())throw new AppError("请先填写 API 密钥。");
 const headers:Record<string,string>={Accept:"application/json"};
 if(input.provider==="anthropic"){headers["x-api-key"]=key;headers["anthropic-version"]="2023-06-01"}
 else if(input.provider==="gemini")headers["x-goog-api-key"]=key;
 else headers.Authorization="Bearer "+key;
 const timeout=AbortSignal.timeout(45000);const signal=clientSignal?AbortSignal.any([timeout,clientSignal]):timeout;
 const found=new Map<string,AvailableModel>();const cursors=new Set<string>();let cursor="";
 for(let page=0;page<100;page++){
  const url=new URL(base+"/models");
  if(input.provider==="gemini"){url.searchParams.set("pageSize","1000");if(cursor)url.searchParams.set("pageToken",cursor)}
  else if(input.provider==="anthropic"){url.searchParams.set("limit","1000");if(cursor)url.searchParams.set("after_id",cursor)}
  else if(cursor)url.searchParams.set("after",cursor);
  let response:Response;
  try{response=await fetchModelEndpoint(url,{method:"GET",headers,signal})}catch(error){
   if(error instanceof AppError)throw error;
   if(signal.aborted)throw new AppError(timeout.aborted?"获取模型列表超过 45 秒，请检查网络后重试。":"模型列表请求已取消，请重新获取。",502);
   throw new AppError("无法连接模型列表接口，请检查基础地址、网络和服务商状态。",502);
  }
  if(!response.ok){await response.body?.cancel();const message=response.status===401||response.status===403?"密钥无效或没有读取模型列表的权限。":response.status===404||response.status===405?"此地址不支持模型列表接口，请确认基础地址，或手动填写模型 ID。":response.status===429?"服务商请求过于频繁，请稍后重试。":`服务商模型列表接口返回 HTTP ${response.status}，请稍后重试。`;throw new AppError(message,502)}
  let data:Record<string,unknown>;try{data=await readJson(response)}catch(error){if(error instanceof AppError)throw error;throw new AppError("模型列表读取中断或超时，请重试。",502)}
  if(!data||typeof data!=="object"||Array.isArray(data))throw new AppError("服务商模型列表结构不受支持，请手动填写模型 ID。",502);
  const entries=input.provider==="gemini"?data.models:data.data;
  if(!Array.isArray(entries))throw new AppError("服务商未返回 models / data 数组，请检查基础地址。",502);
  for(const item of entries){
   if(!item||typeof item!=="object")continue;
   const id=input.provider==="gemini"?item.name:item.id;
   if(typeof id!=="string"||!id.trim())continue;
   // Gemini advertises capabilities; show only models usable by this app's generateContent adapter.
   if(input.provider==="gemini"&&Array.isArray(item.supportedGenerationMethods)&&!item.supportedGenerationMethods.includes("generateContent"))continue;
   const modelId=input.provider==="gemini"?id.replace(/^models\//,""):id;
   const name=typeof item.display_name==="string"?item.display_name:typeof item.displayName==="string"?item.displayName:typeof item.name==="string"&&input.provider!=="gemini"?item.name:modelId;
   found.set(modelId,{id:modelId,name});
  }
  if(found.size>20000)throw new AppError("服务商返回的模型数量过多，请手动填写模型 ID。",502);
  let next="";
  if(input.provider==="gemini")next=typeof data.nextPageToken==="string"?data.nextPageToken:"";
  else if(data.has_more===true){const id=data.last_id||(entries.at(-1) as {id?:unknown}|undefined)?.id;if(typeof id!=="string"||!id)throw new AppError("模型列表分页信息不完整，请手动填写模型 ID。",502);next=id;}
  if(!next)return {models:[...found.values()].sort((a,b)=>a.id.localeCompare(b.id))};
  if(cursors.has(next))throw new AppError("服务商重复返回同一页模型，无法获取完整列表。",502);
  cursors.add(next);cursor=next;
 }
 throw new AppError("模型列表分页过多，无法获取完整列表，请手动填写模型 ID。",502);
}
