"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { VectorConnection, Workspace } from "@/lib/tavern/types";

type Draft={id?:string;revision?:number;name:string;baseUrl:string;apiKey:string};
const blank=():Draft=>({name:"",baseUrl:"",apiKey:""});

export function VectorConnectionManager({workspace,onRefresh}:{workspace:Workspace;onRefresh:(next:Workspace)=>void}){
 const [draft,setDraft]=useState<Draft>(blank);
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("");
 const [error,setError]=useState("");
 const selected=workspace.vectorConnections.find(connection=>connection.id===draft.id);
 const choose=(connection?:VectorConnection)=>{setDraft(connection?{id:connection.id,revision:connection.revision,name:connection.name,baseUrl:connection.baseUrl,apiKey:""}:blank());setStatus("");setError("")};
 const call=async(body:Record<string,unknown>)=>{const response=await fetch("/api/tavern",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,storyId:workspace.id})});const data=await response.json() as Workspace&{error?:string};if(!response.ok)throw new Error(data.error||"操作失败，请重试。");return data};
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError("");setStatus("");try{await fn()}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}};
 return <section className="vector-connections" aria-label="Qdrant 向量数据库">
  <h3>Qdrant 向量数据库</h3>
  <p className="form-help">可选。先在 Qdrant Cloud 创建实例，再保存 HTTPS 地址与 API 密钥；故事里仍需单独选择支持 embeddings 的模型。</p>
  <div className="model-list">{workspace.vectorConnections.map(connection=><button type="button" className={selected?.id===connection.id?"active":""} key={connection.id} onClick={()=>choose(connection)}>{connection.name}<small>{connection.baseUrl}</small></button>)}<button type="button" onClick={()=>choose()}>添加 Qdrant 连接</button></div>
  <form className="editor-form" onSubmit={event=>{event.preventDefault();void run(async()=>{const data=await call({action:"saveVectorConnection",connection:draft});onRefresh(data);const saved=data.vectorConnections.find(connection=>connection.id===draft.id)||data.vectorConnections.find(connection=>!workspace.vectorConnections.some(old=>old.id===connection.id));if(saved)choose(saved);setStatus("Qdrant 连接已保存。")})}}>
   <label className="field"><span>连接名称</span><input value={draft.name} maxLength={80} onChange={event=>setDraft({...draft,name:event.target.value})} placeholder="例如：我的 Qdrant Cloud" required/></label>
   <label className="field"><span>Qdrant HTTPS 地址</span><input value={draft.baseUrl} onChange={event=>setDraft({...draft,baseUrl:event.target.value,apiKey:event.target.value===selected?.baseUrl?draft.apiKey:""})} placeholder="https://xxxx.cloud.qdrant.io:6333" required/></label>
   <label className="field"><span>{selected?.hasKey?"API 密钥（留空保留）":"API 密钥"}</span><input type="password" autoComplete="new-password" value={draft.apiKey} onChange={event=>setDraft({...draft,apiKey:event.target.value})} required={!selected?.hasKey}/></label>
   <div className="form-buttons"><Button type="submit" disabled={busy}>保存连接</Button><Button type="button" variant="outline" disabled={busy||!selected} onClick={()=>void run(async()=>{await call({action:"testVectorConnection",connectionId:selected!.id});setStatus("Qdrant 连接测试成功。")})}>测试连接</Button>{selected&&<Button type="button" variant="ghost" disabled={busy} onClick={()=>void run(async()=>{const data=await call({action:"deleteVectorConnection",connectionId:selected.id,connectionRevision:selected.revision});onRefresh(data);choose();setStatus("连接已删除，远端向量数据未删除。")})}>删除连接</Button>}</div>
   {status&&<p role="status" className="success-message">{status}</p>}{error&&<p role="alert" className="error-message">{error}</p>}
  </form>
 </section>;
}
