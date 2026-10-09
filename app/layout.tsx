import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import UserBar from "./UserBar";

export const metadata: Metadata = {
  title: "조경익의 다이어리",
  description: "계획(Plan) → 실제로 한 일(Do) → 돌아보기(See)를 잇는 나만의 다이어리",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <a href="/" className="brand">📓 조경익의 다이어리</a>
            <p className="tagline" aria-label="계획, 실제로 한 일, 돌아보기">
              <span>Plan 계획</span>→<span>Do 실행</span>→<span>See 돌아보기</span>
            </p>
            <Suspense>
              <UserBar />
            </Suspense>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <p>© 조경익 · 계획하고, 실행하고, 돌아보는 나만의 다이어리</p>
        </footer>
      </body>
    </html>
  );
}
