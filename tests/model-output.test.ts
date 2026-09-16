import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { parseModelObject, outputIssue } from "../lib/tavern/model-output";
import { runTurn } from "../lib/tavern/engine";
import { initialStory, sampleStory } from "../lib/tavern/seed";
import { complete, endpoints } from "../lib/tavern/models";

test("结构解析兼容代码围栏、说明文字及完整前置思考块，保留正文原样", () => {
  const value = {narrative: '她说："看这里 { }"。\n<think>是台词的一部分</think>', nested: [{text: "反斜杠\\"}]};
  const json = JSON.stringify(value);
  for (const source of [json, `\uFEFF${json}`, `\`\`\`JSON\n${json}\n\`\`\``, `返回结果：\n${json}\n结束。`, `<think>包含 {不合法 JSON} 的推理</think>\n${json}`]) {
    assert.deepEqual(parseModelObject(source), value);
  }
});

test("不从截断、多个对象、损坏 JSON 或未闭合思考块猜测剧情", () => {
  for (const source of ['{"deliveries":[{"characterId":"lin"}', '{"a":1} {"a":2}', '<think>{"deliveries":[]}', '{"narrative":"未转义\n换行"}', '结果：{"a":[1,2}']) {
    assert.throws(() => parseModelObject(source));
  }
  const schema = z.object({visibleToPlayer: z.boolean()});
  const result = schema.safeParse(parseModelObject('{"visibleToPlayer":"false"}'));
  assert.equal(result.success, false, "不能把字符串转为可能泄漏私密事件的布尔值");
});

test("导演重试携带字段错误和完整约束，成功后继续，不附带失败原文", async () => {
  const story = initialStory();let plans = 0;
  const result = await runTurn({story, history: [], input: "看向窗外", mode: "roleplay", directorId: "m", turnId: "t", call: async (_id, system) => {
    if (system.includes("你负责信息分发")) {
      plans++;
      assert.ok(system.includes('"maxItems":4'));
      assert.ok(system.includes('"maxLength":2000'));
      if (plans === 1) return '{"deliveries":"PRIVATE_FAILED_RESPONSE"}';
      assert.match(system, /deliveries：应为 array，实际为 string/);
      assert.ok(!system.includes("PRIVATE_FAILED_RESPONSE"));
      return '结果如下：\n```json\n{"deliveries":[]}\n```';
    }
    if (system.includes("你协调实际事件")) return '{"events":[{"description":"窗外落雨。","visibleTo":[],"visibleToPlayer":true}],"changes":[]}';
    return '{"narrative":"窗外落雨。"}';
  }});
  assert.equal(plans, 2);assert.equal(result.narrative, "窗外落雨。");assert.deepEqual(story, initialStory());
});

test("角色失败指出角色与缺失字段，原故事不变且仍只重试一次", async () => {
  const story = sampleStory(), before = structuredClone(story);let actors = 0;
  await assert.rejects(runTurn({story, history: [], input: "你好", mode: "roleplay", directorId: "m", turnId: "t", call: async (_id, system) => {
    if (system.includes("你负责信息分发")) return '{"deliveries":[{"characterId":"lin","visible":"问候","direction":""}]}';
    actors++;return '{"speech":"PRIVATE_RESPONSE","actionIntent":"","emotion":"平静","thought":"","goal":""}';
  }}), error => {
    assert.match((error as Error).message, /角色「林晚」回应连续返回无效结构.*relationship/);
    assert.ok(!(error as Error).message.includes("PRIVATE_RESPONSE"));return true;
  });
  assert.equal(actors, 2);assert.deepEqual(story, before);
});

test("长度错误保留具体上限供模型精简，语法错误不泄漏返回原文", () => {
  const result = z.object({speech: z.string().max(2)}).safeParse({speech: "PRIVATE"});
  assert.equal(result.success, false);
  if (!result.success) assert.equal(outputIssue(result.error), "speech：超过上限 2（字符），请精简");
  try { parseModelObject('{"speech":PRIVATE}');assert.fail("should reject"); }
  catch (error) { assert.ok(!outputIssue(error).includes("PRIVATE")); }
});

test("四种接口识别输出截断，不把部分 JSON 当成格式错误反复调用", async () => {
  const saved = globalThis.fetch;
  try {
    for (const provider of ["openai", "compatible", "anthropic", "gemini"] as const) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return Response.json(provider === "anthropic" ? {stop_reason: "max_tokens", content: [{type: "text", text: '{"partial":'}]} : provider === "gemini" ? {candidates: [{finishReason: "MAX_TOKENS", content: {parts: [{text: '{"partial":'}]}}]} : {choices: [{finish_reason: "length", message: {content: null, reasoning_content: "PRIVATE_REASONING"}}]});
      };
      await assert.rejects(complete({id: "m", name: "测试模型", provider, baseUrl: endpoints[provider], model: "test"}, "fake-key", "system", "prompt"), /输出达到 token 上限/);
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = saved; }
});
