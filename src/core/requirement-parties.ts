import type { RequirementParty } from "./model.js";

/** Bounded explicit Chinese phrases only; preserve evidence rather than resolve real people. */
export function extractRequirementParties(request: string): {
  requestedBy: RequirementParty[];
  feedbackBy: RequirementParty[];
} {
  const result = { requestedBy: [] as RequirementParty[], feedbackBy: [] as RequirementParty[] };
  const roles = new Set(["前端", "后端", "产品", "测试", "运维", "客服", "设计"]);
  const subject = '["“「]?([\\p{L}\\p{N}_@.-]{1,40}?)["”」]?';
  const requested = new RegExp('^(?:(?:这个|这项|该)?需求(?:是|由)|由)?\\s*' + subject + '\\s*(?:提(?:出|过来|了|的)|提交)', 'u');
  const feedback = new RegExp('^' + subject + '\\s*(?:反馈|反映|报告)', 'u');
  // Do not interpret examples/code, questions, negation or hypothetical sentences as attribution.
  const prose = request.replace(/```[\s\S]*?```/g, "").replace(/^\s*\$domainatlas[ \t]+(?:record|记录)\s+/, "");
  for (const sentence of prose.split(/[。！!；;\n]/)) {
    if (/[?？]|不是|并非|没有|并未|未曾|不要|别把|如果|假如|假设|可能|也许|比如|例如|示例|是否|是不是/.test(sentence)) continue;
    for (const part of sentence.split(/[，,]/)) {
      const evidence = part.trim().replace(/^[-*]\s+/, "");
      for (const [key, pattern] of [["requestedBy", requested], ["feedbackBy", feedback]] as const) {
        const match = pattern.exec(evidence);
        if (!match || (key === "requestedBy" && !evidence.includes("需求"))) continue;
        const name = match[1].trim();
        if (!name || /^(?:我|你|他|她|他们|有人|谁|大家)$/.test(name) || /[的是否不没未]|说|让|要求/.test(name)) continue;
        if (result[key].some(party => party.name === name)) continue;
        result[key].push({ name, kind: roles.has(name) ? "role" : /(?:团队|部门|组)$/.test(name) ? "team" : "alias", source: "request", evidence, confidence: "medium" });
      }
    }
  }
  return result;
}
