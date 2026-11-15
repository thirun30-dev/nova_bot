import type { Metadata, Viewport } from "next";
import { RobotProvider } from "@/components/RobotProvider";
import Shell from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Nova AMR Control", template: "%s · Nova AMR" },
  description: "Control, map and task the Nova autonomous mobile robot.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%233b82f6'/%3E%3Ctext x='16' y='23' font-family='sans-serif' font-size='19' font-weight='700' fill='white' text-anchor='middle'%3EH%3C/text%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = { themeColor: "#0b1120", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans text-sm">
        <RobotProvider>
          <Shell>{children}</Shell>
        </RobotProvider>
      </body>
    </html>
  );
}
