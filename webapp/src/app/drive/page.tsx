import type { Metadata } from "next";
import DriveSection from "@/components/sections/DriveSection";

export const metadata: Metadata = { title: "Drive" };

export default function Page() {
  return <DriveSection />;
}
