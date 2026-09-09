import type { Profile } from "./types";
import { AppError } from "./validation";
export const endpoints={openai:"https://api.openai.com/v1",compatible:"https://api.deepseek.com/v1",anthropic:"https://api.anthropic.com/v1",gemini:"https://generativelanguage.googleapis.com/v1beta"};
export function validateEndpoint(profile:Profile){
 const url=new URL(profile.baseUrl);
 if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.port||!url.hostname.includes(".")||/^[\d.]+$/.test(url.hostname)||url.hostname.includes(":")||/(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname))throw new AppError("请使用公开的 HTTPS API 地址，不支持本机、内网、端口或带凭据的地址。");
 if(profile.provider!=="compatible" && url.origin!==new URL(endpoints[profile.provider]).origin)throw new AppError("原生接口仅支持对应官方地址；中转服务请选择 OpenAI 兼容协议。");
 return url.toString().replace(/\/$/,"");
}
type Responder=(profile:Profile,key:string,system:string,prompt:string)=>Promise<string>;
export const complete:Responder=async(profile,key,system,prompt)=>{
 if(!key)throw new AppError(`模型「${profile.name}」尚未填写 API 密钥。`);
 const base=validateEndpoint(profile); let url="",headers:Record<string,string>={"Content-Type":"application/json"}; let body:unknown;
 if(profile.provider==="anthropic") {url=base+"/messages";headers={...headers,"x-api-key":key,"anthropic-version":"2023-06-01"};body={model:profile.model,max_tokens:5000,system,messages:[{role:"user",content:prompt}]};}
 else if(profile.provider==="gemini"){url=base+"/models/"+encodeURIComponent(profile.model.replace(/^models\//,""))+":generateContent";headers["x-goog-api-key"]=key;body={systemInstruction:{parts:[{text:system}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:6000}};}
 else{url=base+"/chat/completions";headers.Authorization="Bearer "+key;body={model:profile.model,messages:[{role:"system",content:system},{role:"user",content:prompt}],...(profile.provider==="openai"?{max_completion_tokens:6000}:{max_tokens:5000})};}
 for(let attempt=0;attempt<2;attempt++){
  let response:Response;
  try{response=await fetch(url,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(65000),redirect:"error"});}catch{throw new AppError(`「${profile.name}」连接失败或超时。本轮尚未保存，请检查地址后重试。`,502);}
  if((response.status===429||response.status>=500)&&attempt===0){await response.body?.cancel();await new Promise(r=>setTimeout(r,700));continue;}
  if(!response.ok){await response.body?.cancel();throw new AppError(`「${profile.name}」返回 HTTP ${response.status}。请检查密钥、模型权限、额度与 API 地址。`,502);}
  const raw=await response.text();if(raw.length>500000)throw new AppError("模型响应过长",502);
  let data;try{data=JSON.parse(raw)}catch{throw new AppError("模型接口未返回有效 JSON 响应",502)}
  const text=profile.provider==="anthropic"?data.content?.filter((c:{type:string})=>c.type==="text").map((c:{text:string})=>c.text).join("\n"):profile.provider==="gemini"?data.candidates?.[0]?.content?.parts?.filter((p:{thought?:boolean})=>!p.thought).map((p:{text?:string})=>p.text||"").join("\n"):data.choices?.[0]?.message?.content;
  if(typeof text!=="string"||!text.trim())throw new AppError("模型返回空内容或拒绝生成，本轮未保存。",502);
  return text;
 }
 throw new AppError("模型暂时不可用",502);
};
export async function cryptKey(value:string,secret:string,decrypt=false):Promise<string>{
 if(!secret||secret.length<32)throw new AppError("服务端尚未配置密钥加密参数，请查看项目启动说明。",503);
 const key=await crypto.subtle.importKey("raw",await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret)),{name:"AES-GCM"},false,["encrypt","decrypt"]);
 if(decrypt){const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes.slice(0,12)},key,bytes.slice(12)));}
 const iv=crypto.getRandomValues(new Uint8Array(12));const data=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(value)));const merged=new Uint8Array(iv.length+data.length);merged.set(iv);merged.set(data,12);return btoa(String.fromCharCode(...merged));
}
