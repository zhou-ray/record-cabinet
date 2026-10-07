import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Record Cabinet — The Listening Room",
  description: "Slow down and dig through five imaginary records in a tactile listening room.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
