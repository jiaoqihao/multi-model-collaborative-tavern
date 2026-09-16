"use client";
import { readCardMemory, type CharacterCard } from "@/lib/tavern/cards";

export function CardMemoryView({card}:{card?:CharacterCard}) {
 if(!card)return <p className="aside-notice">下一回合会自动建立角色卡并保存记忆。</p>;
 let memory;
 try{memory=readCardMemory(card)}catch{return <p className="aside-notice">角色卡记忆格式有误，请在角色编辑器中检查。</p>}
 if(!memory)return <p className="aside-notice">角色卡已载入，经历新回合后会自动更新记忆。</p>;
 return <section className="card-memory-view"><div className="profile-status">角色卡记忆 <span>{memory.mode==="model"?"主 AI 已更新":"规则演示记录"}</span></div><p className="aside-notice">更新回合 · {memory.updatedTurnId.slice(0,6)}</p><p className="card-memory-summary">{memory.summary}</p>{([["已知事实",memory.facts],["个人判断",memory.beliefs],["待办线索",memory.openThreads]] as const).map(([label,items])=>items.length>0&&<details key={label}><summary>{label} · {items.length}</summary><ul>{items.map((item,i)=><li key={i}>{item}</li>)}</ul></details>)}</section>;
}
