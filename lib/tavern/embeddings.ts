import type { Profile } from "./types";
import { fetchModelEndpoint } from "./model-http";
import { validateEndpoint } from "./models";
import { AppError } from "./validation";

export function supportsEmbeddings(profile:Profile){return profile.provider==="openai"||profile.provider==="compatible"||profile.provider==="gemini"}

export async function embedTexts(profile:Profile,key:string,model:string,texts:string[],task:"document"|"query"="document"):Promise<number[][]>{
 if(!supportsEmbeddings(profile))throw new AppError("该模型接口不支持向量生成，请选择 OpenAI、Gemini 或提供 embeddings 的兼容接口。");
 if(!key)throw new AppError("向量模型配置缺少 API 密钥。");
 if(!model.trim()||!texts.length||texts.length>32||texts.some(text=>!text.trim()||text.length>2000))throw new AppError("向量模型名称或输入长度不符合要求。");
 const base=validateEndpoint(profile);
 const gemini=profile.provider==="gemini";
 const modelName=model.replace(/^models\//,"");
 const url=gemini?`${base}/models/${encodeURIComponent(modelName)}:batchEmbedContents`:`${base}/embeddings`;
 const headers:Record<string,string>={"Content-Type":"application/json"};
 if(gemini)headers["x-goog-api-key"]=key;else headers.Authorization=`Bearer ${key}`;
 const body=gemini?{requests:texts.map(text=>({model:`models/${modelName}`,content:{parts:[{text}]},taskType:task==="query"?"RETRIEVAL_QUERY":"RETRIEVAL_DOCUMENT"}))}:{model,input:texts};
 let response:Response;
 try{response=await fetchModelEndpoint(url,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(45000)})}
 catch(error){if(error instanceof AppError)throw error;throw new AppError("向量模型连接失败或超时。",502)}
 if(!response.ok){await response.body?.cancel();throw new AppError(`向量模型返回 HTTP ${response.status}，请检查模型 ID、权限和额度。`,502)}
 const raw=await response.text();if(raw.length>2_000_000)throw new AppError("向量响应过长。",502);
 let data:unknown;try{data=JSON.parse(raw)}catch{throw new AppError("向量模型未返回有效 JSON。",502)}
 const record=data as {embeddings?:{values?:unknown}[];data?:{index?:number;embedding?:unknown}[]};
 const vectors=gemini?record.embeddings?.map(item=>item.values):record.data?.sort((a,b)=>(a.index??0)-(b.index??0)).map(item=>item.embedding);
 if(!vectors||vectors.length!==texts.length)throw new AppError("向量模型返回的数量与输入不一致。",502);
 const dimensions=Array.isArray(vectors[0])?vectors[0].length:0;
 if(dimensions<32||dimensions>4096||vectors.some(vector=>!Array.isArray(vector)||vector.length!==dimensions||vector.some(value=>typeof value!=="number"||!Number.isFinite(value))||vector.every(value=>value===0)))throw new AppError("向量模型返回了无效或不一致的向量。",502);
 return vectors as number[][];
}
