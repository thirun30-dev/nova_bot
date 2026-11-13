import type { Metadata } from "next";
import MissionsSection from "@/components/sections/MissionsSection";

export const metadata: Metadata = { title: "Missions" };

export default function Page() {
  return <MissionsSection />;
}
