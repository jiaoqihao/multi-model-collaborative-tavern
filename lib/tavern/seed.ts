import type { Character, StoryState } from "./types";

export function blankCharacter(): Character { return {
  id: crypto.randomUUID(), name: "新角色", role: "", persona: "", secret: "", color: "gray", modelId: "default", presetId: "inherit",
  state: {location:"当前场景",clothing:"日常服饰",condition:"健康",emotion:"平静",thought:"",goal:"",relationship:"初次见面"}, memories: []
}; }

export function initialStory(): StoryState { return {
  playerState:{location:"当前场景",clothing:"日常服饰",condition:"健康",inventory:""},
  title: "未命名故事", world: "", player: "我", playerPersona: "", style: "第二人称有限视角。不要替玩家决定重大行动、台词或内心。",
  opening: "故事尚未开始。请先设定舞台，或直接写下你的第一步。",
  presetSelection:{director:"",actor:"",settlement:"",narrator:"",memory:""}, stageModels:{settlement:"",narrator:"",memory:""}, collaborationMode:"balanced", retrieval:{mode:"lexical",embeddingProfileId:"",embeddingModel:"",backend:"d1",vectorConnectionId:""}, context:{threads:[],sceneSummaries:[],chapterSummaries:[]}, characters: []
}; }

/** Rich fixture for tests and explicit demos that need a cast. */
export function sampleStory(): StoryState { return {
  playerState:{location:"夜航酒馆 · 门前",clothing:"沾着雨水的旅行外套",condition:"健康",inventory:"一封尚未拆开的旧信"},
  title: "雨夜来信", world: "架空的港口城市雾港。深秋，旧城区的夜航酒馆。故事以人物对话、秘密与缓慢建立的信任为中心，没有预设结局。", player: "旅人", playerPersona: "刚抵达雾港的旅人，随身带着一封尚未拆开的旧信。行动和内心由玩家决定。", style: "第二人称有限视角，克制、细腻、有画面感。每轮约 300–600 字，停在适合玩家回应的位置。不得透露未被玩家感知的内心。",
  opening: "雨水沿着酒馆的窗沿滑落，把港口的灯火揉成模糊的金色。\n\n你站在夜航酒馆门前。门内炉火正旺，一名卷着衬衫袖口的女子正在擦拭玻璃杯。靠窗的位置，一个深色披风的男人翻过手里的书页。\n\n“进来吧，门没锁。”女子抬起头，“这种天气，最好别在外面停留太久。”\n\n你口袋里的那封旧信，边缘已经被雨水浸湿。",
  presetSelection:{director:"",actor:"",settlement:"",narrator:"",memory:""}, stageModels:{settlement:"",narrator:"",memory:""}, collaborationMode:"balanced", context:{threads:[],sceneSummaries:[],chapterSummaries:[]},
  characters: [
    {id:"lin",name:"林晚",role:"酒馆老板",persona:"32 岁，夜航酒馆老板。细心、谨慎，习惯用实际行动表达关心。话不多，偶尔带一点干燥的幽默。不会轻易向陌生人交代过去。",secret:"曾替一个使用鸢尾徽记的组织传递消息，离开组织后隐居雾港。",color:"amber",modelId:"default",presetId:"inherit",state:{location:"夜航酒馆 · 柜台",clothing:"米白衬衫，袖口卷起，深棕色围裙",condition:"健康，右手有一道旧伤",emotion:"平静，留意新来的客人",thought:"这场雨恐怕还要下很久。",goal:"照看酒馆，了解来客的需要",relationship:"对旅人：初次见面，礼貌而谨慎"},memories:[]},
    {id:"shen",name:"沈砚",role:"过路的抄写员",persona:"29 岁，抄写员。观察敏锐，措辞精确，带着温和的疏离感。习惯先听后说，不会无缘无故抢话。",secret:"正在寻找一位失踪的旧友，但暂时不愿公开此行目的。",color:"blue",modelId:"default",presetId:"inherit",state:{location:"夜航酒馆 · 窗边",clothing:"深蓝披风，灰色马甲，皮质手套",condition:"长途跋涉后有些疲惫",emotion:"安静，保持观察",thought:"等雨小一些再走。",goal:"休息，留意港口的消息",relationship:"对旅人：陌生，尚无判断"},memories:[]}
  ]
}; }
