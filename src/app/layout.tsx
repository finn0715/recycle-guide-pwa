import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"RecycleGuide | 분리배출 도우미",description:"헷갈리는 생활용품, 사진으로 확인하는 분리배출 안내"};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ko"><body>{children}</body></html>;}
