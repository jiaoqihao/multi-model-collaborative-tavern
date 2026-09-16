"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cardIdentity, parseCharacterCard, readCardMemory, type CharacterCard } from "@/lib/tavern/cards";
import { downloadText } from "./editor-controls";

export function CardEditor({card,onChange,onValidity}:{card?:CharacterCard;onChange:(card:CharacterCard|undefined,identity?:{name:string;role:string})=>void;onValidity:(valid:boolean)=>void}) {
 const [source,setSource]=useState(card?.source||"");const [filename,setFilename]=useState(card?.filename||"角色卡.yaml");const [fileError,setFileError]=useState("");
 const parsed=useMemo(()=>{if(!source)return {keys:[],error:""};try{readCardMemory({format:"yaml",filename:"card.yaml",source});return {keys:Object.keys(parseCharacterCard(source)),error:""}}catch(e){return {keys:[],error:(e as Error).message}}},[source]);
 function change(text:string,name=filename){setSource(text);setFilename(name);setFileError("");if(!text){onValidity(true);onChange(undefined);return}try{readCardMemory({format:"yaml",filename:name,source:text});const identity=cardIdentity(text);onChange({source:text,filename:name,format:/\.json$/i.test(name)?"json":"yaml"},identity);onValidity(true)}catch{onValidity(false)}}
 return <section className="card-editor"><div className="profile-status">角色卡 <span>{source.length.toLocaleString()} / 60,000 字符</span></div><p className="form-help">每次回应会读取最新卡片，回合结束后主 AI 自动更新 mytavern_memory 记忆区。原有背景字段保留；你也可以编辑原文并保存，下一回合生效。导出包含最新记忆，电脑上的原文件不会自动改写。</p>
 <label className="field"><span>导入角色卡文件</span><input type="file" accept=".yaml,.yml,.json" onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;if(file.size>256*1024){setFileError("角色卡文件超过 256 KB。");return}try{change(await file.text(),file.name.slice(0,180))}catch{setFileError("文件读取失败。")}}}/></label>
 {(source||card)&&<><label className="field"><span>角色卡原文 · {filename}</span><textarea className="source-editor" rows={18} spellCheck={false} value={source} onChange={e=>change(e.target.value)} aria-label="角色卡原文"/></label>{parsed.error?<p className="error-banner" role="alert">{parsed.error}</p>:<p className="success-message" role="status">格式有效 · {parsed.keys.length} 个顶层字段，嵌套对象和列表均保留</p>}<div className="form-buttons"><Button variant="outline" type="button" disabled={!!parsed.error} onClick={()=>downloadText(filename,source,"text/plain;charset=utf-8")}>导出角色卡</Button><Button variant="ghost" type="button" onClick={()=>change("")}>移除草稿中的角色卡</Button></div></>}
 {fileError&&<p role="alert" className="error-banner">{fileError}</p>}</section>;
}
