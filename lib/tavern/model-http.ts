import { AppError } from "./validation";

// Workers supports "manual" and "follow", but rejects "error" before sending.
// Inspect redirects ourselves so credentials are never forwarded to another URL.
export async function fetchModelEndpoint(url:string|URL,init:RequestInit):Promise<Response>{
 const response=await fetch(url,{...init,redirect:"manual"});
 if(response.status>=300&&response.status<400){
  await response.body?.cancel();
  throw new AppError(`模型接口返回重定向（HTTP ${response.status}）。请将基础地址改为服务商提供的最终 API 地址。`,502);
 }
 return response;
}
