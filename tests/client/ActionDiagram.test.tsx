// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActionDiagram, PartShape, diagramFor } from "@/components/recycling/ActionDiagram";
import { COACH_CATALOG } from "@/data/coach-guides";
afterEach(cleanup);
const getStep=(id:string)=>COACH_CATALOG.flows.flatMap(f=>f.steps).find(s=>s.id===id)!;
describe("material-specific household diagrams",()=>{
  it.each(["metal_scrap","toothbrush","cardboard_box","foam_box","drink_carton","paper","glass_bottle","ice_pack","battery","electronic","bulky","hazardous"])("draws a distinct %s silhouette",categoryId=>{
    const {container}=render(<svg><PartShape categoryId={categoryId}/></svg>);
    expect(container.querySelector(`[data-shape="${categoryId}"]`)).not.toBeNull();
    expect(container.innerHTML).not.toContain('M28 6h24v17');
  });
  it("keeps confirmed water emptying distinct from inspecting an already empty shampoo bottle",()=>{
    expect(diagramFor(getStep("ice-water-empty"))).toBe("water-pack-empty");
    expect(diagramFor(getStep("pump-empty"))).toBe("empty");
    render(<ActionDiagram step={getStep("ice-water-empty")} categoryId="ice_pack"/>);
    expect(screen.getByRole("img")).toHaveAccessibleName(/물 100%/);
    expect(screen.getByText("물만 비우기")).toBeVisible();
  });
  it("illustrates drying cartons and gathering paper instead of putting them into a bin mid-action",()=>{
    expect(diagramFor(getStep("carton-dry"))).toBe("carton-dry");
    expect(diagramFor(getStep("paper-stack"))).toBe("paper-stack");
  });
  it("does not invent a loose label on a toothbrush hold example",()=>{
    const {container}=render(<ActionDiagram step={getStep("toothbrush-hold")} categoryId="toothbrush"/>);
    expect(container.querySelector('[data-shape="label"]')).toBeNull();
  });
});
