import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createAnalyzeHandler } from "@/lib/server/analyze";
import { identifyRequest, resolveIdentification } from "@/lib/server/identify";
import { POST } from "@/app/api/identify/route";
import { createQuickGuideController, identifyPhotos } from "@/lib/client/quick-guide-controller";
import { QUICK_GUIDES } from "@/data/quick-guides";
import { ITEMS, type ItemId } from "@/lib/contracts";
import { RULES, SOURCES } from "@/data/disposal-rules";
import { ApiFailure, type PreparedAnalysis } from "@/lib/server/analyze-request";

let photo: File;
beforeAll(async () => { photo = new File([new Uint8Array(await sharp({create:{width:16,height:12,channels:3,background:'white'}}).jpeg().toBuffer())], 'product.jpg', {type:'image/jpeg'}); });
afterEach(() => vi.unstubAllGlobals());
const id = "b82fb366-9e28-49b4-856f-3daaaab063f7";
const identified = (items: ItemId[]) => ({requestId:id,outcome:"identified" as const,items,hasOtherItems:false});
const prepare = async (file: File) => ({id:'photo',name:file.name,url:'blob:photo',file});

function connect(output: unknown) {
  const model = vi.fn(async (_input: PreparedAnalysis) => { expect(_input.images.every(image => image.startsWith("data:image/jpeg;base64,"))).toBe(true); return output; });
  const handler = createAnalyzeHandler({model,resolve:resolveIdentification});
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/identify');
    const response = await handler(new Request(new URL(url,'http://localhost'),init));
    expect(response.headers.get('cache-control')).toBe('no-store');
    return response;
  });
  vi.stubGlobal('fetch',fetcher);
  return {model,fetcher};
}

describe('quick preparation flow through real multipart and image decoding', () => {
  it('exports the actual guarded photo handler', async () => {
    expect(POST).toBe(identifyRequest);
    const response=await POST(new Request('http://localhost/api/identify',{method:'POST',body:'bad'}));
    expect(response.status).toBe(400);
  });
  it('identifies multiple products once, then switches products and conditions without another AI call', async () => {
    const {model,fetcher}=connect({outcome:'identified',items:['pump_bottle','clear_pet_bottle','ice_pack'],hasOtherItems:false});
    const controller=createQuickGuideController({prepare,revoke:vi.fn()});
    await controller.selectPhotos([photo,photo,photo]);
    expect(model).toHaveBeenCalledOnce();
    expect(model.mock.calls[0][0].images).toHaveLength(0); // request memory released after processing
    expect(controller.getSnapshot().items).toEqual(['pump_bottle','clear_pet_bottle','ice_pack']);
    controller.pickItem('ice_pack','photo'); controller.pickMethod('water');
    expect(controller.getSnapshot().methodId).toBe('water');
    controller.pickItem('clear_pet_bottle','photo');
    expect(controller.getSnapshot().methodId).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects invented IDs, generated advice, duplicate IDs and inconsistent recognition output', async () => {
    for(const output of [
      {outcome:'identified',items:['battery'],hasOtherItems:false},
      {outcome:'identified',items:['toothbrush'],hasOtherItems:false,advice:'made up'},
      {outcome:'identified',items:['toothbrush','toothbrush'],hasOtherItems:false},
      {outcome:'unsupported',items:['toothbrush'],hasOtherItems:false},
      {outcome:'identified',items:[],hasOtherItems:false},
    ]) expect(()=>resolveIdentification(id,output)).toThrow(ApiFailure);
  });
  it.each(['unclear','unsupported'] as const)('lets the user manually pick after %s without pretending AI recognized it', async outcome => {
    const {fetcher}=connect({outcome,items:[],hasOtherItems:false});
    const controller=createQuickGuideController({prepare,revoke:vi.fn()});
    await controller.selectPhotos([photo]);
    expect(controller.getSnapshot().activeId).toBeNull();
    expect(controller.getSnapshot().notice).toBeTruthy();
    controller.pickItem('toothbrush');
    expect(controller.getSnapshot()).toMatchObject({activeId:'toothbrush',origin:'manual'});
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('never replaces a manual choice with a late photo response', async () => {
    let finish!: (value:ReturnType<typeof identified>)=>void;
    const controller=createQuickGuideController({prepare,revoke:vi.fn(),transport:()=>new Promise(resolve=>{finish=resolve;})});
    const request=controller.selectPhotos([photo]);
    await vi.waitFor(()=>expect(controller.getSnapshot().status).toBe('loading'));
    controller.pickItem('ice_pack'); controller.pickMethod('gel');
    finish(identified(['pump_bottle'])); await request;
    expect(controller.getSnapshot()).toMatchObject({activeId:'ice_pack',methodId:'gel',origin:'manual'});
  });
  it('releases prepared photos that finish after reset', async () => {
    let finish!: (value:Awaited<ReturnType<typeof prepare>>)=>void;
    const revoke=vi.fn();const transport=vi.fn();
    const controller=createQuickGuideController({revoke,transport,prepare:()=>new Promise(resolve=>{finish=resolve;})});
    const task=controller.selectPhotos([photo]); controller.reset(); finish(await prepare(photo)); await task;
    expect(controller.getSnapshot().photos).toEqual([]);expect(revoke).toHaveBeenCalledWith('blob:photo');expect(transport).not.toHaveBeenCalled();
  });
  it('rejects too many photos without making a paid request', async () => {
    const transport=vi.fn();const controller=createQuickGuideController({prepare,revoke:vi.fn(),transport});
    await controller.selectPhotos([photo,photo,photo,photo]);
    expect(controller.getSnapshot().error).toContain('3장');expect(transport).not.toHaveBeenCalled();
  });
  it('retains photos for a manual retry after a transport error', async () => {
    const transport=vi.fn().mockRejectedValueOnce(new Error('연결 실패')).mockResolvedValueOnce(identified(['toothbrush']));
    const controller=createQuickGuideController({prepare,revoke:vi.fn(),transport});
    await controller.selectPhotos([photo]);expect(controller.getSnapshot().photos).toHaveLength(1);
    await controller.retry();expect(controller.getSnapshot().activeId).toBe('toothbrush');
  });
  it('shares the two-request admission bound across identification and detailed endpoints', async () => {
    const admission={active:0};
    const model=vi.fn<() => Promise<unknown>>();
    // Both calls wait on one externally controlled promise; a third request never starts work.
    let finish!: (value:unknown)=>void;
    const pending=new Promise(resolve=>{finish=resolve;});
    model.mockImplementation(()=>pending);
    const first=createAnalyzeHandler({model,resolve:resolveIdentification,admission});
    const second=createAnalyzeHandler({model,resolve:resolveIdentification,admission});
    const request=()=>{const form=new FormData();form.set('requestId',id);form.set('region','songpa');form.set('messages','[]');form.set('photos',photo);return new Request('http://localhost/api/identify',{method:'POST',body:form});};
    const one=first(request()); const two=second(request());
    expect((await second(request())).status).toBe(503);
    finish({outcome:'identified',items:['toothbrush'],hasOtherItems:false});
    expect((await one).status).toBe(200); expect((await two).status).toBe(200); expect(admission.active).toBe(0);
  });
  it('does not accept mismatched response IDs', async () => {
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json(identified(['toothbrush']))));
    await expect(identifyPhotos([photo],new AbortController().signal)).rejects.toThrow('결과');
  });
});

describe('authored preparation recipes', () => {
  it('covers exactly the ten families with official sources and reviewed rule references', () => {
    expect(QUICK_GUIDES.map(x=>x.id).sort()).toEqual(Object.keys(ITEMS).sort());
    for(const guide of QUICK_GUIDES) for(const method of guide.methods) {
      expect(method.scope).toBeTruthy();expect(method.steps.length).toBeGreaterThan(0);expect(method.sources.length).toBeGreaterThan(0);
      expect(method.ruleIds.every(id=>RULES.some(rule=>rule.id===id && rule.item===guide.id && rule.reviewStatus==='reviewed'))).toBe(true);
      expect(method.sources.every(source=>SOURCES.some(s=>s.id===source.id && s.url===source.url))).toBe(true);
      if(method.parts.length) expect(method.ruleIds.length).toBeGreaterThan(0);
    }
  });
  it('does not default coolant or EPS use, and never turns conflicting variants into disposal answers', () => {
    for(const item of ['ice_pack','foam_box']) expect(QUICK_GUIDES.find(x=>x.id===item)?.question).toBeTruthy();
    expect(QUICK_GUIDES.find(x=>x.id==='ice_pack')?.methods.find(x=>x.id==='unknown')?.parts).toEqual([]);
    expect(QUICK_GUIDES.find(x=>x.id==='foam_box')?.methods.find(x=>x.id==='food')?.parts).toEqual([]);
  });
});
