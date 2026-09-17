import test from "node:test";
import assert from "node:assert/strict";
import { parseCharacterCard, cardIdentity } from "../lib/tavern/cards";
import { actorContext, buildPresetContext } from "../lib/tavern/engine";
import { sampleStory } from "../lib/tavern/seed";
import { storySchema } from "../lib/tavern/validation";
import { importPreset, exportPreset, compilePreset, presetSchema } from "../lib/tavern/presets";
const source=`# arbitrary custom fields\nname: 测试角色\nversion: 2\nage: 29\nidentities:\n  - 记录员\n  - 旅人\nbackground: |\n  第一行\n  第二行\ncustom:\n  nested:\n    enabled: true\n    values: [1, 2, 3]\npersonality:\n  core: [谨慎, 友善]\n`;
test("角色卡保留嵌套对象、列表、数字、多行文本及原文，支持编辑后生效",()=>{
 const parsed=parseCharacterCard(source);assert.equal(parsed.age,29);assert.equal(parsed.background,"第一行\n第二行\n");assert.deepEqual(parsed.custom,{nested:{enabled:true,values:[1,2,3]}});
 const s=sampleStory();s.characters[0].card={format:"yaml",filename:"custom.yaml",source};Object.assign(s.characters[0],cardIdentity(source));
 const saved=storySchema.parse(JSON.parse(JSON.stringify(s)));assert.equal(saved.characters[0].card?.source,source);
 assert.deepEqual(actorContext(saved.characters[0],"","").character.card,parsed);
 saved.characters[0].card!.source=source.replace("age: 29","age: 30");assert.equal(actorContext(saved.characters[0],"","").character.card?.age,30);
 assert.ok(!JSON.stringify(actorContext(saved.characters[1],"","")).includes("custom.yaml"));assert.equal(actorContext(saved.characters[1],"","").character.card.custom,undefined);
 const context=buildPresetContext("actor",saved,[],"",saved.characters[0]);assert.ok(!context.macros.description.includes('"age":30'));assert.equal(actorContext(saved.characters[0],"","").character.card.age,30);
 assert.ok(!JSON.stringify(buildPresetContext("narrator",saved,[],"")).includes('"age":30'));
});
test("角色卡拒绝错误 YAML、重复键、别名、过深嵌套和超长输入",()=>{
 for(const input of ['name: [','name: A\nname: B','name: A\na: &x [1]\nb: *x','[]','name: ""','name: A\ndata: '+"[".repeat(32)+"1"+"]".repeat(32),'name: A\ndata: '+"a".repeat(60000)])assert.throws(()=>parseCharacterCard(input));
 assert.equal(cardIdentity(JSON.stringify({spec:"chara_card_v2",data:{name:"标准卡",description:"背景",extensions:{custom:[1]}}})).name,"标准卡");
});
const fixture=JSON.stringify({temperature:0.7,prompts:[{identifier:"main",name:"开场",role:"system",content:"你是 {{char}}",enabled:true},{identifier:"chatHistory",marker:true},{identifier:"late",role:"system",content:"末尾",injection_position:1,injection_depth:0}],prompt_order:[{order:[{identifier:"main",enabled:false},{identifier:"chatHistory",enabled:true},{identifier:"late",enabled:true}]},{order:[{identifier:"main",enabled:true}]}]});
test("预设顺序组、启用状态、导出再导入及采样参数保持一致",()=>{
 const p=importPreset(fixture,"demo.json",0);assert.equal(p.entries[0].enabled,false);assert.equal(p.sampling.temperature,0.7);
 const roundtrip=importPreset(JSON.stringify(exportPreset(p)),"demo.json");assert.deepEqual(roundtrip.entries,p.entries);assert.deepEqual(roundtrip.sampling,p.sampling);
 const group=importPreset(fixture,"demo.json",1);assert.equal(group.entries[0].enabled,true);assert.equal(group.entries[1].enabled,false);
 const story=sampleStory();const context=buildPresetContext("actor",story,[],"眼前信息",story.characters[0]);const compiled=compilePreset(p,context);assert.deepEqual(compiled.messages.map(m=>m.content),["眼前信息","末尾"]);
 p.entries[0].enabled=true;assert.ok(compilePreset(p,context).messages[0].content.includes("林晚"));
 assert.equal(presetSchema.safeParse({...p,entries:[p.entries[0],p.entries[0]]}).success,false);
});
