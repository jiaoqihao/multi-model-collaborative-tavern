import type { Profile } from "./types";
import { AppError } from "./validation";
import type { ChatMessage, Sampling } from "./presets";
import { fetchModelEndpoint } from "./model-http";
export type ModelOptions = {messages:ChatMessage[];sampling:Sampling};
export const endpoints={openai:"https://api.openai.com/v1",compatible:"https://api.deepseek.com/v1",anthropic:"https://api.anthropic.com/v1",gemini:"https://generativelanguage.googleapis.com/v1beta"};
export function validateEndpoint(profile:Profile){
 const url=new URL(profile.baseUrl);
 if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.port||!url.hostname.includes(".")||/^[\d.]+$/.test(url.hostname)||url.hostname.includes(":")||/(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname))throw new AppError("请使用公开的 HTTPS API 地址，不支持本机、内网、端口或带凭据的地址。");
 if(profile.provider!=="compatible" && url.origin!==new URL(endpoints[profile.provider]).origin)throw new AppError("原生接口仅支持对应官方地址；中转服务请选择 OpenAI 兼容协议。");
 return url.toString().replace(/\/$/,"");
}
type Responder=(profile:Profile,key:string,system:string,prompt:string,options?:ModelOptions)=>Promise<string>;
export const complete:Responder=async(profile,key,system,prompt,options)=>{
 if(!key)throw new AppError(`模型「${profile.name}」尚未填写 API 密钥。`);
 const base=validateEndpoint(profile); let url="",headers:Record<string,string>={"Content-Type":"application/json"}; let body:unknown;
 const messages:ChatMessage[]=[...(options?.messages||[]),{role:"system",content:system},{role:"user",content:prompt}];
 const sampling=options?.sampling||{};
 const common={...(sampling.temperature!==undefined?{temperature:sampling.temperature}:{}),...(sampling.topP!==undefined?{top_p:sampling.topP}:{})};
 const mergedSystem=messages.filter(m=>m.role==="system").map(m=>m.content).join("\n\n");
 const conversation=messages.filter(m=>m.role!=="system");
 if(profile.provider==="anthropic") {url=base+"/messages";headers={...headers,"x-api-key":key,"anthropic-version":"2023-06-01"};if(conversation[0]?.role==="assistant")conversation.unshift({role:"user",content:"以下是提供的上下文。"});body={model:profile.model,max_tokens:sampling.maxTokens??5000,system:mergedSystem,messages:conversation,...(sampling.temperature!==undefined?{temperature:Math.min(sampling.temperature,1)}:sampling.topP!==undefined?{top_p:sampling.topP}:{})};}
 else if(profile.provider==="gemini"){url=base+"/models/"+encodeURIComponent(profile.model.replace(/^models\//,""))+":generateContent";headers["x-goog-api-key"]=key;body={systemInstruction:{parts:[{text:mergedSystem}]},contents:conversation.map(m=>({role:m.role==="assistant"?"model":"user",parts:[{text:m.content}]})),generationConfig:{maxOutputTokens:sampling.maxTokens??6000,...(sampling.temperature!==undefined?{temperature:sampling.temperature}:{}),...(sampling.topP!==undefined?{topP:sampling.topP}:{})}};}
 else{url=base+"/chat/completions";headers.Authorization="Bearer "+key;body={model:profile.model,messages,...common,...(sampling.frequencyPenalty!==undefined?{frequency_penalty:sampling.frequencyPenalty}:{}),...(sampling.presencePenalty!==undefined?{presence_penalty:sampling.presencePenalty}:{}),...(profile.provider==="openai"?{max_completion_tokens:sampling.maxTokens??6000}:{max_tokens:sampling.maxTokens??5000})};}
 for(let attempt=0;attempt<2;attempt++){
  let response:Response;
  try{response=await fetchModelEndpoint(url,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(65000)});}catch(error){if(error instanceof AppError)throw error;throw new AppError(`「${profile.name}」连接失败或超时。本轮尚未保存，请检查地址后重试。`,502);}
  if((response.status===429||response.status>=500)&&attempt===0){await response.body?.cancel();await new Promise(r=>setTimeout(r,700));continue;}
  if(!response.ok){await response.body?.cancel();throw new AppError(`「${profile.name}」返回 HTTP ${response.status}。请检查密钥、模型权限、额度与 API 地址。`,502);}
  const raw=await response.text();if(raw.length>500000)throw new AppError("模型响应过长",502);
  let data;try{data=JSON.parse(raw)}catch{throw new AppError("模型接口未返回有效 JSON 响应",502)}
  const finish=profile.provider==="anthropic"?data?.stop_reason:profile.provider==="gemini"?data?.candidates?.[0]?.finishReason:data?.choices?.[0]?.finish_reason;
  if(["length","max_tokens","MAX_TOKENS"].includes(finish))throw new AppError(`「${profile.name}」输出达到 token 上限，内容可能被截断，本轮未保存。请提高该阶段预设的最大输出 token 数或缩短输出要求；推理模型的思考也可能占用此额度。`,502);
  const text=profile.provider==="anthropic"?data?.content?.filter((c:{type:string})=>c.type==="text").map((c:{text:string})=>c.text).join("\n"):profile.provider==="gemini"?data?.candidates?.[0]?.content?.parts?.filter((p:{thought?:boolean})=>!p.thought).map((p:{text?:string})=>p.text||"").join("\n"):data?.choices?.[0]?.message?.content;
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
