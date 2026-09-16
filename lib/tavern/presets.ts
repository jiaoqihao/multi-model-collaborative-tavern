import { z } from "zod";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type PresetContext = {
  stage: "director" | "actor" | "narrator";
  characterId?: string;
  trigger: "normal" | "regenerate";
  macros: Record<string, string>;
  markers: Record<string, string>;
  history: ChatMessage[];
};
export const samplingSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(1).max(32000).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
}).strict();
export type Sampling = z.infer<typeof samplingSchema>;
export const entrySchema = z.object({
  identifier: z.string().min(1).max(150), name: z.string().max(160),
  role: z.enum(["system", "user", "assistant"]), content: z.string().max(32000),
  enabled: z.boolean(), marker: z.boolean(),
  position: z.union([z.literal(0), z.literal(1)]), depth: z.number().int().min(0).max(100),
  order: z.number().int().min(0).max(10000), triggers: z.array(z.string().max(40)).max(10),
}).strict();
export type PresetEntry = z.infer<typeof entrySchema>;
export const presetSchema = z.object({
  id: z.string().max(100), revision: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(120), source: z.string().max(180),
  entries: z.array(entrySchema).min(1).max(300), sampling: samplingSchema,
  sourceWarnings: z.array(z.string().max(500)).max(100),
}).strict().superRefine((p, ctx) => {
  if (new Set(p.entries.map(e => e.identifier)).size !== p.entries.length)
    ctx.addIssue({code: "custom", message: "提示词 identifier 不可重复"});
  if (p.entries.reduce((n, e) => n + e.content.length, 0) > 160000)
    ctx.addIssue({code: "custom", message: "提示词总长度超过 160,000 字符"});
});
export type Preset = z.infer<typeof presetSchema>;
export type PresetSummary = Pick<Preset, "id" | "name" | "revision"> & { count: number; enabled: number; warnings: string[] };
export class PresetError extends Error {}
const MARKERS = new Set(["charDescription", "charPersonality", "personaDescription", "scenario", "worldInfoBefore", "worldInfoAfter", "dialogueExamples", "chatHistory"]);
const MACROS = new Set(["char", "charifnotgroup", "user", "description", "personality", "scenario", "persona", "mesexamples", "lastusermessage", "lastmessage", "setvar", "getvar", "addvar", "trim", "//"]);
const rawEntry = z.object({
  identifier: z.string().min(1).max(150), name: z.string().max(160).optional(),
  role: z.enum(["system", "user", "assistant"]).default("system"), content: z.string().max(32000).optional(),
  enabled: z.boolean().optional(), marker: z.boolean().optional(),
  injection_position: z.number().int().nullish(), injection_depth: z.number().int().nullish(),
  injection_order: z.number().int().nullish(), injection_trigger: z.array(z.string()).nullish(),
}).passthrough();
const stSchema = z.object({
  prompts: z.array(rawEntry).min(1).max(300),
  prompt_order: z.array(z.object({character_id: z.union([z.number(), z.string()]).optional(), order: z.array(z.object({identifier: z.string(), enabled: z.boolean()})).max(300)})).max(50).optional(),
}).passthrough();
function parseFile(text: string) {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new PresetError("文件超过 2 MB。");
  try { return stSchema.parse(JSON.parse(text.replace(/^\uFEFF/, ""))); }
  catch (error) { throw new PresetError(error instanceof z.ZodError ? "不是支持的 Chat Completion 预设，或字段类型不正确。" : "JSON 文件无法解析。"); }
}
export function orderGroups(text: string) {
  return (parseFile(text).prompt_order || []).map((g, index) => ({ index, label: `顺序组 ${index + 1} · character_id ${g.character_id ?? "未指定"}` }));
}
export function importPreset(text: string, filename: string, groupIndex = 0): Preset {
  const raw = parseFile(text);
  if (new Set(raw.prompts.map(p => p.identifier)).size !== raw.prompts.length) throw new PresetError("原文件包含重复的提示词 identifier。");
  const warnings: string[] = [];
  const group = raw.prompt_order?.[groupIndex];
  if (raw.prompt_order?.length && !group) throw new PresetError("选择的顺序组不存在。");
  if ((raw.prompt_order?.length || 0) > 1) warnings.push(`仅导入所选顺序组 ${groupIndex + 1}，其他顺序组未合并。`);
  const byId = new Map(raw.prompts.map(p => [p.identifier, p]));
  const ordered: typeof raw.prompts = [];
  const enabled = new Map<string, boolean>();
  for (const item of group?.order || []) {
    if (enabled.has(item.identifier)) throw new PresetError("顺序列表中有重复的 identifier。");
    enabled.set(item.identifier, item.enabled);
    const entry = byId.get(item.identifier);
    if (entry) ordered.push(entry); else warnings.push(`顺序中引用了不存在的条目：${item.identifier}`);
  }
  const included = new Set(ordered.map(e => e.identifier));
  ordered.push(...raw.prompts.filter(e => !included.has(e.identifier)));
  if (group && included.size < raw.prompts.length) warnings.push(`${raw.prompts.length - included.size} 个未列入所选顺序的条目保留在末尾，默认关闭。`);
  const entries: PresetEntry[] = ordered.map(p => {
    if (p.injection_position != null && ![0, 1].includes(p.injection_position)) throw new PresetError("不支持的注入位置，不能静默改变条目位置。");
    return {
      identifier: p.identifier, name: p.name || p.identifier, role: p.role, content: p.content || "",
      enabled: group ? (enabled.get(p.identifier) ?? false) : (p.enabled ?? true), marker: p.marker ?? false,
      position: (p.injection_position ?? 0) as 0 | 1, depth: p.injection_depth ?? 4,
      order: p.injection_order ?? 100, triggers: p.injection_trigger || [],
    };
  });
  const settings: Record<string, unknown> = {};
  const parameterMap = { temperature: "temperature", top_p: "topP", openai_max_tokens: "maxTokens", frequency_penalty: "frequencyPenalty", presence_penalty: "presencePenalty" } as const;
  for (const [key, name] of Object.entries(parameterMap)) {
    if (raw[key] !== undefined) {
      const candidate = samplingSchema.safeParse({ [name]: raw[key] });
      if (candidate.success) settings[name] = raw[key]; else warnings.push(`参数 ${key} 超出支持范围，未导入；请手动设置。`);
    }
  }
  const ignored = Object.keys(raw).filter(k => !["prompts", "prompt_order", "extensions", ...Object.keys(parameterMap)].includes(k));
  if (ignored.length) warnings.push("未应用的顶层设置：" + ignored.join("、").slice(0, 400));
  if (raw.extensions && typeof raw.extensions === "object") {
    const ext = raw.extensions as Record<string, unknown>;
    if (Array.isArray(ext.regex_scripts)) warnings.push(`${ext.regex_scripts.length} 条正则扩展未导入、不会执行。`);
    if (ext.tavern_helper) warnings.push("酒馆助手脚本与变量未导入、不会执行；MVU 等扩展状态协议不受支持。");
    const others = Object.keys(ext).filter(k => !["regex_scripts", "tavern_helper"].includes(k));
    if (others.length) warnings.push("未导入的扩展：" + others.join("、").slice(0, 350));
  }
  if (raw.prompts.some(p => p.forbid_overrides)) warnings.push("forbid_overrides 未映射；平台中预设与角色设定分别管理。");
  return presetSchema.parse({ id: "", revision: 0, name: filename.replace(/\.json$/i, "").slice(0, 120) || "导入预设", source: "SillyTavern Chat Completion", entries, sampling: settings, sourceWarnings: warnings });
}
export function presetWarnings(preset: Preset): string[] {
  const warnings = [...preset.sourceWarnings];
  const unknown = new Set<string>();
  for (const entry of preset.entries.filter(e => e.enabled)) {
    if (entry.marker && !MARKERS.has(entry.identifier)) warnings.push(`标记 ${entry.identifier} 没有对应数据，将跳过。`);
    if (entry.triggers.some(t => !["normal", "regenerate"].includes(t))) warnings.push(`「${entry.name}」包含平台没有的触发类型，仅 normal / regenerate 可生效。`);
    for (const m of entry.content.matchAll(/\{\{\s*([^{}\s:]+)/g)) {
      const name = m[1].toLowerCase();
      if (!MACROS.has(name)) unknown.add(name);
    }
  }
  if (unknown.size) warnings.push("未识别的宏会保留为文本：" + [...unknown].join("、").slice(0, 350));
  if (preset.entries.some(e => e.enabled && e.position === 1)) warnings.push("深度按平台提供给该 AI 的可见历史计算，不等于酒馆的完整聊天记录。");
  return [...new Set(warnings)];
}
export function summarizePreset(p: Preset): PresetSummary {
  return {id: p.id, name: p.name, revision: p.revision, count: p.entries.length, enabled: p.entries.filter(e => e.enabled).length, warnings: presetWarnings(p)};
}

// A bounded text interpreter. It never evaluates JavaScript, regular expressions
// from imported files, network requests, slash commands, or plugin code.
export class MacroRenderer {
  readonly variables = new Map<string, string>();
  readonly warnings = new Set<string>();
  private operations = 0;
  constructor(private values: Record<string, string>) {}
  render(source: string, depth = 0): string {
    if (depth > 20) throw new PresetError("变量嵌套超过 20 层。");
    let output = "", cursor = 0;
    while (cursor < source.length) {
      const start = source.indexOf("{{", cursor);
      if (start < 0) { output += source.slice(cursor); break; }
      output += source.slice(cursor, start);
      let level = 1, end = start + 2;
      while (end < source.length && level) {
        if (source.startsWith("{{", end)) { level++; end += 2; }
        else if (source.startsWith("}}", end)) { level--; end += 2; }
        else end++;
      }
      if (level) { this.warnings.add("存在未闭合的宏，已保留原文。"); output += source.slice(start); break; }
      if (++this.operations > 5000) throw new PresetError("宏数量超过单次处理上限。");
      const original = source.slice(start, end), body = source.slice(start + 2, end - 2);
      output += this.evaluate(body, original, depth);
      if (output.length > 200000) throw new PresetError("宏展开结果过长。");
      cursor = end;
    }
    if (output.length > 200000) throw new PresetError("宏展开结果过长。");
    return output.replace(/[\t ]*\r?\n[\t ]*\u0000TRIM\u0000[\t ]*\r?\n[\t ]*/g, "").replaceAll("\u0000TRIM\u0000", "");
  }
  private evaluate(body: string, original: string, depth: number): string {
    if (body.trimStart().startsWith("//")) return "";
    // Split separators only at the outer nesting level.
    const parts: string[] = []; let level = 0, start = 0;
    for (let i = 0; i < body.length; i++) {
      if (body.startsWith("{{", i)) {level++; i++;}
      else if (body.startsWith("}}", i)) {level--; i++;}
      else if (!level && body.startsWith("::", i)) {parts.push(body.slice(start, i)); start = i + 2; i++;}
    }
    parts.push(body.slice(start));
    const name = parts[0].trim().toLowerCase();
    if (name === "trim") return "\u0000TRIM\u0000";
    if (["setvar", "addvar", "getvar"].includes(name)) {
      const key = this.render(parts[1] || "", depth + 1).trim();
      if (!key || key.length > 128) throw new PresetError("局部变量名为空或过长。");
      if (name === "getvar") return this.variables.get(key) || "";
      const value = this.render(parts.slice(2).join("::"), depth + 1);
      if (name === "setvar") this.variables.set(key, value);
      else {
        const before = this.variables.get(key) || "";
        this.variables.set(key, Number.isFinite(Number(before)) && Number.isFinite(Number(value)) ? String(Number(before) + Number(value)) : before + value);
      }
      if ((this.variables.get(key)?.length || 0) > 160000) throw new PresetError("局部变量内容过长。");
      return "";
    }
    if (MACROS.has(name)) return this.values[name] || "";
    this.warnings.add(`未展开的宏：${name.slice(0, 100)}`);
    return original;
  }
}

export function compilePreset(preset: Preset, context: PresetContext) {
  const renderer = new MacroRenderer(Object.fromEntries(Object.entries(context.macros).map(([k, v]) => [k.toLowerCase(), v])));
  const messages: ChatMessage[] = [];
  const history = context.history.map(m => ({...m}));
  const entries = preset.entries.filter(e => e.enabled && (!e.triggers.length || e.triggers.includes(context.trigger)));
  const injections: {entry: PresetEntry; message: ChatMessage; index: number}[] = [];
  const normal: {entry: PresetEntry; message?: ChatMessage}[] = [];
  for (const entry of entries) {
    if (entry.marker) { normal.push({entry}); continue; }
    const content = renderer.render(entry.content);
    if (!content.trim()) continue;
    const message = {role: entry.role, content};
    if (entry.position === 1) injections.push({entry, message, index: Math.max(0, history.length - entry.depth)});
    else normal.push({entry, message});
  }
  const expandedHistory: ChatMessage[] = [];
  const roleOrder = {user: 0, assistant: 1, system: 2};
  for (let i = 0; i <= history.length; i++) {
    const atDepth = injections.filter(e => e.index === i).sort((a, b) => roleOrder[a.entry.role] - roleOrder[b.entry.role] || a.entry.order - b.entry.order);
    expandedHistory.push(...atDepth.map(e => e.message));
    if (i < history.length) expandedHistory.push(history[i]);
  }
  let historyInserted = false;
  const missingMarkers = new Set<string>();
  for (const item of normal) {
    if (item.message) { messages.push(item.message); continue; }
    if (item.entry.identifier === "chatHistory") { messages.push(...expandedHistory); historyInserted = true; }
    else {
      const content = context.markers[item.entry.identifier];
      if (content) messages.push({role: item.entry.role, content});
      else missingMarkers.add(`标记 ${item.entry.identifier} 在当前阶段没有可用数据，已跳过。`);
    }
  }
  if (!historyInserted && injections.length) messages.push(...expandedHistory);
  const characters = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (characters > 200000) throw new PresetError("组装的预设超过 200,000 字符，请关闭部分条目。");
  return {messages, sampling: preset.sampling, warnings: [...new Set([...presetWarnings(preset), ...renderer.warnings, ...missingMarkers])], characters};
}

export function exportPreset(p: Preset) {
  const sampling = p.sampling;
  return {
    temperature: sampling.temperature, top_p: sampling.topP, openai_max_tokens: sampling.maxTokens,
    frequency_penalty: sampling.frequencyPenalty, presence_penalty: sampling.presencePenalty,
    prompts: p.entries.map(e => ({identifier: e.identifier, name: e.name, role: e.role, content: e.content, enabled: e.enabled, marker: e.marker, system_prompt: e.marker, injection_position: e.position, injection_depth: e.depth, injection_order: e.order, injection_trigger: e.triggers})),
    prompt_order: [{character_id: 100001, order: p.entries.map(e => ({identifier: e.identifier, enabled: e.enabled}))}],
  };
}
