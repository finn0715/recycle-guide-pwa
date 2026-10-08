import type { PreparationGuide } from "@/components/recycling/PreparationSummary";
import type { GuideCatalog } from "@/lib/contracts/coach";
import { QUICK_GUIDES } from "./quick-guides";

// Reuse reviewed recipes; aliases refer to the same material/use scope shown in each recipe.
export function preparationGuides(catalog: GuideCatalog): PreparationGuide[] {
  const aliases: Record<string, string> = { plastic_container: "takeaway_container", glass_bottle: "glass_jar" };
  const simple: Record<string, { scope: string; actionIds: string[]; destinationId: string; note: string }> = {
    vinyl_packaging: { scope: "비닐 포장재·봉투 · 내용물과 이물질을 없앤 뒤", actionIds: ["vinyl-empty", "vinyl-clean"], destinationId: "vinyl-bin", note: "고무·천·장판은 비닐류가 아니에요. 제거되지 않는 오염이나 남은 내용물의 처리는 따로 확인하세요." },
    metal_can: { scope: "음료용 알루미늄·식품용 철 캔 · 다른 재질 부품이 없는 경우", actionIds: ["can-empty", "can-rinse"], destinationId: "can-bin", note: "가스·스프레이 용기는 이 방법을 적용하지 마세요. 구멍을 뚫거나 가열하지 마세요." },
    metal_scrap: { scope: "전기제품이 아닌 단일 금속 · 고무·천·플라스틱 부품이 없는 경우", actionIds: ["scrap-clean"], destinationId: "scrap-bin", note: "재질이 섞였거나 안전하게 준비하기 어려우면 멈추세요. 분리하려고 부수지 마세요." },
    paper: { scope: "마르고 깨끗한 비코팅 종이 · 코팅 표지·스프링·스티커가 없는 경우", actionIds: ["paper-stack"], destinationId: "paper-bin", note: "젖음·기름때·코팅이나 다른 재질이 남아 있으면 이 방법을 적용하지 마세요." },
  };
  return catalog.categories.flatMap<PreparationGuide>(category => {
    const recipe = QUICK_GUIDES.find(guide => guide.id === (aliases[category.id] ?? category.id));
    if (recipe) return [{ categoryId: category.id, label: category.label, question: recipe.question, methods: recipe.methods }];
    const flow = catalog.flows.find(flow => flow.categoryId === category.id)!;
    const config = simple[category.id];
    const steps = config ? config.actionIds.map(id => flow.steps.find(step => step.id === id)!) : flow.steps.filter(step => step.kind === "handoff");
    const destination = config ? flow.steps.find(step => step.id === config.destinationId)! : undefined;
    const sourceIds = new Set([...steps, ...(destination ? [destination] : [])].flatMap(step => step.sourceIds));
    return [{ categoryId: category.id, label: category.label, methods: [{ id: "basic", label: "배출 방법", scope: config?.scope ?? "공식 수거·문의 안내", steps: steps.map(step => step.text), parts: destination?.destinations.map(item => ({ name: category.label, bin: item.label })) ?? [], note: config?.note ?? "", ruleIds: [...new Set(steps.flatMap(step => step.ruleIds))], sources: catalog.sources.filter(source => sourceIds.has(source.id)) }] }];
  });
}
