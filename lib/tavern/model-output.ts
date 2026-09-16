import { z } from "zod";

export class ModelOutputError extends Error {}

/** Accept presentation wrappers, but never repair or invent story data. */
export function parseModelObject(text: string): unknown {
  let source = text.trim().replace(/^\uFEFF/, "");
  if (source.length > 500000) throw new ModelOutputError("返回内容过长");
  // Some compatible endpoints include a separate reasoning block in content.
  // Only discard a complete leading block, never tags inside the JSON strings.
  while (/^<think>/i.test(source)) {
    const end = source.toLowerCase().indexOf("</think>");
    if (end < 0) throw new ModelOutputError("返回内容不完整，缺少最终 JSON");
    source = source.slice(end + 8).trim();
  }
  source = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(source); } catch { /* Check for one complete wrapped object. */ }

  const start = source.search(/[\[{]/);
  if (start < 0) throw new ModelOutputError("未返回有效 JSON 对象");
  const stack: string[] = [];
  let quoted = false, escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      if (stack.pop() !== (char === "}" ? "{" : "[")) throw new ModelOutputError("JSON 括号不匹配");
      if (!stack.length) {
        if (/[\[\]{}]/.test(source.slice(i + 1))) throw new ModelOutputError("返回了多个或含糊的 JSON 片段，请只返回一个对象");
        try { return JSON.parse(source.slice(start, i + 1)); }
        catch { throw new ModelOutputError("JSON 语法错误，请检查双引号、逗号和换行转义"); }
      }
    }
  }
  throw new ModelOutputError("JSON 不完整，可能被输出长度限制截断");
}

/** Compact output contract includes limits omitted by the prose examples. */
export function outputContract(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodEffects) return outputContract(schema.innerType());
  if (schema instanceof z.ZodOptional) return {optional: true, value: outputContract(schema.unwrap())};
  if (schema instanceof z.ZodObject) return Object.fromEntries(Object.entries(schema.shape).map(([key, value]) => [key, outputContract(value as z.ZodTypeAny)]));
  if (schema instanceof z.ZodArray) return {type: "array", items: outputContract(schema.element), minItems: schema._def.minLength?.value, maxItems: schema._def.maxLength?.value};
  if (schema instanceof z.ZodUnion) return {anyOf: schema.options.map((option:z.ZodTypeAny)=>outputContract(option))};
  if (schema instanceof z.ZodString) return {type: "string", minLength: schema.minLength ?? undefined, maxLength: schema.maxLength ?? undefined};
  if (schema instanceof z.ZodBoolean) return {type: "boolean"};
  return {type: schema._def.typeName};
}

/** Do not expose response excerpts, validation values, or JSON.parse messages. */
export function outputIssue(error: unknown): string {
  if (error instanceof ModelOutputError) return error.message;
  if (!(error instanceof z.ZodError)) throw error;
  return error.issues.slice(0, 4).map(issue => {
    const path = issue.path.map(part => String(part).replace(/[^a-zA-Z0-9_]/g, "").slice(0, 60)).join(".") || "返回对象";
    if (issue.code === "invalid_type") return `${path}：应为 ${issue.expected}，实际为 ${issue.received}`;
    if (issue.code === "too_big") return `${path}：超过上限 ${issue.maximum}（${issue.type === "array" ? "项" : "字符"}），请精简`;
    if (issue.code === "too_small") return `${path}：至少需要 ${issue.minimum}（${issue.type === "array" ? "项" : "字符"}）`;
    if (issue.code === "unrecognized_keys") return `${path}：存在多余字段，只返回要求的字段`;
    // Custom memory validation messages are application-authored, not model text.
    if (issue.code === "custom") return `${path}：${issue.message}`;
    return `${path}：字段格式不符合要求`;
  }).join("；");
}
