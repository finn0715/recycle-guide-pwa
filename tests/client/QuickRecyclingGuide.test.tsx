// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QuickRecyclingGuide } from '@/components/recycling/QuickRecyclingGuide';
import { QUICK_GUIDES } from '@/data/quick-guides';
import { createQuickGuideController } from '@/lib/client/quick-guide-controller';
afterEach(cleanup);
function setup() {const transport=vi.fn();const controller=createQuickGuideController({transport,revoke:vi.fn()});render(<QuickRecyclingGuide guides={QUICK_GUIDES} controller={controller}/>);return {transport,controller};}
describe('one-tap guide UI',()=>{
  it('shows pump preparation in one tap, without a questionnaire or a second submit',()=>{
    const {transport}=setup();fireEvent.click(screen.getByRole('button',{name:'샴푸통 배출 방법'}));
    expect(screen.getByText('플라스틱 본체')).toBeVisible();expect(screen.getByText('일반쓰레기')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();expect(transport).not.toHaveBeenCalled();
  });
  it('switches food residue guidance immediately',()=>{
    const {transport}=setup();fireEvent.click(screen.getByRole('button',{name:'배달 용기 배출 방법'}));
    fireEvent.click(screen.getByRole('button',{name:'음식물이 안 지워져요'}));
    expect(screen.getByText('음식물이 안 지워지는 본체')).toBeVisible();expect(screen.getByText('일반쓰레기')).toBeVisible();expect(transport).not.toHaveBeenCalled();
  });
  it('requires one coolant choice, applies it immediately, and does not carry it to a new item',()=>{
    setup();fireEvent.click(screen.getByRole('button',{name:'아이스팩 배출 방법'}));
    expect(screen.queryByLabelText('부품별 버리는 곳')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'고흡수성수지(SAP) 젤'}));expect(screen.getByText('젤 아이스팩 통째로')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'물건 바꾸기'}));fireEvent.click(screen.getByRole('button',{name:'스티로폼 배출 방법'}));
    expect(screen.queryByLabelText('부품별 버리는 곳')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'식품 배송 상자'}));expect(screen.queryByLabelText('부품별 버리는 곳')).not.toBeInTheDocument();
  });
});
