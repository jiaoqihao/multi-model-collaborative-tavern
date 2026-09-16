"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from "@/components/ui/combobox";
import type { ModelDiscoveryInput, ModelList, AvailableModel } from "@/lib/tavern/model-discovery";

type Connection=ModelDiscoveryInput & {hasKey?:boolean;model:string};
function sameConnection(a:Connection,b:Connection){return a.id===b.id&&a.provider===b.provider&&a.baseUrl===b.baseUrl&&a.apiKey===b.apiKey&&a.clearKey===b.clearKey&&a.hasKey===b.hasKey}
export function ModelDiscovery({profile,disabled,onSelect}:{profile:Connection;disabled:boolean;onSelect:(model:string)=>void}) {
 const [result,setResult]=useState<{connection:Connection;loading:boolean;models:AvailableModel[];error:string}|null>(null);
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[profile.id,profile.provider,profile.baseUrl,profile.apiKey,profile.clearKey,profile.hasKey]);
 const current=result&&sameConnection(result.connection,profile)?result:null;
 const models=current?.models||[];const loading=!!current?.loading;
 const hasKey=!!profile.apiKey?.trim()||!!profile.hasKey&&!profile.clearKey;
 async function discover(){
  controller.current?.abort();const requestController=new AbortController();controller.current=requestController;
  const connection={...profile};setResult({connection,loading:true,models:[],error:""});
  try{
   const response=await fetch("/api/tavern",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"listModels",connection:{id:profile.id,provider:profile.provider,baseUrl:profile.baseUrl,apiKey:profile.apiKey,clearKey:profile.clearKey}}),signal:requestController.signal});
   const data=await response.json() as ModelList & {error?:string};if(!response.ok)throw new Error(data.error||"获取模型列表失败。");
   if(!requestController.signal.aborted)setResult({connection,loading:false,models:data.models,error:""});
  }catch(error){if(!requestController.signal.aborted)setResult({connection,loading:false,models:[],error:(error as Error).message})}
  finally{if(requestController.signal.aborted)setResult(previous=>previous?.connection===connection?null:previous)}
 }
 return <section className="model-discovery" aria-label="获取服务商模型"><div className="form-buttons"><Button type="button" variant="outline" disabled={disabled||loading||!profile.baseUrl.trim()||!hasKey} onClick={()=>void discover()}>{loading?<LoaderCircle size={16} className="spin"/>:<RefreshCw size={16}/>} {loading?"正在获取模型…":"获取可用模型"}</Button></div><p className="form-help">填写基础地址和 API 密钥即可获取，无需先保存配置。已保存的密钥留空可复用。</p>
 {current?.error&&<p className="error-banner" role="alert">{current.error}</p>}
 {current&&!loading&&!current.error&&<p className="success-message" role="status">{models.length?`已获取 ${models.length} 个模型，可搜索名称或 ID 后选择。`:"服务商没有返回可用模型，可在下方手动填写 ID。"}</p>}
 {models.length>0&&<div className="field"><span>从服务商模型列表选择</span><Combobox items={models} disabled={disabled} value={models.find(m=>m.id===profile.model)||null} itemToStringLabel={m=>m.name===m.id?m.id:`${m.name} · ${m.id}`} itemToStringValue={m=>m.id} isItemEqualToValue={(a,b)=>a.id===b.id} onValueChange={m=>{if(m)onSelect(m.id)}}><ComboboxInput aria-label="搜索并选择模型" placeholder="搜索模型名称或 ID" className="w-full"/><ComboboxContent><ComboboxEmpty>没有匹配的模型</ComboboxEmpty><ComboboxList>{(m:AvailableModel)=><ComboboxItem key={m.id} value={m} disabled={m.id.length>150}><span className="model-option"><span>{m.name}</span>{m.name!==m.id&&<small>{m.id}</small>}{m.id.length>150&&<small>模型 ID 超过当前支持的 150 字符</small>}</span></ComboboxItem>}</ComboboxList></ComboboxContent></Combobox></div>}
 {models.length>0&&<p className="form-help">列表以服务商返回为准；部分模型可能不支持聊天，保存后可测试连接。你也可以手动填写模型 ID。</p>}</section>;
}
