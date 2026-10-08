import { z } from "zod";
import { LIMITS } from "./index";

export const COACH_LIMITS = { ...LIMITS, objects: 12, parts: 16, history: 64, audioSeconds: 20, audioBytes: 1024 * 1024, audioSampleRate: 24000, audioChannels: 1, audioBits: 16 } as const;
const Id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const Text = z.string().trim().min(1).max(2000);
const Ids = z.array(Id).refine(a => new Set(a).size === a.length, "중복 참조입니다.");
const DateString = z.iso.date();
export const CoachProgressStateSchema = z.enum(["idle", "preparing", "recognizing", "choosing", "guiding", "complete", "needs_help", "error"]);
export const CoachVoiceStateSchema = z.enum(["off", "idle", "recording", "processing", "speaking", "error"]);
export type CoachProgressState = z.infer<typeof CoachProgressStateSchema>;
export type CoachVoiceState = z.infer<typeof CoachVoiceStateSchema>;
export const BoxSchema = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().gt(0).max(1), height: z.number().gt(0).max(1) }).refine(b => b.x + b.width <= 1 && b.y + b.height <= 1, "사진 범위를 벗어났습니다.");
export type Box = z.infer<typeof BoxSchema>;
export const ViewSchema = z.strictObject({ photoId: z.uuid(), box: BoxSchema.nullable() });
export type View = z.infer<typeof ViewSchema>;
const Views = z.array(ViewSchema).max(COACH_LIMITS.photos).refine(a => new Set(a.map(v => v.photoId)).size === a.length);
const ModelPartSchema = z.strictObject({ label: Text, role: Id, views: Views });
const ObservationFields = { label: Text, categoryId: Id.nullable(), recognition: z.enum(["recognized", "ambiguous", "out_of_scope"]), views: Views };
/** Model candidates deliberately have no server identifiers, rules, destinations or completion facts. */
export const ModelObservationSchema = z.strictObject({ ...ObservationFields, parts: z.array(ModelPartSchema).max(COACH_LIMITS.parts) });
export type ModelObservation = z.infer<typeof ModelObservationSchema>;
export const ObservationSchema = z.strictObject({ objectId: z.uuid(), ...ObservationFields, parts: z.array(ModelPartSchema.extend({ partId: Id })).max(COACH_LIMITS.parts) }).refine(o => new Set(o.parts.map(p => p.partId)).size === o.parts.length).refine(o => o.recognition !== "recognized" || o.categoryId !== null);
export type Observation = z.infer<typeof ObservationSchema>;
export const SourceSchema = z.strictObject({ id: Id, title: Text, publisher: Text, url: z.url({ protocol: /^https?$/ }), section: Text, scope: z.enum(["songpa", "national"]), checkedAt: DateString, publishedAt: DateString.nullable(), updatedAt: DateString.nullable() });
export type CoachSource = z.infer<typeof SourceSchema>;
export const CoachRuleSchema = z.strictObject({ id: Id, region: z.literal("songpa"), reviewStatus: z.literal("reviewed"), conditions: z.record(Id, z.array(Id).min(1)), sourceIds: Ids.nonempty() });
export type CoachRule = z.infer<typeof CoachRuleSchema>;
export const ChoiceSchema = z.strictObject({ id: Id, label: Text, nextStepId: Id.nullable(), factPatch: z.record(Id, Id) });
export type Choice = z.infer<typeof ChoiceSchema>;
export const DestinationSchema = z.strictObject({ partRole: Id, bin: z.enum(["metal", "plastic", "clear_pet", "glass", "paper", "carton", "vinyl", "foam", "general", "special_collection", "hold"]), label: Text, ruleIds: Ids.nonempty(), sourceIds: Ids.nonempty() });
export type Destination = z.infer<typeof DestinationSchema>;
export const StepSchema = z.strictObject({ id: Id, kind: z.enum(["confirm", "question", "action", "destination", "handoff", "complete"]), text: Text, speechText: Text, visual: z.strictObject({ action: z.enum(["inspect", "detach", "rinse", "empty", "unfold", "flatten", "sort", "hold"]), assetId: Id.nullable() }), targetRoles: Ids.nonempty(), choices: z.array(ChoiceSchema).min(1), ruleIds: Ids.nonempty(), sourceIds: Ids.nonempty(), reason: Text, replyIds: Ids, destinations: z.array(DestinationSchema) });
export type Step = z.infer<typeof StepSchema>;
export const GuideFlowSchema = z.strictObject({ id: Id, categoryId: Id.nullable(), startStepId: Id, facts: z.record(Id, z.strictObject({ values: Ids.nonempty(), evidence: z.enum(["user_only", "visible"]) })), steps: z.array(StepSchema).min(1) });
export type GuideFlow = z.infer<typeof GuideFlowSchema>;
export const ReplySchema = z.strictObject({ id: Id, allowedStepIds: Ids.nonempty(), text: Text, speechText: Text, choiceIds: Ids, ruleIds: Ids.nonempty(), sourceIds: Ids.nonempty() });
export type Reply = z.infer<typeof ReplySchema>;
export const CategorySchema = z.strictObject({ id: Id, label: Text, description: Text, roles: Ids.nonempty() });
const CatalogShape = z.strictObject({ version: Id, categories: z.array(CategorySchema).min(1), flows: z.array(GuideFlowSchema).min(1), rules: z.array(CoachRuleSchema).min(1), sources: z.array(SourceSchema).min(1), replies: z.array(ReplySchema) });
export type GuideCatalog = z.infer<typeof CatalogShape>;
export const GuideCatalogSchema = CatalogShape.superRefine((c, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length) issue("카탈로그 ID 중복"); };
  for (const entries of [c.categories, c.flows, c.rules, c.sources, c.replies]) unique(entries.map(e => e.id));
  const steps = c.flows.flatMap(f => f.steps); unique(steps.map(s => s.id));
  const ruleMap = new Map(c.rules.map(r => [r.id, r]));
  const refs = (ruleIds: string[], sourceIds: string[]) => {
    if (sourceIds.some(id => !c.sources.some(s => s.id === id))) issue("없는 출처");
    for (const id of ruleIds) { const r = ruleMap.get(id); if (!r) issue("없는 규칙"); else if (r.sourceIds.some(s => !sourceIds.includes(s))) issue("규칙 출처 누락"); }
  };
  c.rules.forEach(r => refs([], r.sourceIds));
  for (const f of c.flows) {
    const category = c.categories.find(cat => cat.id === f.categoryId);
    if (f.categoryId !== null && !category) issue("없는 범주");
    const byId = new Map(f.steps.map(s => [s.id, s]));
    if (!byId.has(f.startStepId)) issue("없는 시작 단계");
    for (const s of f.steps) {
      refs(s.ruleIds, s.sourceIds); unique(s.choices.map(ch => ch.id));
      if (category && s.targetRoles.some(r => !category.roles.includes(r))) issue("범주에 없는 부품 역할");
      if ((s.kind === "complete" || s.kind === "handoff") !== s.choices.every(ch => ch.nextStepId === null)) issue("종료 단계와 선택의 불일치");
      if (s.kind !== "complete" && s.kind !== "handoff" && s.choices.some(ch => ch.nextStepId === null)) issue("중간 단계 종료 금지");
      if (s.kind === "complete" && s.destinations.some(d => d.bin === "hold")) issue("보류 완료 금지");
      if (s.destinations.some(d => d.bin === "hold") && s.destinations.some(d => d.bin !== "hold")) issue("보류와 확정 배출 혼합 금지");
      if (s.kind === "handoff" && s.destinations.some(d => d.bin !== "hold")) issue("보류에서 배출 확정 금지");
      if (s.destinations.length && !["destination", "handoff", "complete"].includes(s.kind)) issue("행동 전 배출 확정 금지");
      for (const d of s.destinations) {
        refs(d.ruleIds, d.sourceIds);
        if (!s.targetRoles.includes(d.partRole)) issue("대상이 아닌 부품 배출");
        if (d.bin !== "hold") for (const id of d.ruleIds) for (const [key, values] of Object.entries(ruleMap.get(id)?.conditions ?? {})) if (!f.facts[key] || values.some(v => !f.facts[key].values.includes(v))) issue("규칙 조건과 사실 사전 불일치");
      }
      for (const ch of s.choices) {
        if (ch.nextStepId && !byId.has(ch.nextStepId)) issue("다른 흐름 또는 없는 다음 단계");
        for (const [key, value] of Object.entries(ch.factPatch)) if (!f.facts[key]?.values.includes(value)) issue("허용되지 않은 사실");
      }
      for (const id of s.replyIds) if (!c.replies.some(r => r.id === id && r.allowedStepIds.includes(s.id))) issue("도움 답 참조 오류");
    }
    const visited = new Set<string>(); const active = new Set<string>();
    const visit = (id: string) => {
      if (active.has(id)) { issue("조용한 순환 금지"); return; }
      if (visited.has(id)) return;
      visited.add(id); active.add(id);
      for (const ch of byId.get(id)?.choices ?? []) if (ch.nextStepId) visit(ch.nextStepId);
      active.delete(id);
    };
    visit(f.startStepId);
    if (f.steps.some(s => !visited.has(s.id))) issue("도달할 수 없는 단계");
  }
  for (const r of c.replies) {
    refs(r.ruleIds, r.sourceIds);
    for (const id of r.allowedStepIds) { const s = steps.find(s => s.id === id); if (!s || !s.replyIds.includes(r.id) || r.choiceIds.some(ch => !s.choices.some(x => x.id === ch))) issue("허용되지 않은 도움 답 선택"); }
  }
});
export const HistorySchema = z.array(z.strictObject({ stepId: Id, choiceId: Id })).max(COACH_LIMITS.history);
export type CoachHistory = z.infer<typeof HistorySchema>;
export const CoachContextSchema = z.strictObject({ requestId: z.uuid(), sessionId: z.uuid(), objectId: z.uuid().nullable(), revision: z.number().int().nonnegative(), catalogVersion: Id, flowId: Id, stepId: Id });
export type CoachContext = z.infer<typeof CoachContextSchema>;
const HelpTextSchema = z.string().max(COACH_LIMITS.text).refine(text => text.trim().length > 0, "빈 질문은 보낼 수 없습니다.");
/** Blob comes from the multipart boundary. WAV decoding remains a server responsibility. */
const HelpAudioSchema = z.instanceof(Blob).refine(audio => audio.size > 0 && audio.size <= COACH_LIMITS.audioBytes, "음성 파일 크기가 허용 범위를 벗어났습니다.");
export const CoachHelpRequestSchema = z.union([
  z.strictObject({ context: CoachContextSchema, choices: HistorySchema, text: HelpTextSchema }),
  z.strictObject({ context: CoachContextSchema, choices: HistorySchema, audio: HelpAudioSchema }),
]);
export type CoachHelpRequest = z.infer<typeof CoachHelpRequestSchema>;
export const CoachRecognizeRequestSchema = z.strictObject({ requestId: z.uuid(), sessionId: z.uuid(), revision: z.number().int().nonnegative(), region: z.literal("songpa"), mode: z.enum(["photo", "manual"]), photoIds: z.array(z.uuid()).max(COACH_LIMITS.photos), text: z.string().max(COACH_LIMITS.text) }).refine(v => new Set(v.photoIds).size === v.photoIds.length).refine(v => v.mode === "photo" ? v.photoIds.length > 0 : v.photoIds.length === 0 && v.text.trim().length > 0);
export type CoachRecognizeRequest = z.infer<typeof CoachRecognizeRequestSchema>;
export const CoachRecognitionResponseSchema = z.strictObject({ requestId: z.uuid(), sessionId: z.uuid(), revision: z.number().int().nonnegative(), catalogVersion: Id, outcome: z.enum(["identified", "needs_input"]), objects: z.array(ObservationSchema).max(COACH_LIMITS.objects), routes: z.array(z.strictObject({ objectId: z.uuid().nullable(), flowId: Id })).min(1).max(COACH_LIMITS.objects) }).refine(r => new Set(r.objects.map(o => o.objectId)).size === r.objects.length).refine(r => (r.outcome === "identified") === r.objects.some(o => o.recognition === "recognized"));
export type CoachRecognitionResponse = z.infer<typeof CoachRecognitionResponseSchema>;
export const CoachHelpResponseSchema = z.strictObject({ context: CoachContextSchema, transcript: z.string().max(COACH_LIMITS.text).nullable(), replyId: Id, text: Text, choiceIds: Ids, sourceIds: Ids.nonempty() });
export type CoachHelpResponse = z.infer<typeof CoachHelpResponseSchema>;
export const CoachSpeechRequestSchema = z.strictObject({ context: CoachContextSchema, choices: HistorySchema, cue: z.strictObject({ kind: z.enum(["step", "reply"]), id: Id }) });
export type CoachSpeechRequest = z.infer<typeof CoachSpeechRequestSchema>;
export const CoachErrorResponseSchema = z.strictObject({ requestId: z.uuid().nullable(), error: z.strictObject({ code: Id, message: Text, retryable: z.boolean() }) });

export function replayCoachHistory(flow: GuideFlow, input: unknown) {
  const history = HistorySchema.parse(input);
  const facts: Record<string, string> = {}; const visited: Step[] = [];
  const start = flow.steps.find(s => s.id === flow.startStepId);
  if (!start) throw new Error("시작 단계를 찾을 수 없습니다.");
  let step: Step = start;
  let ended = false;
  for (const h of history) {
    if (ended || h.stepId !== step.id) throw new Error("현재 단계와 선택 이력이 다릅니다.");
    const choice: Choice | undefined = step.choices.find(c => c.id === h.choiceId);
    if (!choice) throw new Error("허용되지 않은 선택입니다.");
    for (const [key, value] of Object.entries(choice.factPatch)) if (!flow.facts[key]?.values.includes(value)) throw new Error("허용되지 않은 사실입니다.");
    Object.assign(facts, choice.factPatch); visited.push(step);
    if (choice.nextStepId === null) { if (!["complete", "handoff"].includes(step.kind)) throw new Error("종료할 수 없는 단계입니다."); ended = true; }
    else { const next: Step | undefined = flow.steps.find(s => s.id === choice.nextStepId); if (!next || visited.some(s => s.id === next.id)) throw new Error("유효하지 않은 경로입니다."); step = next; }
  }
  // Optional part facts use their role as the key; none/absent is a user's report,
  // never an inference from a missing view. Keep the reviewed catalog immutable.
  const absentRoles = new Set(Object.entries(facts).filter(([, value]) => value === "none" || value === "absent").map(([role]) => role));
  if (absentRoles.size > 0) step = { ...step, targetRoles: step.targetRoles.filter(role => !absentRoles.has(role)), destinations: step.destinations.filter(d => !absentRoles.has(d.partRole)) };
  const encountered = ended ? visited : [...visited, step];
  const held = encountered.some(s => s.destinations.some(d => d.bin === "hold") || s.kind === "handoff");
  if (held && step.kind === "complete") throw new Error("보류된 부품이 있어 완료할 수 없습니다.");
  const destinations = new Map<string, Destination>();
  for (const s of encountered) for (const d of s.destinations) {
    if (absentRoles.has(d.partRole)) continue;
    const previous = destinations.get(d.partRole);
    // A broad handoff applies only to unresolved parts. Earlier destinations came
    // from this replayed path, so truncating or correcting history removes them.
    if (d.bin === "hold" && previous && previous.bin !== "hold") continue;
    destinations.set(d.partRole, d);
  }
  if (step.kind === "handoff") {
    const unresolved = new Set([...destinations.values()].filter(d => d.bin === "hold").map(d => d.partRole));
    step = { ...step, targetRoles: step.targetRoles.filter(role => unresolved.has(role)), destinations: step.destinations.filter(d => unresolved.has(d.partRole)) };
  }
  // Resolved and held parts stay distinct; any handoff still prevents overall completion.
  return { step, facts, visited, ended, held, destinations: [...destinations.values()] };
}

/** No stored facts enter replay: editing an earlier choice means truncating history first. */
export function validateCoachContext(catalog: GuideCatalog, contextInput: unknown, choices: unknown) {
  const context = CoachContextSchema.parse(contextInput);
  if (context.catalogVersion !== catalog.version) throw new Error("안내 기준이 변경됐습니다.");
  const flow = catalog.flows.find(f => f.id === context.flowId);
  if (!flow || (context.objectId === null && flow.categoryId !== null)) throw new Error("물건과 흐름이 일치하지 않습니다.");
  const result = replayCoachHistory(flow, choices);
  if (result.step.id !== context.stepId) throw new Error("현재 단계가 아닙니다.");
  // Validate each destination using only facts already reported before that step.
  const history = HistorySchema.parse(choices);
  for (let i = 0; i <= history.length; i++) {
    const state = replayCoachHistory(flow, history.slice(0, i));
    for (const d of state.step.destinations) if (d.bin !== "hold") for (const id of d.ruleIds) {
      const rule = catalog.rules.find(r => r.id === id);
      if (!rule || Object.entries(rule.conditions).some(([key, values]) => !values.includes(state.facts[key]) || state.facts[key] === "unknown")) throw new Error("배출 조건이 확인되지 않았습니다.");
    }
  }
  return { context, flow, ...result };
}

export function validateRecognitionResponse(catalog: GuideCatalog, input: unknown, request: { mode: "photo" | "manual"; photoIds: string[] }) {
  const response = CoachRecognitionResponseSchema.parse(input);
  if (response.catalogVersion !== catalog.version) throw new Error("안내 기준이 다릅니다.");
  for (const o of response.objects) {
    const cat = catalog.categories.find(c => c.id === o.categoryId);
    if (o.categoryId !== null && !cat) throw new Error("없는 범주입니다.");
    if (request.mode === "photo" && !o.views.length) throw new Error("물건의 사진 위치가 필요합니다.");
    for (const v of [o, ...o.parts].flatMap(p => p.views)) if (request.mode === "manual" || !request.photoIds.includes(v.photoId)) throw new Error("현재 사진이 아닙니다.");
    if (cat && o.parts.some(p => !cat.roles.includes(p.role))) throw new Error("허용되지 않은 부품입니다.");
    const routes = response.routes.filter(r => r.objectId === o.objectId);
    if (routes.length !== 1) throw new Error("물건별 흐름이 필요합니다.");
    const flow = catalog.flows.find(f => f.id === routes[0].flowId);
    if (!flow || (o.recognition === "recognized" ? flow.categoryId !== o.categoryId : flow.categoryId !== null)) throw new Error("인식 상태와 흐름이 다릅니다.");
  }
  if (response.objects.length === 0) {
    if (response.routes.length !== 1 || response.routes[0].objectId !== null || !catalog.flows.some(f => f.id === response.routes[0].flowId && f.categoryId === null)) throw new Error("복구 흐름이 필요합니다.");
  } else if (response.routes.length !== response.objects.length || response.routes.some(r => !response.objects.some(o => o.objectId === r.objectId))) throw new Error("물건과 흐름 수가 다릅니다.");
  return response;
}

export function validateCoachHelpRequest(catalog: GuideCatalog, input: unknown) {
  const request = CoachHelpRequestSchema.parse(input);
  return { request, ...validateCoachContext(catalog, request.context, request.choices) };
}

export function validateCoachHelpResponse(catalog: GuideCatalog, input: unknown, requestInput: unknown) {
  const response = CoachHelpResponseSchema.parse(input);
  const current = validateCoachHelpRequest(catalog, requestInput);
  const { context } = current.request;
  if ("text" in current.request) {
    if (response.transcript !== null) throw new Error("글 질문에는 음성 전사를 붙일 수 없습니다.");
  } else if (response.transcript === null || !HelpTextSchema.safeParse(response.transcript).success) throw new Error("음성 질문의 전사가 필요합니다.");
  if (Object.keys(context).some(k => response.context[k as keyof CoachContext] !== context[k as keyof CoachContext])) throw new Error("다른 요청의 도움 답입니다.");
  const reply = catalog.replies.find(r => r.id === response.replyId && r.allowedStepIds.includes(current.step.id) && current.step.replyIds.includes(r.id));
  if (!reply || response.text !== reply.text || JSON.stringify(response.choiceIds) !== JSON.stringify(reply.choiceIds) || JSON.stringify(response.sourceIds) !== JSON.stringify(reply.sourceIds)) throw new Error("검수된 도움 답이 아닙니다.");
  return response;
}

/** The synthesizer receives only this catalog-derived speechText, never request text. */
export function validateCoachSpeechRequest(catalog: GuideCatalog, input: unknown) {
  const request = CoachSpeechRequestSchema.parse(input);
  const current = validateCoachContext(catalog, request.context, request.choices);
  if (request.cue.kind === "step") {
    if (request.cue.id !== current.step.id) throw new Error("현재 단계의 음성만 요청할 수 있습니다.");
    return { request, ...current, speechText: current.step.speechText };
  }
  const reply = catalog.replies.find(r => r.id === request.cue.id && r.allowedStepIds.includes(current.step.id) && current.step.replyIds.includes(r.id));
  if (!reply) throw new Error("현재 단계에 허용된 도움 답이 아닙니다.");
  return { request, ...current, speechText: reply.speechText };
}
