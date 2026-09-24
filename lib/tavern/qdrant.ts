import { AppError } from "./validation";

export type QdrantConnection={baseUrl:string;apiKey:string};
export type QdrantPoint={id:string;vector:readonly number[];payload:Record<string,string>};
export type QdrantHit={id:string;score:number;payload:Record<string,unknown>};

export function validateQdrantUrl(value:string){
 let url:URL;try{url=new URL(value)}catch{throw new AppError("Qdrant 地址无效。");}
 if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||!url.hostname.endsWith(".cloud.qdrant.io")||!(["","443","6333"].includes(url.port))||!(url.pathname==="/"||url.pathname===""))throw new AppError("请使用 Qdrant Cloud 的 HTTPS 实例地址，仅支持 443 或 6333 端口，不带路径或凭据。");
 return url.origin;
}
export function collectionName(dimensions:number){if(!Number.isInteger(dimensions)||dimensions<32||dimensions>4096)throw new AppError("向量维度不受支持。");return `mytavern_memory_${dimensions}`}
export async function qdrantPointId(parts:string[]){const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(parts)))),byte=>byte.toString(16).padStart(2,"0")).join("");return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`}

async function request(connection:QdrantConnection,path:string,method:"GET"|"PUT"|"POST",body?:unknown,allow404=false){
 const base=validateQdrantUrl(connection.baseUrl);if(!connection.apiKey)throw new AppError("Qdrant 连接缺少 API 密钥。");
 let response:Response;try{response=await fetch(base+path,{method,headers:{"Content-Type":"application/json","api-key":connection.apiKey},body:body===undefined?undefined:JSON.stringify(body),redirect:"manual",signal:AbortSignal.timeout(30000)})}
 catch{throw new AppError("Qdrant 连接失败或超时。",502)}
 if(response.status>=300&&response.status<400){await response.body?.cancel();throw new AppError("Qdrant 接口发生重定向，请填写最终服务地址。",502)}
 if(response.status===404&&allow404){await response.body?.cancel();return undefined}
 if(!response.ok){await response.body?.cancel();throw new AppError(`Qdrant 返回 HTTP ${response.status}，请检查地址、密钥和权限。`,502)}
 const raw=await response.text();if(raw.length>4_000_000)throw new AppError("Qdrant 响应过长。",502);
 try{return JSON.parse(raw) as {result?:unknown;status?:string}}catch{throw new AppError("Qdrant 未返回有效 JSON。",502)}
}

export async function testQdrantConnection(connection:QdrantConnection){const data=await request(connection,"/collections","GET");if(!Array.isArray((data?.result as {collections?:unknown})?.collections))throw new AppError("Qdrant 连接成功，但集合列表结构无效。",502);return {ok:true}}

export async function ensureQdrantCollection(connection:QdrantConnection,dimensions:number){
 const name=collectionName(dimensions);const path=`/collections/${name}`;const existing=await request(connection,path,"GET",undefined,true);
 if(!existing){await request(connection,path,"PUT",{vectors:{size:dimensions,distance:"Cosine"}});return name}
 const vectors=(existing.result as {config?:{params?:{vectors?:unknown}}})?.config?.params?.vectors as {size?:unknown;distance?:unknown}|undefined;
 if(vectors?.size!==dimensions||String(vectors?.distance).toLowerCase()!=="cosine")throw new AppError(`Qdrant 集合 ${name} 的维度或距离算法不匹配。`);
 return name;
}

export async function upsertQdrantPoints(connection:QdrantConnection,points:QdrantPoint[]){
 if(!points.length)return;const dimensions=points[0].vector.length;
 if(points.length>32||points.some(point=>point.vector.length!==dimensions||point.vector.some(value=>!Number.isFinite(value))))throw new AppError("待写入的向量无效。");
 const collection=await ensureQdrantCollection(connection,dimensions);
 const data=await request(connection,`/collections/${collection}/points?wait=true`,"PUT",{points});
 if((data?.result as {status?:string})?.status!=="completed")throw new AppError("Qdrant 尚未确认向量写入完成。",502);
}

export async function retrieveQdrantPoints(connection:QdrantConnection,dimensions:number,ids:string[]){
 if(!ids.length)return new Map<string,Record<string,unknown>>();
 const collection=await ensureQdrantCollection(connection,dimensions);
 const found=new Map<string,Record<string,unknown>>();
 for(let start=0;start<ids.length;start+=128){
  const data=await request(connection,`/collections/${collection}/points`,"POST",{ids:ids.slice(start,start+128),with_payload:true,with_vector:false});
  if(!Array.isArray(data?.result))throw new AppError("Qdrant 点查询结果结构无效。",502);
  for(const point of data.result){if(point&&typeof point==="object"&&typeof point.id==="string"&&point.payload&&typeof point.payload==="object")found.set(point.id,point.payload as Record<string,unknown>)}
 }
 return found;
}

export async function queryQdrantPoints(connection:QdrantConnection,vector:readonly number[],allowedPointIds:string[],scope:{owner:string;storyId:string;characterId:string;modelKey:string},limit=64):Promise<QdrantHit[]>{
 if(!allowedPointIds.length)return [];
 const collection=await ensureQdrantCollection(connection,vector.length);
 const filter={must:[{key:"owner",match:{value:scope.owner}},{key:"storyId",match:{value:scope.storyId}},{key:"characterId",match:{value:scope.characterId}},{key:"modelKey",match:{value:scope.modelKey}},{has_id:allowedPointIds}]};
 const data=await request(connection,`/collections/${collection}/points/query`,"POST",{query:vector,filter,limit:Math.min(64,Math.max(1,limit)),with_payload:true,with_vector:false});
 const points=(data?.result as {points?:unknown})?.points;
 if(!Array.isArray(points))throw new AppError("Qdrant 检索结果结构无效。",502);
 const allowed=new Set(allowedPointIds);
 return points.filter((point):point is QdrantHit=>!!point&&typeof point==="object"&&typeof point.id==="string"&&allowed.has(point.id)&&typeof point.score==="number"&&Number.isFinite(point.score)&&!!point.payload&&typeof point.payload==="object"&&point.payload.owner===scope.owner&&point.payload.storyId===scope.storyId&&point.payload.characterId===scope.characterId&&point.payload.modelKey===scope.modelKey);
}
