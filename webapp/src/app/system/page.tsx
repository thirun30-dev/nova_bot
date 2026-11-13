import type { Metadata } from "next";
import SystemSection from "@/components/sections/SystemSection";

export const metadata: Metadata = { title: "System" };

export default function Page() {
  return <SystemSection />;
}
