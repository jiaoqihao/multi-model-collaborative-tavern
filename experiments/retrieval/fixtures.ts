import type { Evidence, RetrievalScope } from "./hybrid";
import { blankCharacter } from "../../lib/tavern/seed";

// Entirely synthetic. Written before running retrieval. No imported stories/cards.
// Each tuple: topic, relevant event, distractor, direct query, paraphrased query.
const topics=[
 ["trust","你没有赴约，她独自在钟楼等了一夜，从此不肯再把要紧事托付给你。","你翻开一本名为《信任》的旧书。","那次钟楼失约发生了什么？","她为什么不再相信我？"],
 ["promise","出发前你答应阿岚，冬季第一场雪落下时一定回到村口迎接她。","今晨村口已经下雪，几个孩子堆起雪人。","我答应阿岚什么时候回村？","很久以前说好什么时候接她？"],
 ["allergy","吃过花生酥后，记录员起了大片红疹，医师叮嘱她以后避开花生。","记录员正在抄写一本甜点食谱。","记录员能吃花生酥吗？","给她准备点心需要忌口什么？"],
 ["debt","渡河时摆渡人替你垫付了三十枚银币，你约好月底偿还。","商店的银币标价牌掉在地上。","月底要还摆渡人多少钱？","我还欠谁一笔钱？"],
 ["key","阿岚把地下室的铜钥匙缝进了外套内衬，只有她能取出来。","你在门外捡到一枚无法开锁的铁片。","地下室铜钥匙藏在哪里？","要进去地窖该找谁拿开门的东西？"],
 ["fear","幼年被困在燃烧的谷仓后，少年一闻到烟味就发抖。","少年坐在谷仓外练习吹口琴。","少年为什么害怕烟味？","是什么旧经历让他恐惧火焰？"],
 ["injury","守卫的左腿被落石砸伤，医师要求三天内不得负重走动。","守卫换了一双崭新的靴子。","守卫左腿受伤后能走吗？","为什么他现在不能陪我们远行？"],
 ["identity","那位自称行商的客人私下承认，自己其实是离宫出走的王室继承人。","行商展示了王宫样式的纪念徽章。","行商私下承认了什么身份？","那个卖货的人究竟是谁？"],
 ["signal","行动开始前，伙伴约定用三声短哨表示安全，两声长哨表示撤退。","街头的乐手正在吹长笛。","两声长哨是什么意思？","听到约定的撤离信号应该怎么办？"],
 ["gift","你送给阿岚的木雕小鸟被她珍藏在枕边，她说这是第一次有人记得她生日。","阿岚看着窗外飞过的小鸟。","阿岚把生日木雕放在哪里？","她为何这么珍惜我送的礼物？"],
 ["route","暴雨冲毁了东面的石桥，去山城只能绕道西侧的渡口。","山城的游客手里拿着去年的地图。","去山城的石桥还能走吗？","眼下要到那座城应该绕哪条路？"],
 ["food","暴风雪把粮车阻在山外，仓库只剩足够两天的干粮。","仓库墙上贴着丰收庆典的海报。","仓库干粮还够几天？","我们为什么必须尽快找到吃的？"],
 ["book","借来的航海日志必须在满月前交还图书馆，否则管理员会取消借阅资格。","图书馆刚添置了一批新书架。","航海日志何时归还？","不想失去借书资格要及时做什么？"],
 ["evidence","案件发生时鞋匠一直在剧院修补戏服，三名演员可以证明他不在现场。","鞋匠的店门口张贴着剧院招募告示。","谁能证明鞋匠不在案发现场？","有什么可以洗清那个人嫌疑的证据？"],
 ["grief","阿岚每年秋天都会去海边祭奠弟弟，他在一次风暴中失去了生命。","海边的小铺在秋季出售风铃。","阿岚为何秋天去海边？","她每到这个季节就难过是因为什么？"],
 ["taboo","当地人把白鹿视为祖先的使者，猎杀白鹿会被逐出村落。","村口树上挂着一面鹿形木牌。","村里允许猎杀白鹿吗？","在这里打猎有什么绝对不能碰的禁忌？"],
 ["password","守门人只向说出“晨星照井”这句话的人开启秘密通道。","门边的水井映着天上的星星。","秘密通道的口令是什么？","要让守门的人放行该说哪句话？"],
 ["letter","故人的来信提到，失散的女儿最近在北港的一家药铺当学徒。","北港药铺贴出了招聘送货员的告示。","故人的女儿在北港哪里？","寻找失散亲人有什么新线索？"],
 ["boundary","你替她擅自决定了远行的日期，她生气地要求以后任何安排都先征求她同意。","她正翻看一本关于远行装备的手册。","她对擅自安排远行有什么反应？","以后做决定怎样才能尊重她的意愿？"],
 ["repair","灯塔的转轴锈死了，修理师说只有拿到鲸油才能让灯重新旋转。","灯塔外的墙面刚涂上白漆。","修理灯塔转轴需要什么？","让航船重新看到转动的灯光还缺哪种材料？"],
 ["rescue","你从冰窟中救出了药师的孩子，药师承诺今后免费为你治疗一次。","药师正在向学徒讲解冻伤处理。","药师答应免费治疗几次？","我之前救人得到过什么报答？"],
 ["hearing","老船长右耳听力严重下降，与他说话最好站在左边。","老船长给右手戴上一只皮手套。","和老船长说话站哪边？","为什么从那个方向叫他总是没反应？"],
 ["delivery","委托人要求把密封匣子亲手交给城南的陶工，途中绝不可拆封。","城南集市出售许多装饰用匣子。","密封匣子应该交给谁？","这件托付要送到什么人手里才算完成？"],
 ["water","矿井里的水被重金属污染，必须到山上的泉眼取饮用水。","矿工在井口摆放了几个空水桶。","矿井的水能喝吗？","我们去哪儿才能找到安全的水源？"],
] as const;
export const character={...blankCharacter(),id:"actor-a",name:"试验记录员",role:"",persona:"",secret:"",state:{location:"",clothing:"",condition:"",emotion:"",thought:"",goal:"",relationship:""},memories:[]};
const base={ownerId:"synthetic-owner",storyId:"story-a",characterId:character.id};
function row(id:string,content:string,turnId="t1",status:"active"|"superseded"|"resolved"="active"):Evidence{
 return {...base,memory:{id,content,turnId,kind:"observation",importance:3,status,scope:"scene",validFromTurnId:turnId}};
}
export const corpus:Evidence[]=topics.flatMap(([id,event,distractor])=>[row(id,event),row(`${id}-noise`,distractor,"t2")]);
corpus.push(row("old-meeting","先前约定在钟楼会面，这个安排后来被码头之约替代。","t1","superseded"),row("new-meeting","现在会面地点改为南码头，钟楼的旧约定已经取消。","t2"),row("resolved-task","寻找丢失戒指的委托已经完成，不再需要找戒指。","t2","resolved"));
// Adversarially relevant documents in disallowed namespaces/branches.
corpus.push({...row("other-character","她不再相信你，因为你没有赴约，让她在钟楼等了一夜。"),characterId:"actor-b"},
 {...row("other-owner","秘密通道的口令就是晨星照井。"),ownerId:"other-owner"},
 {...row("other-story","地下室铜钥匙在外套内衬。"),storyId:"story-b"},
 row("sibling","现在会面地点是北山顶，不再去南码头。","sibling-turn"),
 row("future","现在会面地点是王宫，码头已被封锁。","future-turn"));
export type Query={id:string;text:string;category:"direct"|"paraphrase"|"lifecycle";relevant:string[];historical:boolean};
export const queries:Query[]=topics.flatMap(([id,,,direct,paraphrase])=>[
 {id:`${id}-direct`,text:direct,category:"direct" as const,relevant:[id],historical:false},
 {id:`${id}-paraphrase`,text:paraphrase,category:"paraphrase" as const,relevant:[id],historical:false},
]);
queries.push({id:"meeting-current",text:"现在应该去哪里赴约？",category:"lifecycle",relevant:["new-meeting"],historical:false},
 {id:"meeting-past",text:"最初的见面地点是哪里？",category:"lifecycle",relevant:["old-meeting"],historical:true},
 {id:"resolved-past",text:"之前找戒指的事情完成了吗？",category:"lifecycle",relevant:["resolved-task"],historical:true});
export function scopeFor(query:Query):RetrievalScope{return {...base,ancestorTurnIds:new Set(["t1","t2"]),historical:query.historical}}
