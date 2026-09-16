"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
export function EditorSelect({label,value,onChange,options,disabled=false}:{label:string;value:string;onChange:(v:string)=>void;options:{value:string;label:string}[];disabled?:boolean}) {
 return <label className="field"><span>{label}</span><Select disabled={disabled} value={value||"__none"} onValueChange={v=>onChange(v==="__none"?"":v)}><SelectTrigger aria-label={label} className="w-full"><SelectValue/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value||"__none"} value={o.value||"__none"}>{o.label}</SelectItem>)}</SelectContent></Select></label>;
}
export function downloadText(name:string,content:string,type="application/json") {
 const url=URL.createObjectURL(new Blob([content],{type})); const link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
