import type { Metadata } from "next";
import OverviewSection from "@/components/sections/OverviewSection";

export const metadata: Metadata = { title: { absolute: "Hiro AMR Control" } };

export default function Page() {
  return <OverviewSection />;
}
