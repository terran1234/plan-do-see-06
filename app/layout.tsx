import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "플랜두씨 다이어리",
  description: "계획(Plan) → 실제로 한 일(Do) → 돌아보기(See)를 잇는 다이어리",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
