import { mkdirSync, writeFileSync } from "node:fs";
import { runTurn } from "../lib/tavern/engine";
import { sampleStory } from "../lib/tavern/seed";

// Acceptance probes retained for the original economy-memory length failures.
// Inputs are valid settlement outputs but exercise downstream economy memory limits.
const results=[];
for(const spec of [{name:"economy-event-400",length:400,count:1,thread:0},{name:"economy-event-401",length:401,count:1,thread:0},{name:"economy-summary-1202",length:400,count:3,thread:0},{name:"economy-thread-401",length:20,count:1,thread:401}]){
 const story=sampleStory();story.characters=[story.characters[0]];story.collaborationMode="economy";
 const before=JSON.stringify(story);
 try{
  await runTurn({story,history:[],input:"测试事件",mode:"roleplay",directorId:"mock",turnId:"boundary",call:async(_id,system)=>{
   if(system.includes("信息分发"))return JSON.stringify({deliveries:[]});
   if(system.includes("协调实际事件"))return JSON.stringify({events:Array.from({length:spec.count},()=>({description:"事".repeat(spec.length),visibleTo:["lin"],visibleToPlayer:true})),changes:[],threads:spec.thread?[{action:"open",description:"约".repeat(spec.thread),characterIds:["lin"]}]:[]});
   return JSON.stringify({narrative:"测试旁白。"});
  }});
  results.push({name:spec.name,status:"pass",sourceUnchanged:JSON.stringify(story)===before});
 }catch(error){
  const issues=(error as {issues?:{path:(string|number)[];code:string;maximum?:number}[]}).issues?.map(({path,code,maximum})=>({path,code,maximum}));
  results.push({name:spec.name,status:"fail",sourceUnchanged:JSON.stringify(story)===before,issues});
 }
}
mkdirSync("outputs/live-tests",{recursive:true});writeFileSync("outputs/live-tests/boundaries.json",JSON.stringify(results,null,2)+"\n");
console.log(JSON.stringify(results,null,2));if(results.some(r=>r.status==="fail"))process.exitCode=1;
