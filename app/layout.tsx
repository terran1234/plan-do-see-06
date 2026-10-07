import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "플랜두씨 다이어리",
  description: "계획(Plan) → 실제로 한 일(Do) → 돌아보기(See)를 잇는 다이어리",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <a href="/" className="brand">📓 플랜두씨 다이어리</a>
            <p className="tagline" aria-label="계획, 실제로 한 일, 돌아보기">
              <span>Plan 계획</span>→<span>Do 실행</span>→<span>See 돌아보기</span>
            </p>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
