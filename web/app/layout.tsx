import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Media2Text Console",
  description: "Operator console for the Media2Text ingestion engine",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
