import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terreno",
  description: "Pay a real person, anywhere, to check something in the physical world.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
